// 收信投递引擎：解析 → SPF/DKIM/DMARC 认证 → 反垃圾评分 → 路由（用户/别名/Catch-all）→ 入库
import mailparser from 'mailparser';
import { authenticate } from 'mailauth';
import dns from 'node:dns';
import { q, now, audit } from '../db.js';
import { config } from '../config.js';
import {
  storeMessage, saveAttachmentBuffer, isBlacklisted, getFolderByType,
} from './mailstore.js';

const { simpleParser: parse } = mailparser;

// 垃圾关键词表（可按需扩展）
const SPAM_KEYWORDS = [
  'viagra', 'casino', 'lottery', 'winner', 'free money', 'bitcoin giveaway',
  '彩票', '中奖', '开票', '贷款', '刷单', '博彩', '裸聊', '代办毕业证',
];

export function isLocalDomain(domain) {
  return !!q.get('SELECT id FROM domains WHERE name = ?', domain.toLowerCase());
}

// RCPT 阶段：判断收件地址是否可投递（真实邮箱 / 别名 / Catch-all）
export function resolveRcpt(address) {
  const addr = String(address).toLowerCase().trim();
  const direct = q.get("SELECT id, address FROM users WHERE address = ? AND status = 'active'", addr);
  if (direct) return { kind: 'user', userId: direct.id, address: direct.address };
  const alias = q.get('SELECT * FROM aliases WHERE source = ? AND enabled = 1', addr);
  if (alias) {
    const dest = q.get("SELECT id, address FROM users WHERE address = ?", alias.destination);
    if (dest) return { kind: 'alias', userId: dest.id, address: dest.address, via: alias.source };
  }
  const domain = addr.split('@')[1];
  if (domain) {
    const d = q.get('SELECT * FROM domains WHERE name = ?', domain.toLowerCase());
    if (d && d.catch_all_mailbox) {
      const dest = q.get("SELECT id, address FROM users WHERE address = ?", d.catch_all_mailbox);
      if (dest) return { kind: 'catch_all', userId: dest.id, address: dest.address, via: d.catch_all_mailbox };
    }
  }
  return null;
}

// ---------- 反垃圾评分 ----------
function spamScore(parsed, auth, sender, helo) {
  let score = 0;
  const reasons = [];
  if (config.antispam.enabled) {
    const spf = auth?.spf?.[0]?.result || auth?.spf?.result || 'none';
    const dkimResults = auth?.dkim?.results || [];
    const dkimPass = dkimResults.some(r => r.result === 'pass');
    const dmarc = auth?.dmarc?.[0]?.result || auth?.dmarc?.result || 'none';
    if (spf === 'fail') { score += 3; reasons.push('SPF fail'); }
    else if (spf === 'softfail') { score += 1.5; reasons.push('SPF softfail'); }
    else if (spf === 'none') { score += 0.5; reasons.push('no SPF'); }
    if (!dkimPass) { score += 1; reasons.push('no valid DKIM'); }
    if (dmarc === 'fail') { score += 2.5; reasons.push('DMARC fail'); }

    if (!parsed.messageId) { score += 0.5; reasons.push('missing Message-ID'); }
    const text = `${parsed.subject || ''} ${parsed.text || ''}`.toLowerCase();
    let kw = 0;
    for (const k of SPAM_KEYWORDS) if (text.includes(k)) kw++;
    if (kw) { score += Math.min(kw * 1.5, 4.5); reasons.push(`${kw} spam keyword(s)`); }
    if (parsed.subject && parsed.subject === parsed.subject.toUpperCase() && parsed.subject.length > 10) {
      score += 0.5; reasons.push('ALL-CAPS subject');
    }
    if (helo && /\d+\.\d+\.\d+\.\d+/.test(helo) && !/[a-z]/.test(helo)) {
      score += 1; reasons.push('IP-like HELO');
    }
  }
  return { score, reasons: reasons.join(', ') };
}

function authSummary(auth) {
  if (!auth) return 'none';
  const spf = auth.spf?.[0]?.result || auth.spf?.result || 'none';
  const dkim = (auth.dkim?.results || []).map(r => `${r.domain}=${r.result}`).join(' ') || 'none';
  const dmarc = auth.dmarc?.[0]?.result || auth.dmarc?.result || 'none';
  return `spf=${spf} dkim=${dkim} dmarc=${dmarc}`;
}

// ---------- 解析原始报文 ----------
async function parseRaw(raw) {
  const parsed = await parse(raw, { skipImageLinks: true });
  const attachments = [];
  const inlineImages = [];
  for (const a of parsed.attachments || []) {
    if (a.related && a.cid) {
      inlineImages.push(a);
    } else {
      attachments.push(a);
    }
  }
  return { parsed, attachments, inlineImages };
}

function metaFromParsed(parsed, { sender, helo, scoreObj, authStr, size }) {
  const addrOf = (p) => (p?.value || []).map(v => v.address || '').filter(Boolean).join(', ');
  return {
    fromName: parsed.from?.value?.[0]?.name || '',
    fromAddr: parsed.from?.value?.[0]?.address || sender || '',
    toAddrs: addrOf(parsed.to),
    ccAddrs: addrOf(parsed.cc),
    bccAddrs: addrOf(parsed.bcc),
    replyTo: addrOf(parsed.replyTo),
    subject: parsed.subject || '(无主题)',
    messageId: parsed.messageId || '',
    inReplyTo: parsed.inReplyTo || '',
    references: parsed.references || '',
    bodyText: parsed.text || '',
    bodyHtml: typeof parsed.html === 'string' ? parsed.html : '',
    date: parsed.date ? parsed.date.getTime() : now(),
    spamScore: scoreObj?.score ?? 0,
    authResults: authStr,
    size: size || 0,
  };
}

/**
 * 处理一封入站邮件（SMTP 端口 25 / 587 均走此函数）
 * @returns {Array} 每个收件人的投递结果
 */
export async function processInbound({ sender, rcptTo, raw, remoteIp = '', helo = '' }) {
  const { parsed, attachments, inlineImages } = await parseRaw(raw);
  const size = Buffer.byteLength(raw);

  // DKIM/SPF/DMARC 认证（离线环境 DNS 失败时降级为 none）
  let auth = null;
  try {
    auth = await authenticate(Buffer.from(raw), {
      ip: remoteIp, helo: helo || remoteIp,
      mfrom: sender, rcptTo,
      resolver: { resolveMx: (d, cb) => dns.resolveMx(d, cb), resolveTxt: (d, cb) => dns.resolveTxt(d, cb), resolve: (d, t, cb) => dns.resolve(d, t, cb) },
    });
  } catch { auth = null; }

  const scoreObj = spamScore(parsed, auth, sender, helo);
  const authStr = authSummary(auth);
  const meta = metaFromParsed(parsed, { sender, helo, scoreObj, authStr, size });

  // 存储附件到临时（按收件人复制）
  const results = [];
  for (const rcpt of rcptTo) {
    const target = resolveRcpt(rcpt);
    if (!target) {
      results.push({ rcpt, ok: false, reason: 'unknown recipient' });
      continue;
    }
    // 用户级/全局黑名单 → 直接送垃圾箱
    const blacklisted = isBlacklisted(target.userId, meta.fromAddr);
    if (blacklisted) meta.spamScore = Math.max(meta.spamScore, 10);

    try {
      const storedAtts = [];
      for (const a of attachments) {
        const saved = saveAttachmentBuffer(target.userId, a.filename, a.contentType, a.content);
        storedAtts.push({ ...saved, isInline: false });
      }
      for (const a of inlineImages) {
        const saved = saveAttachmentBuffer(target.userId, a.filename || a.cid, a.contentType, a.content, a.cid);
        storedAtts.push({ ...saved, isInline: true });
      }
      const msgId = storeMessage(target.userId, meta, storedAtts, {
        folderType: blacklisted ? 'junk' : 'inbox',
      });
      results.push({ rcpt, ok: true, userId: target.userId, messageId: msgId, kind: target.kind, score: meta.spamScore });
      audit(target.userId, target.address, 'mail.deliver',
        `from=${meta.fromAddr} subject="${meta.subject}" score=${meta.spamScore.toFixed(1)} auth=[${authStr}]`, remoteIp);
    } catch (err) {
      results.push({ rcpt, ok: false, reason: err.code === 'QUOTA' ? 'mailbox full' : err.message });
    }
  }
  return { results, meta, parsed, auth };
}

// 系统通知邮件（投递失败回执等）
export function deliverSystemMail(toAddress, subject, text) {
  const target = resolveRcpt(toAddress);
  if (!target) return null;
  return storeMessage(target.userId, {
    fromName: config.siteName + ' 系统',
    fromAddr: 'postmaster@' + config.primaryDomain,
    toAddrs: toAddress,
    subject,
    bodyText: text,
    bodyHtml: `<pre style="font-family:inherit;white-space:pre-wrap">${text.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</pre>`,
    messageId: `<sys-${Date.now()}-${Math.random().toString(36).slice(2)}@${config.primaryDomain}>`,
    date: now(),
    spamScore: 0,
    authResults: 'internal',
    size: text.length,
  }, [], { isOutgoing: true, skipFilters: true, noThread: true });
}
