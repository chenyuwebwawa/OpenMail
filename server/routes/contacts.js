// 通讯录路由：联系人 CRUD / 分组 / 搜索 / vCard·CSV 导入导出
import { Router } from 'express';
import { q, now } from '../db.js';
import { requireAuth } from '../util/auth.js';

const router = Router();

router.get('/contacts', requireAuth(), (req, res) => {
  const { q: term = '', groupId } = req.query;
  let sql = 'SELECT * FROM contacts WHERE user_id = ?';
  const args = [req.user.id];
  if (term) { sql += ' AND (name LIKE ? OR email LIKE ? OR organization LIKE ?)'; const t = `%${term}%`; args.push(t, t, t); }
  if (groupId) { sql += ' AND group_id = ?'; args.push(parseInt(groupId)); }
  sql += ' ORDER BY name COLLATE NOCASE';
  res.json({ contacts: q.all(sql, ...args) });
});

router.get('/contact-groups', requireAuth(), (req, res) => {
  const groups = q.all(
    `SELECT g.id, g.name, COUNT(c.id) AS count FROM contact_groups g
     LEFT JOIN contacts c ON c.group_id = g.id AND c.user_id = g.user_id
     WHERE g.user_id = ? GROUP BY g.id ORDER BY g.name`, req.user.id
  );
  res.json({ groups });
});

router.post('/contact-groups', requireAuth(), (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 40);
  if (!name) return res.status(400).json({ error: '分组名不能为空' });
  const exists = q.get('SELECT id FROM contact_groups WHERE user_id = ? AND name = ?', req.user.id, name);
  if (exists) return res.status(409).json({ error: '分组已存在', id: exists.id });
  q.run('INSERT INTO contact_groups(user_id, name) VALUES(?,?)', req.user.id, name);
  res.json({ id: q.get('SELECT last_insert_rowid() AS id').id });
});

router.delete('/contact-groups/:id', requireAuth(), (req, res) => {
  q.run('UPDATE contacts SET group_id = NULL WHERE group_id = ? AND user_id = ?', req.params.id, req.user.id);
  q.run('DELETE FROM contact_groups WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
  res.json({ ok: true });
});

router.post('/contacts', requireAuth(), (req, res) => {
  const b = req.body || {};
  if (!b.email || !String(b.email).includes('@')) return res.status(400).json({ error: '邮箱地址无效' });
  q.run(
    'INSERT INTO contacts(user_id, name, email, organization, phone, note, group_id, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
    req.user.id, b.name || b.email, String(b.email).toLowerCase().trim(), b.organization || '', b.phone || '', b.note || '',
    b.groupId || null, now(), now()
  );
  res.json({ id: q.get('SELECT last_insert_rowid() AS id').id });
});

router.put('/contacts/:id', requireAuth(), (req, res) => {
  const b = req.body || {};
  const c = q.get('SELECT * FROM contacts WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
  if (!c) return res.status(404).json({ error: '联系人不存在' });
  q.run(
    'UPDATE contacts SET name = ?, email = ?, organization = ?, phone = ?, note = ?, group_id = ?, updated_at = ? WHERE id = ?',
    b.name ?? c.name, b.email ?? c.email, b.organization ?? c.organization, b.phone ?? c.phone,
    b.note ?? c.note, b.groupId === undefined ? c.group_id : b.groupId, now(), c.id
  );
  res.json({ ok: true });
});

router.delete('/contacts/:id', requireAuth(), (req, res) => {
  q.run('DELETE FROM contacts WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
  res.json({ ok: true });
});

// ---------- 导入 ----------
router.post('/contacts/import', requireAuth(), (req, res) => {
  const { format, data } = req.body || {};
  if (!data) return res.status(400).json({ error: '缺少导入数据' });
  let count = 0;
  const rows = [];
  if (format === 'csv') {
    const lines = String(data).split(/\r?\n/).filter(l => l.trim());
    const parseCsvLine = (l) => {
      const out = []; let cur = ''; let inQ = false;
      for (let i = 0; i < l.length; i++) {
        const ch = l[i];
        if (inQ) { if (ch === '"') { if (l[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += ch; }
        else if (ch === '"') inQ = true;
        else if (ch === ',') { out.push(cur); cur = ''; }
        else cur += ch;
      }
      out.push(cur);
      return out;
    };
    const header = parseCsvLine(lines[0]).map(h => h.toLowerCase());
    const idx = (n) => header.findIndex(h => h.includes(n));
    const nameI = idx('name') >= 0 ? idx('name') : 0;
    const emailI = idx('email') >= 0 ? idx('email') : 1;
    const orgI = idx('org');
    const phoneI = idx('phone');
    for (let i = 1; i < lines.length; i++) {
      const cells = parseCsvLine(lines[i]);
      rows.push({ name: cells[nameI], email: cells[emailI], organization: orgI >= 0 ? cells[orgI] : '', phone: phoneI >= 0 ? cells[phoneI] : '' });
    }
  } else {
    // vCard: BEGIN:VCARD ... FN / N / EMAIL ... END:VCARD
    const cards = String(data).split(/END:VCARD/i);
    for (const card of cards) {
      const name = (card.match(/^FN[^:]*:(.+)$/mi) || [])[1];
      const email = (card.match(/^EMAIL[^:]*:(.+)$/mi) || [])[1];
      const org = (card.match(/^ORG[^:]*:(.+)$/mi) || [])[1];
      const tel = (card.match(/^TEL[^:]*:(.+)$/mi) || [])[1];
      if (email) rows.push({ name: (name || '').trim(), email: email.trim(), organization: (org || '').trim(), phone: (tel || '').trim() });
    }
  }
  for (const r of rows) {
    if (!r.email || !String(r.email).includes('@')) continue;
    const exists = q.get('SELECT id FROM contacts WHERE user_id = ? AND email = ?', req.user.id, String(r.email).toLowerCase());
    if (exists) continue;
    q.run(
      'INSERT INTO contacts(user_id, name, email, organization, phone, created_at, updated_at) VALUES(?,?,?,?,?,?,?)',
      req.user.id, r.name || r.email, String(r.email).toLowerCase().trim(), r.organization || '', r.phone || '', now(), now()
    );
    count++;
  }
  res.json({ imported: count });
});

// ---------- 导出 ----------
router.get('/contacts/export', requireAuth(), (req, res) => {
  const rows = q.all('SELECT * FROM contacts WHERE user_id = ? ORDER BY name', req.user.id);
  const format = req.query.format === 'csv' ? 'csv' : 'vcard';
  if (format === 'csv') {
    const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const lines = ['Name,Email,Organization,Phone'];
    for (const r of rows) lines.push([esc(r.name), esc(r.email), esc(r.organization), esc(r.phone)].join(','));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="contacts.csv"');
    // BOM 便于 Excel 识别 UTF-8
    return res.send('\ufeff' + lines.join('\n'));
  }
  const vcards = rows.map(r => [
    'BEGIN:VCARD', 'VERSION:3.0',
    `FN:${r.name}`, `N:${r.name};;;`,
    `EMAIL;TYPE=INTERNET:${r.email}`,
    r.organization ? `ORG:${r.organization}` : null,
    r.phone ? `TEL;TYPE=CELL:${r.phone}` : null,
    'END:VCARD',
  ].filter(Boolean).join('\r\n'));
  res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="contacts.vcf"');
  res.send(vcards.join('\r\n'));
});

export default router;
