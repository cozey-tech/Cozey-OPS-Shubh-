// GET /api/meta — exposes domain constants to the frontend so allowlists
// live in one place (api/_domain.js) rather than being duplicated in src/App.js.
const { applyCors } = require('./_auth');
const { VALID_LOCATIONS, VALID_CATEGORIES, MODELS_BY_CATEGORY } = require('./_domain');

module.exports = async (req, res) => {
  try {
    applyCors(res);
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=60');
    return res.status(200).json({ locations: VALID_LOCATIONS, categories: VALID_CATEGORIES, modelsByCategory: MODELS_BY_CATEGORY });
  } catch (err) {
    console.error('meta handler error:', err && err.message);
    return res.status(500).json({ error: 'Server misconfigured' });
  }
};
