// 数据库层：node:sqlite（零原生依赖）+ 全量 Schema + 常用查询助手
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { config, ensureDirs } from './config.js';

ensureDirs();

export const db = new DatabaseSync(path.join(config.dataDir, 'openmail.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS domains (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  dkim_selector TEXT DEFAULT 'om1',
  dkim_private_key TEXT,
  dkim_public_key TEXT,
  catch_all_mailbox TEXT,          -- catch-all 目标邮箱地址，空 = 关闭
  is_primary INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  address TEXT UNIQUE NOT NULL,           -- user@domain.com
  display_name TEXT DEFAULT '',
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',      -- admin / user / temp
  status TEXT NOT NULL DEFAULT 'active',  -- active / banned
  quota_bytes INTEGER DEFAULT 1073741824,
  used_bytes INTEGER DEFAULT 0,
  totp_secret TEXT,
  totp_enabled INTEGER DEFAULT 0,
  signature TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE IF NOT EXISTS aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain_id INTEGER NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  source TEXT NOT NULL,             -- alias@domain.com
  destination TEXT NOT NULL,        -- user@domain.com
  enabled INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT UNIQUE NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip TEXT DEFAULT '',
  user_agent TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id INTEGER,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'custom',  -- inbox/sent/drafts/trash/junk/archive/custom
  sort_order INTEGER DEFAULT 0,
  uid_next INTEGER DEFAULT 1,           -- IMAP UID 分配
  UNIQUE(user_id, name)
);

CREATE TABLE IF NOT EXISTS threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  thread_id INTEGER REFERENCES threads(id) ON DELETE SET NULL,
  uid INTEGER DEFAULT 0,
  imap_deleted INTEGER DEFAULT 0,
  message_id TEXT DEFAULT '',
  in_reply_to TEXT DEFAULT '',
  refs TEXT DEFAULT '',
  from_name TEXT DEFAULT '',
  from_addr TEXT DEFAULT '',
  to_addrs TEXT DEFAULT '',
  cc_addrs TEXT DEFAULT '',
  bcc_addrs TEXT DEFAULT '',
  reply_to TEXT DEFAULT '',
  subject TEXT DEFAULT '',
  snippet TEXT DEFAULT '',
  body_text TEXT DEFAULT '',
  body_html TEXT DEFAULT '',
  raw_eml TEXT,                       -- 原始报文（IMAP/POP3 取信用）
  size INTEGER DEFAULT 0,
  is_read INTEGER DEFAULT 0,
  is_starred INTEGER DEFAULT 0,
  is_answered INTEGER DEFAULT 0,
  is_forwarded INTEGER DEFAULT 0,
  is_draft INTEGER DEFAULT 0,
  has_attachments INTEGER DEFAULT 0,
  spam_score REAL DEFAULT 0,
  auth_results TEXT DEFAULT '',
  delivered_at INTEGER NOT NULL,
  scheduled_at INTEGER,               -- 定时发送时间（草稿箱内）
  send_status TEXT DEFAULT '',        -- sent / queued / failed / ''
  send_error TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_msg_user_folder ON messages(user_id, folder_id, delivered_at DESC);
CREATE INDEX IF NOT EXISTS idx_msg_thread ON messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_msg_mid ON messages(message_id);
CREATE INDEX IF NOT EXISTS idx_msg_uid ON messages(folder_id, uid);

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT DEFAULT 'application/octet-stream',
  size INTEGER DEFAULT 0,
  path TEXT NOT NULL,
  content_id TEXT DEFAULT '',
  is_inline INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  organization TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  note TEXT DEFAULT '',
  group_id INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS contact_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  UNIQUE(user_id, name)
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#3b82f6',
  UNIQUE(user_id, name)
);

CREATE TABLE IF NOT EXISTS message_tags (
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  UNIQUE(message_id, tag_id)
);

CREATE TABLE IF NOT EXISTS filters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  field TEXT NOT NULL,        -- from / to / subject
  operator TEXT NOT NULL,     -- contains / starts_with / equals
  value TEXT NOT NULL,
  action TEXT NOT NULL,       -- move_to / mark_read / star / mark_junk
  folder_id INTEGER,
  priority INTEGER DEFAULT 0,
  enabled INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS blacklist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,            -- NULL = 全局（管理员）
  pattern TEXT NOT NULL,      -- 发件人地址/域名
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  subject TEXT DEFAULT '',
  html TEXT DEFAULT '',
  source TEXT DEFAULT 'manual',   -- manual / import / ai
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_configs (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  base_url TEXT DEFAULT '',       -- OpenAI 兼容地址，如 https://api.openai.com/v1
  model TEXT DEFAULT '',
  api_key_enc TEXT DEFAULT '',    -- AES-256-GCM 加密存储
  enabled INTEGER DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  actor TEXT DEFAULT '',
  action TEXT NOT NULL,
  detail TEXT DEFAULT '',
  ip TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS outbound_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER,
  sender TEXT NOT NULL,
  recipient TEXT NOT NULL,
  raw_eml TEXT NOT NULL,
  attempts INTEGER DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  last_error TEXT DEFAULT '',
  status TEXT DEFAULT 'queued'  -- queued / sent / failed
);
`;

db.exec(SCHEMA);

// ---- 助手 ----
export const q = {
  get: (sql, ...p) => db.prepare(sql).get(...p),
  all: (sql, ...p) => db.prepare(sql).all(...p),
  run: (sql, ...p) => db.prepare(sql).run(...p),
};

export function getSetting(key, def = '') {
  const row = q.get('SELECT value FROM settings WHERE key = ?', key);
  return row ? row.value : def;
}

export function setSetting(key, value) {
  q.run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, String(value));
}

export function audit(userId, actor, action, detail = '', ip = '') {
  q.run(
    'INSERT INTO audit_logs(user_id, actor, action, detail, ip, created_at) VALUES(?,?,?,?,?,?)',
    userId ?? null, actor || '', action, String(detail).slice(0, 2000), ip, Date.now()
  );
}

export function now() { return Date.now(); }
