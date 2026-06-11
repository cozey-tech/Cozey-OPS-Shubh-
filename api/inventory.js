const { Client } = require('pg');

const MODELS_BY_CATEGORY = {
  'Accessories': ['deco-acc'],
  'Bedroom': ['ara-bed', 'bedding', 'cozey-mattress', 'talus'],
  'Chairs': ['mira', 'mistral', 'naos', 'vela'],
  'Dining': ['multi', 'orsa', 'ushi', 'vela'],
  'Rugs': ['rugs', 'rugs-2.5x8', 'rugs-3x5', 'rugs-5x8', 'rugs-8x10', 'rugs-9x12'],
  'Sofas': ['altus', 'atmosphere', 'ciello', 'ciello-1', 'ciello-2', 'ciello-3', 'ciello-xl', 'ciello-xl-3', 'cozey-original', 'gaia', 'gaia-xl', 'luna', 'mistral', 'neptune', 'orian', 'shinuk'],
  'Storage': ['altitude', 'aurora', 'mensa', 'stella', 'theia'],
  'Tables': [],
  'Metal Legs': ['metal-legs'],
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { location = 'royalmount', threshold = 10, quality = 'both', category = 'all', model = 'all', tab = 'lowstock' } = req.query;
  const connectionString = process.env.DATABASE_MCP_URL || process.env.COS_DATABASE_URL;
  if (!connectionString) return res.status(500).json({ error: 'DATABASE_MCP_URL not set' });

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();

    let qualityFilter = `p.quality_id IN ('new', 'refurbished')`;
    if (quality === 'new') qualityFilter = `p.quality_id = 'new'`;
    if (quality === 'refurbished') qualityFilter = `p.quality_id = 'refurbished'`;

    let categoryFilter = '';
    if (category !== 'all') categoryFilter = `AND p.category = '${category.replace(/'/g, "''")}'`;

    let modelFilter = '';
    if (model !== 'all') modelFilter = `AND p.model_name = '${model.replace(/'/g, "''")}'`;

    let locationFilter = `i.location_id = '${location}'`;
    if (location === 'all') locationFilter = `i.location_id IN ('royalmount', 'langley', 'windsor')`;

    if (tab === 'restock') {
      const result = await client.query(`
        SELECT 
          p.sku, p.description, p.model_name, p.quality_id, p.category,
          i.location_id,
          i."onHand" as on_hand,
          i.on_hand_committed as committed,
          i.receiving,
          (i."onHand" - i.on_hand_committed) as available,
          MAX(ih.quantity) FILTER (WHERE ih.reason_code = 'PO Arrived' AND ih.quantity > 0) as last_restock_qty,
          MAX(ih."updatedAt") FILTER (WHERE ih.reason_code = 'PO Arrived' AND ih.quantity > 0) as last_restock_date,
          COUNT(DISTINCT pp.id) FILTER (WHERE pr."createdAt" > NOW() - INTERVAL '30 days') as orders_30d
        FROM mcp.v_inventory i
        JOIN mcp.v_part p ON p.id = i.part_id AND p.region = i.region
        LEFT JOIN mcp.v_inventory_history ih ON ih.inventory_id = i.id AND ih.region = 'CA'
        LEFT JOIN mcp.v_prep_part pp ON pp.part_id = p.id AND pp.region = 'CA'
        LEFT JOIN mcp.v_prep pr ON pr.prep = pp."prepId" AND pr.region = 'CA' AND pr."fulfillmentStatus" = 'Open'
        WHERE ${locationFilter}
          AND i.region = 'CA'
          AND p.disabled = false
          AND ${qualityFilter}
          ${categoryFilter}
          ${modelFilter}
          AND (i."onHand" - i.on_hand_committed) <= ${parseInt(threshold)}
        GROUP BY p.sku, p.description, p.model_name, p.quality_id, p.category, i.location_id, i."onHand", i.on_hand_committed, i.receiving
        ORDER BY available ASC
        LIMIT 200
      `);
      return res.status(200).json({ inventory: result.rows });
    }

    if (tab === 'crossfc') {
      const result = await client.query(`
        SELECT 
          p.sku, p.description, p.model_name, p.quality_id, p.category,
          MAX(CASE WHEN i.location_id = 'royalmount' THEN (i."onHand" - i.on_hand_committed) END) as royalmount,
          MAX(CASE WHEN i.location_id = 'langley' THEN (i."onHand" - i.on_hand_committed) END) as langley,
          MAX(CASE WHEN i.location_id = 'windsor' THEN (i."onHand" - i.on_hand_committed) END) as windsor
        FROM mcp.v_inventory i
        JOIN mcp.v_part p ON p.id = i.part_id AND p.region = i.region
        WHERE i.region = 'CA'
          AND i.location_id IN ('royalmount', 'langley', 'windsor')
          AND p.disabled = false
          AND ${qualityFilter}
          ${categoryFilter}
          ${modelFilter}
        GROUP BY p.sku, p.description, p.model_name, p.quality_id, p.category
        HAVING MIN(
          CASE WHEN i.location_id = 'royalmount' THEN (i."onHand" - i.on_hand_committed) ELSE 999 END
        ) <= ${parseInt(threshold)}
        ORDER BY royalmount ASC NULLS LAST
        LIMIT 200
      `);
      return res.status(200).json({ inventory: result.rows });
    }

    if (tab === 'pos') {
      const result = await client.query(`
        SELECT 
          po.po as po_number,
          po.status,
          po.eta,
          po.location_id,
          po.container,
          po.freight_status,
          po."shippingLine" as shipping_line,
          COUNT(pop.id) as line_items,
          SUM(pop.expected_quantity) as total_units
        FROM mcp.v_purchase_order po
        LEFT JOIN mcp.v_purchase_order_part pop ON pop.po_id = po.id AND pop.region = 'CA'
        WHERE po.region = 'CA'
          AND po.location_id = '${location === 'all' ? 'royalmount' : location}'
          AND po.status NOT IN ('Arrived', 'Cancelled', 'Closed')
        GROUP BY po.po, po.status, po.eta, po.location_id, po.container, po.freight_status, po."shippingLine"
        ORDER BY po.eta ASC NULLS LAST
        LIMIT 50
      `);
      return res.status(200).json({ pos: result.rows });
    }

    // Default: low stock tab
    const result = await client.query(`
      SELECT 
        p.sku, p.description, p.model_name, p.quality_id, p.category,
        i.location_id,
        i."onHand" as on_hand,
        i.on_hand_committed as committed,
        i.receiving,
        (i."onHand" - i.on_hand_committed) as available
      FROM mcp.v_inventory i
      JOIN mcp.v_part p ON p.id = i.part_id AND p.region = i.region
      WHERE ${locationFilter}
        AND i.region = 'CA'
        AND p.disabled = false
        AND ${qualityFilter}
        ${categoryFilter}
        ${modelFilter}
        AND (i."onHand" - i.on_hand_committed) <= ${parseInt(threshold)}
      ORDER BY (i."onHand" - i.on_hand_committed) ASC, p.quality_id, p.model_name
      LIMIT 500
    `);

    res.status(200).json({ inventory: result.rows, models_by_category: MODELS_BY_CATEGORY });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch inventory', details: err.message });
  } finally {
    await client.end().catch(() => {});
  }
};
