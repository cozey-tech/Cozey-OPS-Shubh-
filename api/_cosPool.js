const { Pool } = require('pg');

const STATEMENT_TIMEOUT_MS = 28000;
const RETRY_ATTEMPTS = 2;
const READ_ONLY = /^\s*(SELECT|WITH)\b/i;

function sslFor(url) {
  if (!url || /localhost|127\.0\.0\.1/.test(url) || process.env.PGSSL === 'disable') return false;
  return { rejectUnauthorized: true };
}

let pool = null;

function getCosPool() {
  if (!pool) {
    const url = process.env.DATABASE_MCP_URL || process.env.COS_DATABASE_URL;
    if (!url) throw new Error('DATABASE_MCP_URL not configured');
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
    next.on('error', () => { pool = null; });
    pool = next;
  }
  return pool;
}

function isTransient(err) {
  const code = err && err.code;
  const msg = ((err && err.message) || '').toLowerCase();
  return (
    code === '57P01' || // admin_shutdown
    code === '57P02' || // crash_shutdown
    code === '57P03' || // cannot_connect_now
    msg.includes('connection') ||
    msg.includes('timeout')
  );
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

async function queryCosReadOnly(sql, params = []) {
  if (!READ_ONLY.test(sql)) throw new Error('Only SELECT/WITH queries are allowed');
  let lastErr;
  for (let i = 0; i < RETRY_ATTEMPTS; i++) {
    try {
      return await runQuery(sql, params);
    } catch (err) {
      lastErr = err;
      if (!isTransient(err)) throw err;
      pool = null;
    }
  }
  throw lastErr;
}

module.exports = { queryCosReadOnly };
