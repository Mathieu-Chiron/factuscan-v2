// api/cron-daily.js
// Vercel cron job — runs every day at 8:00 AM Paris time (07:00 UTC).
// Sends a daily summary email via Resend.
// Triggered by vercel.json crons config.

import { sendAlert } from './_alert.js';
import { neon } from '@neondatabase/serverless';

const CRON_SECRET = process.env.CRON_SECRET;

export default async function handler(req, res) {
  // Protect the cron endpoint
  if (req.headers['authorization'] !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);

    // Count pushes in the last 24h from the datasets table
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const [{ active_users }] = await sql`
      SELECT COUNT(DISTINCT user_id) AS active_users
      FROM datasets
      WHERE updated_at >= ${since}
    `;

    await sendAlert({
      subject: 'Résumé quotidien',
      text: [
        `Résumé du ${new Date().toLocaleDateString('fr-FR')}`,
        '',
        `Utilisateurs actifs (24h) : ${active_users}`,
        '',
        'Aucune erreur critique détectée — voir les alertes précédentes pour le détail.',
      ].join('\n'),
      level: 'info',
      source: 'cron-daily',
    });

    return res.status(200).json({ ok: true });
  } catch (e) {
    await sendAlert({
      subject: 'Erreur cron daily',
      text: e?.message || String(e),
      level: 'critical',
      source: 'cron-daily',
    });
    return res.status(500).json({ error: e.message });
  }
}
