import { sendAlert } from './_alert.js';
import { getClerkUserId } from './_clerk-verify.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Require a valid Clerk session — this endpoint proxies a paid API (Anthropic)
  // with a server-side key, so it must never be an open proxy.
  const userId = await getClerkUserId(req);
  if (!userId) return res.status(401).json({ error: 'unauthorized' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    await sendAlert({ subject: 'ANTHROPIC_API_KEY manquante', text: 'La variable ANTHROPIC_API_KEY est absente — extraction PDF impossible.', level: 'critical', source: 'extract' });
    return res.status(500).json({ error: 'API key not configured on server' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(req.body),
    });

    const data = await response.json();

    if (!response.ok) {
      const errorMsg = data?.error?.message || JSON.stringify(data);
      await sendAlert({
        subject: `Erreur Claude API [${response.status}]`,
        text: `Statut: ${response.status}
Erreur: ${errorMsg}

Cela bloque la lecture des PDFs.`,
        level: response.status >= 500 ? 'critical' : 'warning',
        source: 'extract',
      });
    }

    res.status(response.status).json(data);
  } catch (e) {
    await sendAlert({
      subject: 'Erreur réseau Claude API',
      text: `Impossible de joindre api.anthropic.com.

Erreur: ${e?.message || String(e)}

Cela bloque la lecture des PDFs.`,
      level: 'critical',
      source: 'extract',
    });
    res.status(500).json({ error: 'Impossible de joindre Claude API' });
  }
}
