// 调度器：定时发送 + 站外投递队列重试
import nodemailer from 'nodemailer';
import { q, now, audit } from '../db.js';
import { config } from '../config.js';
import { scheduledDue, getFolderByType } from './mailstore.js';
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

// ---------- 站外投递 ----------
function makeTransport() {
  const r = config.relay;
  if (r.host) {
    return nodemailer.createTransport({
      host: r.host, port: r.port, secure: r.secure,
      auth: r.user ? { user: r.user, pass: r.pass } : undefined,
      connectionTimeout: 30000, socketTimeout: 60000,
    });
  }
  // 直投模式：nodemailer 自动做 MX 查询（需要出站 25 端口）
  // MTA 间 STARTTLS 为机会性加密（RFC 3207 惯例，等同 Postfix 的 may 模式）：
  // 加密优先，但不校验对方证书链 —— 大量邮件服务器（含国内 MX）在 25 端口使用自签证书
  return nodemailer.createTransport({
    connectionTimeout: 30000,
    socketTimeout: 60000,
    tls: { rejectUnauthorized: false },
  });
}

async function processOutboundQueue() {
  const due = q.all(
    "SELECT * FROM outbound_queue WHERE status = 'queued' AND attempts < ? AND next_attempt_at <= ? LIMIT 20",
    MAX_ATTEMPTS, now()
  );
  if (!due.length) return;
  const transport = makeTransport();
  for (const item of due) {
    try {
      await transport.sendMail({
        envelope: { from: item.sender, to: [item.recipient] },
        raw: Buffer.from(item.raw_eml, 'utf8'),
      });
      q.run("UPDATE outbound_queue SET status = 'sent', last_error = '' WHERE id = ?", item.id);
      if (item.message_id) updateSentStatus(item.message_id, 'sent');
      audit(null, item.sender, 'mail.relay_sent', `to=${item.recipient}`);
    } catch (err) {
      const attempts = item.attempts + 1;
      const errMsg = String(err.message || err).slice(0, 500);
      if (attempts >= MAX_ATTEMPTS) {
        q.run("UPDATE outbound_queue SET status = 'failed', attempts = ?, last_error = ? WHERE id = ?", attempts, errMsg, item.id);
        // 退信通知
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
