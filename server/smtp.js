// SMTP 服务：MX 收信(25) + Submission 发信(587, SASL 认证) + SMTPS(465 隐式 TLS)
import { SMTPServer } from 'smtp-server';
import bcrypt from 'bcryptjs';
import mailparser from 'mailparser';
import { q, now, audit } from './db.js';
import { config } from './config.js';
import { processInbound } from './mail/delivery.js';
import { storeMessage, saveAttachmentBuffer, isBlacklisted } from './mail/mailstore.js';
import { resolveRcpt } from './mail/delivery.js';
import { getTLSContext } from './util/tlsutil.js';

const { simpleParser } = mailparser;

// 简单连接级限流：每 IP 每分钟最多 30 封
const rateMap = new Map();
function rateLimited(ip) {
  const key = ip || 'unknown';
  const nowMs = Date.now();
  let rec = rateMap.get(key);
  if (!rec || nowMs - rec.start > 60000) {
    rec = { start: nowMs, count: 0 };
    rateMap.set(key, rec);
  }
  rec.count++;
  return rec.count > 30;
}

function tlsOpts() {
  const ctx = getTLSContext();
  return ctx ? { key: ctx.key, cert: ctx.cert } : {};
}

function addrStr(addressObject) {
  return (addressObject?.value || []).map(v => v.address || '').filter(Boolean).join(', ');
}

async function handleData(stream, session, callback) {
  const chunks = [];
  let size = 0;
  let tooBig = false;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > config.smtpMaxSize) { tooBig = true; continue; }
    chunks.push(chunk);
  }
  if (tooBig) { console.error(`[smtp] 拒收: 邮件超过大小限制 from=${session.remoteAddress} (${size}B)`); return callback(new Error('邮件超过大小限制')); }
  const raw = Buffer.concat(chunks);
  const remoteIp = session.remoteAddress;
  const rcpts = session.envelope.rcptTo.map(r => r.address);
  const sender = session.envelope.mailFrom?.address || '';
  const isSubmission = session.isSubmission === true;

  try {
    if (isSubmission) {
      // 用户认证发信：站内直投 + 站外入队；不经过反垃圾
      const user = session.user;
      const parsed = await simpleParser(raw);
      const meta = {
        fromName: user.display_name || '', fromAddr: user.address,
        toAddrs: addrStr(parsed.to), ccAddrs: addrStr(parsed.cc), bccAddrs: addrStr(parsed.bcc),
        replyTo: addrStr(parsed.replyTo), subject: parsed.subject || '(无主题)',
        messageId: parsed.messageId || '', inReplyTo: parsed.inReplyTo || '',
        references: parsed.references || '', bodyText: parsed.text || '',
        bodyHtml: typeof parsed.html === 'string' ? parsed.html : '',
        date: parsed.date ? parsed.date.getTime() : now(), spamScore: 0,
        authResults: 'submission-auth', size: raw.length,
      };
      const atts = [];
      for (const a of parsed.attachments || []) {
        const saved = saveAttachmentBuffer(user.id, a.filename, a.contentType, a.content, a.cid);
        atts.push({ ...saved, isInline: !!a.related });
      }
      for (const rcpt of rcpts) {
        const target = resolveRcpt(rcpt);
        if (target) {
          storeMessage(target.userId, meta, atts.map(a => ({ ...a })), { isOutgoing: true, folderType: 'inbox', rawEml: raw.toString('utf8') });
        } else {
          q.run('INSERT INTO outbound_queue(message_id, sender, recipient, raw_eml, next_attempt_at, created_at) VALUES(?,?,?,?,?,?)',
            null, user.address, rcpt, raw.toString('utf8'), now(), now());
        }
      }
      // 发件副本
      const sentFolder = q.get("SELECT id FROM folders WHERE user_id = ? AND type = 'sent'", user.id);
      storeMessage(user.id, meta, atts, { isOutgoing: true, folderId: sentFolder.id, isRead: true, skipFilters: true, rawEml: raw.toString('utf8'), sendStatus: 'sent' });
      audit(user.id, user.address, 'mail.send_smtp', `submission to=[${rcpts.join(',')}] subject="${meta.subject}"`);
      callback();
    } else {
      // MX 收信
      const { results } = await processInbound({ sender, rcptTo: rcpts, raw, remoteIp, helo: session.clientHostname });
      const failed = results.filter(r => !r.ok);
      if (failed.length) {
        console.error(`[smtp] 入站投递失败 from=${sender}: ${JSON.stringify(failed).slice(0, 300)}`);
        const allRejected = results.every(r => !r.ok);
        if (allRejected) return callback(new Error('投递失败: ' + failed.map(r => r.reason).join('; ')));
      }
      const delivered = results.filter(r => r.ok);
      if (delivered.length) console.log(`[smtp] 已收下 from=${sender} to=[${delivered.map(r => r.rcpt).join(',')}] score=${delivered[0].score?.toFixed(1) ?? '?'}`);
      callback();
    }
  } catch (err) {
    console.error('[smtp] 处理邮件失败:', err.message);
    callback(new Error('内部处理错误'));
  }
}

export function startSMTPServers() {
  const tls = tlsOpts();

  // ---- 端口 25：MX 服务器间投递 ----
  const mx = new SMTPServer({
    ...tls,
    banner: `${config.siteName} ESMTP ready`,
    authOptional: true,
    disabledCommands: ['AUTH'],
    size: config.smtpMaxSize,
    onConnect(session, cb) {
      console.log(`[smtp] 收信连入 from ${session.remoteAddress}`);
      cb();
    },
    onRcptTo(address, session, cb) {
      if (rateLimited(session.remoteAddress)) return cb(new Error('发送频率超限，请稍后再试'));
      const target = resolveRcpt(address.address);
      if (!target) {
        console.log(`[smtp] 拒收（收件人不存在）${address.address} from ${session.remoteAddress}`);
        return cb(new Error(`<${address.address}> 收件人不存在`));
      }
      cb();
    },
    onData(stream, session, cb) { handleData(stream, session, cb); },
    onMailFrom(address, session, cb) {
      cb();
    },
  });

  // ---- 端口 587 / 465：Submission，必须认证 ----
  const submissionHandler = (isImplicitTls) => {
    const srv = new SMTPServer({
      ...tls,
      secure: isImplicitTls,
      banner: `${config.siteName} Submission ready`,
      size: config.smtpMaxSize,
      allowInsecureAuth: true, // 开发环境自签证书时允许明文认证；生产建议启用外部 TLS 后关闭
      onAuth(auth, session, cb) {
        const username = String(auth.username || '').toLowerCase().trim();
        const fullAddr = username.includes('@') ? username : `${username}@${config.primaryDomain}`;
        const user = q.get('SELECT * FROM users WHERE address = ? OR address = ?', fullAddr, username);
        if (!user || user.status === 'banned') return cb(new Error('认证失败：用户不存在或已禁用'));
        bcrypt.compare(String(auth.password || ''), user.password_hash).then(match => {
          if (!match) return cb(new Error('认证失败：密码错误'));
          cb(null, { user });
        });
      },
      onRcptTo(address, session, cb) {
        if (!session.user) return cb(new Error('需要认证'));
        if (rateLimited(session.remoteAddress)) return cb(new Error('发送频率超限，请稍后再试'));
        cb();
      },
      onData(stream, session, cb) {
        session.isSubmission = true;
        handleData(stream, session, cb);
      },
    });
    srv.on('error', (err) => console.error('[smtp] Submission 服务错误:', err.message));
    return srv;
  };

  const servers = [];
  mx.on('error', (err) => console.error('[smtp] MX 服务错误:', err.message));
  try {
    mx.listen(config.smtpPort, () => console.log(`[smtp] MX 收信端口 :${config.smtpPort} (生产 25)`));
    servers.push(mx);
  } catch (e) { console.error('[smtp] MX 端口监听失败:', e.message); }

  try {
    const sub = submissionHandler(false);
    sub.on('error', (err) => console.error('[smtp] Submission 服务错误:', err.message));
    sub.listen(config.submissionPort, () => console.log(`[smtp] Submission 端口 :${config.submissionPort} (生产 587, SASL)`));
    servers.push(sub);
  } catch (e) { console.error('[smtp] Submission 监听失败:', e.message); }

  if (tls.cert) {
    try {
      const smtps = submissionHandler(true);
      smtps.on('error', (err) => console.error('[smtp] SMTPS 服务错误:', err.message));
      smtps.listen(config.smtpsPort, () => console.log(`[smtp] SMTPS 端口 :${config.smtpsPort} (生产 465, 隐式 TLS)`));
      servers.push(smtps);
    } catch (e) { console.error('[smtp] SMTPS 监听失败:', e.message); }
  }
  return servers;
}
