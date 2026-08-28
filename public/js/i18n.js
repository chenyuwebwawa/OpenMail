// i18n 框架：语言加载 / t() 翻译 / RTL / 语言包（内置 zh、en，其余为可安装语言包）
const RTL_LOCALES = new Set(['ar', 'ur', 'fa', 'he']);
const cache = {};        // code -> dict

function detectInitialLocale() {
  const saved = localStorage.getItem('om_locale');
  if (saved) return saved; // 已保存的选择优先（含语言包语言）
  const nav = (navigator.language || 'en').toLowerCase();
  return nav.startsWith('zh') ? 'zh' : 'en'; // 无保存时按浏览器语言，仅回退内置语言
}
let current = detectInitialLocale();

export function getLocale() { return current; }
export function isRTL(code = current) { return RTL_LOCALES.has(code); }

export async function loadLocale(code) {
  if (cache[code]) return cache[code];
  const res = await fetch(`/locales/${encodeURIComponent(code)}.json`);
  if (!res.ok) throw new Error(`语言包 ${code} 不存在`);
  const dict = await res.json();
  cache[code] = dict;
  return dict;
}

export async function setLocale(code) {
  await loadLocale(code);
  current = code;
  localStorage.setItem('om_locale', code);
  applyDirection();
}

export function applyDirection() {
  document.documentElement.lang = current;
  document.documentElement.dir = isRTL() ? 'rtl' : 'ltr';
}

export function t(key, params) {
  let s = (cache[current] && cache[current][key]) ?? cache.en?.[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}

// 初始化：应用启动时调用
export async function init() {
  try { await loadLocale('en'); } catch {}
  try { await loadLocale(current); } catch { current = 'en'; }
  applyDirection();
}

// 已安装语言列表（含元信息）
export async function installedLocales() {
  const res = await fetch('/api/langs');
  if (!res.ok) return [{ code: 'en', name: 'English', builtin: true, rtl: false }, { code: 'zh', name: '中文', builtin: true, rtl: false }];
  return res.json(); // [{code,name,builtin,rtl,installed}]
}
