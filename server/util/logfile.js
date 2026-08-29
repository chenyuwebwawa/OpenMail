// 日志文件：console 输出同步写入 logs/openmail-YYYYMMDD.log，按天切割，保留 14 天
// 在 index.js 中第一个 import，保证后续所有模块的日志都被捕获
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

const LOG_DIR = path.join(config.dataDir, 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });

const origLog = console.log.bind(console);
const origWarn = console.warn.bind(console);
const origErr = console.error.bind(console);

function stamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}
function logFile() {
  return path.join(LOG_DIR, `openmail-${new Date().toISOString().slice(0, 10)}.log`);
}
function fmt(a) {
  if (a instanceof Error) return a.stack || a.message;
  if (typeof a === 'string') return a;
  try { return JSON.stringify(a); } catch { return String(a); }
}
function write(level, args) {
  try {
    fs.appendFile(logFile(), `[${stamp()}] [${level}] ${args.map(fmt).join(' ')}\n`, () => {});
  } catch {}
}
function cleanup() {
  try {
    const cutoff = Date.now() - 14 * 86400000;
    for (const f of fs.readdirSync(LOG_DIR)) {
      const p = path.join(LOG_DIR, f);
      if (f.endsWith('.log') && fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
    }
  } catch {}
}

console.log = (...a) => { write('INFO', a); origLog(...a); };
console.warn = (...a) => { write('WARN', a); origWarn(...a); };
console.error = (...a) => { write('ERROR', a); origErr(...a); };

cleanup();
setInterval(cleanup, 6 * 3600 * 1000).unref();
