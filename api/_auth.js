// Shared request helpers: CORS scoping + (optional) server-side office-secret.
//
// This dashboard's API is READ-ONLY. The real access gate for production is
// Vercel Deployment Protection (password/SSO) on the deployment — see README.
// `applyCors` scopes the browser origin (no more "*"). `isOffice` is provided
// for any future write endpoints and is a LIGHT check only.

const crypto = require('crypto');

function applyCors(res) {
  const origin = process.env.DASHBOARD_ORIGIN || '';
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-office-key');
}

// Timing-safe comparison of the provided office key against OFFICE_SECRET.
function isOffice(req) {
  const secret = process.env.OFFICE_SECRET;
  if (!secret) return false; // fail closed if unconfigured
  const provided = req.headers['x-office-key'] || '';
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(secret));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { applyCors, isOffice };
