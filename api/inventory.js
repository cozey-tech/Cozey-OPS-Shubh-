// GET /api/inventory — all inventory views for the Cozey Ops dashboard.
// READ-ONLY against COS mcp.v_* views via the cos_mcp_reader role.
// All user input is validated against allowlists or clamped before use —
// no string interpolation into SQL.

const { queryCosReadOnly } = require('./_cosPool');
const { applyCors } = require('./_auth');
const { VALID_LOCATIONS, VALID_QUALITY, VALID_CATEGORIES, ALL_MODELS } = require('./_domain');

const VALID_TABS = ['lowstock', 'chart', 'restock', 'crossfc', 'pos'];

// In-memory best-effort cache (per serverless instance).
// The real shared cache is Cache-Control: s-maxage on the CDN layer.
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
  cache.delete(key);
  cache.set(key, { ts: Date.now(), payload });
  while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
}

module.exports = async (req, res) => {
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

    // ── Input validation ───────────────────────────────────────────────────
    let { location = 'royalmount', threshold = '10', quality = 'both',
          category = 'all', model = 'all', tab = 'lowstock', etaFilter = 'all' } = req.query;

    if (!VALID_LOCATIONS.includes(location)) location = 'royalmount';
    if (!VALID_TABS.includes(tab)) tab = 'lowstock';
    if (!VALID_QUALITY.includes(quality)) quality = 'both';
    const thresh = Math.min(100, Math.max(1, parseInt(threshold) || 10));
    const safeCategory = VALID_CATEGORIES.includes(category) ? category : null;
    const safeModel = ALL_MODELS.includes(model) ? model : null;
    const safeEtaFilter = ['all', 'today', 'week', 'next7', 'next30'].includes(etaFilter) ? etaFilter : 'all';

    const cacheKey = `inv-${tab}-${location}-${thresh}-${quality}-${safeCategory}-${safeModel}-${safeEtaFilter}`;
    res.setHeader('Cache-Control', 's-maxage=55, stale-while-revalidate=30');

    const hit = getCached(cacheKey);
    if (hit) return res.status(200).json({ ...hit.payload, stale: false });

    const params = [];

    function qualityClause(alias) {
      if (quality === 'new') { params.push('new'); return `${alias}.quality_id = $${params.length}`; }
      if (quality === 'refurbished') { params.push('refurbished'); return `${alias}.quality_id = $${params.length}`; }
      params.push('new'); params.push('refurbished');
      return `${alias}.quality_id IN ($${params.length - 1}, $${params.length})`;
    }

    // ── LOW STOCK + CHART ──────────────────────────────────────────────────
    // Uses a CTE to compute accurate stats across the FULL dataset before LIMIT,
    // so Flagged/Negative/OOS/Critical/Good counts are never capped at 500.
    if (tab === 'lowstock' || tab === 'chart') {
      params.push(location); const pLoc = params.length;
      params.push(thresh);   const pThresh = params.length;
      const qClause = qualityClause('p');
      let extra = '';
      if (safeCategory) { params.push(safeCategory); extra += ` AND p.category = $${params.length}`; }
      if (safeModel)    { params.push(safeModel);    extra += ` AND p.model_name = $${params.length}`; }

      const rows = await queryCosReadOnly(`
        WITH base AS (
          SELECT
            p.sku, p.description, p.model_name, p.quality_id, p.category,
            i.location_id,
            i."onHand"                          AS on_hand,
            i.on_hand_committed                 AS committed,
            i.receiving,
            (i."onHand" - i.on_hand_committed)  AS available
          FROM mcp.v_inventory i
          JOIN mcp.v_part p ON p.id = i.part_id AND p.region = i.region
          WHERE i.location_id = $${pLoc}
            AND i.region = 'CA'
            AND p.disabled = false
            AND ${qClause}
            ${extra}
            AND (i."onHand" - i.on_hand_committed) <= $${pThresh}
        ),
        stats AS (
          SELECT
            COUNT(*)                                                    AS total_count,
            COUNT(*) FILTER (WHERE available < 0)                      AS negative_count,
            COUNT(*) FILTER (WHERE available = 0)                      AS oos_count,
            COUNT(*) FILTER (WHERE available > 0 AND available <= $${pThresh}) AS critical_count,
            COUNT(*) FILTER (WHERE available >= 10)                    AS good_count
          FROM base
        )
        SELECT b.*, s.total_count, s.negative_count, s.oos_count, s.critical_count, s.good_count
        FROM base b, stats s
        ORDER BY b.available ASC, b.quality_id, b.model_name
        LIMIT 500
      `, params);

      const first = rows[0] || {};
      const payload = {
        inventory: rows,
        stats: {
          total:    parseInt(first.total_count    || 0),
          negative: parseInt(first.negative_count || 0),
          oos:      parseInt(first.oos_count      || 0),
          critical: parseInt(first.critical_count || 0),
          good:     parseInt(first.good_count     || 0),
        },
        totalCount: parseInt(first.total_count || 0),
        truncated: parseInt(first.total_count || 0) > rows.length,
      };
      setCached(cacheKey, payload);
      return res.status(200).json(payload);
    }

    // ── RESTOCK INTEL ──────────────────────────────────────────────────────
    // orders_30d in its own CTE keyed on part_id — avoids join fan-out miscounting.
    // Uses pr."createdAt" (not prepDate which does not exist on v_prep).
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
            AND pr."createdAt" >= NOW() - INTERVAL '30 days'
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
          i."onHand"                          AS on_hand,
          i.on_hand_committed                 AS committed,
          i.receiving,
          (i."onHand" - i.on_hand_committed)  AS available,
          lr.last_restock_date::text,
          COALESCE(d.orders_30d, 0)           AS orders_30d,
          COUNT(*) OVER()                     AS total_count
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
        LIMIT 500
      `, params);

      const totalCount = rows[0]?.total_count ?? rows.length;
      const payload = {
        inventory: rows,
        totalCount: parseInt(totalCount),
        truncated: parseInt(totalCount) > rows.length,
      };
      setCached(cacheKey, payload);
      return res.status(200).json(payload);
    }

    // ── CROSS-FC ───────────────────────────────────────────────────────────
    if (tab === 'crossfc') {
      params.push(thresh); const pThresh = params.length;
      const qClause = qualityClause('p');
      let extra = '';
      if (safeCategory) { params.push(safeCategory); extra += ` AND p.category = $${params.length}`; }
      if (safeModel)    { params.push(safeModel);    extra += ` AND p.model_name = $${params.length}`; }

      const rows = await queryCosReadOnly(`
        WITH base AS (
          SELECT
            p.sku, p.description, p.model_name, p.quality_id, p.category,
            MAX(CASE WHEN i.location_id = 'royalmount' THEN (i."onHand" - i.on_hand_committed) END) AS royalmount,
            MAX(CASE WHEN i.location_id = 'langley'    THEN (i."onHand" - i.on_hand_committed) END) AS langley,
            MAX(CASE WHEN i.location_id = 'windsor'    THEN (i."onHand" - i.on_hand_committed) END) AS windsor
          FROM mcp.v_inventory i
          JOIN mcp.v_part p ON p.id = i.part_id AND p.region = i.region
          WHERE i.region = 'CA'
            AND i.location_id IN ('royalmount', 'langley', 'windsor')
            AND p.disabled = false
            AND ${qClause}
            ${extra}
          GROUP BY p.sku, p.description, p.model_name, p.quality_id, p.category
          HAVING MIN(i."onHand" - i.on_hand_committed) <= $${pThresh}
        )
        SELECT b.*, COUNT(*) OVER() AS total_count
        FROM base b
        ORDER BY royalmount ASC NULLS FIRST
        LIMIT 500
      `, params);

      const totalCount = rows[0]?.total_count ?? rows.length;
      const payload = {
        inventory: rows,
        totalCount: parseInt(totalCount),
        truncated: parseInt(totalCount) > rows.length,
      };
      setCached(cacheKey, payload);
      return res.status(200).json(payload);
    }

    // ── INCOMING POs ───────────────────────────────────────────────────────
    if (tab === 'pos') {
      params.push(location === 'all' ? 'royalmount' : location); const pLoc = params.length;

      // Build ETA filter based on safeEtaFilter
      let etaClause = '';
      if (safeEtaFilter === 'today')  etaClause = `AND DATE(po.eta) = CURRENT_DATE`;
      if (safeEtaFilter === 'week')   etaClause = `AND DATE(po.eta) >= DATE_TRUNC('week', CURRENT_DATE) AND DATE(po.eta) < DATE_TRUNC('week', CURRENT_DATE) + 7`;
      if (safeEtaFilter === 'next7')  etaClause = `AND DATE(po.eta) >= CURRENT_DATE AND DATE(po.eta) <= CURRENT_DATE + 7`;
      if (safeEtaFilter === 'next30') etaClause = `AND DATE(po.eta) >= CURRENT_DATE AND DATE(po.eta) <= CURRENT_DATE + 30`;

      const rows = await queryCosReadOnly(`
        SELECT
          po.po            AS po_number,
          po.status,
          po.eta::text     AS eta,
          po.location_id,
          po.container,
          po.freight_status,
          po."shippingLine" AS shipping_line,
          COUNT(*) OVER()  AS total_count
        FROM mcp.v_purchase_order po
        WHERE po.region = 'CA'
          AND po.location_id = $${pLoc}
          AND po.status NOT IN ('Arrived', 'Cancelled', 'Closed')
          ${etaClause}
        ORDER BY po.eta ASC NULLS LAST
        LIMIT 100
      `, params);

      const totalCount = rows[0]?.total_count ?? rows.length;
      const payload = {
        pos: rows,
        totalCount: parseInt(totalCount),
        truncated: parseInt(totalCount) > rows.length,
      };
      setCached(cacheKey, payload);
      return res.status(200).json(payload);
    }

    return res.status(400).json({ error: 'Unknown tab' });

  } catch (err) {
    console.error('inventory handler error:', err && err.message);
    return res.status(502).json({ error: 'Failed to fetch inventory data' });
  }
};
