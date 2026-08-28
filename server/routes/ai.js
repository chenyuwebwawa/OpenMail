// AI 助手 API：用户自配 OpenAI 兼容服务（base_url + model + api_key），服务端代理调用
//   GET/PUT /api/ai/config       读取/保存配置（密钥加密存储，返回时打码）
//   POST   /api/ai/test         连通性测试
//   POST   /api/ai/chat         通用对话（messages 数组透传）
//   POST   /api/ai/write        帮写邮件 → {subject, html}
//   POST   /api/ai/translate    翻译邮件文本
//   POST   /api/ai/analyze      分析邮件（摘要/要点/情感/建议）
//   POST   /api/ai/template     生成 HTML 邮件模板
import { Router } from 'express';
import crypto from 'node:crypto';
import { db, q, now } from '../db.js';
import { config } from '../config.js';
import { requireAuth, logAudit } from '../util/auth.js';

const router = Router();

// ---------- 密钥加密（AES-256-GCM，密钥取自 OM_SECRET） ----------
function encKey() {
  return crypto.createHash('sha256').update(`openmail-ai:${config.secret}`).digest();
}
function encrypt(plain) {
  if (!plain) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${enc.toString('base64')}`;
}
function decrypt(payload) {
  if (!payload) return '';
  try {
    const [iv, tag, data] = String(payload).split('.').map(s => Buffer.from(s, 'base64'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', encKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch { return ''; }
}
function maskKey(k) {
  if (!k) return '';
  return k.length <= 8 ? '****' : k.slice(0, 4) + '****' + k.slice(-4);
}

function getConfig(userId) {
  const row = q.get('SELECT * FROM ai_configs WHERE user_id = ?', userId);
  if (!row) return null;
  return {
    baseUrl: row.base_url, model: row.model, apiKey: decrypt(row.api_key_enc), enabled: !!row.enabled,
  };
}

router.get('/ai/config', requireAuth(), (req, res) => {
  const c = getConfig(req.user.id);
  res.json({
    config: c ? {
      baseUrl: c.baseUrl, model: c.model,
      apiKeyMasked: c.apiKey ? maskKey(c.apiKey) : '',
      hasKey: !!c.apiKey, enabled: c.enabled,
    } : { baseUrl: '', model: '', apiKeyMasked: '', hasKey: false, enabled: false },
  });
});

router.put('/ai/config', requireAuth(), (req, res) => {
  const b = req.body || {};
  const baseUrl = String(b.baseUrl || '').trim().replace(/\/+$/, '');
  const model = String(b.model || '').trim();
  const apiKey = String(b.apiKey || '');
  const enabled = b.enabled === undefined ? undefined : !!b.enabled;
  if (baseUrl && !/^https?:\/\//.test(baseUrl)) return res.status(400).json({ error: 'Base URL 必须以 http(s):// 开头' });
  const existing = q.get('SELECT * FROM ai_configs WHERE user_id = ?', req.user.id);
  // apiKey 传 null 表示清除；空字符串表示保留现有 Key
  const keyToStore = apiKey === null ? '' : (apiKey ? encrypt(apiKey) : (existing?.api_key_enc || ''));
  if (existing) {
    q.run('UPDATE ai_configs SET base_url = ?, model = ?, api_key_enc = ?, enabled = ?, updated_at = ? WHERE user_id = ?',
      baseUrl, model, keyToStore, enabled === undefined ? existing.enabled : (enabled ? 1 : 0), now(), req.user.id);
  } else {
    q.run('INSERT INTO ai_configs(user_id, base_url, model, api_key_enc, enabled, updated_at) VALUES(?,?,?,?,?,?)',
      req.user.id, baseUrl, model, keyToStore, enabled ? 1 : 0, now());
  }
  logAudit(req, 'ai.config', `更新 AI 配置 ${baseUrl || '(空)'} / ${model || '(空)'}`);
  const c = getConfig(req.user.id);
  res.json({ ok: true, config: { baseUrl: c.baseUrl, model: c.model, apiKeyMasked: maskKey(c.apiKey), hasKey: !!c.apiKey, enabled: c.enabled } });
});

// OpenAI 兼容 chat completions 调用
async function callOpenAI(userId, messages, opts = {}) {
  const c = getConfig(userId);
  if (!c || !c.baseUrl || !c.apiKey) {
    throw Object.assign(new Error('尚未配置 AI 服务：请到 设置 → AI 助手 填写接口地址、模型与 API Key'), { code: 'AI_NOT_CONFIGURED' });
  }
  const url = `${c.baseUrl}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs || 90000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${c.apiKey}`,
      },
      body: JSON.stringify({
        model: c.model || 'gpt-4o-mini',
        messages,
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.maxTokens ?? 2000,
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = text.slice(0, 300);
      try { msg = JSON.parse(text).error?.message || msg; } catch {}
      throw new Error(`AI 服务返回 ${res.status}: ${msg}`);
    }
    const data = JSON.parse(text);
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('AI 服务未返回内容');
    return content;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('AI 请求超时，请检查接口地址或稍后再试');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

router.post('/ai/test', requireAuth(), async (req, res) => {
  try {
    const reply = await callOpenAI(req.user.id, [
      { role: 'user', content: 'Reply with exactly: OK' },
    ], { maxTokens: 10, temperature: 0 });
    res.json({ ok: true, reply: reply.trim().slice(0, 50) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/ai/chat', requireAuth(), async (req, res) => {
  const { messages, system } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ error: '缺少对话内容' });
  try {
    const full = system ? [{ role: 'system', content: system }, ...messages] : messages;
    const reply = await callOpenAI(req.user.id, full);
    res.json({ reply });
  } catch (err) {
    res.status(err.code === 'AI_NOT_CONFIGURED' ? 400 : 502).json({ error: err.message });
  }
});

// ---------- 帮写邮件 ----------
router.post('/ai/write', requireAuth(), async (req, res) => {
  const { instruction, tone = 'professional', lang = 'zh' } = req.body || {};
  if (!instruction || !String(instruction).trim()) return res.status(400).json({ error: '请描述要写的邮件内容' });
  const langName = { zh: '中文', en: 'English', fr: 'French', es: 'Spanish', pt: 'Portuguese', ru: 'Russian', ar: 'Arabic', hi: 'Hindi', bn: 'Bengali', ur: 'Urdu' }[lang] || 'Chinese';
  const system = `You are an expert email writing assistant inside the OpenMail webmail. Write complete, ready-to-send emails based on the user's instruction. Respond ONLY with a JSON object (no markdown fences) in this exact shape: {"subject": "...", "body_html": "<p>...</p>"}. The body_html must be clean, well-structured HTML (paragraphs/lists, no full document, no <html> wrapper). Write the email in ${langName} with a ${tone} tone. If the instruction includes recipient context, personalize the greeting and closing appropriately.`;
  try {
    const reply = await callOpenAI(req.user.id, [
      { role: 'system', content: system },
      { role: 'user', content: String(instruction).slice(0, 4000) },
    ], { temperature: 0.8 });
    const parsed = parseJsonLoose(reply);
    if (!parsed || !parsed.body_html) {
      // 兜底：把整个回复当正文
      return res.json({ subject: '', body_html: `<p>${escapeHtmlMin(reply)}</p>`, raw: true });
    }
    res.json({ subject: parsed.subject || '', body_html: parsed.body_html });
  } catch (err) {
    res.status(err.code === 'AI_NOT_CONFIGURED' ? 400 : 502).json({ error: err.message });
  }
});

// ---------- 翻译邮件 ----------
router.post('/ai/translate', requireAuth(), async (req, res) => {
  const { text, targetLang = 'zh' } = req.body || {};
  if (!text || !String(text).trim()) return res.status(400).json({ error: '缺少要翻译的内容' });
  const langName = { zh: '简体中文', en: 'English', fr: 'French', es: 'Spanish', pt: 'Portuguese', ru: 'Russian', ar: 'Arabic', hi: 'Hindi', bn: 'Bengali', ur: 'Urdu', ja: 'Japanese', ko: 'Korean', de: 'German' }[targetLang] || 'Simplified Chinese';
  const system = `You are a professional email translator. Translate the user's email content into ${langName}. Preserve the original tone, greetings, formatting and placeholders. Respond ONLY with the translated text (keep simple HTML tags if present, otherwise plain text). No explanations.`;
  try {
    const reply = await callOpenAI(req.user.id, [
      { role: 'system', content: system },
      { role: 'user', content: String(text).slice(0, 12000) },
    ], { temperature: 0.3 });
    res.json({ translated: reply.trim() });
  } catch (err) {
    res.status(err.code === 'AI_NOT_CONFIGURED' ? 400 : 502).json({ error: err.message });
  }
});

// ---------- 分析邮件 ----------
router.post('/ai/analyze', requireAuth(), async (req, res) => {
  const { subject = '', text = '', lang = 'zh' } = req.body || {};
  if (!String(subject + text).trim()) return res.status(400).json({ error: '缺少邮件内容' });
  const langName = { zh: '简体中文', en: 'English' }[lang] || '简体中文';
  const system = `You are an email analysis assistant. Analyze the given email and respond ONLY with a JSON object (no markdown fences): {"summary": "2-3 sentence summary", "key_points": ["point1", "point2"], "sentiment": "positive|neutral|negative|urgent", "action_items": ["action1"], "suggested_reply_hint": "one-sentence suggestion of how to reply"}. Write all values in ${langName}.`;
  try {
    const reply = await callOpenAI(req.user.id, [
      { role: 'system', content: system },
      { role: 'user', content: `主题: ${subject}\n\n正文:\n${String(text).slice(0, 12000)}` },
    ], { temperature: 0.4 });
    const parsed = parseJsonLoose(reply);
    if (!parsed) return res.status(502).json({ error: 'AI 返回格式无法解析', raw: reply.slice(0, 500) });
    res.json(parsed);
  } catch (err) {
    res.status(err.code === 'AI_NOT_CONFIGURED' ? 400 : 502).json({ error: err.message });
  }
});

// ---------- AI 生成邮件模板 ----------
router.post('/ai/template', requireAuth(), async (req, res) => {
  const { description, kind = 'general' } = req.body || {};
  if (!description || !String(description).trim()) return res.status(400).json({ error: '请描述模板用途' });
  const system = `You are an email HTML template designer. Create a complete, beautiful, responsive HTML email template based on the user's description (kind: ${kind}). Requirements: inline CSS only, table-based or simple block layout, max-width 640px, web-safe fonts, pleasant modern color scheme, include a header banner area, content sections with realistic placeholder text (Chinese if the description is Chinese, otherwise English), and a footer. Respond ONLY with the raw HTML document (starting with <html> or <!DOCTYPE html>). No markdown fences, no explanations.`;
  try {
    const reply = await callOpenAI(req.user.id, [
      { role: 'system', content: system },
      { role: 'user', content: String(description).slice(0, 2000) },
    ], { temperature: 0.8, maxTokens: 3500 });
    const html = reply.replace(/^```html?\n?/i, '').replace(/```\s*$/i, '').trim();
    const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
    res.json({ html, name: (titleMatch ? titleMatch[1] : 'AI 模板').slice(0, 60) });
  } catch (err) {
    res.status(err.code === 'AI_NOT_CONFIGURED' ? 400 : 502).json({ error: err.message });
  }
});

function parseJsonLoose(s) {
  try { return JSON.parse(s); } catch {}
  const m = String(s).match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

function escapeHtmlMin(s) {
  return String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

export default router;
