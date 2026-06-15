// api/db-save.js
// POST { invoices: [...] }  (Authorization: Bearer <clerk-token>)
// Upsert invoice metadata into Neon Postgres
// Returns: { ok: true }

import { neon } from '@neondatabase/serverless';
import { getClerkUserId } from './_clerk-verify.js';

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

  const session_id = await getClerkUserId(req);
  if (!session_id) return res.status(401).json({ error: 'unauthorized' });
  const { invoices } = req.body || {};
  if (!Array.isArray(invoices)) return res.status(400).json({ error: 'missing_invoices' });

  const sql = neon(process.env.DATABASE_URL);

  try {
    await sql(INIT_SQL);

    for (const inv of invoices) {
      await sql`
        INSERT INTO invoices
          (session_id, file_name, pdf_url, status, data, debtor_type, target_company, payt_status, amount_paid, push_status)
        VALUES (
          ${session_id},
          ${inv.fileName},
          ${inv.pdfUrl || null},
          ${inv.status || null},
          ${JSON.stringify(inv.data || {})},
          ${inv.debtorType || null},
          ${inv.targetCompany ? JSON.stringify(inv.targetCompany) : null},
          ${inv.paytStatus || null},
          ${inv.amountPaid ?? null},
          ${inv.pushStatus || null}
        )
        ON CONFLICT (session_id, file_name) DO UPDATE SET
          pdf_url        = EXCLUDED.pdf_url,
          status         = EXCLUDED.status,
          data           = EXCLUDED.data,
          debtor_type    = EXCLUDED.debtor_type,
          target_company = EXCLUDED.target_company,
          payt_status    = EXCLUDED.payt_status,
          amount_paid    = EXCLUDED.amount_paid,
          push_status    = EXCLUDED.push_status,
          updated_at     = NOW()
      `;
    }

    // Delete rows that were removed in the UI (keep only what is in current snapshot)
    const fileNames = invoices.map(inv => inv.fileName);
    if (fileNames.length > 0) {
      await sql`DELETE FROM invoices WHERE session_id = ${session_id} AND file_name != ALL(${fileNames})`;
    } else {
      await sql`DELETE FROM invoices WHERE session_id = ${session_id}`;
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[db-save] Error:', e);
    return res.status(500).json({ error: 'Erreur DB' });
  }
}
