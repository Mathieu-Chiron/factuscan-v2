// api/db-load.js
// POST { session_id }
// Returns all invoices for this user from Neon Postgres

import { neon } from '@neondatabase/serverless';

const INIT_SQL = `
  CREATE TABLE IF NOT EXISTS invoices (
    id           SERIAL PRIMARY KEY,
    session_id   TEXT NOT NULL,
    file_name    TEXT NOT NULL,
    pdf_url      TEXT,
    status       TEXT,
    data         JSONB,
    debtor_type  TEXT,
    target_company JSONB,
    payt_status  TEXT,
    amount_paid  NUMERIC,
    push_status  TEXT,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (session_id, file_name)
  );
`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { session_id } = req.body || {};
  if (!session_id) return res.status(400).json({ error: 'missing_session_id' });

  const sql = neon(process.env.DATABASE_URL);

  try {
    await sql(INIT_SQL);

    const rows = await sql`
      SELECT file_name, pdf_url, status, data, debtor_type,
             target_company, payt_status, amount_paid, push_status
      FROM invoices
      WHERE session_id = ${session_id}
      ORDER BY updated_at ASC
    `;

    const invoices = rows.map(r => ({
      fileName:      r.file_name,
      pdfUrl:        r.pdf_url || null,
      status:        r.status,
      data:          r.data || {},
      errors:        {},
      confidence:    null,
      rawNorm:       {},
      debtorType:    r.debtor_type || null,
      repaired:      false,
      targetCompany: r.target_company || null,
      paytStep:      null,
      paytStatus:    r.payt_status || null,
      amountPaid:    r.amount_paid ?? null,
      baseOpenAmount:null,
      pdfError:      null,
      pushStatus:    r.push_status || null,
    }));

    return res.status(200).json({ invoices });
  } catch (e) {
    console.error('[db-load] Error:', e);
    return res.status(500).json({ error: 'Erreur DB' });
  }
}
