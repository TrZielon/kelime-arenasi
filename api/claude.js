const MODELS = {
  quick: ["gemini-3.5-flash-lite", "gemini-3.5-flash"],
  default: ["gemini-3.5-flash", "gemini-3.5-flash-lite"],
};
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

  const candidates = MODELS[tier] || MODELS.default;
  let lastMsg = "";

  for (const model of candidates) {
    try {
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
              thinkingConfig: { thinkingBudget: 0 },
            },
          }),
        }
      );

      const data = await response.json().catch(() => ({}));

      if (response.ok) {
        const cand = data.candidates?.[0];
        const text = (cand?.content?.parts || [])
          .map((p) => p.text || "")
          .join("");
        const truncated = cand?.finishReason === "MAX_TOKENS";
        return res.status(200).json({ text, truncated });
      }

      if (response.status === 429) {
        return res.status(429).json({ error: "rate" });
      }

      lastMsg = `${model} (${response.status}): ${data?.error?.message || "bilinmeyen hata"}`;

      // Anahtar sorunu varsa diğer modeller de çalışmaz
      if (response.status === 400 || response.status === 403) {
        if (/api key/i.test(lastMsg)) break;
      }
    } catch (err) {
      lastMsg = `${model}: ${err.message}`;
    }
  }

  return res.status(502).json({ error: "Gemini hatası: " + lastMsg });
}
