// 命令行维护工具：
//   node server/setup.js reset-admin <email> <newPassword>  重置管理员密码
//   node server/setup.js create-admin <email> [password]    创建管理员
//   node server/setup.js add-domain <domain>                添加域名并生成 DKIM
//   node server/setup.js list-users                         列出用户
import { q, now } from './db.js';
import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { generateDkimKeys, randomToken } from './util/crypto.js';
import { ensureSystemFolders } from './mail/mailstore.js';

const [, , cmd, ...args] = process.argv;

function fail(msg) { console.error('✗', msg); process.exit(1); }

switch (cmd) {
  case 'reset-admin': {
    const [email, password] = args;
    if (!email || !password) fail('用法: node server/setup.js reset-admin <email> <newPassword>');
    const u = q.get('SELECT * FROM users WHERE address = ?', email.toLowerCase());
    if (!u) fail(`用户 ${email} 不存在`);
    q.run('UPDATE users SET password_hash = ?, role = ? WHERE id = ?',
      bcrypt.hashSync(password, config.bcryptRounds), 'admin', u.id);
    console.log(`✓ 已将 ${email} 重置为管理员，密码已更新`);
    break;
  }
  case 'create-admin': {
    const [email, password] = args;
    if (!email || !email.includes('@')) fail('用法: node server/setup.js create-admin <email> [password]');
    const addr = email.toLowerCase();
    const domain = addr.split('@')[1];
    if (!q.get('SELECT id FROM domains WHERE name = ?', domain)) fail(`域名 ${domain} 未托管，请先 add-domain`);
    if (q.get('SELECT id FROM users WHERE address = ?', addr)) fail('邮箱已存在');
    const pw = password || randomToken(9);
    q.run("INSERT INTO users(address, display_name, password_hash, role, created_at) VALUES(?,?,?,?,?)",
      addr, 'Administrator', bcrypt.hashSync(pw, config.bcryptRounds), 'admin', now());
    const u = q.get('SELECT * FROM users WHERE address = ?', addr);
    ensureSystemFolders(u.id);
    console.log(`✓ 管理员已创建: ${addr} / ${pw}`);
    break;
  }
  case 'add-domain': {
    const [domain] = args;
    if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) fail('用法: node server/setup.js add-domain <domain>');
    if (q.get('SELECT id FROM domains WHERE name = ?', domain)) fail('域名已存在');
    const keys = generateDkimKeys();
    q.run('INSERT INTO domains(name, dkim_selector, dkim_private_key, dkim_public_key, created_at) VALUES(?,?,?,?,?)',
      domain.toLowerCase(), config.dkimSelector, keys.privateKey, keys.publicKey, now());
    console.log(`✓ 域名 ${domain} 已添加，DKIM 选择器: ${config.dkimSelector}`);
    console.log('  请在 DNS 添加记录（管理后台 → 域名管理 → DNS 配置 可查看）');
    break;
  }
  case 'list-users': {
    const users = q.all('SELECT id, address, role, status, created_at FROM users ORDER BY id');
    console.table(users);
    break;
  }
  default:
    console.log(`OpenMail 维护工具

用法:
  node server/setup.js reset-admin <email> <newPassword>   重置用户密码并提权为管理员
  node server/setup.js create-admin <email> [password]      创建管理员账号
  node server/setup.js add-domain <domain>                  添加邮件域名（自动生成 DKIM）
  node server/setup.js list-users                           列出所有用户`);
}
