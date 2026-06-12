// api/user-settings.js
// GET  — returns { payt_token } for the authenticated user
// POST { payt_token } — upserts the token in user_settings

import { neon } from '@neondatabase/serverless';
import { getClerkUserId } from './_clerk-verify.js';

const INIT_SQL = `
  CREATE TABLE IF NOT EXISTS user_settings (
    clerk_user_id TEXT PRIMARY KEY,
    payt_token    TEXT,
    updated_at    TIMESTAMPTZ DEFAULT NOW()
  );
`;

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const userId = await getClerkUserId(req);
  if (!userId) return res.status(401).json({ error: 'unauthorized' });

  const sql = neon(process.env.DATABASE_URL);
  await sql(INIT_SQL);

  if (req.method === 'GET') {
    const rows = await sql`
      SELECT payt_token FROM user_settings WHERE clerk_user_id = ${userId}
    `;
    return res.status(200).json({ payt_token: rows[0]?.payt_token || null });
  }

  // POST — save token
  const { payt_token } = req.body || {};
  await sql`
    INSERT INTO user_settings (clerk_user_id, payt_token, updated_at)
    VALUES (${userId}, ${payt_token || null}, NOW())
    ON CONFLICT (clerk_user_id) DO UPDATE
      SET payt_token = EXCLUDED.payt_token,
          updated_at = NOW()
  `;
  return res.status(200).json({ ok: true });
}
