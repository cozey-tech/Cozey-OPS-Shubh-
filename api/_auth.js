// Shared request helpers: CORS scoping + optional office-secret check.
//
// This dashboard's API is READ-ONLY. The real access gate for production is
// Vercel Deployment Protection (password/SSO) — enable it before connecting prod data.
// applyCors scopes the browser origin (no more "*"). isOffice is provided
// for any future write endpoints and is a LIGHT check only.

const crypto = require('crypto');

function applyCors(res) {
  const origin = process.env.DASHBOARD_ORIGIN;
  if (!origin) {
    // Fail loudly — silent CORS denial is very hard to debug.
    throw new Error(
      'DASHBOARD_ORIGIN env var is not set. ' +
      'Set it to the app URL in Vercel (Production + Preview) before connecting production data.'
    );
  }
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-office-key');
}

// Timing-safe comparison of the provided office key against OFFICE_SECRET.
// isOffice is a LIGHT check only — the real gate is Vercel Deployment Protection.
function isOffice(req) {
  const secret = process.env.OFFICE_SECRET;
  if (!secret) return false;
  const provided = req.headers['x-office-key'] || '';
  try {
    return crypto.timingSafeEqual(
      Buffer.from(provided.padEnd(secret.length)),
      Buffer.from(secret)
    );
  } catch {
    return false;
  }
}

module.exports = { applyCors, isOffice };
