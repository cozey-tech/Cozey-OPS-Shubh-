const { Client } = require('pg');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { location = 'royalmount', threshold = 10, quality = 'both', category = 'all' } = req.query;

  const connectionString = process.env.DATABASE_MCP_URL || process.env.COS_DATABASE_URL;
  if (!connectionString) return res.status(500).json({ error: 'DATABASE_MCP_URL not set' });

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();

    let qualityFilter = `p.quality_id IN ('new', 'refurbished')`;
    if (quality === 'new') qualityFilter = `p.quality_id = 'new'`;
    if (quality === 'refurbished') qualityFilter = `p.quality_id = 'refurbished'`;

    let categoryFilter = '';
    if (category !== 'all') categoryFilter = `AND p.category = $2`;

    const params = [location];
    if (category !== 'all') params.push(category);

    const result = await client.query(`
      SELECT 
        p.sku,
        p.description,
        p.model_name,
        p.quality_id,
        p.category,
        i."onHand" as on_hand,
        i.on_hand_committed as committed,
        i.receiving,
        (i."onHand" - i.on_hand_committed) as available
      FROM mcp.v_inventory i
      JOIN mcp.v_part p ON p.id = i.part_id AND p.region = i.region
      WHERE i.location_id = $1
        AND i.region = 'CA'
        AND p.disabled = false
        AND ${qualityFilter}
        ${categoryFilter}
      ORDER BY (i."onHand" - i.on_hand_committed) ASC, p.quality_id, p.model_name
      LIMIT 500
    `, params);

    const thresholdNum = parseInt(threshold);
    const filtered = result.rows.filter(r => r.available <= thresholdNum);

    res.status(200).json({ inventory: filtered, total: filtered.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch inventory', details: err.message });
  } finally {
    await client.end().catch(() => {});
  }
};
