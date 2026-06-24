// GET /api/inventory — all inventory views for the Cozey Ops dashboard.
// READ-ONLY against COS mcp.v_* views via the cos_mcp_reader role.
// All user input is validated against allowlists or clamped before use —
// no string interpolation into SQL.

const { queryCosReadOnly } = require('./_cosPool');
const { applyCors } = require('./_auth');
const { normalizeInventoryQuery, inventoryCacheKey } = require('./_inventoryCache');

// In-memory best-effort cache (per serverless instance).
// The real shared cache is Cache-Control: s-maxage on the CDN layer.
// Bounded with oldest-first eviction so a flood of distinct filter keys cannot
// grow the heap without limit for the life of the serverless instance.
const cache = new Map();
const CACHE_TTL_MS = 55 * 1000;
const MAX_CACHE_ENTRIES = 200;

function getCached(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > CACHE_TTL_MS) { cache.delete(key); return null; }
  return hit;
}

function setCached(key, payload) {
  cache.delete(key); // re-insert at the end so recency = insertion order
  cache.set(key, { ts: Date.now(), payload });
  while (cache.size > MAX_CACHE_ENTRIES) {
    cache.delete(cache.keys().next().value); // evict oldest
  }
}

const handler = async (req, res) => {
  // Handle preflight before anything that might throw.
  if (req.method === 'OPTIONS') {
    try { applyCors(res); } catch (_) {}
    return res.status(204).end();
  }

  try {
    applyCors(res);
  } catch (err) {
    console.error('inventory cors failed:', err && err.message);
    return res.status(500).json({ status: 'error', config: 'misconfigured' });
  }

  try {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    // ── Input validation / allowlisting ────────────────────────────────────
    const { tab, location, thresh, quality, safeCategory, safeModel } = normalizeInventoryQuery(req.query);
    const cacheKey = inventoryCacheKey({ tab, location, thresh, quality, safeCategory, safeModel });
    res.setHeader('Cache-Control', 's-maxage=55, stale-while-revalidate=30');

    const hit = getCached(cacheKey);
    if (hit) return res.status(200).json({ ...hit.payload, stale: false, cachedAt: new Date(hit.ts).toISOString() });

    // ── Build reusable filter clauses (parameterized) ──────────────────────
    const params = [];

    function qualityClause(alias) {
      if (quality === 'new') { params.push('new'); return `${alias}.quality_id = $${params.length}`; }
      if (quality === 'refurbished') { params.push('refurbished'); return `${alias}.quality_id = $${params.length}`; }
      params.push('new'); params.push('refurbished');
      return `${alias}.quality_id IN ($${params.length - 1}, $${params.length})`;
    }

    // ── Tab: low stock ─────────────────────────────────────────────────────
    if (tab === 'lowstock' || tab === 'chart') {
      params.push(location); const pLoc = params.length;
      params.push(thresh);   const pThresh = params.length;
      const qClause = qualityClause('p');
      let extra = '';
      if (safeCategory) { params.push(safeCategory); extra += ` AND p.category = $${params.length}`; }
      if (safeModel)    { params.push(safeModel);    extra += ` AND p.model_name = $${params.length}`; }

      const rows = await queryCosReadOnly(`
        SELECT
          p.sku, p.description, p.model_name, p.quality_id, p.category,
          i.location_id,
          i."onHand"                           AS on_hand,
          i.on_hand_committed                  AS committed,
          i.receiving,
          (i."onHand" - i.on_hand_committed)   AS available,
          COUNT(*) OVER()                      AS total_count
        FROM mcp.v_inventory i
        JOIN mcp.v_part p ON p.id = i.part_id AND p.region = i.region
        WHERE i.location_id = $${pLoc}
          AND i.region = 'CA'
          AND p.disabled = false
          AND ${qClause}
          ${extra}
          AND (i."onHand" - i.on_hand_committed) <= $${pThresh}
        ORDER BY (i."onHand" - i.on_hand_committed) ASC, p.quality_id, p.model_name
        LIMIT 500
      `, params);

      const totalCount = rows[0]?.total_count ?? rows.length;
      const truncated = parseInt(totalCount) > rows.length;
      const payload = { inventory: rows, totalCount: parseInt(totalCount), truncated };
      setCached(cacheKey, payload);
      return res.status(200).json(payload);
    }

    // ── Tab: restock intel ─────────────────────────────────────────────────
    // orders_30d uses a separate CTE to avoid join fan-out miscounting.
    if (tab === 'restock') {
      params.push(location); const pLoc = params.length;
      params.push(thresh);   const pThresh = params.length;
      const qClause = qualityClause('p');
      let extra = '';
      if (safeCategory) { params.push(safeCategory); extra += ` AND p.category = $${params.length}`; }
      if (safeModel)    { params.push(safeModel);    extra += ` AND p.model_name = $${params.length}`; }

      const rows = await queryCosReadOnly(`
        WITH demand AS (
          SELECT pp.part_id, COUNT(DISTINCT pp."prepId") AS orders_30d
          FROM mcp.v_prep_part pp
          JOIN mcp.v_prep pr ON pr.prep = pp."prepId" AND pr.region = 'CA'
          WHERE pp.region = 'CA'
            AND pr."fulfillmentStatus" = 'Open'
            AND pr."prepDate" >= NOW() - INTERVAL '30 days'
          GROUP BY pp.part_id
        ),
        last_restock AS (
          SELECT ih.inventory_id,
            MAX(ih."updatedAt") FILTER (WHERE ih.reason_code = 'PO Arrived' AND ih.quantity > 0) AS last_restock_date
          FROM mcp.v_inventory_history ih
          WHERE ih.region = 'CA'
          GROUP BY ih.inventory_id
        )
        SELECT
          p.sku, p.description, p.model_name, p.quality_id, p.category,
          i.location_id,
          i."onHand"                           AS on_hand,
          i.on_hand_committed                  AS committed,
          i.receiving,
          (i."onHand" - i.on_hand_committed)   AS available,
          lr.last_restock_date,
          COALESCE(d.orders_30d, 0)            AS orders_30d,
          COUNT(*) OVER()                      AS total_count
        FROM mcp.v_inventory i
        JOIN mcp.v_part p ON p.id = i.part_id AND p.region = i.region
        LEFT JOIN last_restock lr ON lr.inventory_id = i.id
        LEFT JOIN demand d ON d.part_id = p.id
        WHERE i.location_id = $${pLoc}
          AND i.region = 'CA'
          AND p.disabled = false
          AND ${qClause}
          ${extra}
          AND (i."onHand" - i.on_hand_committed) <= $${pThresh}
        ORDER BY (i."onHand" - i.on_hand_committed) ASC
        LIMIT 200
      `, params);

      const totalCount = rows[0]?.total_count ?? rows.length;
      const payload = { inventory: rows, totalCount: parseInt(totalCount), truncated: parseInt(totalCount) > rows.length };
      setCached(cacheKey, payload);
      return res.status(200).json(payload);
    }

    // ── Tab: cross-FC ──────────────────────────────────────────────────────
    // Fixed: removed the sentinel ELSE 999 which hid SKUs with no Royalmount row.
    if (tab === 'crossfc') {
      params.push(thresh); const pThresh = params.length;
      const qClause = qualityClause('p');
      let extra = '';
      if (safeCategory) { params.push(safeCategory); extra += ` AND p.category = $${params.length}`; }
      if (safeModel)    { params.push(safeModel);    extra += ` AND p.model_name = $${params.length}`; }

      const rows = await queryCosReadOnly(`
        SELECT
          p.sku, p.description, p.model_name, p.quality_id, p.category,
          MAX(CASE WHEN i.location_id = 'royalmount' THEN (i."onHand" - i.on_hand_committed) END) AS royalmount,
          MAX(CASE WHEN i.location_id = 'langley'    THEN (i."onHand" - i.on_hand_committed) END) AS langley,
          MAX(CASE WHEN i.location_id = 'windsor'    THEN (i."onHand" - i.on_hand_committed) END) AS windsor,
          COUNT(*) OVER()                                                                          AS total_count
        FROM mcp.v_inventory i
        JOIN mcp.v_part p ON p.id = i.part_id AND p.region = i.region
        WHERE i.region = 'CA'
          AND i.location_id IN ('royalmount', 'langley', 'windsor')
          AND p.disabled = false
          AND ${qClause}
          ${extra}
        GROUP BY p.sku, p.description, p.model_name, p.quality_id, p.category
        HAVING MIN(i."onHand" - i.on_hand_committed) <= $${pThresh}
        ORDER BY royalmount ASC NULLS FIRST
        LIMIT 200
      `, params);

      const totalCount = rows[0]?.total_count ?? rows.length;
      const payload = { inventory: rows, totalCount: parseInt(totalCount), truncated: parseInt(totalCount) > rows.length };
      setCached(cacheKey, payload);
      return res.status(200).json(payload);
    }

    // ── Tab: incoming POs ──────────────────────────────────────────────────
    if (tab === 'pos') {
      params.push(location === 'all' ? 'royalmount' : location); const pLoc = params.length;

      const rows = await queryCosReadOnly(`
        SELECT
          po.po          AS po_number,
          po.status,
          po.eta::text   AS eta,
          po.location_id,
          po.container,
          po.freight_status,
          po."shippingLine" AS shipping_line,
          COUNT(*) OVER() AS total_count
        FROM mcp.v_purchase_order po
        WHERE po.region = 'CA'
          AND po.location_id = $${pLoc}
          AND po.status NOT IN ('Arrived', 'Cancelled', 'Closed')
        ORDER BY po.eta ASC NULLS LAST
        LIMIT 100
      `, params);

      const totalCount = rows[0]?.total_count ?? rows.length;
      const payload = { pos: rows, totalCount: parseInt(totalCount), truncated: parseInt(totalCount) > rows.length };
      setCached(cacheKey, payload);
      return res.status(200).json(payload);
    }

    return res.status(400).json({ error: 'Unknown tab' });

  } catch (err) {
    console.error('inventory handler error:', err && err.message);
    // Serve stale cache on error rather than returning nothing.
    const hit = getCached(inventoryCacheKey(normalizeInventoryQuery(req.query)));
    if (hit) {
      return res.status(200).json({
        ...hit.payload,
        stale: true,
        cachedAt: new Date(hit.ts).toISOString(),
      });
    }
    return res.status(502).json({ error: 'Failed to fetch inventory data' });
  }
};

module.exports = handler;
