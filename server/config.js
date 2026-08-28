// OpenMail 全局配置 —— 所有配置均可通过环境变量 / .env 覆盖
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

// 读取 .env（不依赖 dotenv，保持零依赖理念）
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

const int = (v, d) => (v !== undefined && v !== '' ? parseInt(v, 10) : d);
const bool = (v, d) => (v !== undefined && v !== '' ? v === 'true' || v === '1' : d);

export const config = {
  // ---- 基础 ----
  siteName: process.env.OM_SITE_NAME || 'OpenMail',
  baseUrl: process.env.OM_BASE_URL || 'http://localhost:3000',
  dataDir: path.resolve(ROOT, process.env.OM_DATA_DIR || 'data'),
  filesDir: path.resolve(ROOT, process.env.OM_FILES_DIR || 'files'),
  primaryDomain: process.env.OM_PRIMARY_DOMAIN || 'localhost',

  // ---- HTTP ----
  httpPort: int(process.env.OM_HTTP_PORT, 3000),
  tlsCert: process.env.OM_TLS_CERT || '',
  tlsKey: process.env.OM_TLS_KEY || '',
  httpsPort: int(process.env.OM_HTTPS_PORT, 0), // 0 = 关闭

  // ---- SMTP ----
  smtpPort: int(process.env.OM_SMTP_PORT, 2525),        // 生产 25：服务器间投递
  submissionPort: int(process.env.OM_SUBMISSION_PORT, 2587), // 生产 587：用户发信(SASL)
  smtpsPort: int(process.env.OM_SMTPS_PORT, 2546),      // 生产 465：隐式 TLS 发信
  smtpMaxSize: int(process.env.OM_SMTP_MAX_SIZE, 26214400), // 25MB
  maxMailboxSize: int(process.env.OM_MAX_MAILBOX_MB, 1024), // 默认邮箱配额 1GB

  // ---- IMAP / POP3 ----
  imapPort: int(process.env.OM_IMAP_PORT, 1143),   // 生产 143
  imapsPort: int(process.env.OM_IMAPS_PORT, 1993), // 生产 993
  pop3Port: int(process.env.OM_POP3_PORT, 1110),   // 生产 110
  pop3sPort: int(process.env.OM_POP3S_PORT, 1995), // 生产 995
  jmapEnabled: bool(process.env.OM_JMAP, false),

  // ---- 安全 ----
  secret: process.env.OM_SECRET || crypto.randomBytes(32).toString('hex'),
  sessionTtlHours: int(process.env.OM_SESSION_TTL_HOURS, 24 * 7),
  registrationEnabled: bool(process.env.OM_REGISTRATION, true),
  bcryptRounds: int(process.env.OM_BCRYPT_ROUNDS, 10),

  // ---- 外发中继（可选：若云厂商封 25 端口，配置上游 SMTP 中继）----
  relay: {
    host: process.env.OM_RELAY_HOST || '',   // 例 smtp.exmail.com
    port: int(process.env.OM_RELAY_PORT, 587),
    secure: bool(process.env.OM_RELAY_SECURE, false),
    user: process.env.OM_RELAY_USER || '',
    pass: process.env.OM_RELAY_PASS || '',
  },

  // ---- 反垃圾 ----
  antispam: {
    junkThreshold: parseFloat(process.env.OM_SPAM_SCORE || '5'),
    rejectThreshold: parseFloat(process.env.OM_SPAM_REJECT || '12'),
    enabled: bool(process.env.OM_ANTISPAM, true),
  },

  dkimSelector: process.env.OM_DKIM_SELECTOR || 'om1',
  adminEmail: process.env.OM_ADMIN_EMAIL || 'admin@localhost',
};

export function ensureDirs() {
  for (const d of [config.dataDir, config.filesDir]) {
    fs.mkdirSync(d, { recursive: true });
  }
}
