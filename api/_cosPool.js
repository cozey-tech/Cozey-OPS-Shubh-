// Shared COS read-only connection pool.
// Mirrors the canonical cozey-tech/warehouse-dashboard- implementation.
// A singleton pg.Pool with verified TLS, BEGIN READ ONLY, statement_timeout,
// transient-error retry, and a SELECT/WITH-only guard.
//
// DATABASE_MCP_URL must point at the Neon POOLED endpoint (-pooler host).
// That is what makes the singleton pool safe under serverless fan-out.

const { Pool } = require('pg');

// Match canonical: 15 s. Keep below functions.maxDuration (30 s in vercel.json).
const STATEMENT_TIMEOUT_MS = 15000;
const RETRY_ATTEMPTS = 2;
const READ_ONLY = /^\s*(SELECT|WITH)\b/i;

// Postgres transient error codes:
// 57P01 = admin_shutdown (server is shutting down)
// 57P02 = crash_shutdown (server crashed)
// 57P03 = cannot_connect_now (server starting up)
// 53300 = too_many_connections (connection limit hit — treat as transient)
function isTransient(err) {
  const code = err && err.code;
  const msg = ((err && err.message) || '').toLowerCase();
  return (
    code === '57P01' ||
    code === '57P02' ||
    code === '57P03' ||
    code === '53300' ||
    msg.includes('connection') ||
    msg.includes('timeout')
  );
}

// Use verified TLS for Neon (publicly trusted cert).
// Set PGSSL=disable only for local Postgres which has no TLS.
function sslFor(url) {
  if (!url || /localhost|127\.0\.0\.1/.test(url) || process.env.PGSSL === 'disable') return false;
  return { rejectUnauthorized: true };
}

let pool = null;

function getCosPool() {
  if (!pool) {
    // New deployments must set DATABASE_MCP_URL (the Neon pooled endpoint).
    const url = process.env.DATABASE_MCP_URL;
    if (!url) throw new Error('DATABASE_MCP_URL is not configured');
    const next = new Pool({
      connectionString: url,
      // max: 1 is safe here — each serverless invocation runs one query at a time.
      max: 1,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
      ssl: sslFor(url),
    });
    next.on('connect', (client) => {
      client.query('SET search_path = mcp, public').catch(() => {});
    });
    // Self-heal on dead socket.
    next.on('error', () => { pool = null; });
    pool = next;
  }
  return pool;
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runQuery(sql, params) {
  const client = await getCosPool().connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
    const { rows } = await client.query(sql, params);
    await client.query('COMMIT');
    return rows;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// queryCosReadOnly — the only public function.
// Guards against non-SELECT statements and retries on transient errors.
async function queryCosReadOnly(sql, params = []) {
  if (!READ_ONLY.test(sql)) throw new Error('Only SELECT/WITH queries are allowed');
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await runQuery(sql, params);
    } catch (err) {
      if (attempt < RETRY_ATTEMPTS && isTransient(err)) {
        attempt += 1;
        pool = null; // force reconnect on next attempt
        await delay(250 * attempt);
        continue;
      }
      throw err;
    }
  }
}

module.exports = { queryCosReadOnly };
