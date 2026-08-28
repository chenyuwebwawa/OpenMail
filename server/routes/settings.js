// 用户设置路由：个人资料 / 过滤规则 / 黑名单
import { Router } from 'express';
import { q, now } from '../db.js';
import { requireAuth, logAudit } from '../util/auth.js';

const router = Router();

router.put('/profile', requireAuth(), (req, res) => {
  const { displayName, signature } = req.body || {};
  q.run('UPDATE users SET display_name = ?, signature = ? WHERE id = ?',
    String(displayName ?? req.user.display_name).slice(0, 60),
    String(signature ?? req.user.signature).slice(0, 5000),
    req.user.id);
  logAudit(req, 'settings.profile', '更新个人资料');
  res.json({ ok: true });
});

// ---------- 过滤规则 ----------
router.get('/filters', requireAuth(), (req, res) => {
  res.json({ filters: q.all('SELECT * FROM filters WHERE user_id = ? ORDER BY priority DESC, id', req.user.id) });
});

router.post('/filters', requireAuth(), (req, res) => {
  const b = req.body || {};
  if (!b.field || !b.value || !b.action) return res.status(400).json({ error: '规则不完整' });
  if (!['from', 'to', 'subject'].includes(b.field)) return res.status(400).json({ error: '不支持的字段' });
  if (!['contains', 'starts_with', 'equals'].includes(b.operator || 'contains')) return res.status(400).json({ error: '不支持的操作符' });
  if (!['move_to', 'mark_read', 'star', 'mark_junk'].includes(b.action)) return res.status(400).json({ error: '不支持的动作' });
  if (b.action === 'move_to' && b.folderId) {
    const f = q.get('SELECT id FROM folders WHERE id = ? AND user_id = ?', b.folderId, req.user.id);
    if (!f) return res.status(400).json({ error: '目标文件夹不存在' });
  }
  q.run(
    'INSERT INTO filters(user_id, name, field, operator, value, action, folder_id, priority, enabled) VALUES(?,?,?,?,?,?,?,?,1)',
    req.user.id, b.name || `${b.field} 包含 ${b.value}`, b.field, b.operator || 'contains',
    b.value, b.action, b.action === 'move_to' ? b.folderId || null : null, parseInt(b.priority) || 0
  );
  res.json({ id: q.get('SELECT last_insert_rowid() AS id').id });
});

router.put('/filters/:id', requireAuth(), (req, res) => {
  const f = q.get('SELECT * FROM filters WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
  if (!f) return res.status(404).json({ error: '规则不存在' });
  const b = req.body || {};
  q.run(
    'UPDATE filters SET name = ?, field = ?, operator = ?, value = ?, action = ?, folder_id = ?, enabled = ? WHERE id = ?',
    b.name ?? f.name, b.field ?? f.field, b.operator ?? f.operator, b.value ?? f.value,
    b.action ?? f.action, b.folderId !== undefined ? b.folderId : f.folder_id,
    b.enabled !== undefined ? (b.enabled ? 1 : 0) : f.enabled, f.id
  );
  res.json({ ok: true });
});

router.delete('/filters/:id', requireAuth(), (req, res) => {
  q.run('DELETE FROM filters WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
  res.json({ ok: true });
});

// ---------- 发件人黑名单 ----------
router.get('/blacklist', requireAuth(), (req, res) => {
  res.json({ entries: q.all('SELECT * FROM blacklist WHERE user_id = ? ORDER BY id DESC', req.user.id) });
});

router.post('/blacklist', requireAuth(), (req, res) => {
  const pattern = String(req.body?.pattern || '').toLowerCase().trim();
  if (!pattern || /\s/.test(pattern)) return res.status(400).json({ error: '请输入有效的地址或域名' });
  q.run('INSERT INTO blacklist(user_id, pattern, created_at) VALUES(?,?,?)', req.user.id, pattern, now());
  res.json({ id: q.get('SELECT last_insert_rowid() AS id').id });
});

router.delete('/blacklist/:id', requireAuth(), (req, res) => {
  q.run('DELETE FROM blacklist WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
  res.json({ ok: true });
});

export default router;
