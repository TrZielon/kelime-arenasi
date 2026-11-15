// api/ted.js — TED konuşmasının İngilizce metnini (zaman damgalı paragraflar) getirir
// GET /api/ted?slug=ken_robinson_do_schools_kill_creativity   ya da  ?url=https://www.ted.com/talks/...

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';

async function get(url, opt = {}, ms = 10000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { ...opt, headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9', ...(opt.headers || {}) }, signal: ac.signal, redirect: 'follow' });
  } finally { clearTimeout(t); }
}

// JSON içinde "paragraphs": [{ cues: [{ text, time }] }] yapısını ara (site yapısı değişse de bulunsun)
function findParagraphs(o, depth = 0) {
  if (!o || typeof o !== 'object' || depth > 14) return null;
  if (Array.isArray(o.paragraphs) && o.paragraphs.length && o.paragraphs.some(p => p && Array.isArray(p.cues))) return o.paragraphs;
  for (const k of Object.keys(o)) {
    const r = findParagraphs(o[k], depth + 1);
    if (r) return r;
  }
  return null;
}
function findKey(o, key, depth = 0) {
  if (!o || typeof o !== 'object' || depth > 10) return undefined;
  if (key in o && (typeof o[key] === 'string' || typeof o[key] === 'number')) return o[key];
  for (const k of Object.keys(o)) {
    const r = findKey(o[k], key, depth + 1);
    if (r !== undefined) return r;
  }
  return undefined;
}
const clean = s => String(s || '').replace(/\s+/g, ' ').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').trim();
function shape(paras) {
  return paras.map(p => {
    const cues = (p.cues || []).filter(c => c && c.text);
    return { t: Number((cues[0] || {}).time) || 0, text: clean(cues.map(c => c.text).join(' ')) };
  }).filter(p => p.text && !/^\(.*\)$/.test(p.text));
}

async function fromPage(slug) {
  const r = await get(`https://www.ted.com/talks/${slug}/transcript?language=en`);
  if (!r.ok) throw new Error('sayfa ' + r.status);
  const html = await r.text();
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('veri yok');
  const data = JSON.parse(m[1]);
  const paras = findParagraphs(data);
  if (!paras) throw new Error('metin yok');
  const og = k => { const x = html.match(new RegExp(`<meta[^>]+property="og:${k}"[^>]+content="([^"]*)"`)); return x ? clean(x[1]) : ''; };
  return {
    title: clean(findKey(data, 'title') || og('title')).replace(/\s*\|\s*TED Talk$/i, ''),
    speaker: clean(findKey(data, 'presenterDisplayName') || ''),
    duration: Number(findKey(data, 'duration')) || 0,
    image: og('image'),
    paras: shape(paras)
  };
}

async function fromGraphql(slug) {
  const q = `query { translation(videoId: "${slug}", language: "en") { paragraphs { cues { text time } } } video(slug: "${slug}") { title presenterDisplayName duration } }`;
  const r = await get('https://www.ted.com/graphql', { method: 'POST', headers: { 'content-type': 'application/json', 'x-operation-name': 'Transcript' }, body: JSON.stringify({ query: q }) });
  if (!r.ok) throw new Error('graphql ' + r.status);
  const j = await r.json();
  const paras = findParagraphs(j);
  if (!paras) throw new Error('graphql metin yok');
  const v = (j.data && j.data.video) || {};
  return { title: clean(v.title || ''), speaker: clean(v.presenterDisplayName || ''), duration: Number(v.duration) || 0, image: '', paras: shape(paras) };
}

export default async function handler(req, res) {
  const q = req.query || {};
  let slug = String(q.slug || '').trim();
  if (!slug && q.url) { const m = String(q.url).match(/ted\.com\/talks\/([A-Za-z0-9_]+)/); if (m) slug = m[1]; }
  if (!/^[A-Za-z0-9_]{3,140}$/.test(slug)) return res.status(400).json({ error: 'slug' });
  const errs = [];
  for (const f of [fromPage, fromGraphql]) {
    try {
      const out = await f(slug);
      if (out.paras.length < 3) throw new Error('metin kısa');
      res.setHeader('Cache-Control', 'public, s-maxage=2592000, stale-while-revalidate=2592000');
      return res.status(200).json({ slug, ...out });
    } catch (e) { errs.push(String(e.message || e)); }
  }
  res.setHeader('Cache-Control', 'public, s-maxage=600');
  return res.status(404).json({ error: 'bulunamadi', detail: errs.join(' · ') });
}
