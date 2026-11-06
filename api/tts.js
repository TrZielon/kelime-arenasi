// Vercel serverless function: Gemini ses üretimi (GEMINI_API_KEY ile), Amerikan İngilizcesi aksanı.
// Birkaç model adı sırayla denenir. Hata olursa Google'ın cevabı geri döner.
const MODELS = [
  'gemini-2.5-flash-preview-tts',
  'gemini-2.5-pro-preview-tts',
  'gemini-2.5-flash-tts'
];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  const text = req.body && req.body.text;
  if (typeof text !== 'string' || !text.trim() || text.length > 2000) {
    return res.status(400).json({ error: 'bad input' });
  }
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: 'GEMINI_API_KEY tanımlı değil' });

  const errors = [];
  for (const model of MODELS) {
    const up = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Say in a clear American English accent: ' + text }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } }
          }
        })
      }
    );
    const raw = await up.text();
    if (!up.ok) {
      errors.push({ model, status: up.status, detail: raw.slice(0, 300) });
      continue;
    }
    let j = {};
    try { j = JSON.parse(raw); } catch (e) {}
    const part = j.candidates && j.candidates[0] && j.candidates[0].content &&
                 j.candidates[0].content.parts && j.candidates[0].content.parts.find(p => p.inlineData);
    if (!part) {
      errors.push({ model, status: 200, detail: 'ses verisi yok: ' + raw.slice(0, 300) });
      continue;
    }
    // Gemini ham PCM (16 bit, mono, 24 kHz) döndürür; WAV başlığı ekliyoruz
    const pcm = Buffer.from(part.inlineData.data, 'base64');
    res.setHeader('content-type', 'audio/wav');
    res.setHeader('cache-control', 'public, max-age=86400');
    res.setHeader('x-tts-model', model);
    return res.status(200).send(pcmToWav(pcm, 24000));
  }
  return res.status(502).json({ error: 'hiçbir model çalışmadı', errors });
}

function pcmToWav(pcm, rate) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
