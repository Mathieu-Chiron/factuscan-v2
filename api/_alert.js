// api/_alert.js
// Sends alert emails via Resend when errors occur in production.
// Usage: await sendAlert({ subject, text, level })
// Levels: 'critical' | 'warning' | 'info'

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM = 'alertes@payt-agences.fr';
const TO = ['m.chiron@paytsoftware.com', 'm.habfast@paytsoftware.com'];

const LEVEL_EMOJI = { critical: '🔴', warning: '🟠', info: '🔵' };

export async function sendAlert({ subject, text, level = 'critical', source = '' }) {
  if (!RESEND_API_KEY) {
    console.warn('[alert] RESEND_API_KEY manquante — alerte non envoyée');
    return;
  }

  const emoji = LEVEL_EMOJI[level] || '🔴';
  const fullSubject = `${emoji} [Payt Agences${source ? ' / ' + source : ''}] ${subject}`;
  const body = `${text}\n\n---\nEnv: production\nDate: ${new Date().toISOString()}\nSource: ${source || 'inconnu'}`;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: TO,
        subject: fullSubject,
        text: body,
      }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      console.error('[alert] Resend error', r.status, JSON.stringify(d));
    }
  } catch (e) {
    console.error('[alert] Impossible d\'envoyer l\'alerte:', e.message);
  }
}
