// 邮件存储引擎：文件夹、线程聚合、投递入库、过滤规则、搜索、配额
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { db, q, now } from '../db.js';
import { config } from '../config.js';

// 邮件事件总线（IMAP IDLE 等实时通知用）
export const mailEvents = new EventEmitter();
mailEvents.setMaxListeners(100);

// ---------- 文件夹 ----------
export function ensureSystemFolders(userId) {
  const types = ['inbox', 'sent', 'drafts', 'trash', 'junk', 'archive'];
  const names = { inbox: '收件箱', sent: '已发送', drafts: '草稿箱', trash: '垃圾箱', junk: '垃圾邮件', archive: '归档' };
  for (const t of types) {
    const row = q.get('SELECT id FROM folders WHERE user_id = ? AND type = ?', userId, t);
    if (!row) {
      q.run('INSERT INTO folders(user_id, name, type, sort_order) VALUES(?,?,?,?)', userId, names[t], t, types.indexOf(t));
    }
  }
}

export function getFolderByType(userId, type) {
  return q.get('SELECT * FROM folders WHERE user_id = ? AND type = ?', userId, type);
}

export function getOrCreateCustomFolder(userId, name) {
  ensureSystemFolders(userId);
  const row = q.get('SELECT * FROM folders WHERE user_id = ? AND name = ?', userId, name);
  if (row) return row;
  q.run('INSERT INTO folders(user_id, name, type, sort_order) VALUES(?,?,?,?)', userId, name, 'custom', 100);
  return q.get('SELECT * FROM folders WHERE user_id = ? AND name = ?', userId, name);
}

// ---------- 线程聚合 ----------
function normalizeSubject(s) {
  return String(s || '')
    .replace(/^(?:(?:re|fwd?|aw|fw)\s*(?:\[\d+\])?\s*:\s*)+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// 通过 References / In-Reply-To 链路或规范化主题聚合会话
export function resolveThread(userId, { messageId, inReplyTo, references, subject }) {
  const refList = String(references || '').split(/\s+/).filter(Boolean);
  if (inReplyTo) refList.push(inReplyTo);
  for (const ref of refList) {
    const m = q.get(
      'SELECT thread_id FROM messages WHERE user_id = ? AND message_id = ? AND thread_id IS NOT NULL LIMIT 1',
      userId, ref
    );
    if (m) return m.thread_id;
  }
  const norm = normalizeSubject(subject);
  if (norm) {
    // 同一用户的同主题未回消息 → 视为同一线程（便于追踪）
    const t = q.get(
      `SELECT m.thread_id AS tid FROM messages m JOIN threads th ON th.id = m.thread_id
       WHERE m.user_id = ? AND th.subject = ? ORDER BY m.id DESC LIMIT 1`,
      userId, norm
    );
    if (t) return t.tid;
  }
  q.run('INSERT INTO threads(user_id, subject, created_at) VALUES(?,?,?)', userId, norm, now());
  return q.get('SELECT last_insert_rowid() AS id').id;
}

// ---------- 配额 ----------
export function quotaExceeded(userId, incomingBytes) {
  const u = q.get('SELECT quota_bytes, used_bytes FROM users WHERE id = ?', userId);
  if (!u) return true;
  return u.used_bytes + incomingBytes > u.quota_bytes;
}

function addUsage(userId, delta) {
  q.run('UPDATE users SET used_bytes = MAX(0, used_bytes + ?) WHERE id = ?', delta, userId);
}

// ---------- 附件 ----------
export function saveAttachmentBuffer(userId, filename, contentType, buf, contentId = '') {
  const dir = path.join(config.filesDir, String(userId));
  fs.mkdirSync(dir, { recursive: true });
  const fname = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${path.extname(filename || '').slice(0, 20)}`;
  const fp = path.join(dir, fname);
  fs.writeFileSync(fp, buf);
  return { filename: filename || 'unnamed', contentType: contentType || 'application/octet-stream', size: buf.length, path: fp, contentId };
}

// ---------- 过滤规则 ----------
export function applyUserFilters(userId, meta) {
  const rules = q.all('SELECT * FROM filters WHERE user_id = ? AND enabled = 1 ORDER BY priority DESC, id ASC', userId);
  const res = { folderId: null, isRead: 0, isStarred: 0, isJunk: 0 };
  const hit = (rule) => {
    const fieldMap = { from: meta.fromAddr, to: meta.toAddrs, subject: meta.subject };
    const target = String(fieldMap[rule.field] || '').toLowerCase();
    const value = String(rule.value || '').toLowerCase();
    if (rule.operator === 'contains') return target.includes(value);
    if (rule.operator === 'starts_with') return target.startsWith(value);
    if (rule.operator === 'equals') return target === value;
    return false;
  };
  for (const r of rules) {
    if (!hit(r)) continue;
    if (r.action === 'move_to' && r.folder_id) {
      const f = q.get('SELECT id FROM folders WHERE id = ? AND user_id = ?', r.folder_id, userId);
      if (f) res.folderId = f.id;
    } else if (r.action === 'mark_read') res.isRead = 1;
    else if (r.action === 'star') res.isStarred = 1;
    else if (r.action === 'mark_junk') res.isJunk = 1;
  }
  return res;
}

// ---------- 黑名单 ----------
export function isBlacklisted(userId, fromAddr) {
  const addr = String(fromAddr || '').toLowerCase();
  if (!addr) return false;
  const domain = addr.split('@')[1] || '';
  const rows = q.all('SELECT user_id, pattern FROM blacklist WHERE user_id IS NULL OR user_id = ?', userId);
  return rows.some(r => {
    const p = String(r.pattern).toLowerCase().trim();
    return p && (addr === p || domain === p || addr.endsWith('@' + p));
  });
}

// ---------- 写入邮件（投递 / 发送共用）----------
export function makeSnippet(text, html) {
  const src = text || String(html || '').replace(/<[^>]+>/g, ' ');
  return src.replace(/\s+/g, ' ').trim().slice(0, 180);
}

/**
 * 将一封已解析的邮件写入指定用户邮箱。
 * meta: { fromName, fromAddr, toAddrs, ccAddrs, bccAddrs, replyTo, subject,
 *         messageId, inReplyTo, references, date, rawEml, spamScore, authResults, flags }
 * attachments: [{filename, contentType, size, path, contentId, isInline}]
 */
export function storeMessage(userId, meta, attachments = [], opts = {}) {
  ensureSystemFolders(userId);

  if (quotaExceeded(userId, meta.size || 0) && !opts.ignoreQuota) {
    throw Object.assign(new Error('mailbox quota exceeded'), { code: 'QUOTA' });
  }

  const filterRes = opts.skipFilters
    ? { folderId: null, isRead: 0, isStarred: 0, isJunk: 0 }
    : applyUserFilters(userId, meta);

  let folderId = opts.folderId || filterRes.folderId;
  if (!folderId) {
    const type = opts.folderType || (filterRes.isJunk ? 'junk' : 'inbox');
    folderId = getFolderByType(userId, type).id;
  }
  if (opts.isDraft) folderId = getFolderByType(userId, 'drafts').id;

  const threadId = opts.noThread ? null : resolveThread(userId, meta);
  const score = meta.spamScore ?? 0;
  const junkFolder = getFolderByType(userId, 'junk');
  const forcedJunk = config.antispam.enabled && score >= config.antispam.junkThreshold && !opts.isOutgoing;
  if (forcedJunk && !opts.folderId && !filterRes.folderId) folderId = junkFolder.id;

  const ts = meta.date || now();
  // 分配文件夹内递增 UID（IMAP 用）
  const frow = q.get('SELECT uid_next FROM folders WHERE id = ?', folderId);
  const uid = frow ? frow.uid_next : 1;
  q.run('UPDATE folders SET uid_next = uid_next + 1 WHERE id = ?', folderId);
  q.run(
    `INSERT INTO messages(user_id, folder_id, thread_id, uid, message_id, in_reply_to, refs,
       from_name, from_addr, to_addrs, cc_addrs, bcc_addrs, reply_to, subject, snippet,
       body_text, body_html, raw_eml, size, is_read, is_starred, has_attachments,
       spam_score, auth_results, delivered_at, scheduled_at, is_draft, send_status)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    userId, folderId, threadId, uid, meta.messageId || '', meta.inReplyTo || '', meta.references || '',
    meta.fromName || '', meta.fromAddr || '', meta.toAddrs || '', meta.ccAddrs || '', meta.bccAddrs || '',
    meta.replyTo || '', meta.subject || '', makeSnippet(meta.bodyText, meta.bodyHtml),
    meta.bodyText || '', meta.bodyHtml || '', meta.rawEml || null, meta.size || 0,
    filterRes.isRead || (opts.isRead ? 1 : 0), filterRes.isStarred || 0,
    attachments.length > 0 ? 1 : 0,
    score, meta.authResults || '', ts, meta.scheduledAt || null,
    opts.isDraft ? 1 : 0, opts.sendStatus || ''
  );
  const msgId = q.get('SELECT last_insert_rowid() AS id').id;

  for (const a of attachments) {
    q.run(
      'INSERT INTO attachments(message_id, user_id, filename, content_type, size, path, content_id, is_inline, created_at) VALUES(?,?,?,?,?,?,?,?,?)',
      msgId, userId, a.filename, a.contentType, a.size, a.path, a.contentId || '', a.isInline ? 1 : 0, now()
    );
  }
  addUsage(userId, (meta.size || 0));
  mailEvents.emit('stored', { userId, folderId, messageId: msgId });
  return msgId;
}

// ---------- 列表 / 搜索 ----------
export function listMessages(userId, folderId, { offset = 0, limit = 50, q: search = '', starred = false, unread = false, threadMode = false } = {}) {
  let sql = `SELECT m.* FROM messages m WHERE m.user_id = ? AND m.folder_id = ?`;
  const args = [userId, folderId];
  if (search) {
    sql += ` AND (m.subject LIKE ? OR m.from_addr LIKE ? OR m.from_name LIKE ? OR m.to_addrs LIKE ? OR m.body_text LIKE ? OR m.snippet LIKE ?)`;
    const like = `%${search}%`;
    args.push(like, like, like, like, like, like);
  }
  if (starred) sql += ' AND m.is_starred = 1';
  if (unread) sql += ' AND m.is_read = 0';
  sql += ' ORDER BY COALESCE(m.scheduled_at, m.delivered_at) DESC LIMIT ? OFFSET ?';
  args.push(limit, offset);
  return q.all(sql, ...args);
}

export function countFolder(userId, folderId) {
  const row = q.get(
    'SELECT COUNT(*) AS total, SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) AS unread FROM messages WHERE user_id = ? AND folder_id = ? AND is_draft = 0',
    userId, folderId
  );
  return { total: row?.total || 0, unread: row?.unread || 0 };
}

export function searchAllFolders(userId, search, limit = 100) {
  const like = `%${search}%`;
  return q.all(
    `SELECT m.*, f.name AS folder_name, f.type AS folder_type FROM messages m
     JOIN folders f ON f.id = m.folder_id
     WHERE m.user_id = ?
       AND (m.subject LIKE ? OR m.from_addr LIKE ? OR m.from_name LIKE ? OR m.to_addrs LIKE ? OR m.body_text LIKE ?)
     ORDER BY m.delivered_at DESC LIMIT ?`,
    userId, like, like, like, like, like, limit
  );
}

// ---------- 批量操作 ----------
function getMsg(userId, id) {
  return q.get('SELECT * FROM messages WHERE id = ? AND user_id = ?', id, userId);
}

export function moveMessages(userId, ids, destFolderId) {
  const dest = q.get('SELECT id FROM folders WHERE id = ? AND user_id = ?', destFolderId, userId);
  if (!dest) throw new Error('目标文件夹不存在');
  const ph = ids.map(() => '?').join(',');
  q.run(`UPDATE messages SET folder_id = ? WHERE user_id = ? AND id IN (${ph})`, destFolderId, userId, ...ids);
}

export function trashMessages(userId, ids) {
  const trash = getFolderByType(userId, 'trash');
  const ph = ids.map(() => '?').join(',');
  // 已在垃圾箱的 → 彻底删除
  q.run(`DELETE FROM messages WHERE user_id = ? AND folder_id = ? AND id IN (${ph})`, userId, trash.id, ...ids);
  q.run(`UPDATE messages SET folder_id = ? WHERE user_id = ? AND id IN (${ph})`, trash.id, userId, ...ids);
}

export function deleteForever(userId, ids) {
  const ph = ids.map(() => '?').join(',');
  const rows = q.all(`SELECT id, size FROM messages WHERE user_id = ? AND id IN (${ph})`, userId, ...ids);
  for (const r of rows) {
    q.run('DELETE FROM attachments WHERE message_id = ?', r.id);
    addUsage(userId, -r.size);
  }
  q.run(`DELETE FROM messages WHERE user_id = ? AND id IN (${ph})`, userId, ...ids);
}

export function setFlags(userId, ids, flags) {
  const ph = ids.map(() => '?').join(',');
  const sets = [];
  const args = [];
  if ('is_read' in flags) { sets.push('is_read = ?'); args.push(flags.is_read ? 1 : 0); }
  if ('is_starred' in flags) { sets.push('is_starred = ?'); args.push(flags.is_starred ? 1 : 0); }
  if ('is_answered' in flags) { sets.push('is_answered = ?'); args.push(flags.is_answered ? 1 : 0); }
  if ('is_forwarded' in flags) { sets.push('is_forwarded = ?'); args.push(flags.is_forwarded ? 1 : 0); }
  if (!sets.length) return;
  q.run(`UPDATE messages SET ${sets.join(', ')} WHERE user_id = ? AND id IN (${ph})`, ...args, userId, ...ids);
}

export function emptyFolder(userId, folderType) {
  const f = getFolderByType(userId, folderType);
  if (!f) return 0;
  const rows = q.all('SELECT id, size FROM messages WHERE user_id = ? AND folder_id = ?', userId, f.id);
  let bytes = 0;
  for (const r of rows) bytes += r.size;
  if (rows.length) {
    const ph = rows.map(r => r.id).map(() => '?').join(',');
    q.run(`DELETE FROM attachments WHERE message_id IN (SELECT id FROM messages WHERE user_id = ? AND folder_id = ?)`, userId, f.id);
    q.run(`DELETE FROM messages WHERE user_id = ? AND folder_id = ?`, userId, f.id);
    addUsage(userId, -bytes);
  }
  return rows.length;
}

export function archiveRead(userId) {
  const inbox = getFolderByType(userId, 'inbox');
  const archive = getFolderByType(userId, 'archive');
  const r = q.run('UPDATE messages SET folder_id = ? WHERE user_id = ? AND folder_id = ? AND is_read = 1 AND is_starred = 0',
    archive.id, userId, inbox.id);
  return r.changes;
}

export function getMessageFull(userId, id) {
  const m = getMsg(userId, id);
  if (!m) return null;
  m.attachments = q.all('SELECT id, filename, content_type, size, content_id, is_inline FROM attachments WHERE message_id = ?', id);
  m.tags = q.all(
    `SELECT t.id, t.name, t.color FROM tags t JOIN message_tags mt ON mt.tag_id = t.id WHERE mt.message_id = ?`, id
  );
  return m;
}

export function scheduledDue() {
  return q.all(
    `SELECT m.*, u.address AS sender_address, u.display_name AS sender_name
     FROM messages m JOIN users u ON u.id = m.user_id
     WHERE m.is_draft = 1 AND m.scheduled_at IS NOT NULL AND m.scheduled_at <= ? AND m.folder_id = (SELECT id FROM folders WHERE user_id = m.user_id AND type = 'drafts')
       AND m.send_status = ''`,
    now()
  );
}
