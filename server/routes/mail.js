// 邮件相关路由：文件夹 / 列表 / 详情 / 草稿 / 发送 / 批量操作 / 附件 / 搜索
import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { q, now, audit, getSetting } from '../db.js';
import { requireAuth, logAudit } from '../util/auth.js';
import {
  listMessages, searchAllFolders, getMessageFull, moveMessages, trashMessages,
  deleteForever, setFlags, emptyFolder, archiveRead, countFolder, getFolderByType,
  getOrCreateCustomFolder, ensureSystemFolders, saveAttachmentBuffer, makeSnippet,
} from '../mail/mailstore.js';
import { sendMessage } from '../mail/outbound.js';
import { resolveRcpt } from '../mail/delivery.js';

const router = Router();

// ---------- 文件夹 ----------
router.get('/folders', requireAuth(), (req, res) => {
  ensureSystemFolders(req.user.id);
  const folders = q.all('SELECT * FROM folders WHERE user_id = ? ORDER BY sort_order, id', req.user.id);
  const result = folders.map(f => {
    const c = q.get(
      "SELECT COUNT(*) AS total, SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) AS unread, SUM(CASE WHEN is_starred = 1 THEN 1 ELSE 0 END) AS starred FROM messages WHERE user_id = ? AND folder_id = ? AND is_draft = 0",
      req.user.id, f.id
    );
    return { ...f, total: c.total || 0, unread: c.unread || 0, starred: c.starred || 0 };
  });
  res.json({ folders: result });
});

router.post('/folders', requireAuth(), (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 50);
  if (!name) return res.status(400).json({ error: '文件夹名称不能为空' });
  if (q.get('SELECT id FROM folders WHERE user_id = ? AND name = ?', req.user.id, name)) {
    return res.status(409).json({ error: '同名文件夹已存在' });
  }
  getOrCreateCustomFolder(req.user.id, name);
  logAudit(req, 'folder.create', name);
  res.json({ ok: true });
});

router.patch('/folders/:id', requireAuth(), (req, res) => {
  const f = q.get('SELECT * FROM folders WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
  if (!f) return res.status(404).json({ error: '文件夹不存在' });
  if (f.type !== 'custom') return res.status(400).json({ error: '系统文件夹不可重命名' });
  q.run('UPDATE folders SET name = ? WHERE id = ?', String(req.body?.name || f.name).slice(0, 50), f.id);
  res.json({ ok: true });
});

router.delete('/folders/:id', requireAuth(), (req, res) => {
  const f = q.get('SELECT * FROM folders WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
  if (!f) return res.status(404).json({ error: '文件夹不存在' });
  if (f.type !== 'custom') return res.status(400).json({ error: '系统文件夹不可删除' });
  const trash = getFolderByType(req.user.id, 'trash');
  q.run('UPDATE messages SET folder_id = ? WHERE folder_id = ?', trash.id, f.id);
  q.run('DELETE FROM folders WHERE id = ?', f.id);
  res.json({ ok: true });
});

// ---------- 邮件列表 / 搜索 ----------
router.get('/messages', requireAuth(), (req, res) => {
  const { folderId, q: search, page = '1', pageSize = '50', starred, unread } = req.query;
  if (search) {
    const results = searchAllFolders(req.user.id, String(search));
    return res.json({ messages: results.slice(0, 200), total: results.length, searchAll: true });
  }
  const fid = parseInt(folderId);
  const folder = fid
    ? q.get('SELECT * FROM folders WHERE id = ? AND user_id = ?', fid, req.user.id)
    : getFolderByType(req.user.id, 'inbox');
  if (!folder) return res.status(404).json({ error: '文件夹不存在' });
  const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(pageSize);
  const messages = listMessages(req.user.id, folder.id, {
    offset, limit: Math.min(200, parseInt(pageSize)), q: String(search || ''),
    starred: starred === '1', unread: unread === '1',
  });
  const counts = countFolder(req.user.id, folder.id);
  res.json({ messages, total: counts.total, folder });
});

router.get('/search', requireAuth(), (req, res) => {
  const qstr = String(req.query.q || '').trim();
  if (!qstr) return res.json({ messages: [] });
  res.json({ messages: searchAllFolders(req.user.id, qstr) });
});

// ---------- 线程 ----------
router.get('/threads/:id', requireAuth(), (req, res) => {
  const rows = q.all(
    `SELECT m.id, m.subject, m.from_name, m.from_addr, m.delivered_at, m.is_read, f.type AS folder_type
     FROM messages m JOIN folders f ON f.id = m.folder_id
     WHERE m.user_id = ? AND m.thread_id = ? ORDER BY m.delivered_at ASC`,
    req.user.id, req.params.id
  );
  res.json({ messages: rows });
});

// ---------- 详情 ----------
router.get('/messages/:id', requireAuth(), (req, res) => {
  const m = getMessageFull(req.user.id, parseInt(req.params.id));
  if (!m) return res.status(404).json({ error: '邮件不存在' });
  // 打开即标已读（peek=1 时只看不标，用于预览）
  if (!m.is_read && req.query.peek !== '1' && !m.is_draft) {
    setFlags(req.user.id, [m.id], { is_read: true });
    m.is_read = 1;
  }
  res.json({ message: m });
});

router.post('/messages/:id/read', requireAuth(), (req, res) => {
  setFlags(req.user.id, [parseInt(req.params.id)], { is_read: req.body?.read !== false });
  res.json({ ok: true });
});

router.post('/messages/:id/flags', requireAuth(), (req, res) => {
  const flags = {};
  for (const k of ['is_read', 'is_starred', 'is_answered', 'is_forwarded']) {
    if (k in (req.body || {})) flags[k] = !!req.body[k];
  }
  setFlags(req.user.id, [parseInt(req.params.id)], flags);
  res.json({ ok: true });
});

// ---------- 批量操作 ----------
router.post('/messages/batch', requireAuth(), (req, res) => {
  const ids = (req.body?.ids || []).map(Number).filter(Number.isFinite);
  const action = req.body?.action;
  if (!ids.length) return res.status(400).json({ error: '未选择邮件' });
  switch (action) {
    case 'read': setFlags(req.user.id, ids, { is_read: true }); break;
    case 'unread': setFlags(req.user.id, ids, { is_read: false }); break;
    case 'star': setFlags(req.user.id, ids, { is_starred: true }); break;
    case 'unstar': setFlags(req.user.id, ids, { is_starred: false }); break;
    case 'move': moveMessages(req.user.id, ids, parseInt(req.body?.folderId)); break;
    case 'trash': trashMessages(req.user.id, ids); break;
    case 'delete_forever': deleteForever(req.user.id, ids); break;
    default: return res.status(400).json({ error: '未知操作' });
  }
  logAudit(req, 'mail.batch', `${action} ${ids.length} 封`);
  res.json({ ok: true });
});

// ---------- 草稿 ----------
router.post('/drafts', requireAuth(), (req, res) => {
  const b = req.body || {};
  const draftsFolder = getFolderByType(req.user.id, 'drafts');
  q.run(
    `INSERT INTO messages(user_id, folder_id, message_id, from_name, from_addr, to_addrs, cc_addrs, bcc_addrs,
       subject, body_text, body_html, snippet, size, is_draft, is_read, delivered_at, scheduled_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    req.user.id, draftsFolder.id, `<draft-${Date.now()}-${Math.random().toString(36).slice(2)}@draft>`,
    req.user.display_name, req.user.address, b.to || '', b.cc || '', b.bcc || '',
    b.subject || '', b.text || '', b.html || '', makeSnippet(b.text, b.html),
    (b.text || '').length + (b.html || '').length, 1, 1, now(), b.scheduledAt ? parseInt(b.scheduledAt) : null
  );
  const draftId = q.get('SELECT last_insert_rowid() AS id').id;
  res.json({ draftId });
});

router.put('/drafts/:id', requireAuth(), (req, res) => {
  const b = req.body || {};
  const d = q.get('SELECT * FROM messages WHERE id = ? AND user_id = ? AND is_draft = 1', req.params.id, req.user.id);
  if (!d) return res.status(404).json({ error: '草稿不存在' });
  q.run(
    `UPDATE messages SET to_addrs = ?, cc_addrs = ?, bcc_addrs = ?, subject = ?, body_text = ?, body_html = ?,
       snippet = ?, scheduled_at = ? WHERE id = ?`,
    b.to || '', b.cc || '', b.bcc || '', b.subject || '', b.text || '', b.html || '',
    makeSnippet(b.text, b.html), b.scheduledAt ? parseInt(b.scheduledAt) : null, d.id
  );
  res.json({ ok: true });
});

router.delete('/drafts/:id', requireAuth(), (req, res) => {
  const d = q.get('SELECT * FROM messages WHERE id = ? AND user_id = ? AND is_draft = 1', req.params.id, req.user.id);
  if (!d) return res.status(404).json({ error: '草稿不存在' });
  q.run('DELETE FROM attachments WHERE message_id = ?', d.id);
  q.run('DELETE FROM messages WHERE id = ?', d.id);
  res.json({ ok: true });
});

// ---------- 附件 ----------
router.post('/attachments', requireAuth(), (req, res) => {
  const { draftId, filename, contentType, data } = req.body || {};
  if (!filename || !data) return res.status(400).json({ error: '参数缺失' });
  const buf = Buffer.from(String(data), 'base64');
  // 上限由管理员在管理面板设置（默认 25MB）
  const maxMB = Math.max(1, parseInt(getSetting('max_attachment_mb', '25')) || 25);
  const maxBytes = maxMB * 1024 * 1024;
  if (buf.length > maxBytes) return res.status(413).json({ error: `附件超过大小上限（${maxMB}MB）` });
  if (draftId) {
    const d = q.get('SELECT id FROM messages WHERE id = ? AND user_id = ?', draftId, req.user.id);
    if (!d) return res.status(404).json({ error: '草稿不存在' });
  }
  const saved = saveAttachmentBuffer(req.user.id, filename, contentType, buf);
  const attId = q.get('SELECT last_insert_rowid() AS id').id;
  q.run(
    'INSERT INTO attachments(message_id, user_id, filename, content_type, size, path, content_id, is_inline, created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    draftId ? parseInt(draftId) : draftMessageId(req.user.id), req.user.id,
    saved.filename, saved.contentType, saved.size, saved.path, saved.contentId, saved.isInline ? 1 : 0, now()
  );
  const newId = q.get('SELECT last_insert_rowid() AS id').id;
  res.json({ id: newId, filename: saved.filename, size: saved.size });
});

// 无草稿时上传的附件挂到一个隐藏草稿上
function draftMessageId(userId) {
  const draftsFolder = getFolderByType(userId, 'drafts');
  q.run(
    `INSERT INTO messages(user_id, folder_id, message_id, subject, is_draft, is_read, delivered_at)
     VALUES(?,?,?,?,1,1,?)`,
    userId, draftsFolder.id, `<draft-${Date.now()}@upload>`, '(附件暂存)', now()
  );
  return q.get('SELECT last_insert_rowid() AS id').id;
}

router.get('/attachments/:id/download', requireAuth(), (req, res) => {
  const a = q.get('SELECT * FROM attachments WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
  if (!a || !fs.existsSync(a.path)) return res.status(404).json({ error: '附件不存在' });
  res.setHeader('Content-Type', a.content_type);
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(a.filename)}`);
  fs.createReadStream(a.path).pipe(res);
});

router.get('/attachments/:id/inline', requireAuth(), (req, res) => {
  const a = q.get('SELECT * FROM attachments WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
  if (!a || !fs.existsSync(a.path)) return res.status(404).json({ error: '附件不存在' });
  res.setHeader('Content-Type', a.content_type);
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(a.filename)}`);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  fs.createReadStream(a.path).pipe(res);
});

router.delete('/attachments/:id', requireAuth(), (req, res) => {
  q.run('DELETE FROM attachments WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
  res.json({ ok: true });
});

// ---------- 发送 ----------
router.post('/send', requireAuth(), async (req, res) => {
  const b = req.body || {};
  try {
    const draftId = b.draftId ? parseInt(b.draftId) : null;

    // 定时发送：更新草稿的 scheduled_at，由调度器到点发出
    if (b.scheduledAt) {
      const when = parseInt(b.scheduledAt);
      if (when > Date.now() - 5000) {
        let sid = draftId;
        if (!sid) {
          const draftsFolder = getFolderByType(req.user.id, 'drafts');
          q.run(
            `INSERT INTO messages(user_id, folder_id, message_id, from_name, from_addr, to_addrs, cc_addrs, bcc_addrs,
               subject, body_text, body_html, snippet, is_draft, is_read, delivered_at, scheduled_at)
             VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1,1,?,?)`,
            req.user.id, draftsFolder.id, `<draft-${Date.now()}@sched>`, req.user.display_name, req.user.address,
            b.to || '', b.cc || '', b.bcc || '', b.subject || '', b.text || '', b.html || '',
            makeSnippet(b.text, b.html), now(), when
          );
          sid = q.get('SELECT last_insert_rowid() AS id').id;
        } else {
          q.run('UPDATE messages SET scheduled_at = ?, to_addrs = ?, cc_addrs = ?, bcc_addrs = ?, subject = ?, body_text = ?, body_html = ? WHERE id = ? AND user_id = ?',
            when, b.to || '', b.cc || '', b.bcc || '', b.subject || '', b.text || '', b.html || '', sid, req.user.id);
        }
        // 附件挂到该草稿
        if (b.attachmentDraftId && b.attachmentDraftId !== sid) {
          q.run('UPDATE attachments SET message_id = ? WHERE message_id = ? AND user_id = ?', sid, b.attachmentDraftId, req.user.id);
        }
        logAudit(req, 'mail.schedule', `定时发送 subject="${b.subject}" at=${new Date(when).toISOString()}`);
        return res.json({ scheduled: true, draftId: sid });
      }
    }

    // 立即发送：收集附件（草稿中已上传的）
    let attachments = [];
    const sourceId = draftId || b.attachmentDraftId;
    if (sourceId) {
      attachments = q.all('SELECT * FROM attachments WHERE message_id = ?', sourceId)
        .filter(a => a.user_id === req.user.id)
        .map(a => ({ filename: a.filename, path: a.path, contentType: a.content_type, cid: a.content_id || undefined }));
    }
    const result = await sendMessage(req.user, {
      to: b.to, cc: b.cc, bcc: b.bcc, subject: b.subject,
      html: b.html, text: b.text, inReplyTo: b.inReplyTo, references: b.references,
    }, attachments, draftId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- 整理 ----------
router.post('/archive-read', requireAuth(), (req, res) => {
  const n = archiveRead(req.user.id);
  res.json({ archived: n });
});

router.post('/folders/:type/empty', requireAuth(), (req, res) => {
  const type = String(req.params.type);
  if (!['trash', 'junk'].includes(type)) return res.status(400).json({ error: '仅支持清空垃圾箱/垃圾邮件' });
  const n = emptyFolder(req.user.id, type);
  logAudit(req, 'mail.empty_folder', `${type} 清空 ${n} 封`);
  res.json({ deleted: n });
});

// ---------- 自动补全（联系人 + 本域用户）----------
router.get('/autocomplete', requireAuth(), (req, res) => {
  const term = `%${String(req.query.q || '')}%`;
  const contacts = q.all(
    'SELECT name, email FROM contacts WHERE user_id = ? AND (name LIKE ? OR email LIKE ?) LIMIT 8',
    req.user.id, term, term
  );
  const directory = q.all(
    "SELECT display_name AS name, address AS email FROM users WHERE status = 'active' AND (address LIKE ? OR display_name LIKE ?) LIMIT 5",
    term, term
  );
  const seen = new Set();
  const merged = [];
  for (const c of [...contacts, ...directory]) {
    if (!seen.has(c.email)) { seen.add(c.email); merged.push(c); }
  }
  res.json({ suggestions: merged.slice(0, 10) });
});

export default router;
