const MODELS = {
  quick: ["gemini-3.5-flash-lite", "gemini-3.5-flash"],
  default: ["gemini-3.5-flash", "gemini-3.5-flash-lite"],
};

// İstek sınırına takılınca bekleme süreleri (milisaniye)
const WAITS = [2000, 4000, 8000];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callGemini(model, apiKey, prompt) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
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
  const data = await response.json().catch(() => ({}));
  return { status: response.status, ok: response.ok, data };
}

async function generate(apiKey, prompt, models) {
  let lastStatus = 502;
  let lastMsg = "";

  for (const model of models) {
    for (let attempt = 0; attempt <= WAITS.length; attempt++) {
      let r;
      try {
        r = await callGemini(model, apiKey, prompt);
      } catch (err) {
        lastMsg = `${model}: ${err.message}`;
        break;
      }

      if (r.ok) return { ok: true, data: r.data };

      lastStatus = r.status;
      lastMsg = `${model} (${r.status}): ${r.data?.error?.message || "bilinmeyen hata"}`;

      if (r.status === 429 || r.status === 503) {
        if (attempt < WAITS.length) {
          await sleep(WAITS[attempt]);
          continue;
        }
        break;
      }

      break;
    }
  }

  if (lastStatus === 429) {
    return { ok: false, status: 429, error: "rate", detail: lastMsg };
  }
  return { ok: false, status: 502, error: "upstream", detail: lastMsg };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "server_config" });
  }

  const { prompt, tier } = req.body || {};
  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ error: "prompt" });
  }

  const result = await generate(apiKey, prompt, MODELS[tier] || MODELS.default);
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error, detail: result.detail });
  }

  const cand = result.data.candidates?.[0];
  const text = (cand?.content?.parts || []).map((p) => p.text || "").join("");
  const truncated = cand?.finishReason === "MAX_TOKENS";
  return res.status(200).json({ text, truncated });
}
