// Shared COS read-only connection pool.
// Mirrors the conventions in cozey-tech/warehouse-dashboard-.
// A singleton pg.Pool with verified TLS, BEGIN READ ONLY, statement_timeout,
// transient-error retry, and a SELECT/WITH-only guard.

const { Pool } = require('pg');

const STATEMENT_TIMEOUT_MS = 28000;
const RETRY_ATTEMPTS = 2;
const READ_ONLY = /^\s*(SELECT|WITH)\b/i;

// Postgres transient error codes:
// 57P01 = admin_shutdown (server is shutting down)
// 57P02 = crash_shutdown (server crashed)
// 57P03 = cannot_connect_now (server starting up)
function isTransient(err) {
  const code = err && err.code;
  const msg = ((err && err.message) || '').toLowerCase();
  return (
    code === '57P01' ||
    code === '57P02' ||
    code === '57P03' ||
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
    // New deployments must set DATABASE_MCP_URL.
    const url = process.env.DATABASE_MCP_URL;
    if (!url) throw new Error('DATABASE_MCP_URL is not configured');
    const next = new Pool({
      connectionString: url,
      max: 3,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
      ssl: sslFor(url),
    });
    next.on('connect', (client) => {
      client.query('SET search_path = mcp, public').catch(() => {});
    });
    // Self-heal on dead socket
    next.on('error', () => { pool = null; });
    pool = next;
  }
  return pool;
}

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
  let lastErr;
  for (let i = 0; i < RETRY_ATTEMPTS; i++) {
    try {
      return await runQuery(sql, params);
    } catch (err) {
      lastErr = err;
      if (!isTransient(err)) throw err;
      pool = null; // force reconnect on next attempt
    }
  }
  throw lastErr;
}

module.exports = { queryCosReadOnly };
