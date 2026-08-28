// 语言与语言包 API：
//   GET  /api/langs                    已安装 + 可安装语言列表（公开）
//   POST /api/admin/langs/install      从 langpacks/ 安装 {code}（管理员）
//   POST /api/admin/langs/remove       移除非内置语言 {code}（管理员）
import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config.js';
import { requireAuth, logAudit } from '../util/auth.js';

const router = Router();
const LOCALES_DIR = path.join(ROOT, 'public', 'locales');
const PACKS_DIR = path.join(ROOT, 'langpacks');
const BUILTIN = new Set(['en', 'zh']);

function readMeta(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { name: j.__name || path.basename(file, '.json'), dir: j.__dir || 'ltr' };
  } catch { return null; }
}

function listLangs() {
  const installed = [];
  for (const f of fs.readdirSync(LOCALES_DIR).filter(f => f.endsWith('.json'))) {
    const code = path.basename(f, '.json');
    const meta = readMeta(path.join(LOCALES_DIR, f));
    if (meta) installed.push({ code, name: meta.name, rtl: meta.dir === 'rtl', builtin: BUILTIN.has(code), installed: true });
  }
  const available = [];
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(PACKS_DIR, 'manifest.json'), 'utf8'));
    for (const p of manifest.packs) {
      if (installed.some(l => l.code === p.code)) continue;
      const src = path.join(PACKS_DIR, p.file);
      if (fs.existsSync(src)) {
        available.push({ code: p.code, name: p.name || readMeta(src)?.name, rtl: !!p.rtl, builtin: false, installed: false });
      }
    }
  } catch {}
  return [...installed, ...available];
}

router.get('/langs', (req, res) => {
  res.json(listLangs());
});

const guard = (req, res, next) => requireAuth('admin')(req, res, next);

router.post('/admin/langs/install', guard, (req, res) => {
  const code = String(req.body?.code || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const manifest = JSON.parse(fs.readFileSync(path.join(PACKS_DIR, 'manifest.json'), 'utf8'));
  const pack = manifest.packs.find(p => p.code === code);
  if (!pack) return res.status(404).json({ error: `语言包 ${code} 不存在` });
  const src = path.join(PACKS_DIR, pack.file);
  if (!fs.existsSync(src)) return res.status(404).json({ error: `语言包文件 langpacks/${pack.file} 缺失（部署时未包含 langpacks 目录，可用命令行脚本安装）` });
  fs.copyFileSync(src, path.join(LOCALES_DIR, `${code}.json`));
  logAudit(req, 'admin.lang_install', `安装语言包 ${code}`);
  res.json({ ok: true, code, name: pack.name });
});

router.post('/admin/langs/remove', guard, (req, res) => {
  const code = String(req.body?.code || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (BUILTIN.has(code)) return res.status(400).json({ error: '内置语言不可移除' });
  const target = path.join(LOCALES_DIR, `${code}.json`);
  if (!fs.existsSync(target)) return res.status(404).json({ error: '未安装该语言' });
  fs.unlinkSync(target);
  logAudit(req, 'admin.lang_remove', `移除语言包 ${code}`);
  res.json({ ok: true });
});

export default router;
