// GET /api/health — liveness probe for monitoring.
// Runs a lightweight SELECT 1 against the pool and reports DB reachability.

const { queryCosReadOnly } = require('./_cosPool');
const { applyCors } = require('./_auth');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    try { applyCors(res); } catch (_) {}
    return res.status(204).end();
  }

  try {
    applyCors(res);
    const start = Date.now();
    await queryCosReadOnly('SELECT 1', []);
    return res.status(200).json({ status: 'ok', db: 'reachable', latencyMs: Date.now() - start });
  } catch (err) {
    console.error('health check failed:', err && err.message);
    return res.status(503).json({ status: 'error', db: 'unreachable' });
  }
};
