// api/define.js — İngilizce açıklamalar
// Önce Cambridge Dictionary sayfasını okur; ulaşılamazsa Free Dictionary API'ye (Wiktionary) düşer.
// GET /api/define?w=undermine

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”' };
function clean(h) {
  return String(h || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

async function get(url, ms) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { headers: { 'user-agent': UA, 'accept': 'text/html,application/json;q=0.9,*/*;q=0.8', 'accept-language': 'en-GB,en;q=0.9' }, signal: ac.signal, redirect: 'follow' });
  } finally { clearTimeout(t); }
}

export function parseCambridge(html) {
  // Yalnızca Cambridge Advanced Learner's bölümünü al (sayfada Amerikan ve İş İngilizcesi bölümleri de var)
  let h = html;
  const i = h.search(/data-id="cald4"/);
  if (i >= 0) {
    h = h.slice(i);
    const j = h.slice(20).search(/<div class="pr dictionary"|data-id="(cacd|cbed|business)/);
    if (j > 0) h = h.slice(0, j + 20);
  }
  const re = /<div class="pr entry-body__el|class="hw dhw"[^>]*>([\s\S]*?)<\/span>|class="pos dpos"[^>]*>([\s\S]*?)<\/span>|class="(?:us|uk) dpron-i[^"]*"[\s\S]{0,700}?class="ipa dipa[^"]*"[^>]*>([\s\S]*?)<\/span>|class="guideword dsense_gw"[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>|class="epp-xref dxref ([ABC][12])"|class="def ddef_d[^"]*"[^>]*>([\s\S]*?)<\/div>|class="eg deg"[^>]*>([\s\S]*?)<\/span>\s*(?:<\/div>|<span class="trans)/g;
  const entries = [];
  let e = null, gw = '', lvl = '', last = null, m;
  const ensure = () => { if (!e) { e = { hw: '', pos: '', ipa: '', senses: [] }; entries.push(e); } return e; };
  while ((m = re.exec(h))) {
    if (m[0].startsWith('<div class="pr entry-body__el')) { e = null; gw = ''; lvl = ''; last = null; continue; }
    if (m[1] !== undefined) { const x = ensure(); if (!x.hw) x.hw = clean(m[1]); }
    else if (m[2] !== undefined) { const x = ensure(); if (!x.pos) x.pos = clean(m[2]); }
    else if (m[3] !== undefined) { const x = ensure(); if (!x.ipa) x.ipa = clean(m[3]); }
    else if (m[4] !== undefined) { gw = clean(m[4]); }
    else if (m[5] !== undefined) { lvl = m[5]; }
    else if (m[6] !== undefined) {
      const def = clean(m[6]).replace(/\s*:\s*$/, '');
      if (!def) continue;
      last = { def, gw, lvl, ex: [] };
      ensure().senses.push(last);
      lvl = '';
    } else if (m[7] !== undefined && last && last.ex.length < 3) {
      const ex = clean(m[7]);
      if (ex) last.ex.push(ex);
    }
  }
  return entries.filter(x => x.senses.length).slice(0, 5).map(x => ({ ...x, senses: x.senses.slice(0, 10) }));
}

async function cambridge(w) {
  const slug = encodeURIComponent(w.toLowerCase().replace(/\s+/g, '-'));
  const url = `https://dictionary.cambridge.org/dictionary/english/${slug}`;
  const r = await get(url, 9000);
  if (!r.ok) throw new Error('cambridge ' + r.status);
  const entries = parseCambridge(await r.text());
  if (!entries.length) throw new Error('cambridge boş');
  return { src: 'cambridge', url, entries };
}

async function wiktionary(w) {
  const r = await get(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w.toLowerCase())}`, 7000);
  if (!r.ok) throw new Error('wiktionary ' + r.status);
  const j = await r.json();
  const entries = [];
  (Array.isArray(j) ? j : []).forEach(it => (it.meanings || []).forEach(mn => {
    const senses = (mn.definitions || []).slice(0, 8).map(d => ({ def: clean(d.definition), gw: '', lvl: '', ex: d.example ? [clean(d.example)] : [] })).filter(s => s.def);
    if (senses.length) entries.push({ hw: it.word || w, pos: mn.partOfSpeech || '', ipa: String((it.phonetic || ((it.phonetics || []).find(p => p.text) || {}).text || '')).replace(/^\/|\/$/g, ''), senses });
  }));
  if (!entries.length) throw new Error('wiktionary boş');
  return { src: 'wiktionary', url: `https://en.wiktionary.org/wiki/${encodeURIComponent(w)}`, entries: entries.slice(0, 5) };
}

export default async function handler(req, res) {
  const w = String((req.query && req.query.w) || '').trim().slice(0, 60);
  if (!w || !/^[a-z][a-z' -]*$/i.test(w)) return res.status(400).json({ error: 'kelime' });
  const errs = [];
  for (const f of [cambridge, wiktionary]) {
    try {
      const out = await f(w);
      res.setHeader('Cache-Control', 'public, s-maxage=604800, stale-while-revalidate=2592000');
      return res.status(200).json(out);
    } catch (e) { errs.push(String(e.message || e)); }
  }
  res.setHeader('Cache-Control', 'public, s-maxage=3600');
  return res.status(404).json({ error: 'bulunamadi', detail: errs.join(' · ') });
}
