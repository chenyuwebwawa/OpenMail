// AI 助手 API：用户自配 OpenAI 兼容服务（base_url + model + api_key），服务端代理调用
//   GET/PUT /api/ai/config       读取/保存配置（密钥加密存储，返回时打码）
//   GET     /api/ai/models       从上游拉取可用模型列表（诊断用，未启用时也可用）
//   POST    /api/ai/test         连通性测试（未启用时也可用，便于排查配置）
//   POST    /api/ai/chat         通用对话（messages 数组透传）
//   POST    /api/ai/write        帮写邮件 → {subject, body_html}
//   POST    /api/ai/translate    翻译邮件文本
//   POST    /api/ai/analyze      分析邮件（摘要/要点/情感/建议）
//   POST    /api/ai/template     生成 HTML 邮件模板
//
// 兼容性说明：上游按 OpenAI Chat Completions 协议调用（POST {base}/chat/completions）。
// 用户既可以填服务根地址 / …/v1，也可以直接粘贴提供商文档里完整的 …/chat/completions 地址
// （保存时自动规范化）；对推理/思考类模型会自适应处理 max_tokens / max_completion_tokens、
// temperature、response_format 等参数差异，并兼容 content 数组、reasoning_content、SSE 流式响应。
import { Router } from 'express';
import crypto from 'node:crypto';
import { q, now } from '../db.js';
import { config } from '../config.js';
import { requireAuth, logAudit } from '../util/auth.js';

const router = Router();

// ---------- 密钥加密（AES-256-GCM，密钥取自 OM_SECRET / 持久化 secret.key） ----------
// 旧版本在未配置 OM_SECRET 时每次启动随机生成密钥，导致保存的 Key 重启后无法解密；
// 同时列出历史模板里的默认值，尝试解密并透明迁移旧数据。
const LEGACY_SECRETS = [
  'change-me-to-a-long-random-string',   // 旧 docker-compose 默认值
  'please-change-me-to-a-random-string', // 旧 .env.example 默认值
];
const RETRY_DELAY_MS = 800;
const MAX_REQUESTS = 3; // 首次请求 + 最多 2 次自适应重试
const DEFAULT_TIMEOUT_MS = 120000; // 生成类请求
const TEST_TIMEOUT_MS = 30000;     // 连通性测试
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function encKey(secret = config.secret) {
  return crypto.createHash('sha256').update(`openmail-ai:${secret}`).digest();
}
function encrypt(plain, secret = config.secret) {
  if (!plain) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey(secret), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${enc.toString('base64')}`;
}
function decryptWith(payload, secret) {
  try {
    const [iv, tag, data] = String(payload).split('.').map(s => Buffer.from(s, 'base64'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', encKey(secret), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch { return null; }
}
function maskKey(k) {
  if (!k) return '';
  return k.length <= 8 ? '****' : k.slice(0, 4) + '****' + k.slice(-4);
}
function aiErr(message, code) {
  const err = new Error(message);
  if (code) err.code = code;
  return err;
}
function clip(s, n) {
  s = String(s ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}
const snippet = (text) => clip(text, 300);

// ---------- 接口地址规范化 ----------
// 接受：服务根地址 / …/v1 / 完整的 …/chat/completions / …/models，统一成「再拼 /chat/completions」的 base。
function normalizeBaseUrl(raw) {
  let s = String(raw ?? '').trim();
  if (!s) return '';
  // 去掉查询串 / 锚点 / 末尾斜杠
  s = s.replace(/[?#].*$/, '').replace(/\/+$/, '');
  // 用户可能直接粘贴提供商文档里的完整端点，去掉已知后缀（大小写不敏感）
  s = s.replace(/\/chat\/completions$/i, '').replace(/\/models$/i, '').replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(s)) return s;
  let u;
  try { u = new URL(s); } catch { return s; }
  const host = u.hostname.toLowerCase();
  const pathname = u.pathname.replace(/\/+$/, '');
  const origin = `${u.protocol}//${u.host}`;
  if (!pathname || pathname === '/') {
    // 只填了域名时，按已知提供商补默认路径（未知地址保持原样，由程序直接拼 /chat/completions）
    if (host === 'api.openai.com' || host === 'api.moonshot.cn') return `${origin}/v1`;
    if (host.includes('api.deepseek.com')) return origin; // DeepSeek 官方接受根地址（文档示例即 https://api.deepseek.com/chat/completions）
    if (u.port === '11434') return `${origin}/v1`;       // Ollama 默认端口
    if (host === 'open.bigmodel.cn') return `${origin}/api/paas/v4`;
    return s;
  }
  return `${origin}${pathname}`;
}
function resolveEndpoint(endpointPath) {
  const base = normalizeBaseUrl(endpointPath);
  return base ? `${base}/chat/completions` : '';
}
function endpointLabel(url) {
  try { const u = new URL(url); return `${u.host}${u.pathname}`; } catch { return String(url || ''); }
}

// ---------- 配置读取（含旧密钥透明迁移） ----------
function getConfig(userId) {
  const row = q.get('SELECT * FROM ai_configs WHERE user_id = ?', userId);
  if (!row) return null;
  let apiKey = '';
  if (row.api_key_enc) {
    apiKey = decryptWith(row.api_key_enc, config.secret) ?? '';
    if (!apiKey) {
      // 兼容旧版本默认 OM_SECRET：解密成功后立即用当前密钥重新加密并落库
      for (const legacy of LEGACY_SECRETS) {
        const got = decryptWith(row.api_key_enc, legacy);
        if (got !== null && got !== '') {
          apiKey = got;
          try {
            q.run('UPDATE ai_configs SET api_key_enc = ?, updated_at = ? WHERE user_id = ?', encrypt(got), now(), userId);
            console.log(`[ai] 已使用兼容密钥迁移用户 #${userId} 的 AI API Key 加密数据`);
          } catch (e) {
            console.warn('[ai] 迁移 AI API Key 加密数据失败:', e.message);
          }
          break;
        }
      }
    }
  }
  return { baseUrl: row.base_url || '', model: row.model || '', apiKey, enabled: !!row.enabled };
}
function missingFields(c) {
  const missing = [];
  if (!c || !c.baseUrl) missing.push('接口地址');
  if (!c || !c.model) missing.push('模型');
  if (!c || !c.apiKey) missing.push('API Key');
  return missing;
}
// 校验配置完整性；allowDisabled=true 用于 /ai/test、/ai/models 这类诊断接口
function ensureReady(userId, { allowDisabled = false } = {}) {
  const c = getConfig(userId);
  const missing = missingFields(c);
  if (missing.length) {
    throw aiErr(`AI 配置不完整，缺少：${missing.join('、')}。请到 设置 → AI 助手 填写接口地址、模型与 API Key 后保存`, 'AI_NOT_CONFIGURED');
  }
  if (!allowDisabled && !c.enabled) {
    throw aiErr('AI 功能已关闭（未启用）。请到 设置 → AI 助手 → 启用 AI 功能，打开开关并保存后再使用', 'AI_DISABLED');
  }
  return c;
}
function configResponse(c) {
  const baseUrl = c ? normalizeBaseUrl(c.baseUrl) : '';
  return {
    baseUrl,
    model: c?.model || '',
    apiKeyMasked: c?.apiKey ? maskKey(c.apiKey) : '',
    hasKey: !!c?.apiKey,
    enabled: !!c?.enabled,
    endpoint: baseUrl ? `${baseUrl}/chat/completions` : '',
  };
}
// 统一错误响应：配置类错误 400 / 未启用 403 / 上游与解析类错误 502
function fail(res, err) {
  const code = err.code || 'AI_UPSTREAM_ERROR';
  const status = code === 'AI_NOT_CONFIGURED' ? 400 : code === 'AI_DISABLED' ? 403 : 502;
  return res.status(status).json({ error: err.message || 'AI 调用失败', code });
}

// ---------- 上游错误抽取 ----------
function extractUpstreamError(text) {
  if (!text) return '';
  const s = String(text).trim();
  try {
    const j = JSON.parse(s);
    if (j && typeof j === 'object') {
      const e = j.error;
      if (typeof e === 'string' && e) return clip(e, 500);
      if (e && typeof e === 'object') return clip(e.message || e.msg || e.detail || JSON.stringify(e), 500);
      if (typeof j.message === 'string' && j.message) return clip(j.message, 500);
      if (typeof j.detail === 'string' && j.detail) return clip(j.detail, 500);
    }
  } catch { /* 非 JSON（HTML/纯文本错误页），按原文返回 */ }
  return clip(s, 500);
}
function buildHttpError(endpoint, status, providerMessage) {
  const where = endpointLabel(endpoint);
  const detail = providerMessage ? `：${clip(providerMessage, 500)}` : '';
  let hint;
  if (status === 401 || status === 403) hint = 'API Key 无效或无权限，请检查 Key 是否填写正确、账户是否已开通该模型/接口';
  else if (status === 404) hint = '接口地址不正确（应指向 …/v1 或服务根地址，程序会自动补 /chat/completions），请核对后重新保存';
  else if (status === 429) hint = '请求过于频繁或额度不足（上游限流），请稍后重试或检查账户余额';
  else if (status >= 500) hint = '上游 AI 服务异常，请稍后重试';
  else hint = '请求被上游服务拒绝';
  const err = aiErr(`AI 调用失败（HTTP ${status}，${where}）—— ${hint}${detail}`, 'AI_UPSTREAM_ERROR');
  err.status = status;
  err.upstream = providerMessage || '';
  return err;
}

// ---------- 响应解析 ----------
function contentToText(content) {
  if (content === null || content === undefined) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(part => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object') {
        if (typeof part.text === 'string') return part.text;
        if (part.type === 'text' && part.text !== undefined) return String(part.text);
      }
      return '';
    }).join('');
  }
  if (typeof content === 'object' && typeof content.text === 'string') return content.text;
  return String(content);
}
function reasoningOnlyError(finishReason) {
  const fr = finishReason ? `（finish_reason=${finishReason}）` : '';
  return aiErr(`模型只返回了推理内容（reasoning_content）${fr}，没有返回最终回答。可能原因：max_tokens 太小（推理过程占满了额度）或该模型需要关闭思考模式；请调大 max_tokens 或换用非推理模型（如 deepseek-chat / gpt-4o-mini）。`, 'AI_ONLY_REASONING');
}
function parseSSEReply(text, endpoint) {
  const contentParts = [];
  const reasoningParts = [];
  let finishReason = '';
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    let chunk;
    try { chunk = JSON.parse(payload); } catch { continue; }
    if (chunk && chunk.error) {
      throw aiErr(`AI 服务返回错误（${endpointLabel(endpoint)}）：${extractUpstreamError(payload) || '未知错误'}`, 'AI_UPSTREAM_ERROR');
    }
    const choice = chunk?.choices?.[0];
    if (!choice) continue;
    if (choice.finish_reason) finishReason = choice.finish_reason;
    const delta = choice.delta || choice.message || {};
    const c = contentToText(delta.content);
    if (c) contentParts.push(c);
    const r = contentToText(delta.reasoning_content) || contentToText(delta.reasoning);
    if (r) reasoningParts.push(r);
  }
  const content = contentParts.join('');
  if (content.trim()) return content;
  if (reasoningParts.join('').trim()) throw reasoningOnlyError(finishReason);
  throw aiErr(`AI 服务以流式（SSE）返回但未解析到任何内容（${endpointLabel(endpoint)}）：${snippet(text)}`, 'AI_BAD_RESPONSE');
}
function parseCompletion(resp, endpoint) {
  const text = resp.text || '';
  const ctype = String(resp.contentType || '').toLowerCase();
  if (ctype.includes('text/event-stream') || (!ctype.includes('json') && /^\s*(?:data|event):/.test(text))) {
    return parseSSEReply(text, endpoint);
  }
  let data;
  try { data = JSON.parse(text); }
  catch {
    throw aiErr(`AI 服务返回了无法解析的内容（${endpointLabel(endpoint)}，HTTP ${resp.status}）：${snippet(text)}`, 'AI_BAD_RESPONSE');
  }
  if (data && typeof data === 'object' && data.error) {
    throw aiErr(`AI 服务返回错误（${endpointLabel(endpoint)}）：${extractUpstreamError(text) || '未知错误'}`, 'AI_UPSTREAM_ERROR');
  }
  const choices = data?.choices;
  if (!Array.isArray(choices) || !choices.length) {
    throw aiErr(`AI 服务未返回 choices（${endpointLabel(endpoint)}）：${snippet(text)}`, 'AI_BAD_RESPONSE');
  }
  const choice = choices[0] || {};
  const message = choice.message || {};
  let content = contentToText(message.content);
  if (!content.trim()) content = contentToText(choice.text);
  if (content.trim()) return content;
  const reasoning = contentToText(message.reasoning_content) || contentToText(message.reasoning);
  if (reasoning.trim()) throw reasoningOnlyError(choice.finish_reason);
  const finish = choice.finish_reason ? `（finish_reason=${choice.finish_reason}）` : '';
  throw aiErr(`AI 服务返回内容为空${finish}（${endpointLabel(endpoint)}）。请检查模型名称是否正确、max_tokens 是否太小，或稍后重试。`, 'AI_EMPTY');
}

// ---------- 上游 HTTP 调用（带超时） ----------
async function postChatCompletion(endpoint, apiKey, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, ok: res.ok, contentType: res.headers.get('content-type') || '', text };
  } finally {
    clearTimeout(timer);
  }
}

// OpenAI 兼容 chat completions 调用（含自适应重试）
async function callOpenAI(userId, messages, opts = {}) {
  const c = ensureReady(userId, { allowDisabled: !!opts.allowDisabled });
  const endpoint = resolveEndpoint(c.baseUrl);
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const body = { model: c.model, messages, stream: false };
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.maxTokens !== undefined) body.max_tokens = opts.maxTokens;
  if (opts.jsonMode) body.response_format = { type: 'json_object' };

  let requests = 0;
  let retriedNetwork = false;
  let retriedRateLimit = false;
  let swappedMaxTokens = false;
  let droppedTemperature = false;
  let droppedResponseFormat = false;
  let droppedThinkingParam = false;

  while (true) {
    requests++;
    let resp;
    try {
      resp = await postChatCompletion(endpoint, c.apiKey, body, timeoutMs);
    } catch (err) {
      if (err.name === 'AbortError') {
        throw aiErr(`AI 请求超时（${Math.round(timeoutMs / 1000)} 秒）：${endpointLabel(endpoint)} 未在限定时间内响应。请检查接口地址、网络/代理，或稍后重试`, 'AI_TIMEOUT');
      }
      if (!retriedNetwork && requests < MAX_REQUESTS) {
        retriedNetwork = true;
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      throw aiErr(`无法连接 AI 服务 ${endpointLabel(endpoint)}：${err.message}。请检查接口地址、网络或代理设置`, 'AI_NETWORK');
    }

    if (resp.ok) return parseCompletion(resp, endpoint);

    const providerMsg = extractUpstreamError(resp.text);
    const lower = providerMsg.toLowerCase();
    const status = resp.status;

    // ---- 400：按上游提示自适应调整参数后重试（最多 2 次额外请求） ----
    if (status === 400) {
      // 1) 新模型（o 系列 / gpt-5 等）不再接受 max_tokens，需改用 max_completion_tokens
      const unsupportedMaxTokens = /max_tokens/.test(lower) && /max_completion_tokens/.test(lower)
        && body.max_tokens !== undefined;
      if (unsupportedMaxTokens && !swappedMaxTokens) {
        swappedMaxTokens = true;
        const limit = body.max_tokens;
        delete body.max_tokens;
        body.max_completion_tokens = limit;
        if (requests < MAX_REQUESTS) continue;
      }
      // 2) 部分推理模型不接受 temperature
      const unsupportedTemperature = body.temperature !== undefined && /temperature/.test(lower)
        && /(unsupport|not\s*support|unrecogni|unknown|invalid|does\s*not\s*support|不支持|无效|不允许)/.test(lower);
      if (unsupportedTemperature && !droppedTemperature) {
        droppedTemperature = true;
        delete body.temperature;
        if (requests < MAX_REQUESTS) continue;
      }
      // 3) 未知/不支持 thinking / reasoning_effort 参数（仅当请求里确实带了才重试）
      if (!droppedThinkingParam && /(^|[^a-z])(thinking|reasoning_effort)([^a-z]|$)/.test(lower)) {
        const keys = ['thinking', 'reasoning_effort'].filter(k => k in body);
        if (keys.length && /(unrecogni|unknown|unexpected|unsupported|not\s*support|extra)/.test(lower)) {
          droppedThinkingParam = true;
          for (const k of keys) delete body[k];
          if (requests < MAX_REQUESTS) continue;
        }
      }
      // 4) 不支持 response_format 时退回普通文本模式
      if (body.response_format && /response_format/.test(lower) && !droppedResponseFormat) {
        droppedResponseFormat = true;
        delete body.response_format;
        if (requests < MAX_REQUESTS) continue;
      }
    }

    // ---- 429 / 5xx：限流或上游抖动，等待后重试一次 ----
    if ((status === 429 || status >= 500) && !retriedRateLimit && requests < MAX_REQUESTS) {
      retriedRateLimit = true;
      await sleep(RETRY_DELAY_MS);
      continue;
    }

    throw buildHttpError(endpoint, status, providerMsg);
  }
}

// ---------- 路由 ----------
router.get('/ai/config', requireAuth(), (req, res) => {
  res.json({ config: configResponse(getConfig(req.user.id)) });
});

router.put('/ai/config', requireAuth(), (req, res) => {
  const b = req.body || {};
  const baseUrl = normalizeBaseUrl(b.baseUrl ?? '');
  const model = String(b.model ?? '').trim();
  if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
    return res.status(400).json({ error: '接口地址必须以 http:// 或 https:// 开头。可填服务根地址（如 https://api.deepseek.com）或完整的 …/chat/completions 地址，保存时自动规范化' });
  }
  if (baseUrl) {
    try { if (!new URL(baseUrl).hostname) throw new Error('no host'); }
    catch { return res.status(400).json({ error: '接口地址格式不正确，请检查后重试（示例：https://api.deepseek.com 或 https://api.openai.com/v1）' }); }
  }
  const existing = q.get('SELECT * FROM ai_configs WHERE user_id = ?', req.user.id);
  // apiKey 传 null 表示清除；传空字符串/不传表示保留现有 Key；非空字符串表示更新
  let keyToStore = existing?.api_key_enc || '';
  if (b.apiKey === null) keyToStore = '';
  else if (b.apiKey !== undefined && String(b.apiKey).trim() !== '') keyToStore = encrypt(String(b.apiKey).trim());
  // enabled 不传时保留原值；首次配置且字段完整时默认启用
  const enabled = b.enabled === undefined
    ? (existing ? !!existing.enabled : !!(baseUrl && model && keyToStore))
    : !!b.enabled;
  if (existing) {
    q.run('UPDATE ai_configs SET base_url = ?, model = ?, api_key_enc = ?, enabled = ?, updated_at = ? WHERE user_id = ?',
      baseUrl, model, keyToStore, enabled ? 1 : 0, now(), req.user.id);
  } else {
    q.run('INSERT INTO ai_configs(user_id, base_url, model, api_key_enc, enabled, updated_at) VALUES(?,?,?,?,?,?)',
      req.user.id, baseUrl, model, keyToStore, enabled ? 1 : 0, now());
  }
  logAudit(req, 'ai.config', `更新 AI 配置 ${baseUrl || '(空)'} / ${model || '(空)'}`);
  res.json({ ok: true, config: configResponse(getConfig(req.user.id)) });
});

// 连通性测试：未启用时也可用（方便用户先验证 Key/地址再启用），但要求配置完整
router.post('/ai/test', requireAuth(), async (req, res) => {
  const startedAt = Date.now();
  try {
    const c = ensureReady(req.user.id, { allowDisabled: true });
    const reply = await callOpenAI(req.user.id, [
      { role: 'user', content: 'Reply with exactly: OK' },
    ], { temperature: 0, maxTokens: 256, timeoutMs: TEST_TIMEOUT_MS, allowDisabled: true });
    res.json({
      ok: true,
      reply: String(reply).trim(),
      endpoint: resolveEndpoint(c.baseUrl),
      model: c.model,
      latencyMs: Date.now() - startedAt,
    });
  } catch (err) {
    const status = err.code === 'AI_NOT_CONFIGURED' ? 400 : 502;
    res.status(status).json({ error: err.message, code: err.code || 'AI_UPSTREAM_ERROR' });
  }
});

// 模型列表：代理上游 GET {base}/models，方便用户选择模型（未启用时也可用）
router.get('/ai/models', requireAuth(), async (req, res) => {
  let endpoint = '';
  try {
    const c = ensureReady(req.user.id, { allowDisabled: true });
    endpoint = `${normalizeBaseUrl(c.baseUrl)}/models`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    let resp, text;
    try {
      resp = await fetch(endpoint, {
        method: 'GET',
        signal: controller.signal,
        headers: { Accept: 'application/json', Authorization: `Bearer ${c.apiKey}` },
      });
      text = await resp.text();
    } catch (err) {
      if (err.name === 'AbortError') throw aiErr(`获取模型列表超时（20 秒）：${endpointLabel(endpoint)}，请检查接口地址与网络`, 'AI_TIMEOUT');
      throw aiErr(`无法连接 AI 服务 ${endpointLabel(endpoint)}：${err.message}。请检查接口地址、网络或代理设置`, 'AI_NETWORK');
    } finally {
      clearTimeout(timer);
    }
    if (!resp.ok) throw buildHttpError(endpoint, resp.status, extractUpstreamError(text));
    let data;
    try { data = JSON.parse(text); }
    catch { throw aiErr(`AI 服务返回了无法解析的模型列表（${endpointLabel(endpoint)}）：${snippet(text)}`, 'AI_BAD_RESPONSE'); }
    const raw = Array.isArray(data?.data) ? data.data
      : Array.isArray(data?.models) ? data.models
        : Array.isArray(data) ? data : [];
    const ids = [...new Set(raw.map(item => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object') return String(item.id || item.name || item.model || '').trim();
      return '';
    }).filter(Boolean))];
    if (!ids.length) throw aiErr(`AI 服务未返回可用的模型列表（${endpointLabel(endpoint)}）：${snippet(text)}`, 'AI_BAD_RESPONSE');
    res.json({ models: ids });
  } catch (err) {
    return fail(res, err);
  }
});

router.post('/ai/chat', requireAuth(), async (req, res) => {
  const { messages, system } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ error: '缺少对话内容' });
  try {
    ensureReady(req.user.id);
    const full = system ? [{ role: 'system', content: system }, ...messages] : messages;
    const reply = await callOpenAI(req.user.id, full);
    res.json({ reply });
  } catch (err) {
    fail(res, err);
  }
});

// ---------- 帮写邮件 ----------
router.post('/ai/write', requireAuth(), async (req, res) => {
  const { instruction, tone = 'professional', lang = 'zh' } = req.body || {};
  if (!instruction || !String(instruction).trim()) return res.status(400).json({ error: '请描述要写的邮件内容' });
  const langName = { zh: '中文', en: 'English', fr: 'French', es: 'Spanish', pt: 'Portuguese', ru: 'Russian', ar: 'Arabic', hi: 'Hindi', bn: 'Bengali', ur: 'Urdu' }[lang] || 'Chinese';
  const system = `You are an expert email writing assistant inside the OpenMail webmail. Write complete, ready-to-send emails based on the user's instruction. Respond ONLY with a JSON object (no markdown fences) in this exact shape: {"subject": "...", "body_html": "<p>...</p>"}. The body_html must be clean, well-structured HTML (paragraphs/lists, no full document, no <html> wrapper). Write the email in ${langName} with a ${tone} tone. If the instruction includes recipient context, personalize the greeting and closing appropriately.`;
  try {
    ensureReady(req.user.id);
    const reply = await callOpenAI(req.user.id, [
      { role: 'system', content: system },
      { role: 'user', content: String(instruction).slice(0, 4000) },
    ], { temperature: 0.8, maxTokens: 2000, jsonMode: true });
    const parsed = parseJsonLoose(reply);
    if (!parsed || !parsed.body_html) {
      // 兜底：把整个回复当正文
      return res.json({ subject: '', body_html: `<p>${escapeHtmlMin(reply)}</p>`, raw: true });
    }
    res.json({ subject: parsed.subject || '', body_html: parsed.body_html });
  } catch (err) {
    fail(res, err);
  }
});

// ---------- 翻译邮件 ----------
router.post('/ai/translate', requireAuth(), async (req, res) => {
  const { text, targetLang = 'zh' } = req.body || {};
  if (!text || !String(text).trim()) return res.status(400).json({ error: '缺少要翻译的内容' });
  const langName = { zh: '简体中文', en: 'English', fr: 'French', es: 'Spanish', pt: 'Portuguese', ru: 'Russian', ar: 'Arabic', hi: 'Hindi', bn: 'Bengali', ur: 'Urdu', ja: 'Japanese', ko: 'Korean', de: 'German' }[targetLang] || 'Simplified Chinese';
  const system = `You are a professional email translator. Translate the user's email content into ${langName}. Preserve the original tone, greetings, formatting and placeholders. Respond ONLY with the translated text (keep simple HTML tags if present, otherwise plain text). No explanations.`;
  try {
    ensureReady(req.user.id);
    const reply = await callOpenAI(req.user.id, [
      { role: 'system', content: system },
      { role: 'user', content: String(text).slice(0, 12000) },
    ], { temperature: 0.3, maxTokens: 2000 });
    res.json({ translated: reply.trim() });
  } catch (err) {
    fail(res, err);
  }
});

// ---------- 分析邮件 ----------
router.post('/ai/analyze', requireAuth(), async (req, res) => {
  const { subject = '', text = '', lang = 'zh' } = req.body || {};
  if (!String(subject + text).trim()) return res.status(400).json({ error: '缺少邮件内容' });
  const langName = { zh: '简体中文', en: 'English' }[lang] || '简体中文';
  const system = `You are an email analysis assistant. Analyze the given email and respond ONLY with a JSON object (no markdown fences): {"summary": "2-3 sentence summary", "key_points": ["point1", "point2"], "sentiment": "positive|neutral|negative|urgent", "action_items": ["action1"], "suggested_reply_hint": "one-sentence suggestion of how to reply"}. Write all values in ${langName}.`;
  try {
    ensureReady(req.user.id);
    const reply = await callOpenAI(req.user.id, [
      { role: 'system', content: system },
      { role: 'user', content: `主题: ${subject}\n\n正文:\n${String(text).slice(0, 12000)}` },
    ], { temperature: 0.4, maxTokens: 2000, jsonMode: true });
    const parsed = parseJsonLoose(reply);
    if (!parsed) return res.status(502).json({ error: 'AI 返回格式无法解析', raw: reply.slice(0, 500) });
    res.json(parsed);
  } catch (err) {
    fail(res, err);
  }
});

// ---------- AI 生成邮件模板 ----------
// 注：模板输出是完整 HTML（非 JSON），因此不附加 response_format: json_object，
// 否则上游会强制输出 JSON、破坏 HTML 模板（DeepSeek 等还要求 prompt 中出现 json 才允许该模式）。
router.post('/ai/template', requireAuth(), async (req, res) => {
  const { description, kind = 'general' } = req.body || {};
  if (!description || !String(description).trim()) return res.status(400).json({ error: '请描述模板用途' });
  const system = `You are an email HTML template designer. Create a complete, beautiful, responsive HTML email template based on the user's description (kind: ${kind}). Requirements: inline CSS only, table-based or simple block layout, max-width 640px, web-safe fonts, pleasant modern color scheme, include a header banner area, content sections with realistic placeholder text (Chinese if the description is Chinese, otherwise English), and a footer. Respond ONLY with the raw HTML document (starting with <html> or <!DOCTYPE html>). No markdown fences, no explanations.`;
  try {
    ensureReady(req.user.id);
    const reply = await callOpenAI(req.user.id, [
      { role: 'system', content: system },
      { role: 'user', content: String(description).slice(0, 2000) },
    ], { temperature: 0.8, maxTokens: 3500 });
    const html = reply.replace(/^```html?\n?/i, '').replace(/```\s*$/i, '').trim();
    const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
    res.json({ html, name: (titleMatch ? titleMatch[1] : 'AI 模板').slice(0, 60) });
  } catch (err) {
    fail(res, err);
  }
});

function parseJsonLoose(s) {
  try { return JSON.parse(s); } catch { /* 继续宽松解析 */ }
  const m = String(s).match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* 忽略 */ } }
  return null;
}

function escapeHtmlMin(s) {
  return String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

export default router;
