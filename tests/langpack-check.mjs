// 语言包 key 覆盖率检查
import fs from 'node:fs';

const en = JSON.parse(fs.readFileSync('public/locales/en.json', 'utf8'));
const enKeys = Object.keys(en).filter(k => !k.startsWith('__'));
const zh = JSON.parse(fs.readFileSync('public/locales/zh.json', 'utf8'));
console.log('en keys:', enKeys.length);
const zhMissing = enKeys.filter(k => !(k in zh));
console.log('zh 缺失:', zhMissing.join(',') || '无');
for (const f of ['fr', 'es', 'pt', 'ru', 'ar', 'hi', 'bn', 'ur']) {
  const j = JSON.parse(fs.readFileSync(`langpacks/${f}.json`, 'utf8'));
  const missing = enKeys.filter(k => !(k in j));
  const extra = Object.keys(j).filter(k => !k.startsWith('__') && !(k in en));
  const pct = ((enKeys.length - missing.length) / enKeys.length * 100).toFixed(1);
  console.log(f.padEnd(4), `覆盖率 ${pct}%`, missing.length ? `缺失:${missing.slice(0, 6).join(',')}` : '', extra.length ? `多余:${extra.slice(0, 4).join(',')}` : '');
}
