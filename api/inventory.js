// GET /api/inventory — low-stock / restock / PO / cross-FC views over COS.
// Read-only via cos_mcp_reader (masked mcp.v_* views). All user input is bound
// as query parameters or validated against allowlists — never string-interpolated
// into SQL. Results are cached server-side so many polling clients collapse to
// roughly one query per minute per distinct view.
//
// Access gate in production: Vercel Deployment Protection (see README) + CORS
// scoped to DASHBOARD_ORIGIN. This endpoint never writes.

const { queryCosReadOnly } = require('./_cosPool');
const { applyCors } = require('./_auth');

const REGION = process.env.FC_REGION || 'CA';
const CACHE_MS = parseInt(process.env.INVENTORY_CACHE_MS, 10) || 55_000;

const LOCATIONS = ['royalmount', 'langley', 'windsor'];
const QUALITIES = ['both', 'new', 'refurbished'];
const CATEGORIES = ['Accessories', 'Bedroom', 'Chairs', 'Dining', 'Metal Legs', 'Rugs', 'Sofas', 'Storage', 'Tables'];
const TABS = ['lowstock', 'restock', 'chart', 'pos', 'crossfc'];
const MODEL_RE = /^[A-Za-z0-9.\- ]{1,40}$/; // model_name shape guard (values are also bound as params)

// --- input validation: every value is either allowlisted or clamped ---
function parseParams(q) {
  const location = LOCATIONS.includes(q.location) || q.location === 'all' ? q.location : 'royalmount';
  const quality = QUALITIES.includes(q.quality) ? q.quality : 'both';
  const category = q.category === 'all' || CATEGORIES.includes(q.category) ? q.category : 'all';
  const model = q.model && q.model !== 'all' && MODEL_RE.test(q.model) ? q.model : 'all';
  let tab = TABS.includes(q.tab) ? q.tab : 'lowstock';
  if (tab === 'chart') tab = 'lowstock'; // chart renders client-side from lowstock data
  let threshold = parseInt(q.threshold, 10);
  if (!Number.isFinite(threshold) || threshold < 1) threshold = 10;
  if (threshold > 100) threshold = 100;
  return { location, quality, category, model, tab, threshold };
}

// Appends quality/category/model predicates as bound params. Quality "both"
// is a SQL constant (no user value), so it is never parameterized.
function appendFilters(params, { quality, category, model }) {
  let sql = '';
  if (quality === 'new' || quality === 'refurbished') {
    params.push(quality);
    sql += ` AND p.quality_id = $${params.length}`;
  } else {
    sql += ` AND p.quality_id IN ('new', 'refurbished')`;
  }
  if (category !== 'all') {
    params.push(category);
    sql += ` AND p.category = $${params.length}`;
  }
  if (model !== 'all') {
    params.push(model);
    sql += ` AND p.model_name = $${params.length}`;
  }
  return sql;
}

async function runQuery({ location, quality, category, model, tab, threshold }) {
  if (tab === 'restock') {
    const params = [REGION];
    let where = `i.region = $1 AND p.disabled = false`;
    where += appendFilters(params, { quality, category, model });
    if (location === 'all') {
      where += ` AND i.location_id IN ('royalmount', 'langley', 'windsor')`;
    } else {
      params.push(location);
      where += ` AND i.location_id = $${params.length}`;
    }
    params.push(threshold);
    where += ` AND (i."onHand" - i.on_hand_committed) <= $${params.length}`;
    const rows = await queryCosReadOnly(
      `SELECT
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
        LEFT JOIN mcp.v_inventory_history ih ON ih.inventory_id = i.id AND ih.region = $1
        LEFT JOIN mcp.v_prep_part pp ON pp.part_id = p.id AND pp.region = $1
        LEFT JOIN mcp.v_prep pr ON pr.prep = pp."prepId" AND pr.region = $1 AND pr."fulfillmentStatus" = 'Open'
        WHERE ${where}
        GROUP BY p.sku, p.description, p.model_name, p.quality_id, p.category, i.location_id, i."onHand", i.on_hand_committed, i.receiving
        ORDER BY available ASC
        LIMIT 200`,
      params,
    );
    return { inventory: rows };
  }

  if (tab === 'crossfc') {
    const params = [REGION];
    let where = `i.region = $1
        AND i.location_id IN ('royalmount', 'langley', 'windsor')
        AND p.disabled = false`;
    where += appendFilters(params, { quality, category, model });
    params.push(threshold);
    const rows = await queryCosReadOnly(
      `SELECT
          p.sku, p.description, p.model_name, p.quality_id, p.category,
          MAX(CASE WHEN i.location_id = 'royalmount' THEN (i."onHand" - i.on_hand_committed) END) as royalmount,
          MAX(CASE WHEN i.location_id = 'langley' THEN (i."onHand" - i.on_hand_committed) END) as langley,
          MAX(CASE WHEN i.location_id = 'windsor' THEN (i."onHand" - i.on_hand_committed) END) as windsor
        FROM mcp.v_inventory i
        JOIN mcp.v_part p ON p.id = i.part_id AND p.region = i.region
        WHERE ${where}
        GROUP BY p.sku, p.description, p.model_name, p.quality_id, p.category
        HAVING MIN(
          CASE WHEN i.location_id = 'royalmount' THEN (i."onHand" - i.on_hand_committed) ELSE 999 END
        ) <= $${params.length}
        ORDER BY royalmount ASC NULLS LAST
        LIMIT 200`,
      params,
    );
    return { inventory: rows };
  }

  if (tab === 'pos') {
    const loc = location === 'all' ? 'royalmount' : location;
    const rows = await queryCosReadOnly(
      `SELECT
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
        LEFT JOIN mcp.v_purchase_order_part pop ON pop.po_id = po.id AND pop.region = $1
        WHERE po.region = $1
          AND po.location_id = $2
          AND po.status NOT IN ('Arrived', 'Cancelled', 'Closed')
        GROUP BY po.po, po.status, po.eta, po.location_id, po.container, po.freight_status, po."shippingLine"
        ORDER BY po.eta ASC NULLS LAST
        LIMIT 50`,
      [REGION, loc],
    );
    return { pos: rows };
  }

  // Default: low stock tab
  const params = [REGION];
  let where = `i.region = $1 AND p.disabled = false`;
  where += appendFilters(params, { quality, category, model });
  if (location === 'all') {
    where += ` AND i.location_id IN ('royalmount', 'langley', 'windsor')`;
  } else {
    params.push(location);
    where += ` AND i.location_id = $${params.length}`;
  }
  params.push(threshold);
  where += ` AND (i."onHand" - i.on_hand_committed) <= $${params.length}`;
  const rows = await queryCosReadOnly(
    `SELECT
        p.sku, p.description, p.model_name, p.quality_id, p.category,
        i.location_id,
        i."onHand" as on_hand,
        i.on_hand_committed as committed,
        i.receiving,
        (i."onHand" - i.on_hand_committed) as available
      FROM mcp.v_inventory i
      JOIN mcp.v_part p ON p.id = i.part_id AND p.region = i.region
      WHERE ${where}
      ORDER BY (i."onHand" - i.on_hand_committed) ASC, p.quality_id, p.model_name
      LIMIT 500`,
    params,
  );
  return { inventory: rows };
}

// Server-side cache: shared across all clients so polling collapses to ~1
// query/min per distinct view. Keyed by the validated params.
const cache = new Map();

function pruneCache(now) {
  if (cache.size <= 100) return;
  for (const [k, v] of cache) {
    if (now - v.at > CACHE_MS) cache.delete(k);
  }
}

module.exports = async (req, res) => {
  applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const params = parseParams(req.query || {});
  const key = JSON.stringify(params);
  const now = Date.now();

  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) {
    res.setHeader('Cache-Control', 's-maxage=55, stale-while-revalidate=30');
    return res.status(200).json({ ...hit.payload, cached: true });
  }

  try {
    const payload = await runQuery(params);
    cache.set(key, { at: now, payload });
    pruneCache(now);
    res.setHeader('Cache-Control', 's-maxage=55, stale-while-revalidate=30');
    res.status(200).json(payload);
  } catch (err) {
    console.error('inventory query failed:', err && err.message);
    if (hit) return res.status(200).json({ ...hit.payload, stale: true }); // serve stale on error
    res.status(502).json({ error: 'Failed to fetch inventory' });
  }
};
