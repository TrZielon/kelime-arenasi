// api/claude.js — Vercel Serverless Function
// Ortam değişkenleri (Vercel → Settings → Environment Variables):
//   GEMINI_API_KEY          (zorunlu)
//   GEMINI_MODEL_QUALITY    (isteğe bağlı; varsayılan: gemini-3.5-flash-lite)
//   GEMINI_MODEL_FAST       (isteğe bağlı; varsayılan: gemini-3.5-flash-lite)
//   GEMINI_THINKING_BUDGET  (isteğe bağlı; yalnızca model destekliyorsa, ör. 0)
//   ALLOWED_ORIGINS         (isteğe bağlı, virgülle ayrılmış; boşsa herkes kullanabilir)

const MODEL_QUALITY = process.env.GEMINI_MODEL_QUALITY || 'gemini-3.5-flash-lite';
const MODEL_FAST = process.env.GEMINI_MODEL_FAST || 'gemini-3.5-flash-lite';
const FALLBACK_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];
const MAX_PROMPT = 60000;
const hits = new Map();

function send(res, code, obj) { res.status(code).json(obj); }

function originOk(req) {
  const list = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const origin = req.headers.origin;
  if (!origin || !list.length) return true;
  return list.includes(origin) || origin === 'https://' + req.headers.host;
}

function limited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < 60000);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > 40;
}

async function gemini(model, key, prompt, maxTokens) {
  const gen = { temperature: 0.7, maxOutputTokens: maxTokens };
  const tb = process.env.GEMINI_THINKING_BUDGET;
  if (tb !== undefined && tb !== '') gen.thinkingConfig = { thinkingBudget: Number(tb) };
  const body = { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: gen };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  let r, j = {};
  for (let attempt = 0; attempt < 3; attempt++) {
    r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
    });
    j = await r.json().catch(() => ({}));
    if ((r.status === 429 || r.status >= 500) && attempt < 2) {
      await new Promise(res => setTimeout(res, 1500 * (attempt + 1)));
      continue;
    }
    break;
  }
  return { status: r.status, json: j };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  if (!originOk(req)) return send(res, 403, { error: 'origin' });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return send(res, 500, { error: 'server_config' });
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'local';
  if (limited(ip)) return send(res, 429, { error: 'rate' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  const prompt = body.prompt;
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > MAX_PROMPT) {
    return send(res, 400, { error: 'prompt' });
  }

  const quick = body.tier === 'quick';
  const maxTokens = quick ? 4096 : 8192;
  const models = [...new Set(quick
    ? [MODEL_FAST, MODEL_QUALITY, ...FALLBACK_MODELS]
    : [MODEL_QUALITY, MODEL_FAST, ...FALLBACK_MODELS])];

  let last = null, usedModel = '';
  for (const model of models) {
    const { status, json } = await gemini(model, key, prompt, maxTokens);
    usedModel = model;
    last = { status, json };
    if (status === 200) break;
    const msg = (json && json.error && json.error.message) || '';
    const modelProblem = status === 404 || (status === 400 && /model/i.test(msg));
    if (!modelProblem) break;
  }

  const { status, json } = last;
  if (status === 429) return send(res, 429, { error: 'rate' });
  if (status !== 200) {
    const msg = String((json && json.error && json.error.message) || 'bilinmeyen hata').slice(0, 300);
    return send(res, 502, { error: 'upstream', detail: `${usedModel} (${status}): ${msg}` });
  }

  const cand = json.candidates && json.candidates[0];
  const text = cand && cand.content && Array.isArray(cand.content.parts)
    ? cand.content.parts.map(p => p.text || '').join('')
    : '';
  if (!text.trim()) {
    const why = (cand && cand.finishReason) || (json.promptFeedback && json.promptFeedback.blockReason) || 'boş yanıt';
    return send(res, 502, { error: 'upstream', detail: `${usedModel}: boş yanıt (${why})` });
  }
  return send(res, 200, { text, truncated: !!(cand && cand.finishReason === 'MAX_TOKENS') });
}
