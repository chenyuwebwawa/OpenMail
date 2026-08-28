// 认证路由：注册 / 登录 / 2FA / 会话 / 密码重置
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { q, now, audit, setSetting, getSetting } from '../db.js';
import { config } from '../config.js';
import { createSession, revokeSession, revokeUserSessions, requireAuth, resolveUser, logAudit, parseCookies } from '../util/auth.js';
import { verifyTotp, generateTotpSecret, otpauthUri, randomToken, sha256, validateEmail } from '../util/crypto.js';
import { ensureSystemFolders } from '../mail/mailstore.js';
import { deliverSystemMail } from '../mail/delivery.js';

const router = Router();

function setSessionCookie(res, token, maxAgeMs) {
  res.setHeader('Set-Cookie',
    `om_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'om_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

function userPayload(u) {
  return {
    id: u.id, address: u.address, displayName: u.display_name, role: u.role,
    totpEnabled: !!u.totp_enabled, quotaBytes: u.quota_bytes, usedBytes: u.used_bytes,
    signature: u.signature,
  };
}

// 待二次验证的临时票据
const pending2fa = new Map(); // ticket -> {userId, expires}

router.post('/register', (req, res) => {
  if (!config.registrationEnabled && req.body.adminCode !== getSetting('admin_code')) {
    return res.status(403).json({ error: '管理员已关闭开放注册' });
  }
  const { address, password, displayName } = req.body || {};
  if (!validateEmail(address)) return res.status(400).json({ error: '邮箱地址格式不正确' });
  const addr = String(address).toLowerCase().trim();
  const domain = addr.split('@')[1];
  if (!q.get('SELECT id FROM domains WHERE name = ?', domain)) {
    return res.status(400).json({ error: `域名 @${domain} 未在本系统托管` });
  }
  if (String(password || '').length < 6) return res.status(400).json({ error: '密码至少 6 位' });
  if (q.get('SELECT id FROM users WHERE address = ?', addr)) {
    return res.status(409).json({ error: '该邮箱已被注册' });
  }
  const hash = bcrypt.hashSync(password, config.bcryptRounds);
  q.run(
    'INSERT INTO users(address, display_name, password_hash, role, created_at) VALUES(?,?,?,?,?)',
    addr, String(displayName || addr.split('@')[0]).slice(0, 60), hash, 'user', now()
  );
  const u = q.get('SELECT * FROM users WHERE address = ?', addr);
  ensureSystemFolders(u.id);
  audit(u.id, addr, 'user.register', `注册账号 ${addr}`);
  const sess = createSession(u.id, req.ip, req.headers['user-agent'] || '');
  setSessionCookie(res, sess.token, config.sessionTtlHours * 3600 * 1000);
  res.json({ user: userPayload(u), token: sess.token });
});

router.post('/login', (req, res) => {
  const { address, password } = req.body || {};
  const addr = String(address || '').toLowerCase().trim();
  const full = addr.includes('@') ? addr : `${addr}@${config.primaryDomain}`;
  const u = q.get('SELECT * FROM users WHERE address = ? OR address = ?', full, addr);
  if (!u || !bcrypt.compareSync(String(password || ''), u.password_hash)) {
    audit(u?.id ?? null, addr, 'user.login_failed', `登录失败: ${addr}`);
    return res.status(401).json({ error: '邮箱或密码错误' });
  }
  if (u.status === 'banned') return res.status(403).json({ error: '账号已被封禁，请联系管理员' });

  if (u.totp_enabled) {
    const ticket = randomToken(24);
    pending2fa.set(ticket, { userId: u.id, expires: now() + 5 * 60 * 1000 });
    return res.json({ need2fa: true, ticket });
  }
  const sess = createSession(u.id, req.ip, req.headers['user-agent'] || '');
  setSessionCookie(res, sess.token, config.sessionTtlHours * 3600 * 1000);
  q.run('UPDATE users SET last_login_at = ? WHERE id = ?', now(), u.id);
  audit(u.id, u.address, 'user.login', '登录成功');
  res.json({ user: userPayload(u), token: sess.token });
});

router.post('/login/2fa', (req, res) => {
  const { ticket, code } = req.body || {};
  const p = pending2fa.get(String(ticket || ''));
  if (!p || p.expires < now()) {
    pending2fa.delete(String(ticket));
    return res.status(401).json({ error: '验证已过期，请重新登录' });
  }
  const u = q.get('SELECT * FROM users WHERE id = ?', p.userId);
  if (!u || !u.totp_enabled) return res.status(401).json({ error: '验证状态异常' });
  if (!verifyTotp(u.totp_secret, code)) {
    audit(u.id, u.address, 'user.2fa_failed', '2FA 验证码错误');
    return res.status(401).json({ error: '动态验证码错误' });
  }
  pending2fa.delete(String(ticket));
  const sess = createSession(u.id, req.ip, req.headers['user-agent'] || '');
  setSessionCookie(res, sess.token, config.sessionTtlHours * 3600 * 1000);
  q.run('UPDATE users SET last_login_at = ? WHERE id = ?', now(), u.id);
  audit(u.id, u.address, 'user.login', '登录成功（含 2FA）');
  res.json({ user: userPayload(u), token: sess.token });
});

router.post('/logout', (req, res) => {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies.om_session || (req.headers.authorization || '').replace('Bearer ', '');
  if (token) revokeSession(token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  const u = resolveUser(req);
  if (!u) return res.status(401).json({ error: '未登录' });
  res.json({ user: userPayload(u) });
});

router.post('/password', requireAuth(), (req, res) => {
  const { current, next } = req.body || {};
  if (!bcrypt.compareSync(String(current || ''), req.user.password_hash)) {
    return res.status(400).json({ error: '当前密码错误' });
  }
  if (String(next || '').length < 6) return res.status(400).json({ error: '新密码至少 6 位' });
  q.run('UPDATE users SET password_hash = ? WHERE id = ?', bcrypt.hashSync(next, config.bcryptRounds), req.user.id);
  logAudit(req, 'user.password_change', '修改密码');
  res.json({ ok: true });
});

// ---- 2FA ----
router.post('/2fa/setup', requireAuth(), (req, res) => {
  const secret = generateTotpSecret();
  q.run('UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?', secret, req.user.id);
  res.json({ secret, uri: otpauthUri(req.user.address, secret, config.siteName) });
});

// 2FA 二维码（SVG）
router.get('/2fa/qr.svg', async (req, res) => {
  const u = resolveUser(req);
  if (!u || !u.totp_secret) return res.status(404).end();
  try {
    const QRCode = (await import('qrcode')).default;
    const svg = await QRCode.toString(otpauthUri(u.address, u.totp_secret, config.siteName), { type: 'svg', margin: 1, width: 200 });
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(svg);
  } catch { res.status(500).end(); }
});

router.post('/2fa/enable', requireAuth(), (req, res) => {
  const u = q.get('SELECT * FROM users WHERE id = ?', req.user.id);
  if (!u.totp_secret) return res.status(400).json({ error: '请先获取密钥' });
  if (!verifyTotp(u.totp_secret, req.body?.code)) return res.status(400).json({ error: '验证码错误' });
  q.run('UPDATE users SET totp_enabled = 1 WHERE id = ?', u.id);
  logAudit(req, 'user.2fa_enable', '启用两步验证');
  res.json({ ok: true });
});

router.post('/2fa/disable', requireAuth(), (req, res) => {
  const { code } = req.body || {};
  const u = q.get('SELECT * FROM users WHERE id = ?', req.user.id);
  if (u.totp_enabled && !verifyTotp(u.totp_secret, code)) return res.status(400).json({ error: '验证码错误' });
  q.run('UPDATE users SET totp_secret = NULL, totp_enabled = 0 WHERE id = ?', u.id);
  logAudit(req, 'user.2fa_disable', '关闭两步验证');
  res.json({ ok: true });
});

// ---- 会话管理 ----
router.get('/sessions', requireAuth(), (req, res) => {
  const rows = q.all('SELECT id, ip, user_agent, created_at, last_seen, expires_at FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen DESC', req.user.id, now());
  res.json({ sessions: rows.map(s => ({ ...s, current: !!(req.session && s.id === req.session.id) })) });
});

router.delete('/sessions/:id', requireAuth(), (req, res) => {
  q.run('DELETE FROM sessions WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
  logAudit(req, 'user.session_revoke', `撤销会话 #${req.params.id}`);
  res.json({ ok: true });
});

// ---- 忘记密码 ----
router.post('/forgot', (req, res) => {
  const addr = String(req.body?.address || '').toLowerCase().trim();
  const u = q.get('SELECT * FROM users WHERE address = ?', addr);
  // 无论是否存在都返回成功（防枚举）
  if (u) {
    const token = randomToken(24);
    q.run('INSERT INTO password_resets(user_id, token_hash, expires_at, created_at) VALUES(?,?,?,?)',
      u.id, sha256(token), now() + 30 * 60 * 1000, now());
    const link = `${config.baseUrl}/app/#/reset?token=${token}`;
    deliverSystemMail(addr, '密码重置请求',
      `您（或他人）请求重置 ${addr} 的密码。\n\n请在 30 分钟内访问以下链接完成重置：\n${link}\n\n如非本人操作请忽略此邮件。`);
    audit(u.id, addr, 'user.password_reset_request', '请求重置密码');
  }
  res.json({ ok: true, message: '如果该邮箱存在，重置链接已发送至邮箱（站内信）。' });
});

router.post('/reset', (req, res) => {
  const { token, password } = req.body || {};
  const row = q.get('SELECT * FROM password_resets WHERE token_hash = ? AND used = 0 AND expires_at > ?', sha256(String(token || '')), now());
  if (!row) return res.status(400).json({ error: '重置链接无效或已过期' });
  if (String(password || '').length < 6) return res.status(400).json({ error: '密码至少 6 位' });
  q.run('UPDATE users SET password_hash = ? WHERE id = ?', bcrypt.hashSync(password, config.bcryptRounds), row.user_id);
  q.run('UPDATE password_resets SET used = 1 WHERE id = ?', row.id);
  revokeUserSessions(row.user_id);
  const u = q.get('SELECT address FROM users WHERE id = ?', row.user_id);
  audit(row.user_id, u?.address || '', 'user.password_reset', '密码重置完成');
  res.json({ ok: true });
});

export default router;
