// COS production reader. Connects as the cos_mcp_reader role (DATABASE_MCP_URL):
// SELECT-only on the masked mcp.v_* views — the same role/credential the COS
// Database MCP uses. We never write to COS and never touch base tables.
//
// Pattern (mirrors warehouse-dashboard- and the COS Database MCP's pooled
// reader): a singleton pooled connection, verified TLS, a read-only transaction
// with a statement timeout, and transient-error retry. Plain `pg` is used because
// these run as Vercel Node functions against Neon's pooled endpoint.

const { Pool } = require('pg');

const STATEMENT_TIMEOUT_MS = parseInt(process.env.COS_STATEMENT_TIMEOUT_MS, 10) || 15_000;
const RETRY_ATTEMPTS = 2;
const READ_ONLY = /^\s*(SELECT|WITH)\b/i;

// Local Postgres (testing) has no TLS; Neon's cert is publicly trusted so we
// verify it (NO rejectUnauthorized bypass). Set PGSSL=disable only for local dev.
function sslFor(url) {
  if (!url || /localhost|127\.0\.0\.1/.test(url) || process.env.PGSSL === 'disable') return false;
  return { rejectUnauthorized: true };
}

let pool = null;

function getCosPool() {
  if (!pool) {
    const url = process.env.DATABASE_MCP_URL;
    if (!url) throw new Error('DATABASE_MCP_URL not configured');
    const next = new Pool({
      connectionString: url,
      max: 3,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      ssl: sslFor(url),
    });
    next.on('connect', (client) => {
      client.query('SET search_path = mcp, public').catch(() => {});
    });
    next.on('error', () => { pool = null; }); // self-heal on dead socket
    pool = next;
  }
  return pool;
}

function isTransient(err) {
  const code = err && err.code;
  const msg = ((err && err.message) || '').toLowerCase();
  return (
    code === '57P01' || code === '57P02' || code === '57P03' ||
    msg.includes('connection terminated') ||
    msg.includes('connection reset') ||
    msg.includes('econnreset') ||
    msg.includes('socket hang up') ||
    msg.includes('could not connect')
  );
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function queryReadOnlyOnce(sql, params) {
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

async function queryCosReadOnly(sql, params = []) {
  if (!READ_ONLY.test(sql)) throw new Error('Only SELECT/WITH queries are permitted');
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await queryReadOnlyOnce(sql, params);
    } catch (err) {
      if (attempt < RETRY_ATTEMPTS && isTransient(err)) {
        attempt += 1;
        pool = null; // force a fresh socket
        await delay(250 * attempt);
        continue;
      }
      throw err;
    }
  }
}

module.exports = { getCosPool, queryCosReadOnly };
