const { queryCosReadOnly } = require('./_cosPool');
const { applyCors } = require('./_auth');

const VALID_CATEGORIES = ['Accessories', 'Bedroom', 'Chairs', 'Dining', 'Metal Legs', 'Rugs', 'Sofas', 'Storage', 'Tables'];
const VALID_QUALITY = ['new', 'refurbished', 'both'];

module.exports = async (req, res) => {
  applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  let { search = '', category = 'all', quality = 'new' } = req.query;

  if (!VALID_QUALITY.includes(quality)) quality = 'new';
  const safeSearch = String(search).replace(/[%_]/g, '\\$&').slice(0, 100);
  const safeCategory = VALID_CATEGORIES.includes(category) ? category : null;

  let qualityFilter = `p.quality_id IN ('new', 'refurbished')`;
  if (quality === 'new') qualityFilter = `p.quality_id = 'new'`;
  if (quality === 'refurbished') qualityFilter = `p.quality_id = 'refurbished'`;

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');

  try {
    const params = [`%${safeSearch}%`];
    let categoryClause = '';
    if (safeCategory) {
      params.push(safeCategory);
      categoryClause = `AND p.category = $${params.length}`;
    }

    const rows = await queryCosReadOnly(`
      SELECT 
        p.sku,
        p.description,
        p.model_name,
        p.category,
        p.quality_id,
        p."barcodeInteger" as barcode,
        p.height,
        p.length,
        p.width,
        p.weight,
        p.dimensions_unit,
        p.weight_unit,
        p."has_printed_barcode" as has_barcode
      FROM mcp.v_part p
      WHERE p.region = 'CA'
        AND p.disabled = false
        AND ${qualityFilter}
        AND p."barcodeInteger" IS NOT NULL
        AND (
          p.description ILIKE $1
          OR p.sku ILIKE $1
          OR p.model_name ILIKE $1
        )
        ${categoryClause}
      ORDER BY p.model_name, p.description
      LIMIT 50
    `, params);

    return res.status(200).json({ parts: rows });
  } catch (err) {
    console.error('Barcode query failed:', err?.message);
    return res.status(502).json({ error: 'Failed to fetch barcode data' });
  }
};
