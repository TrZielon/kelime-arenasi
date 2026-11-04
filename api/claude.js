const MODELS = {
  quick: "claude-haiku-5-5",
  default: "claude-sonnet-5-5",
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "server_config" });
  }

  const { prompt, tier } = req.body || {};
  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ error: "prompt" });
  }

  const model = MODELS[tier] || MODELS.default;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 6000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await response.json();

    if (response.status === 429) {
      return res.status(429).json({ error: "rate" });
    }
    if (!response.ok) {
      return res.status(502).json({ error: "upstream" });
    }

    const text = (data.content || [])
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    const truncated = data.stop_reason === "max_tokens";

    return res.status(200).json({ text, truncated });
  } catch (err) {
    return res.status(502).json({ error: "upstream" });
  }
}
