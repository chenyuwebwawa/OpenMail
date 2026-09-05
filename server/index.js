// OpenMail 入口：HTTP API + Webmail 静态资源 + SMTP/IMAP/POP3 + 调度器
import './util/logfile.js';   // 必须最先导入：捕获全部日志到文件
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import { config, ensureDirs } from './config.js';
import { q, now, getSetting, setSetting, audit } from './db.js';
import { randomToken, sha256 } from './util/crypto.js';
import { getTLSContext } from './util/tlsutil.js';

import authRoutes from './routes/auth.js';
import mailRoutes from './routes/mail.js';
import contactRoutes from './routes/contacts.js';
import settingRoutes from './routes/settings.js';
import adminRoutes from './routes/admin.js';
import langRoutes from './routes/langs.js';
import templateRoutes from './routes/templates.js';
import aiRoutes from './routes/ai.js';
import { startSMTPServers } from './smtp.js';
import { startImapServer } from './imap.js';
import { startPop3Server } from './pop3.js';
import { startScheduler } from './mail/scheduler.js';
import { ensureSystemFolders } from './mail/mailstore.js';
import bcrypt from 'bcryptjs';

ensureDirs();

// ---------- 首次初始化：主域名 + 管理员 ----------
function firstRunInit() {
  const domain = config.primaryDomain.toLowerCase();
  if (!q.get('SELECT id FROM domains WHERE name = ?', domain)) {
    // 生成 DKIM
    import('./util/crypto.js').then(({ generateDkimKeys }) => {
      const keys = generateDkimKeys();
      q.run('INSERT INTO domains(name, dkim_selector, dkim_private_key, dkim_public_key, is_primary, created_at) VALUES(?,?,?,?,1,?)',
        domain, config.dkimSelector, keys.privateKey, keys.publicKey, now());
      console.log(`[init] 已创建主域名 ${domain} 并生成 DKIM 密钥`);
    });
  }
  const admin = q.get("SELECT * FROM users WHERE role = 'admin'");
  if (!admin) {
    let adminAddr = config.adminEmail.toLowerCase();
    if (!adminAddr.includes('@')) adminAddr = `${adminAddr}@${domain}`;
    const password = randomToken(9);
    q.run(
      "INSERT INTO users(address, display_name, password_hash, role, quota_bytes, created_at) VALUES(?,?,?,?,?,?)",
      adminAddr, 'Administrator', bcrypt.hashSync(password, config.bcryptRounds), 'admin',
      config.maxMailboxSize * 1024 * 1024, now()
    );
    const u = q.get('SELECT * FROM users WHERE address = ?', adminAddr);
    ensureSystemFolders(u.id);
    const credPath = path.join(config.dataDir, 'admin-credentials.txt');
    fs.writeFileSync(credPath,
      `OpenMail 管理员账号（首次启动自动生成，请妥善保管并尽快修改密码）\n地址: ${adminAddr}\n密码: ${password}\n`);
    console.log('='.repeat(60));
    console.log(`[init] 已创建管理员: ${adminAddr} / ${password}`);
    console.log(`[init] 凭据已保存至: ${credPath}`);
    console.log('='.repeat(60));
  }
}
firstRunInit();

// ---------- Express ----------
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '320mb' }));

// 安全响应头（CSP 允许站内资源与 data: 图片）
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

app.use('/api/auth', authRoutes);
app.use('/api', mailRoutes);
app.use('/api', contactRoutes);
app.use('/api', settingRoutes);
app.use('/api', adminRoutes);
app.use('/api', langRoutes);
app.use('/api', templateRoutes);
app.use('/api', aiRoutes);

// 静态资源 + 双前端路由：/ 为邮箱客户端（直达），/home 为产品官网
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '..', 'public');
app.use(express.static(publicDir, { index: false }));
app.get('/', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));
app.get(['/home', '/home/'], (req, res) => res.sendFile(path.join(publicDir, 'site', 'index.html')));
app.get(/^\/app($|\/)/, (req, res) => res.sendFile(path.join(publicDir, 'index.html')));
app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(publicDir, 'index.html')));

// 错误处理
app.use((err, req, res, next) => {
  console.error('[http] 错误:', err.message);
  if (res.headersSent) return next(err);
  res.status(err.type === 'entity.too.large' ? 413 : 500).json({ error: err.type === 'entity.too.large' ? '请求体过大' : '服务器内部错误' });
});

// ---------- 启动 ----------
const httpServer = http.createServer(app);
httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[http] 端口 ${config.httpPort} 已被其他进程占用！`);
    console.error(`  排查: ss -ltnp | grep :${config.httpPort}`);
    console.error(`  解决: 停掉占用进程，或在 .env 中设置 OM_HTTP_PORT 换一个端口后重启本服务`);
    process.exit(1);
  }
  throw err;
});
httpServer.listen(config.httpPort, () => {
  console.log(`[http] Webmail/管理后台: http://localhost:${config.httpPort}`);
});

if (config.httpsPort > 0) {
  const ctx = config.tlsCert && config.tlsKey
    ? { cert: fs.readFileSync(config.tlsCert), key: fs.readFileSync(config.tlsKey) }
    : getTLSContext();
  if (ctx) {
    https.createServer({ key: ctx.key, cert: ctx.cert }, app).listen(config.httpsPort, () => {
      console.log(`[https] HTTPS 已启用: https://localhost:${config.httpsPort}`);
    });
  }
}

startSMTPServers();
startImapServer();
startPop3Server();
startScheduler();

process.on('uncaughtException', (err) => console.error('[uncaught]', err));
process.on('unhandledRejection', (err) => console.error('[unhandled]', err));
