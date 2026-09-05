// 管理端路由：仪表盘统计 / 用户 / 域名(DKIM) / 别名 / 黑名单 / 审计 / SMTP测试 / 备份
import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import dns from 'node:dns';
import net from 'node:net';
import bcrypt from 'bcryptjs';
import { db, q, now, audit, getSetting, setSetting } from '../db.js';
import { config, ensureDirs } from '../config.js';
import { requireAuth, revokeUserSessions } from '../util/auth.js';
import { generateDkimKeys, randomToken } from '../util/crypto.js';
import { sendMessage } from '../mail/outbound.js';
import { ensureSystemFolders } from '../mail/mailstore.js';

const router = Router();
// 所有 /admin 路由要求管理员角色（RBAC）
const guard = (req, res, next) => requireAuth('admin')(req, res, next);
router.use('/admin', guard);

// ---------- DNS 解析连通性一键检测 ----------
router.get('/admin/domains/:id/check', async (req, res) => {
  const d = q.get('SELECT * FROM domains WHERE id = ?', req.params.id);
  if (!d) return res.status(404).json({ error: '域名不存在' });
  const base = config.baseUrl.replace(/^https?:\/\//, '').split(':')[0] || `mail.${d.name}`;
  const ip = String(req.query.ip || '').trim();
  const dnsProm = dns.promises;
  const results = [];

  const check = async (name, expectSub, note, run) => {
    try {
      const found = (await run()) || null;
      const ok = !!found && (expectSub === '' || String(found).toLowerCase().includes(expectSub.toLowerCase()));
      results.push({ name, expected: expectSub || '—', found, ok, note: note || '' });
    } catch (e) {
      results.push({ name, expected: expectSub || '—', found: null, ok: false, note: (note || '') + (e.code ? ` (${e.code})` : '') });
    }
  };

  await check(`A 记录 · ${base}`, '', '邮件服务器主机名指向服务器 IP',
    async () => (await dnsProm.resolve4(base)).join(', '));
  await check(`MX 记录 · ${d.name}`, base, '告诉外部服务器把信投到哪里',
    async () => (await dnsProm.resolveMx(d.name)).sort((a, b) => a.priority - b.priority).map(m => m.exchange).join(', '));
  await check('SPF · TXT', 'v=spf1', '声明有权代本域发信的 IP',
    async () => {
      const flat = (await dnsProm.resolveTxt(d.name)).map(t => t.join(''));
      return flat.find(s => s.startsWith('v=spf1')) || null;
    });
  await check(`DKIM · ${d.dkim_selector}._domainkey`, 'v=DKIM1', '发信签名公钥',
    async () => {
      const flat = (await dnsProm.resolveTxt(`${d.dkim_selector}._domainkey.${d.name}`)).map(t => t.join(''));
      return flat.find(s => s.replace(/\s/g, '').startsWith('v=DKIM1')) || null;
    });
  await check('DMARC · _dmarc', 'v=DMARC', '验证失败策略与报告',
    async () => {
      const flat = (await dnsProm.resolveTxt(`_dmarc.${d.name}`)).map(t => t.join(''));
      return flat.find(s => s.startsWith('v=DMARC')) || null;
    });
  if (ip) {
    let ptr = null;
    try { ptr = (await dnsProm.reverse(ip))[0] || null; } catch {}
    results.push({ name: `PTR 反向解析 · ${ip}`, expected: base, found: ptr, ok: !!ptr && ptr.toLowerCase().includes(base.toLowerCase()),
      note: 'PTR 不在 DNS 服务商配置，需在云服务商控制台/工单设置' });
  }
  // 本机 SMTP 收信端口连通（验证服务在监听；外部能否连入取决于安全组/防火墙）
  const banner = await new Promise((resolve) => {
    const sock = net.createConnection({ host: '127.0.0.1', port: config.smtpPort }, () => {});
    let got = null;
    const done = (v) => { try { sock.destroy(); } catch {} resolve(v); };
    sock.setTimeout(3000, () => done(null));
    sock.on('data', (buf) => { if (/^220/.test(buf.toString())) { got = `220 就绪（本机 :${config.smtpPort}）`; done(got); } });
    sock.on('error', () => done(null));
  });
  results.push({ name: `SMTP 收信监听 · 本机:${config.smtpPort}`, expected: '220', found: banner, ok: !!banner,
    note: '本机自测。外部能否连入还取决于云安全组/防火墙对入站 25 端口的放行' });

  res.json({ domain: d.name, ok: results.every(r => r.ok), results });
});

// ---------- 仪表盘 ----------
// 探测服务器公网出口 IP（用于 DNS 记录示例预填；NAT 场景可能不准，允许手动修改）
router.get('/admin/myip', async (req, res) => {
  const services = ['https://api.ipify.org', 'https://ifconfig.me/ip', 'https://ipecho.net/plain'];
  for (const s of services) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      const r = await fetch(s, { signal: controller.signal });
      clearTimeout(timer);
      const ip = (await r.text()).trim();
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return res.json({ ip });
    } catch {}
  }
  res.json({ ip: '' });
});

router.get('/admin/stats', (req, res) => {
  const users = q.get('SELECT COUNT(*) AS c FROM users').c;
  const domains = q.get('SELECT COUNT(*) AS c FROM domains').c;
  const messages = q.get('SELECT COUNT(*) AS c FROM messages').c;
  const storage = q.get('SELECT COALESCE(SUM(used_bytes),0) AS s FROM users').s;
  const sentToday = q.get('SELECT COUNT(*) AS c FROM messages WHERE delivered_at > ? AND auth_results = ?', startOfDay(), 'outgoing').c;
  const receivedToday = q.get('SELECT COUNT(*) AS c FROM messages WHERE delivered_at > ? AND auth_results != ?', startOfDay(), 'outgoing').c;
  const spam = q.get("SELECT COUNT(*) AS c FROM messages m JOIN folders f ON f.id = m.folder_id WHERE f.type = 'junk'").c;
  // 近 14 天收发曲线
  const chart = [];
  for (let i = 13; i >= 0; i--) {
    const dayStart = startOfDay(-i);
    const dayEnd = startOfDay(-i + 1);
    const sent = q.get('SELECT COUNT(*) AS c FROM messages WHERE delivered_at >= ? AND delivered_at < ? AND auth_results = ?', dayStart, dayEnd, 'outgoing').c;
    const recv = q.get('SELECT COUNT(*) AS c FROM messages WHERE delivered_at >= ? AND delivered_at < ? AND auth_results != ?', dayStart, dayEnd, 'outgoing').c;
    chart.push({ date: new Date(dayStart).toISOString().slice(0, 10), sent, received: recv });
  }
  const queue = q.get("SELECT COUNT(*) AS c FROM outbound_queue WHERE status = 'queued'").c;
  const failed = q.get("SELECT COUNT(*) AS c FROM outbound_queue WHERE status = 'failed'").c;
  res.json({
    users, domains, messages, storage, sentToday, receivedToday, spam,
    chart, queue, failed,
    uptimeSec: Math.floor(process.uptime()),
    memMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    nodeVersion: process.version,
  });
});

function startOfDay(offsetDays = 0) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime() + offsetDays * 86400000;
}

// ---------- 用户管理 ----------
router.get('/admin/users', (req, res) => {
  const users = q.all(
    `SELECT u.id, u.address, u.display_name, u.role, u.status, u.quota_bytes, u.used_bytes,
       u.totp_enabled, u.created_at, u.last_login_at,
       (SELECT COUNT(*) FROM messages m WHERE m.user_id = u.id) AS message_count
     FROM users u ORDER BY u.id`
  );
  res.json({ users });
});

router.post('/admin/users', (req, res) => {
  const b = req.body || {};
  const address = String(b.address || '').toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+$/.test(address)) return res.status(400).json({ error: '邮箱地址无效' });
  const domain = address.split('@')[1];
  if (!q.get('SELECT id FROM domains WHERE name = ?', domain)) return res.status(400).json({ error: `域名 ${domain} 未托管` });
  if (q.get('SELECT id FROM users WHERE address = ?', address)) return res.status(409).json({ error: '邮箱已存在' });
  const password = b.password || randomToken(9);
  const role = ['admin', 'user', 'temp'].includes(b.role) ? b.role : 'user';
  const quota = Math.max(1, parseInt(b.quotaMB) || config.maxMailboxSize) * 1024 * 1024;
  q.run(
    'INSERT INTO users(address, display_name, password_hash, role, quota_bytes, created_at) VALUES(?,?,?,?,?,?)',
    address, b.displayName || address.split('@')[0], bcrypt.hashSync(password, config.bcryptRounds), role, quota, now()
  );
  const u = q.get('SELECT * FROM users WHERE address = ?', address);
  ensureSystemFolders(u.id);
  audit(u.id, 'admin', 'admin.user_create', `创建用户 ${address} (${role})`);
  res.json({ id: u.id, initialPassword: b.password ? undefined : password });
});

router.patch('/admin/users/:id', (req, res) => {
  const u = q.get('SELECT * FROM users WHERE id = ?', req.params.id);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  const b = req.body || {};
  if (b.role && ['admin', 'user', 'temp'].includes(b.role)) {
    q.run('UPDATE users SET role = ? WHERE id = ?', b.role, u.id);
  }
  if (b.status && ['active', 'banned'].includes(b.status)) {
    q.run('UPDATE users SET status = ? WHERE id = ?', b.status, u.id);
    if (b.status === 'banned') revokeUserSessions(u.id);
  }
  if (b.quotaMB) {
    q.run('UPDATE users SET quota_bytes = ? WHERE id = ?', Math.max(1, parseInt(b.quotaMB)) * 1024 * 1024, u.id);
  }
  if (b.password) {
    if (String(b.password).length < 6) return res.status(400).json({ error: '密码至少 6 位' });
    q.run('UPDATE users SET password_hash = ? WHERE id = ?', bcrypt.hashSync(b.password, config.bcryptRounds), u.id);
    revokeUserSessions(u.id);
  }
  audit(u.id, 'admin', 'admin.user_update', `更新用户 ${u.address}: ${JSON.stringify({ ...b, password: b.password ? '(已重置)' : undefined })}`);
  res.json({ ok: true });
});

router.delete('/admin/users/:id', (req, res) => {
  const u = q.get('SELECT * FROM users WHERE id = ?', req.params.id);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  if (u.id === req.user.id) return res.status(400).json({ error: '不能删除自己' });
  // 级联清理
  for (const t of ['messages', 'folders', 'contacts', 'contact_groups', 'tags', 'filters', 'sessions', 'blacklist']) {
    try { q.run(`DELETE FROM ${t} WHERE user_id = ?`, u.id); } catch {}
  }
  q.run('DELETE FROM users WHERE id = ?', u.id);
  audit(null, 'admin', 'admin.user_delete', `删除用户 ${u.address}`);
  res.json({ ok: true });
});

// ---------- 域名管理 ----------
router.get('/admin/domains', (req, res) => {
  const domains = q.all('SELECT * FROM domains ORDER BY id');
  res.json({ domains: domains.map(d => ({ ...d, dkim_private_key: undefined })) });
});

router.post('/admin/domains', (req, res) => {
  const name = String(req.body?.name || '').toLowerCase().trim();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(name)) return res.status(400).json({ error: '域名格式无效' });
  if (q.get('SELECT id FROM domains WHERE name = ?', name)) return res.status(409).json({ error: '域名已存在' });
  const keys = generateDkimKeys();
  const info = q.run(
    'INSERT INTO domains(name, dkim_selector, dkim_private_key, dkim_public_key, created_at) VALUES(?,?,?,?,?)',
    name, config.dkimSelector, keys.privateKey, keys.publicKey, now()
  );
  audit(null, 'admin', 'admin.domain_add', `添加域名 ${name}（已生成 DKIM 密钥）`);
  res.json({ id: Number(info.lastInsertRowid) });
});

router.delete('/admin/domains/:id', (req, res) => {
  const d = q.get('SELECT * FROM domains WHERE id = ?', req.params.id);
  if (!d) return res.status(404).json({ error: '域名不存在' });
  const inUse = q.get("SELECT COUNT(*) AS c FROM users WHERE address LIKE ?", '%@' + d.name);
  if (inUse.c > 0) return res.status(400).json({ error: `仍有 ${inUse.c} 个用户使用该域名，请先删除或迁移` });
  q.run('DELETE FROM domains WHERE id = ?', d.id);
  audit(null, 'admin', 'admin.domain_delete', `删除域名 ${d.name}`);
  res.json({ ok: true });
});

router.patch('/admin/domains/:id', (req, res) => {
  const d = q.get('SELECT * FROM domains WHERE id = ?', req.params.id);
  if (!d) return res.status(404).json({ error: '域名不存在' });
  const b = req.body || {};
  if (b.catchAll !== undefined) {
    if (b.catchAll) {
      const u = q.get('SELECT * FROM users WHERE address = ?', String(b.catchAll).toLowerCase());
      if (!u) return res.status(400).json({ error: 'Catch-all 目标邮箱不存在' });
      q.run('UPDATE domains SET catch_all_mailbox = ? WHERE id = ?', u.address, d.id);
    } else {
      q.run('UPDATE domains SET catch_all_mailbox = NULL WHERE id = ?', d.id);
    }
  }
  if (b.regenerateDkim) {
    const keys = generateDkimKeys();
    q.run('UPDATE domains SET dkim_private_key = ?, dkim_public_key = ? WHERE id = ?', keys.privateKey, keys.publicKey, d.id);
  }
  audit(null, 'admin', 'admin.domain_update', `更新域名 ${d.name}`);
  res.json({ ok: true });
});

// DNS 配置记录展示
router.get('/admin/domains/:id/dns', (req, res) => {
  const d = q.get('SELECT * FROM domains WHERE id = ?', req.params.id);
  if (!d) return res.status(404).json({ error: '域名不存在' });
  const host = config.baseUrl.replace(/^https?:\/\//, '').split(':')[0] || `mail.${d.name}`;
  const ip = req.query.ip || '203.0.113.10';
  res.json({
    domain: d.name,
    selector: d.dkim_selector,
    records: [
      { type: 'A', name: host, value: ip, note: '邮件服务器主机名 → 服务器公网 IP' },
      { type: 'MX', name: d.name, value: `${host} (优先级 10)`, note: '告诉其他服务器往哪里投递' },
      { type: 'TXT (SPF)', name: d.name, value: `v=spf1 mx ip4:${ip} ~all`, note: '观察一周后可将 ~all 改为 -all' },
      { type: 'TXT (DKIM)', name: `${d.dkim_selector}._domainkey.${d.name}`, value: `v=DKIM1; k=rsa; p=${d.dkim_public_key}`, note: 'DKIM 公钥' },
      { type: 'TXT (DMARC)', name: `_dmarc.${d.name}`, value: `v=DMARC1; p=none; rua=mailto:admin@${d.name}`, note: '先 p=none 收报告，稳定后改 p=quarantine' },
      { type: 'PTR', name: ip, value: host, note: '在云服务商/VPS 控制台设置反向解析' },
    ],
  });
});

// ---------- 别名管理 ----------
router.get('/admin/aliases', (req, res) => {
  const aliases = q.all(
    `SELECT a.*, d.name AS domain_name FROM aliases a JOIN domains d ON d.id = a.domain_id ORDER BY a.id DESC`
  );
  res.json({ aliases });
});

router.post('/admin/aliases', (req, res) => {
  const source = String(req.body?.source || '').toLowerCase().trim();
  const destination = String(req.body?.destination || '').toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+$/.test(source)) return res.status(400).json({ error: '别名地址无效' });
  const dest = q.get('SELECT * FROM users WHERE address = ?', destination);
  if (!dest) return res.status(400).json({ error: '目标邮箱不存在' });
  const domain = q.get('SELECT * FROM domains WHERE name = ?', source.split('@')[1]);
  if (!domain) return res.status(400).json({ error: '别名域名未托管' });
  if (q.get('SELECT id FROM aliases WHERE source = ?', source)) return res.status(409).json({ error: '别名已存在' });
  const info = q.run('INSERT INTO aliases(domain_id, source, destination, created_at) VALUES(?,?,?,?)', domain.id, source, destination, now());
  audit(null, 'admin', 'admin.alias_add', `${source} → ${destination}`);
  res.json({ id: Number(info.lastInsertRowid) });
});

router.patch('/admin/aliases/:id', (req, res) => {
  q.run('UPDATE aliases SET enabled = ? WHERE id = ?', req.body?.enabled ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

router.delete('/admin/aliases/:id', (req, res) => {
  q.run('DELETE FROM aliases WHERE id = ?', req.params.id);
  res.json({ ok: true });
});

// ---------- 全局黑名单 ----------
router.get('/admin/blacklist', (req, res) => {
  res.json({ entries: q.all('SELECT * FROM blacklist WHERE user_id IS NULL ORDER BY id DESC') });
});

router.post('/admin/blacklist', (req, res) => {
  const pattern = String(req.body?.pattern || '').toLowerCase().trim();
  if (!pattern || /\s/.test(pattern)) return res.status(400).json({ error: '请输入有效地址或域名' });
  const info = q.run('INSERT INTO blacklist(user_id, pattern, created_at) VALUES(NULL, ?, ?)', pattern, now());
  audit(null, 'admin', 'admin.blacklist_add', pattern);
  res.json({ id: Number(info.lastInsertRowid) });
});

router.delete('/admin/blacklist/:id', (req, res) => {
  q.run('DELETE FROM blacklist WHERE id = ? AND user_id IS NULL', req.params.id);
  res.json({ ok: true });
});

// ---------- 审计日志 ----------
router.get('/admin/audit', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = 50;
  const total = q.get('SELECT COUNT(*) AS c FROM audit_logs').c;
  const logs = q.all(
    'SELECT * FROM audit_logs ORDER BY id DESC LIMIT ? OFFSET ?', pageSize, (page - 1) * pageSize
  );
  res.json({ logs, total, page, pageSize });
});

// ---------- 日志文件 ----------
router.get('/admin/logs', (req, res) => {
  const dir = path.join(config.dataDir, 'logs');
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.log')).sort();
    if (!files.length) return res.json({ file: '', lines: ['（暂无日志文件）'] });
    const latest = files[files.length - 1];
    const content = fs.readFileSync(path.join(dir, latest), 'utf8');
    res.json({ file: latest, lines: content.split(/\r?\n/).slice(-400) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/admin/logs/download', (req, res) => {
  const dir = path.join(config.dataDir, 'logs');
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.log')).sort();
    if (!files.length) return res.status(404).json({ error: '暂无日志文件' });
    const latest = files[files.length - 1];
    audit(null, 'admin', 'admin.logs_download', latest);
    res.download(path.join(dir, latest), latest);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------- 系统设置 ----------
router.get('/admin/settings', (req, res) => {
  res.json({
    siteName: getSetting('site_name', config.siteName),
    registration: getSetting('registration', String(config.registrationEnabled)) === 'true',
    maxAttachmentMB: Math.max(1, parseInt(getSetting('max_attachment_mb', '25')) || 25),
    relay: { configured: !!config.relay.host, host: config.relay.host, port: config.relay.port },
    smtp: {
      mxPort: config.smtpPort, submissionPort: config.submissionPort,
      imapPort: config.imapPort, pop3Port: config.pop3Port,
    },
    adminCode: getSetting('admin_code', ''),
  });
});

router.put('/admin/settings', (req, res) => {
  const b = req.body || {};
  if (b.siteName !== undefined) setSetting('site_name', b.siteName);
  if (b.registration !== undefined) setSetting('registration', String(!!b.registration));
  if (b.adminCode !== undefined) setSetting('admin_code', b.adminCode);
  if (b.maxAttachmentMB !== undefined) {
    const mb = Math.min(2048, Math.max(1, parseInt(b.maxAttachmentMB) || 25));
    setSetting('max_attachment_mb', String(mb));
  }
  audit(null, 'admin', 'admin.settings', '更新系统设置');
  res.json({ ok: true });
});

// ---------- SMTP 测试 ----------
router.post('/admin/smtp-test', async (req, res) => {
  const { to } = req.body || {};
  try {
    const result = await sendMessage(req.user, {
      to, subject: `【${config.siteName}】SMTP 测试邮件`,
      text: `这是一封测试邮件。\n发送时间: ${new Date().toLocaleString()}\n如果你收到了它，说明发信链路工作正常。`,
      html: `<p>这是一封 <b>测试邮件</b>。</p><p>发送时间: ${new Date().toLocaleString()}</p><p>如果你收到了它，说明发信链路工作正常。</p>`,
    }, [], null);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- 外发队列 ----------
router.get('/admin/queue', (req, res) => {
  res.json({ queue: q.all('SELECT id, sender, recipient, attempts, status, last_error, next_attempt_at FROM outbound_queue ORDER BY id DESC LIMIT 100') });
});

// ---------- 备份 ----------
router.get('/admin/backup', (req, res) => {
  ensureDirs();
  const backupPath = path.join(config.dataDir, `backup-${Date.now()}.db`);
  try {
    db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
    audit(null, 'admin', 'admin.backup', '下载数据库备份');
    res.download(backupPath, `openmail-backup-${new Date().toISOString().slice(0, 10)}.db`, (err) => {
      fs.unlink(backupPath, () => {});
    });
  } catch (err) {
    res.status(500).json({ error: '备份失败: ' + err.message });
  }
});

// 邮件收发统计（供仪表盘表格）
router.get('/admin/mail-stats', (req, res) => {
  const byDay = q.all(
    `SELECT date(delivered_at/1000, 'unixepoch') AS day,
       SUM(CASE WHEN auth_results = 'outgoing' THEN 1 ELSE 0 END) AS sent,
       SUM(CASE WHEN auth_results != 'outgoing' THEN 1 ELSE 0 END) AS received,
       SUM(CASE WHEN spam_score >= ${config.antispam.junkThreshold} THEN 1 ELSE 0 END) AS spam
     FROM messages GROUP BY day ORDER BY day DESC LIMIT 30`
  );
  res.json({ byDay });
});

export default router;
