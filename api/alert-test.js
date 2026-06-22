// api/alert-test.js
// Sends a test alert email to verify Resend + domain setup.
// Protected by CRON_SECRET. One-shot endpoint, to be called manually.

import { sendAlert } from './_alert.js';

const CRON_SECRET = process.env.CRON_SECRET;

export default async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  await sendAlert({
    subject: 'TEST ALERT — Vérification du système d\'alertes',
    text: [
      'TEST ALERT — Ceci est un email de test.',
      '',
      'Si vous recevez cet email, le système d\'alertes fonctionne correctement.',
      '',
      'Alertes configurées :',
      '  🔴 Erreur réseau PAYT (contacts, débiteurs, factures)',
      '  🔴 Erreur réseau Claude API (lecture PDF)',
      '  🔴 ANTHROPIC_API_KEY manquante',
      '  🟠 Factures rejetées par PAYT',
      '  🟠 Avoirs non créés',
      '  🟠 Mises à jour rejetées (invoice-edit)',
      '  🔵 Résumé quotidien (tous les matins à 07h00 UTC)',
    ].join('\n'),
    level: 'info',
    source: 'alert-test',
  });

  return res.status(200).json({ ok: true, message: 'Test alert sent' });
}
