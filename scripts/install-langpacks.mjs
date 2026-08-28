#!/usr/bin/env node
// OpenMail 语言包安装器
//   node scripts/install-langpacks.mjs --all           安装全部
//   node scripts/install-langpacks.mjs fr ar ur        安装指定语言
//   node scripts/install-langpacks.mjs --status        查看状态
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKS_DIR = path.join(ROOT, 'langpacks');
const LOCALES_DIR = path.join(ROOT, 'public', 'locales');
fs.mkdirSync(LOCALES_DIR, { recursive: true });

const manifest = JSON.parse(fs.readFileSync(path.join(PACKS_DIR, 'manifest.json'), 'utf8'));
const BUILTIN = [
  { code: 'en', name: 'English', file: null },
  { code: 'zh', name: '中文（简体）', file: null },
];

const installed = (code) => fs.existsSync(path.join(LOCALES_DIR, `${code}.json`));

function status() {
  console.log('\nOpenMail 语言包状态:\n');
  for (const b of BUILTIN) {
    console.log(`  ✓ ${b.code.padEnd(4)} ${b.name}  (内置)`);
  }
  for (const p of manifest.packs) {
    console.log(`  ${installed(p.code) ? '✓' : '·'} ${p.code.padEnd(4)} ${p.name}  ${installed(p.code) ? '(已安装)' : '(未安装 — langpacks/' + p.file + ')'}`);
  }
  console.log('');
}

const args = process.argv.slice(2);
if (args.includes('--status') || args.length === 0) {
  status();
  if (args.length === 0) console.log('用法: node scripts/install-langpacks.mjs --all | <code...> | --status');
  process.exit(0);
}

const toInstall = args.includes('--all')
  ? manifest.packs.map(p => p.code)
  : args.map(a => a.toLowerCase().replace(/^--/, ''));

let ok = 0, fail = 0;
for (const code of toInstall) {
  const pack = manifest.packs.find(p => p.code === code);
  if (!pack) { console.error(`✗ 未知语言包: ${code}（可用: ${manifest.packs.map(p => p.code).join(', ')}）`); fail++; continue; }
  const src = path.join(PACKS_DIR, pack.file);
  if (!fs.existsSync(src)) { console.error(`✗ 缺少文件: langpacks/${pack.file}`); fail++; continue; }
  fs.copyFileSync(src, path.join(LOCALES_DIR, `${code}.json`));
  console.log(`✓ 已安装: ${pack.name} (${code}) → public/locales/${code}.json`);
  ok++;
}
console.log(`\n完成: ${ok} 安装, ${fail} 失败。刷新浏览器即可在「设置 → 语言」中切换，无需重启服务。\n`);
