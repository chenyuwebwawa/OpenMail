// 发信引擎：构建 MIME → DKIM 签名 → 站内投递 + 站外队列（中继/直投 MX）
import nodemailer from 'nodemailer';
import { q, now, audit } from '../db.js';
import { config } from '../config.js';
import { storeMessage, getFolderByType } from './mailstore.js';
import { resolveRcpt } from './delivery.js';
import crypto from 'node:crypto';
import fs from 'node:fs';

// 流式构建原始报文（buffer 模式）
const composer = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });

function dkimOptions(domain) {
  const d = q.get('SELECT * FROM domains WHERE name = ?', domain.toLowerCase());
  if (d && d.dkim_private_key) {
    return { domainName: d.name, keySelector: d.dkim_selector || config.dkimSelector, privateKey: d.dkim_private_key };
  }
  return null;
}

export function splitAddresses(input) {
  if (!input) return [];
  const arr = Array.isArray(input) ? input : String(input).split(/[,;]+/);
  return arr.map(s => s.trim()).filter(Boolean);
}

function extractAddress(s) {
  const m = String(s).match(/<([^>]+)>/);
  return (m ? m[1] : s).trim().toLowerCase();
}

/**
 * 用户发信主入口
 * @param {object} user 发件用户行
 * @param {object} data {to, cc, bcc, subject, html, text, inReplyTo, references, scheduledAt}
 * @param {Array} attachments [{filename, path|content, contentType, cid}]
 * @param {number|null} draftId 草稿 id（发送后删除）
 */
export async function sendMessage(user, data, attachments = [], draftId = null) {
  const to = splitAddresses(data.to);
  const cc = splitAddresses(data.cc);
  const bcc = splitAddresses(data.bcc);
  const all = [...to, ...cc, ...bcc];
  if (!all.length) throw new Error('请至少填写一个收件人');
  if (all.length > 50) throw new Error('收件人数量过多（上限 50）');

  const senderDomain = user.address.split('@')[1];
  const messageId = `<${Date.now()}.${crypto.randomBytes(8).toString('hex')}@${senderDomain}>`;

  // 读取附件内容
  const mimeAtts = [];
  for (const a of attachments) {
    const content = a.content ?? (a.path ? fs.readFileSync(a.path) : Buffer.alloc(0));
    mimeAtts.push({
      filename: a.filename || 'attachment',
      content,
      contentType: a.contentType || 'application/octet-stream',
      cid: a.cid || undefined,
    });
  }

  const mailOptions = {
    from: { name: user.display_name || user.address.split('@')[0], address: user.address },
    to, cc: cc.length ? cc : undefined, bcc: bcc.length ? bcc : undefined,
    subject: data.subject || '(无主题)',
    text: data.text || '',
    html: data.html || undefined,
    messageId,
    inReplyTo: data.inReplyTo || undefined,
    references: data.references || data.inReplyTo || undefined,
    date: new Date(),
    attachments: mimeAtts.length ? mimeAtts : undefined,
  };

  const info = await composer.sendMail(mailOptions);
  let raw = info.message;

  // DKIM 签名（站内站外统一使用签名报文）
  const dkim = dkimOptions(senderDomain);
  if (dkim) {
    try {
      const { DKIMSign } = await import('dkim-signer');
      const rawStr0 = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
      const sigHeader = DKIMSign(rawStr0, dkim);
      raw = Buffer.from(sigHeader + '\r\n' + rawStr0, 'utf8');
    } catch (e) {
      console.warn('[dkim] 签名失败:', e.message);
    }
  }
  const rawStr = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
  const size = Buffer.byteLength(rawStr);

  const meta = {
    fromName: user.display_name || '', fromAddr: user.address,
    toAddrs: to.join(', '), ccAddrs: cc.join(', '), bccAddrs: bcc.join(', '),
    replyTo: '', subject: mailOptions.subject, messageId,
    inReplyTo: data.inReplyTo || '', references: data.references || '',
    bodyText: data.text || '', bodyHtml: data.html || '',
    date: Date.now(), spamScore: 0, authResults: 'outgoing', size,
  };
  const storedAtts = attachments.map(a => ({
    filename: a.filename || 'attachment',
    contentType: a.contentType || 'application/octet-stream',
    size: a.content?.length ?? (a.path ? fs.statSync(a.path).size : 0),
    path: a.path,
    contentId: a.cid || '',
  }));

  // ---- 站内投递 ----
  const internalTargets = [];
  const external = [];
  for (const addr of all) {
    const clean = extractAddress(addr);
    const target = resolveRcpt(clean);
    if (target) internalTargets.push({ addr: clean, target });
    else external.push(clean);
  }

  let sentCopyId = null;
  let status = 'sent';
  let error = '';

  for (const { target } of internalTargets) {
    try {
      const atts = storedAtts.map(a => ({ ...a, path: a.path }));
      storeMessage(target.userId, meta, atts, { isOutgoing: true, folderType: 'inbox', rawEml: rawStr, skipFilters: false });
    } catch (e) {
      error = `投递给 ${target.address} 失败: ${e.message}`;
      status = 'partial';
    }
  }

  // ---- 站外入队 ----
  if (external.length) {
    for (const rcpt of external) {
      q.run(
        'INSERT INTO outbound_queue(message_id, sender, recipient, raw_eml, next_attempt_at, created_at) VALUES(?,?,?,?,?,?)',
        null, user.address, rcpt, rawStr, now(), now()
      );
    }
    status = status === 'sent' ? 'queued' : status;
  }

  // ---- 发件人"已发送"副本 ----
  const sentFolder = getFolderByType(user.id, 'sent');
  sentCopyId = storeMessage(user.id, meta, storedAtts, {
    isOutgoing: true, folderId: sentFolder.id, isRead: true, skipFilters: true,
    sendStatus: status,
  });
  q.run('UPDATE messages SET send_error = ? WHERE id = ?', error, sentCopyId);

  // ---- 清理草稿 ----
  if (draftId) {
    const draft = q.get('SELECT id FROM messages WHERE id = ? AND user_id = ? AND is_draft = 1', draftId, user.id);
    if (draft) {
      q.run('DELETE FROM attachments WHERE message_id = ?', draftId);
      q.run('DELETE FROM messages WHERE id = ?', draftId);
    }
  }

  audit(user.id, user.address, 'mail.send',
    `to=[${to.join(',')}] cc=[${cc.join(',')}] bcc=[${bcc.length}个] subject="${mailOptions.subject}" external=${external.length}`);

  return { messageId, sentId: sentCopyId, status, error, internal: internalTargets.map(t => t.target.address), external };
}

// 更新已发送邮件的外发状态（由队列任务调用）
export function updateSentStatus(sentId, status, errText = '') {
  if (!sentId) return;
  q.run('UPDATE messages SET send_status = ?, send_error = ? WHERE id = ?', status, errText, sentId);
}
