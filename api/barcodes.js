// GET /api/barcodes — barcode label search for the Cozey Ops dashboard.
// READ-ONLY against COS mcp.v_* views via the cos_mcp_reader role.

const { queryCosReadOnly } = require('./_cosPool');
const { applyCors } = require('./_auth');
const { VALID_CATEGORIES } = require('./_domain');

const VALID_QUALITY = ['new', 'refurbished', 'both'];

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    try { applyCors(res); } catch (_) {}
    return res.status(204).end();
  }

  try {
    applyCors(res);
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    let { search = '', category = 'all', quality = 'new' } = req.query;
    if (!VALID_QUALITY.includes(quality)) quality = 'new';
    const safeSearch = String(search).replace(/[%_]/g, '\\$&').slice(0, 100);
    const safeCategory = VALID_CATEGORIES.includes(category) ? category : null;

    let qualityFilter = `p.quality_id IN ('new', 'refurbished')`;
    if (quality === 'new') qualityFilter = `p.quality_id = 'new'`;
    if (quality === 'refurbished') qualityFilter = `p.quality_id = 'refurbished'`;

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');

    const params = [`%${safeSearch}%`];
    let categoryClause = '';
    if (safeCategory) { params.push(safeCategory); categoryClause = `AND p.category = $${params.length}`; }

    const rows = await queryCosReadOnly(`
      SELECT
        p.sku, p.description, p.model_name, p.category, p.quality_id,
        p."barcodeInteger" AS barcode,
        p.height, p.length, p.width, p.weight,
        p.dimensions_unit, p.weight_unit,
        p."has_printed_barcode" AS has_barcode
      FROM mcp.v_part p
      WHERE p.region = 'CA'
        AND p.disabled = false
        AND ${qualityFilter}
        AND p."barcodeInteger" IS NOT NULL
        AND (p.description ILIKE $1 OR p.sku ILIKE $1 OR p.model_name ILIKE $1)
        ${categoryClause}
      ORDER BY p.model_name, p.description
      LIMIT 50
    `, params);

    return res.status(200).json({ parts: rows });
  } catch (err) {
    console.error('barcodes handler error:', err && err.message);
    return res.status(502).json({ error: 'Failed to fetch barcode data' });
  }
};
