const crypto = require('crypto');

// This dashboard's API is READ-ONLY.
// The real access gate for production is Vercel Deployment Protection.
// applyCors scopes the browser origin. isOffice is for any future write endpoints.

function applyCors(res) {
  const origin = process.env.DASHBOARD_ORIGIN || '';
  if (!origin) {
    console.error('DASHBOARD_ORIGIN is not set — CORS will block all browser requests');
  }
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-office-key');
}

function isOffice(req) {
  const secret = process.env.OFFICE_SECRET;
  if (!secret) return false;
  const provided = req.headers['x-office-key'] || '';
  try {
    return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
  } catch {
    return false;
  }
}

module.exports = { applyCors, isOffice };
