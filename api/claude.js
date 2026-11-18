// api/claude.js — Vercel Serverless Function
// Ortam değişkenleri (Vercel → Settings → Environment Variables):
//   GEMINI_API_KEY          (zorunlu)
//   GEMINI_MODEL_QUALITY    (isteğe bağlı; varsayılan: gemini-3.5-flash-lite)
//   GEMINI_MODEL_FAST       (isteğe bağlı; varsayılan: gemini-3.5-flash-lite)
//   GEMINI_THINKING_BUDGET  (isteğe bağlı; yalnızca model destekliyorsa, ör. 0)
//   ALLOWED_ORIGINS         (isteğe bağlı, virgülle ayrılmış; boşsa herkes kullanabilir)
//   GROQ_API_KEY            (isteğe bağlı ama önerilir: metin istekleri çok daha hızlı Groq'ta çalışır,
//                            Groq dolarsa ya da hata verirse otomatik Gemini'ye geçilir; fotoğraflar hep Gemini'de)
//   GROQ_MODEL              (isteğe bağlı; varsayılan: openai/gpt-oss-120b)
//   GROQ_MODEL_FAST         (isteğe bağlı; varsayılan: openai/gpt-oss-20b)

const MODEL_QUALITY = process.env.GEMINI_MODEL_QUALITY || 'gemini-3.5-flash-lite';
const MODEL_FAST = process.env.GEMINI_MODEL_FAST || 'gemini-3.5-flash-lite';
const FALLBACK_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];
const MAX_PROMPT = 60000;
const hits = new Map();
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const GROQ_MODEL_FAST = process.env.GROQ_MODEL_FAST || 'openai/gpt-oss-20b';

// Groq (OpenAI uyumlu). Düşünmeyi düşük tutar, JSON istenirse JSON modunu açar.
async function groq(model, key, prompt, maxTokens, wantJson, deadline) {
  const left = deadline - Date.now();
  if (left < 4000) return { status: 504, text: '' };
  const body = { model, messages: [{ role: 'user', content: prompt }], temperature: 0.7, max_completion_tokens: Math.min(maxTokens, 8192), reasoning_effort: 'low' };
  if (wantJson && /json/i.test(prompt)) body.response_format = { type: 'json_object' };
  const go = async b => {
    const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), Math.min(left - 1500, 30000));
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key }, body: JSON.stringify(b), signal: ac.signal });
      const j = await r.json().catch(() => ({}));
      const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
      return { status: r.status, text, msg: (j.error && j.error.message) || '', trunc: !!(j.choices && j.choices[0] && j.choices[0].finish_reason === 'length') };
    } catch (e) { return { status: 504, text: '' }; } finally { clearTimeout(tm); }
  };
  let r = await go(body);
  // JSON modu ya da düşünme ayarı reddedilirse sade istekle bir kez daha
  if (r.status === 400) { delete body.response_format; delete body.reasoning_effort; r = await go(body); }
  return r;
}

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

// Vercel fonksiyonu 60 sn'de kesilir; tarayıcı (özellikle Safari) bağlantıyı "Load failed" diye düşürür.
// Bu yüzden toplam süreyi 50 sn'de tutuyoruz ve süre kalmadıysa yeni deneme başlatmıyoruz.
const BUDGET_MS = 50000;
async function gemini(model, key, prompt, maxTokens, image, ocr, wantJson, plain, deadline) {
  const gen = { temperature: ocr ? 0 : 0.7, maxOutputTokens: maxTokens };
  const tb = process.env.GEMINI_THINKING_BUDGET;
  if (!plain) {
    // Düşünme süresini kısa tut: cümle ve paragraf üretimi çok daha hızlı biter
    if (tb !== undefined && tb !== '') gen.thinkingConfig = { thinkingBudget: Number(tb) };
    else if (/gemini-3/.test(model)) gen.thinkingConfig = { thinkingLevel: 'low' };
    else if (/2\.5-flash/.test(model)) gen.thinkingConfig = { thinkingBudget: 0 };
    if (ocr && image) gen.mediaResolution = 'MEDIA_RESOLUTION_HIGH';
    if (wantJson) gen.responseMimeType = 'application/json';
  }
  const parts = image ? [{ inline_data: { mime_type: image.mime, data: image.data } }, { text: prompt }] : [{ text: prompt }];
  const body = { contents: [{ role: 'user', parts }], generationConfig: gen };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  let status = 0, j = {};
  for (let attempt = 0; attempt < 3; attempt++) {
    const left = deadline - Date.now();
    if (left < 4000) return { status: status || 504, json: j, timeout: true };
    const ac = new AbortController();
    const tm = setTimeout(() => ac.abort(), left - 1500);
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      status = r.status;
      j = await r.json().catch(() => ({}));
    } catch (e) {
      status = 504; j = {}; // zaman aşımı ya da bağlantı hatası
    } finally { clearTimeout(tm); }
    if ((status === 429 || status >= 500) && attempt < 2 && deadline - Date.now() > 15000) {
      await new Promise(res => setTimeout(res, 1200 * (attempt + 1)));
      continue;
    }
    break;
  }
  return { status, json: j };
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

  let image = null;
  if (body.image) {
    const im = body.image;
    if (!im || typeof im.data !== 'string' || !/^image\/(jpeg|png|webp)$/.test(im.mime || '') || im.data.length > 4200000) {
      return send(res, 400, { error: 'image' });
    }
    image = { mime: im.mime, data: im.data };
  }
  const quick = body.tier === 'quick';
  const ocr = body.mode === 'ocr';
  const wantJson = !!body.json;
  const maxTokens = ocr ? 24000 : quick ? 4096 : 8192;
  const models = [...new Set(quick
    ? [MODEL_FAST, MODEL_QUALITY, ...FALLBACK_MODELS]
    : [MODEL_QUALITY, MODEL_FAST, ...FALLBACK_MODELS])];

  const deadline = Date.now() + BUDGET_MS;
  // 1) Hızlı yol: Groq (fotoğraf yoksa)
  const gk = process.env.GROQ_API_KEY;
  if (gk && !image) {
    for (const gm of [...new Set(quick ? [GROQ_MODEL_FAST, GROQ_MODEL] : [GROQ_MODEL, GROQ_MODEL_FAST])]) {
      const r = await groq(gm, gk, prompt, maxTokens, wantJson, deadline);
      if (r.status === 200 && r.text.trim()) return send(res, 200, { text: r.text, truncated: r.trunc, via: 'groq' });
      if (deadline - Date.now() < 12000) break;
    }
  }
  // 2) Gemini (fotoğraflar ve Groq yedeği)
  let last = null, usedModel = '';
  for (const model of models) {
    if (last && deadline - Date.now() < 8000) break;
    let { status, json } = await gemini(model, key, prompt, maxTokens, image, ocr, wantJson, false, deadline);
    let msg = (json && json.error && json.error.message) || '';
    // Model ek ayarları (çözünürlük, düşünme, JSON) desteklemiyorsa sade istekle tekrar dene
    if (status === 400 && (ocr || wantJson) && !/model/i.test(msg)) {
      ({ status, json } = await gemini(model, key, prompt, maxTokens, image, ocr, false, true, deadline));
      msg = (json && json.error && json.error.message) || '';
    }
    usedModel = model;
    last = { status, json };
    if (status === 200) break;
    const modelProblem = status === 404 || (status === 400 && /model/i.test(msg));
    const busy = status === 429 || status >= 500; // kota dolduysa ya da model yoğunsa sıradaki modele geç
    if (!modelProblem && !busy) break;
  }

  const { status, json } = last;
  if (status === 429) return send(res, 429, { error: 'rate' });
  if (status === 504) return send(res, 503, { error: 'busy', detail: `${usedModel}: süre doldu` });
  if (status !== 200) {
    const emsg = String((json && json.error && json.error.message) || 'bilinmeyen hata').slice(0, 300);
    return send(res, 502, { error: 'upstream', detail: `${usedModel} (${status}): ${emsg}` });
  }

  const cand = json.candidates && json.candidates[0];
  const text = cand && cand.content && Array.isArray(cand.content.parts)
    ? cand.content.parts.filter(p => !p.thought).map(p => p.text || '').join('')
    : '';
  if (!text.trim()) {
    const why = (cand && cand.finishReason) || (json.promptFeedback && json.promptFeedback.blockReason) || 'boş yanıt';
    return send(res, 502, { error: 'upstream', detail: `${usedModel}: boş yanıt (${why})` });
  }
  return send(res, 200, { text, truncated: !!(cand && cand.finishReason === 'MAX_TOKENS') });
}
