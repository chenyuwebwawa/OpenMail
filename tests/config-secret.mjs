// 验证「未设置 OM_SECRET 时安全密钥持久化」：两次独立进程启动必须得到同一个密钥，
// 且已写入 <dataDir>/secret.key；显式 OM_SECRET 仍然最优先。
// 运行: npm run test:secret（不需要启动服务，完全离线）
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openmail-secret-'));
const filesDir = tmp + '-files';
const secretFile = path.join(tmp, 'secret.key');
const bootScript = "import('./server/config.js').then(m => process.stdout.write(m.config.secret))";

let passed = 0, failed = 0;
const failures = [];
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name} ${extra}`); }
}

function bootSecret(extraEnv = {}) {
  const env = { ...process.env, OM_DATA_DIR: tmp, OM_FILES_DIR: filesDir, ...extraEnv };
  delete env.OM_SECRET; // 模拟未配置 .env / 手动 npm start 的场景
  for (const [k, v] of Object.entries(extraEnv)) env[k] = v;
  return execFileSync(process.execPath, ['-e', bootScript], { cwd: repoRoot, env, encoding: 'utf8' }).trim();
}

console.log('\n== 安全密钥持久化（未设置 OM_SECRET） ==');
try {
  const first = bootSecret();
  const second = bootSecret();
  ok('首次启动生成非空密钥（≥32 字符）', typeof first === 'string' && first.length >= 32 && /^[0-9a-f]+$/.test(first), `len=${first?.length}`);
  ok('重启后复用同一密钥（此前随机密钥的 bug 已修复）', first === second && second.length > 0);
  ok('密钥文件已持久化到 <dataDir>/secret.key', fs.existsSync(secretFile));
  const saved = fs.existsSync(secretFile) ? fs.readFileSync(secretFile, 'utf8').trim() : '';
  ok('secret.key 内容与导出密钥一致', saved === first);
  ok('密钥文件内容不含 BOM/异常字符', !saved.startsWith('\uFEFF') && saved.length >= 32);
  const withEnv = bootSecret({ OM_SECRET: 'env-secret-for-test-1234567890' });
  ok('显式 OM_SECRET 优先级最高（覆盖密钥文件）', withEnv === 'env-secret-for-test-1234567890', withEnv.slice(0, 12) + '…');
} catch (err) {
  failed++;
  failures.push('测试执行异常: ' + (err && err.message ? err.message : String(err)));
  console.error('  ✗ 测试执行异常:', err);
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 忽略清理失败 */ }
  try { fs.rmSync(filesDir, { recursive: true, force: true }); } catch { /* 忽略清理失败 */ }
}

console.log('\n' + '='.repeat(50));
console.log(`结果: ${passed} 通过, ${failed} 失败`);
if (failures.length) {
  console.log('失败项:');
  failures.forEach(f => console.log('  - ' + f));
  process.exitCode = 1;
}
