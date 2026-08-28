// 端口一致性交叉验证：教程文档 vs 配置代码 vs .env.example
import fs from 'node:fs';

// 1. 从 config.js 提取真实默认端口（程序的唯一事实来源）
const cfg = fs.readFileSync('server/config.js', 'utf8');
const getCode = (name) => (cfg.match(new RegExp(`${name}[^\\d]*(\\d+)`)) || [])[1];

const actual = {
  'SMTP MX':        getCode('OM_SMTP_PORT'),
  'Submission':     getCode('OM_SUBMISSION_PORT'),
  'SMTPS':          getCode('OM_SMTPS_PORT'),
  'IMAP':           getCode('OM_IMAP_PORT'),
  'IMAPS':          getCode('OM_IMAPS_PORT'),
  'POP3':           getCode('OM_POP3_PORT'),
  'POP3S':          getCode('OM_POP3S_PORT'),
  'HTTP':           getCode('OM_HTTP_PORT'),
};
const prod = { 'SMTP MX': 25, Submission: 587, SMTPS: 465, IMAP: 143, IMAPS: 993, POP3: 110, POP3S: 995, HTTP: 3000 };

// 2. 教程文档中出现的高位端口断言
const docs = {
  'README.md': fs.readFileSync('README.md', 'utf8'),
  'docs/panels/BAOTA.md': fs.readFileSync('docs/panels/BAOTA.md', 'utf8'),
  'docs/panels/BAOTA-COEXIST.md': fs.readFileSync('docs/panels/BAOTA-COEXIST.md', 'utf8'),
  '.env.example': fs.readFileSync('.env.example', 'utf8'),
};

// 共存教程的端口分配表核心断言
const coexist = docs['docs/panels/BAOTA-COEXIST.md'];
const coexistPairs = [
  ['SMTP 收信 OpenMail', '2525'], ['Submission OpenMail', '2587'], ['SMTPS OpenMail', '2546'],
  ['IMAP OpenMail', '1143'], ['IMAPS OpenMail', '1993'], ['POP3 OpenMail', '1110'], ['POP3S OpenMail', '1995'],
  ['宝塔邮局 SMTP', '25'], ['宝塔邮局 Submission', '587'], ['宝塔邮局 IMAPS', '993'],
];
console.log('== config.js 默认端口 ==');
for (const [k, v] of Object.entries(actual)) console.log(`  ${k.padEnd(12)} dev=${v}  prod=${prod[k]}`);

console.log('\n== 共存教程端口表 vs 代码 ==');
let bad = 0;
for (const [name, port] of coexistPairs) {
  const key = name.replace(' OpenMail', '').replace('宝塔邮局 ', '');
  const expect = name.includes('宝塔邮局') ? { SMTP: '25', Submission: '587', IMAPS: '993' }[key] : actual[key === 'SMTP' ? 'SMTP MX' : key];
  const ok = coexist.includes(port) && (expect === undefined || port === expect);
  if (!ok) bad++;
  console.log(`  ${ok ? '✓' : '✗'} ${name.padEnd(22)} 文档=${port} 代码=${expect ?? '?'}`);
}

// 3. BAOTA.md 客户端参数表（标准端口）抽查
const baota = docs['docs/panels/BAOTA.md'];
console.log('\n== BAOTA.md 客户端标准端口 ==');
for (const [label, port] of [['IMAP', '993'], ['POP3', '995'], ['Submission', '587'], ['SMTPS', '465']]) {
  const ok = baota.includes(port);
  if (!ok) bad++;
  console.log(`  ${ok ? '✓' : '✗'} ${label} ${port}`);
}

// 4. .env.example 变量名核对
const envNames = ['OM_SMTP_PORT', 'OM_SUBMISSION_PORT', 'OM_SMTPS_PORT', 'OM_IMAP_PORT', 'OM_IMAPS_PORT', 'OM_POP3_PORT', 'OM_POP3S_PORT'];
console.log('\n== .env.example 变量名 ==');
for (const n of envNames) {
  const ok = docs['.env.example'].includes(n);
  if (!ok) bad++;
  console.log(`  ${ok ? '✓' : '✗'} ${n}`);
}

console.log(`\n结论: ${bad === 0 ? '全部一致 ✓' : bad + ' 处不一致 ✗'}`);
process.exit(bad ? 1 : 0);
