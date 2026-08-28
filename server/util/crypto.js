// 加密 / 令牌工具：TOTP(RFC 6238)、Base32、随机令牌、DKIM 密钥生成
import crypto from 'node:crypto';

// ---------- Base32 (RFC 4648) ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = str.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// ---------- TOTP (RFC 6238, SHA1/6位/30s，兼容 Google Authenticator) ----------
export function generateTotpSecret() {
  return base32Encode(crypto.randomBytes(20));
}

export function totpCode(secret, timeStep = Math.floor(Date.now() / 30000)) {
  const key = base32Decode(secret);
  const msg = Buffer.alloc(8);
  msg.writeUInt32BE(Math.floor(timeStep / 0x100000000), 0);
  msg.writeUInt32BE(timeStep >>> 0, 4);
  const hmac = crypto.createHmac('sha1', key).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(code % 1000000).padStart(6, '0');
}

export function verifyTotp(secret, token, window = 1) {
  const step = Math.floor(Date.now() / 30000);
  const t = String(token || '').trim();
  if (!/^\d{6}$/.test(t)) return false;
  for (let i = -window; i <= window; i++) {
    if (totpCode(secret, step + i) === t) return true;
  }
  return false;
}

export function otpauthUri(account, secret, issuer = 'OpenMail') {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

// ---------- 令牌 / 哈希 ----------
export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

export function hmacSign(data, secret) {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

// ---------- DKIM ----------
export function generateDkimKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
  // 提取裸 base64 公钥（去掉 PEM 头尾，拼成单行，用于 DNS TXT 记录）
  const pubB64 = pubPem.split(/\r?\n/).filter(l => l && !l.startsWith('-----')).join('');
  return {
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicKey: pubB64,
  };
}

// ---------- 其他 ----------
export function normalizeAddress(s) {
  if (!s) return '';
  const m = String(s).match(/<([^>]+)>/);
  const addr = (m ? m[1] : s).trim().toLowerCase();
  return addr;
}

export function validateEmail(addr) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$|^[^\s@]+@localhost$/i.test(String(addr || '').trim());
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
