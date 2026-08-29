// 调度器：定时发送 + 站外投递队列重试
import nodemailer from 'nodemailer';
import dns from 'node:dns';
import { q, now, audit } from '../db.js';
import { config } from '../config.js';
import { scheduledDue } from './mailstore.js';
import { sendMessage, updateSentStatus } from './outbound.js';

const MAX_ATTEMPTS = 5;
const RETRY_BASE_MS = 60 * 1000; // 首次重试 1 分钟后，指数退避

// ---------- 定时发送 ----------
async function processScheduledSends() {
  const due = scheduledDue();
  for (const draft of due) {
    try {
      const atts = q.all('SELECT * FROM attachments WHERE message_id = ?', draft.id)
        .map(a => ({ filename: a.filename, path: a.path, contentType: a.content_type, cid: a.content_id }));
      const user = q.get('SELECT * FROM users WHERE id = ?', draft.user_id);
      if (!user) continue;
      await sendMessage(user, {
        to: draft.to_addrs, cc: draft.cc_addrs, bcc: draft.bcc_addrs,
        subject: draft.subject, html: draft.body_html, text: draft.body_text,
        inReplyTo: draft.in_reply_to, references: draft.refs,
      }, atts, draft.id);
      audit(user.id, user.address, 'mail.scheduled_send', `定时邮件已发出 subject="${draft.subject}"`);
    } catch (err) {
      console.error('[scheduler] 定时发送失败:', err.message);
      q.run('UPDATE messages SET send_status = ?, send_error = ?, scheduled_at = ? WHERE id = ?',
        'failed', err.message, Date.now() + 5 * 60 * 1000, draft.id);
    }
  }
}

// ---------- 站外投递：真正的 MX 直投（RFC 5321） ----------
// nodemailer 不会自动做 MX 查询，必须手动解析收件域的 MX 记录并逐台投递
async function deliverToRecipient(item) {
  const domain = String(item.recipient || '').split('@')[1] || '';
  let hosts = [];
  try {
    hosts = (await dns.promises.resolveMx(domain))
      .sort((a, b) => a.priority - b.priority)
      .map(m => m.exchange);
  } catch {}
  if (!hosts.length) hosts = [domain]; // 无 MX 记录时按 A 记录主机投递（RFC 5321 §5.1）
  let lastErr = null;
  for (const host of hosts.slice(0, 3)) {
    try {
      const transport = nodemailer.createTransport({
        host,
        port: 25,
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 30000,
        tls: { rejectUnauthorized: false }, // MTA 间机会性加密：不校验对方证书
      });
      await transport.sendMail({
        envelope: { from: item.sender, to: [item.recipient] },
        raw: Buffer.from(item.raw_eml, 'utf8'),
      });
      return { ok: true, via: host };
    } catch (err) {
      lastErr = err;
      console.warn(`[queue] ${item.recipient} 经 ${host}:25 投递失败: ${err.message}`);
    }
  }
  throw lastErr || new Error('无可用投递路由');
}

async function processOutboundQueue() {
  const due = q.all(
    "SELECT * FROM outbound_queue WHERE status = 'queued' AND attempts < ? AND next_attempt_at <= ? LIMIT 20",
    MAX_ATTEMPTS, now()
  );
  if (!due.length) return;
  for (const item of due) {
    try {
      const r = await deliverToRecipient(item);
      q.run("UPDATE outbound_queue SET status = 'sent', last_error = '' WHERE id = ?", item.id);
      if (item.message_id) updateSentStatus(item.message_id, 'sent');
      audit(null, item.sender, 'mail.relay_sent', `to=${item.recipient} via=${r.via}`);
    } catch (err) {
      const attempts = item.attempts + 1;
      const errMsg = String(err.message || err).slice(0, 500);
      if (attempts >= MAX_ATTEMPTS) {
        q.run("UPDATE outbound_queue SET status = 'failed', attempts = ?, last_error = ? WHERE id = ?", attempts, errMsg, item.id);
        const { deliverSystemMail } = await import('./delivery.js');
        deliverSystemMail(item.sender,
          `投递失败: ${item.recipient}`,
          `您的邮件无法投递给 ${item.recipient}。\n\n错误信息: ${errMsg}\n\n已重试 ${attempts} 次。请检查收件人地址是否正确，或联系管理员。`);
        if (item.message_id) updateSentStatus(item.message_id, 'failed', errMsg);
        audit(null, item.sender, 'mail.relay_failed', `to=${item.recipient} err=${errMsg}`);
      } else {
        const delay = RETRY_BASE_MS * Math.pow(2, attempts - 1);
        q.run('UPDATE outbound_queue SET attempts = ?, last_error = ?, next_attempt_at = ? WHERE id = ?',
          attempts, errMsg, now() + delay, item.id);
      }
    }
  }
}

let started = false;
export function startScheduler() {
  if (started) return;
  started = true;
  setInterval(() => { processScheduledSends().catch(e => console.error('[scheduler]', e.message)); }, 10 * 1000);
  setInterval(() => { processOutboundQueue().catch(e => console.error('[scheduler]', e.message)); }, 45 * 1000);
  // 启动即跑一次
  setTimeout(() => processScheduledSends().catch(() => {}), 3000);
  setTimeout(() => processOutboundQueue().catch(() => {}), 5000);
  console.log('[scheduler] 定时任务已启动（定时发送 / 站外投递重试）');
}
