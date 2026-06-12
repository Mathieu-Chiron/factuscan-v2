// api/_clerk-verify.js
// Shared helper — NOT exposed as a serverless endpoint (underscore prefix).
// Verifies a Clerk session token and returns the Clerk userId, or null.

import { verifyToken } from '@clerk/backend';

export async function getClerkUserId(req) {
  const auth = req.headers['authorization'];
  if (!auth?.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  try {
    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
    });
    return payload.sub; // Clerk userId e.g. "user_2abc..."
  } catch {
    return null;
  }
}
