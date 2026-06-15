// api/config.js
// Returns public configuration for the frontend (non-secret values only).

export default function handler(req, res) {
  res.status(200).json({
    clerkPublishableKey:
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
      process.env.CLERK_PUBLISHABLE_KEY ||
      null,
  });
}
