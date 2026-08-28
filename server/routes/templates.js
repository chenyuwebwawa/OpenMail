// 邮件模板 API：CRUD / HTML 导入 / 列表（写信时可插入）
import { Router } from 'express';
import { q, now } from '../db.js';
import { requireAuth, logAudit } from '../util/auth.js';

const router = Router();

router.get('/templates', requireAuth(), (req, res) => {
  res.json({
    templates: q.all(
      'SELECT id, name, subject, source, created_at, updated_at, LENGTH(html) AS size FROM templates WHERE user_id = ? ORDER BY updated_at DESC',
      req.user.id
    ),
  });
});

router.get('/templates/:id', requireAuth(), (req, res) => {
  const t = q.get('SELECT * FROM templates WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
  if (!t) return res.status(404).json({ error: '模板不存在' });
  res.json({ template: t });
});

router.post('/templates', requireAuth(), (req, res) => {
  const b = req.body || {};
  if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: '模板名称不能为空' });
  const info = q.run(
    'INSERT INTO templates(user_id, name, subject, html, source, created_at, updated_at) VALUES(?,?,?,?,?,?,?)',
    req.user.id, String(b.name).slice(0, 100), b.subject || '', b.html || '', b.source === 'ai' || b.source === 'import' ? b.source : 'manual', now(), now()
  );
  logAudit(req, 'template.create', b.name);
  res.json({ id: Number(info.lastInsertRowid) });
});

// 导入 HTML 模板（粘贴内容或 base64 文件）
router.post('/templates/import', requireAuth(), (req, res) => {
  const b = req.body || {};
  let html = '';
  let name = String(b.name || '').trim();
  if (b.fileBase64) {
    html = Buffer.from(String(b.fileBase64), 'base64').toString('utf8');
    if (!name) name = b.filename || '导入的模板';
  } else if (b.html) {
    html = String(b.html);
    if (!name) name = '导入的模板';
  } else {
    return res.status(400).json({ error: '请提供 HTML 内容或上传 .html 文件' });
  }
  if (html.length > 512 * 1024) return res.status(413).json({ error: '模板过大（上限 512KB）' });
  const subjectMatch = html.match(/<title>([^<]*)<\/title>/i);
  const info = q.run(
    'INSERT INTO templates(user_id, name, subject, html, source, created_at, updated_at) VALUES(?,?,?,?,?,?,?)',
    req.user.id, name.slice(0, 100), b.subject || (subjectMatch ? subjectMatch[1].trim() : ''), html, 'import', now(), now()
  );
  logAudit(req, 'template.import', name);
  res.json({ id: Number(info.lastInsertRowid) });
});

router.put('/templates/:id', requireAuth(), (req, res) => {
  const t = q.get('SELECT * FROM templates WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
  if (!t) return res.status(404).json({ error: '模板不存在' });
  const b = req.body || {};
  q.run(
    'UPDATE templates SET name = ?, subject = ?, html = ?, updated_at = ? WHERE id = ?',
    b.name !== undefined ? String(b.name).slice(0, 100) : t.name,
    b.subject !== undefined ? b.subject : t.subject,
    b.html !== undefined ? b.html : t.html,
    now(), t.id
  );
  res.json({ ok: true });
});

router.delete('/templates/:id', requireAuth(), (req, res) => {
  q.run('DELETE FROM templates WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
  res.json({ ok: true });
});

export default router;
