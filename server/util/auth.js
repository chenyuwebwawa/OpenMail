// 认证与会话：Bearer / Cookie 双通道，RBAC 权限守卫
import { q, now, audit } from '../db.js';
import { config } from '../config.js';
import { randomToken, sha256 } from './crypto.js';

export function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function createSession(userId, ip = '', ua = '') {
  const token = randomToken(32);
  const expires = now() + config.sessionTtlHours * 3600 * 1000;
  q.run(
    'INSERT INTO sessions(token_hash, user_id, ip, user_agent, created_at, expires_at, last_seen) VALUES(?,?,?,?,?,?,?)',
    sha256(token), userId, ip, String(ua).slice(0, 300), now(), expires, now()
  );
  return { token, expiresAt: expires };
}

export function revokeSession(token) {
  q.run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
}

export function revokeUserSessions(userId) {
  q.run('DELETE FROM sessions WHERE user_id = ?', userId);
}

export function touchSession(tokenHash) {
  q.run('UPDATE sessions SET last_seen = ? WHERE token_hash = ?', now(), tokenHash);
}

// 从请求解析当前用户（Cookie 或 Authorization: Bearer）
export function resolveUser(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  let token = cookies.om_session;
  const authz = req.headers.authorization || '';
  if (authz.startsWith('Bearer ')) token = authz.slice(7);
  if (!token) return null;

  const s = q.get(
    'SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?',
    sha256(token), now()
  );
  if (!s) return null;
  const user = q.get('SELECT * FROM users WHERE id = ?', s.user_id);
  if (!user || user.status === 'banned') return null;
  touchSession(s.token_hash);
  req.session = s;
  req.sessionToken = token;
  return user;
}

// RBAC：角色层级 admin > user > temp
const ROLE_LEVEL = { admin: 3, user: 2, temp: 1 };

export function requireAuth(minRole = 'user') {
  return (req, res, next) => {
    const user = resolveUser(req);
    if (!user) {
      return res.status(401).json({ error: '未登录或会话已过期' });
    }
    if ((ROLE_LEVEL[user.role] || 0) < (ROLE_LEVEL[minRole] || 0)) {
      return res.status(403).json({ error: '权限不足' });
    }
    req.user = user;
    next();
  };
}

export function logAudit(req, action, detail = '') {
  const userId = req.user?.id ?? null;
  const actor = req.user?.address || '';
  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';
  audit(userId, actor, action, detail, ip);
}
