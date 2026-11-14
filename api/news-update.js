const REPO = "TrZielon/kelime-arenasi";
const FILE = "data/news.json";
const FEED = "https://feeds.bbci.co.uk/news/world/rss.xml";
const PER_RUN = 3;
const KEEP = 30;
const MODELS = ["gemini-3.5-flash-lite", "gemini-3.5-flash"];

const decode = (s) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
   .replace(/<[^>]+>/g, "")
   .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
   .replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&").trim();

function field(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? decode(m[1]) : "";
}

// Haberin kendi fotoğrafı: RSS'teki küçük resmi büyük boyuta çevirir.
function thumb(xml) {
  const m = xml.match(/<media:(?:thumbnail|content)[^>]*url="([^"]+)"/i);
  if (!m) return "";
  return m[1].replace(/&amp;/g, "&").replace(/\/(standard|news)\/\d+\//, "/$1/800/");
}

// Fotoğrafı olmayan eski haberler için sayfadaki kapak fotoğrafını bulur.
async function ogImage(src) {
  try {
    const u = new URL(src);
    const r = await fetch(u.origin + u.pathname, { headers: { "User-Agent": "Mozilla/5.0 (compatible; KelimeArenasi/1.0)" } });
    if (!r.ok) return "";
    const html = (await r.text()).slice(0, 200000);
    const tag = (html.match(/<meta[^>]+>/gi) || []).find((t) => /(property|name)=["'](og:image|twitter:image)["']/i.test(t));
    const m = tag && tag.match(/content=["']([^"']+)["']/i);
    return m && /^https:\/\//.test(m[1]) ? m[1].replace(/&amp;/g, "&") : "";
  } catch (e) {
    return "";
  }
}

function shuffleQ(q) {
  if (!q || typeof q !== "object" || !Array.isArray(q.opts) || q.opts.length < 2) return null;
  const opts = q.opts.map(String);
  const ans = Number(q.ans) || 0;
  const order = opts.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return { q: String(q.q || ""), opts: order.map((i) => opts[i]), ans: order.indexOf(ans) };
}

async function gemini(apiKey, prompt, errors) {
  for (const model of MODELS) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
              maxOutputTokens: 8000,
              responseMimeType: "application/json",
              thinkingConfig: { thinkingBudget: 0 },
            },
          }),
        }
      );
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        errors.push(`${model} ${r.status}`);
        continue;
      }
      const text = (d.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
      if (text.trim()) return text;
      errors.push(`${model} boş cevap`);
    } catch (e) {
      errors.push(`${model} ${e.message}`);
    }
  }
  return "";
}

function parseLoose(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch (e) {
    return null;
  }
}

function buildPrompt(c) {
  return `You are an English teacher who writes news for learners.
Using ONLY the facts in the summary below, write one news story in three levels, each with a 4-question multiple-choice quiz.
Do not invent facts, numbers, names or quotes.

Level 1: 80-100 words, very simple sentences and common words (CEFR A2).
Level 2: 120-140 words, clear sentences (CEFR B1).
Level 3: 160-180 words, natural news English (CEFR B2).

Each quiz has exactly 4 questions. Each question has 4 English options and one correct answer. Cover the main idea, one word meaning, one detail and one true/false style statement.

Return ONLY JSON in exactly this shape. "levels" must contain exactly three objects with level 1, 2 and 3:
{"title":"short English headline","category":"World","levels":[{"level":1,"text":"...","quiz":[{"q":"...","opts":["...","...","...","..."],"ans":0}]},{"level":2,"text":"...","quiz":[]},{"level":3,"text":"...","quiz":[]}]}
"ans" is the index (0 to 3) of the correct option.

TITLE: ${c.title}
SUMMARY: ${c.summary}`;
}

function normalize(j) {
  const raw = Array.isArray(j.levels)
    ? j.levels
    : Object.entries(j.levels || {}).map(([k, v]) => ({ level: k, ...(v || {}) }));
  const out = {};
  for (const lv of raw) {
    const n = String(lv.level ?? "").match(/[123]/)?.[0];
    if (!n) continue;
    const text = String(lv.text || "").trim();
    const quiz = (Array.isArray(lv.quiz) ? lv.quiz : []).slice(0, 4).map(shuffleQ).filter(Boolean);
    if (text.split(/\s+/).length >= 40 && quiz.length >= 2) out[n] = { text, quiz };
  }
  return out["1"] && out["2"] && out["3"] ? out : null;
}

async function makeItem(apiKey, c, reasons) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const errs = [];
    const txt = await gemini(apiKey, buildPrompt(c), errs);
    const j = parseLoose(txt);
    if (!j) {
      reasons.push(`${c.title.slice(0, 40)}: cevap okunamadı (${errs.join(", ") || "boş"})`);
      continue;
    }
    const levels = normalize(j);
    if (!levels) {
      reasons.push(`${c.title.slice(0, 40)}: seviyeler ya da quizler eksik`);
      continue;
    }
    return {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      date: new Date().toISOString().slice(0, 10),
      category: String(j.category || "World"),
      title: String(j.title || c.title),
      src: c.link,
      source: "BBC News",
      img: c.img || (await ogImage(c.link)),
      levels,
    };
  }
  return null;
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.authorization || "";
  const key = (req.query && req.query.key) || "";
  if (!secret || (auth !== `Bearer ${secret}` && key !== secret)) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const ghToken = process.env.GITHUB_TOKEN;
  if (!apiKey || !ghToken) {
    return res.status(500).json({ error: "config", detail: "GEMINI_API_KEY ve GITHUB_TOKEN gerekli" });
  }

  const gh = {
    Authorization: `Bearer ${ghToken}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "kelime-arenasi",
  };
  const url = `https://api.github.com/repos/${REPO}/contents/${FILE}`;

  try {
    let current = { items: [] };
    let sha;
    const read = await fetch(url, { headers: gh });
    if (read.ok) {
      const j = await read.json();
      sha = j.sha;
      current = JSON.parse(Buffer.from(j.content, "base64").toString("utf8"));
    } else if (read.status !== 404) {
      return res.status(502).json({ error: "github_read", detail: read.status });
    }
    const used = new Set((current.items || []).map((i) => i.src));

    // Fotoğrafı eksik olan eski haberleri tamamla (her çalışmada en fazla 12 tane)
    let filled = 0;
    const missing = (current.items || []).filter((i) => !i.img && i.src).slice(0, 12);
    await Promise.all(missing.map(async (i) => { const img = await ogImage(i.src); if (img) { i.img = img; filled++; } }));

    const onlyPhotos = req.query && req.query.photos === "1";
    const feed = onlyPhotos ? "" : await (await fetch(FEED)).text();
    const cands = (feed.match(/<item>[\s\S]*?<\/item>/g) || [])
      .map((x) => ({ title: field(x, "title"), summary: field(x, "description"), link: field(x, "link"), img: thumb(x) }))
      .filter((x) => x.link && x.title && x.summary && !used.has(x.link))
      .slice(0, PER_RUN);

    const reasons = [];
    const made = (await Promise.all(cands.map((c) => makeItem(apiKey, c, reasons)))).filter(Boolean);

    if (made.length === 0 && filled === 0) {
      return res.status(200).json({ ok: true, added: 0, photos: 0, skipped: cands.length, reasons, note: cands.length ? "" : "yeni haber bulunamadı" });
    }

    const body = {
      updated: new Date().toISOString(),
      items: [...made, ...(current.items || [])].slice(0, KEEP),
    };
    const write = await fetch(url, {
      method: "PUT",
      headers: { ...gh, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `haber güncellemesi: ${made.length} yeni, ${filled} fotoğraf`,
        content: Buffer.from(JSON.stringify(body, null, 2)).toString("base64"),
        ...(sha ? { sha } : {}),
      }),
    });
    if (!write.ok) return res.status(502).json({ error: "github_write", detail: write.status });

    return res.status(200).json({
      ok: true,
      added: made.length,
      photos: filled,
      skipped: cands.length - made.length,
      reasons,
    });
  } catch (e) {
    return res.status(500).json({ error: "exception", detail: e.message });
  }
}
