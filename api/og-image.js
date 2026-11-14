// api/og-image.js — Bir BBC haberinin kendi kapak fotoğrafına yönlendirir.
// Kullanım: /api/og-image?u=https://www.bbc.co.uk/news/articles/...
// Sonuç Vercel'de 30 gün önbelleğe alınır; her haber kendi fotoğrafını alır.
const ALLOWED = /(^|\.)bbc\.(co\.uk|com)$/i;

function pick(html) {
  const tags = html.match(/<meta[^>]+>/gi) || [];
  for (const name of ['og:image', 'twitter:image', 'twitter:image:src']) {
    for (const t of tags) {
      if (new RegExp(`(property|name)=["']${name}["']`, 'i').test(t)) {
        const m = t.match(/content=["']([^"']+)["']/i);
        if (m) return m[1].replace(/&amp;/g, '&');
      }
    }
  }
  return '';
}

export default async function handler(req, res) {
  let url;
  try { url = new URL(String((req.query && req.query.u) || '')); } catch (e) { return res.status(400).json({ error: 'url' }); }
  if (url.protocol !== 'https:' || !ALLOWED.test(url.hostname)) return res.status(400).json({ error: 'host' });
  try {
    const r = await fetch(url.origin + url.pathname, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; KelimeArenasi/1.0; +https://kelime-arenasi-d8zm.vercel.app)' },
      redirect: 'follow',
    });
    if (!r.ok) return res.status(404).json({ error: 'page' });
    const img = pick((await r.text()).slice(0, 200000));
    if (!/^https:\/\//.test(img)) return res.status(404).json({ error: 'image' });
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=2592000, stale-while-revalidate=604800');
    res.setHeader('Location', img);
    return res.status(302).end();
  } catch (e) {
    return res.status(502).json({ error: 'fetch' });
  }
}
