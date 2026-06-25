// GET /api/productivity — pack/label scan views for the Cozey Ops dashboard.
// READ-ONLY against COS mcp.v_* views via the cos_mcp_reader role.
//
// Note: v_pnp_packing_compliance has no region column — region is scoped
// through the join chain: ppi → pp → pr (v_prep), which has location_id + region.

const { queryCosReadOnly } = require('./_cosPool');
const { applyCors } = require('./_auth');
const { VALID_LOCATIONS } = require('./_domain');

const VALID_TABS = ['pack', 'label', 'leaderboard', 'orderlookup', 'packtime',
                    'notscanned', 'weekly', 'scantrend', 'prepdrilldown'];

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
    console.error('productivity cors failed:', err && err.message);
    return res.status(500).json({ status: 'error', config: 'misconfigured' });
  }

  try {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    let { location = 'royalmount', tab = 'pack', dateFrom, dateTo, order, prep } = req.query;
    if (!VALID_LOCATIONS.includes(location)) location = 'royalmount';
    if (!VALID_TABS.includes(tab)) tab = 'pack';

    // Date range: default to last 7 days if not provided
    const today = new Date().toISOString().split('T')[0];
    const sevenDaysAgo = new Date(Date.now() - 6 * 86400000).toISOString().split('T')[0];
    const fourteenDaysAgo = new Date(Date.now() - 13 * 86400000).toISOString().split('T')[0];
    let safeFrom = /^\d{4}-\d{2}-\d{2}$/.test(dateFrom) ? dateFrom : sevenDaysAgo;
    let safeTo   = /^\d{4}-\d{2}-\d{2}$/.test(dateTo)   ? dateTo   : today;
    if (tab === 'scantrend') {
      safeFrom = fourteenDaysAgo;
      safeTo = today;
    }

    res.setHeader('Cache-Control', 's-maxage=55, stale-while-revalidate=30');

    const cacheKey = `prod-${tab}-${location}-${safeFrom}-${safeTo}`;
    const hit = getCached(cacheKey);
    if (hit && tab !== 'orderlookup' && tab !== 'prepdrilldown') {
      return res.status(200).json({ ...hit.payload, stale: false });
    }

    // ── PACK SCANS ─────────────────────────────────────────────────────────
    if (tab === 'pack') {
      const rows = await queryCosReadOnly(`
        SELECT
          u.name,
          COUNT(ppc.id) FILTER (WHERE ppc.packing_scan_method = 'SCANNER') AS scanner_scans,
          COUNT(ppc.id) FILTER (WHERE ppc.packing_scan_method = 'MANUAL')  AS manual_scans,
          COUNT(ppc.id)                                                     AS total_scans
        FROM mcp.v_pnp_packing_compliance ppc
        JOIN mcp.v_users u ON u.id = ppc.packed_by_user_id AND u.region = 'CA'
        JOIN mcp.v_prep_part_item ppi ON ppi.id = ppc.prep_part_item_id AND ppi.region = 'CA'
        JOIN mcp.v_prep_part pp ON pp.id = ppi."prepPartId" AND pp.region = 'CA'
        JOIN mcp.v_prep p ON p.prep = pp."prepId" AND p.region = 'CA'
        WHERE p.location_id = $1
          AND p.region = 'CA'
          AND DATE(ppc.created_at) BETWEEN $2 AND $3
        GROUP BY u.name
        ORDER BY total_scans DESC
        LIMIT 20
      `, [location, safeFrom, safeTo]);
      const payload = { data: rows };
      setCached(cacheKey, payload);
      return res.status(200).json(payload);
    }

    // ── LABEL SCANS ────────────────────────────────────────────────────────
    if (tab === 'label') {
      const rows = await queryCosReadOnly(`
        SELECT
          u.name,
          COUNT(ppi.id) FILTER (WHERE ppi.label_scan_method = 'SCANNER') AS scanner_scans,
          COUNT(ppi.id) FILTER (WHERE ppi.label_scan_method = 'MANUAL')  AS manual_scans,
          COUNT(ppi.id)                                                   AS total_scans
        FROM mcp.v_prep_part_item ppi
        JOIN mcp.v_users u ON u.id = ppi.label_scanned_by_user_id AND u.region = 'CA'
        JOIN mcp.v_prep_part pp ON pp.id = ppi."prepPartId" AND pp.region = 'CA'
        JOIN mcp.v_prep p ON p.prep = pp."prepId" AND p.region = 'CA'
        WHERE p.location_id = $1
          AND p.region = 'CA'
          AND DATE(ppi.label_scanned_at) BETWEEN $2 AND $3
        GROUP BY u.name
        ORDER BY total_scans DESC
        LIMIT 20
      `, [location, safeFrom, safeTo]);
      const payload = { data: rows };
      setCached(cacheKey, payload);
      return res.status(200).json(payload);
    }

    // ── LEADERBOARD ────────────────────────────────────────────────────────
    if (tab === 'leaderboard') {
      const [pack, label] = await Promise.all([
        queryCosReadOnly(`
          SELECT u.name, COUNT(ppc.id) AS total_scans,
            ROUND(COUNT(ppc.id) FILTER (WHERE ppc.packing_scan_method = 'SCANNER')::numeric / NULLIF(COUNT(ppc.id),0) * 100) AS scanner_pct
          FROM mcp.v_pnp_packing_compliance ppc
          JOIN mcp.v_users u ON u.id = ppc.packed_by_user_id AND u.region = 'CA'
          JOIN mcp.v_prep_part_item ppi ON ppi.id = ppc.prep_part_item_id AND ppi.region = 'CA'
          JOIN mcp.v_prep_part pp ON pp.id = ppi."prepPartId" AND pp.region = 'CA'
          JOIN mcp.v_prep p ON p.prep = pp."prepId" AND p.region = 'CA'
          WHERE p.location_id = $1 AND p.region = 'CA'
            AND DATE(ppc.created_at) BETWEEN $2 AND $3
          GROUP BY u.name ORDER BY total_scans DESC LIMIT 5
        `, [location, safeFrom, safeTo]),
        queryCosReadOnly(`
          SELECT u.name, COUNT(ppi.id) AS total_scans,
            ROUND(COUNT(ppi.id) FILTER (WHERE ppi.label_scan_method = 'SCANNER')::numeric / NULLIF(COUNT(ppi.id),0) * 100) AS scanner_pct
          FROM mcp.v_prep_part_item ppi
          JOIN mcp.v_users u ON u.id = ppi.label_scanned_by_user_id AND u.region = 'CA'
          JOIN mcp.v_prep_part pp ON pp.id = ppi."prepPartId" AND pp.region = 'CA'
          JOIN mcp.v_prep p ON p.prep = pp."prepId" AND p.region = 'CA'
          WHERE p.location_id = $1 AND p.region = 'CA'
            AND DATE(ppi.label_scanned_at) BETWEEN $2 AND $3
          GROUP BY u.name ORDER BY total_scans DESC LIMIT 5
        `, [location, safeFrom, safeTo]),
      ]);
      const payload = { packers: pack, labelers: label };
      setCached(cacheKey, payload);
      return res.status(200).json(payload);
    }

    // ── ORDER LOOKUP ───────────────────────────────────────────────────────
    // shopifyOrderNumber in COS is a short number like "369427" — not a 13-digit ID.
    // Join uses o."shopifyOrderId" = pr.order_id (not o.id).
    // ppi.region = 'CA' is required — without it no rows are returned.
    // DISTINCT ON (p2.sku, ppi.label_scan_method) deduplicates multiple scans per box.
    if (tab === 'orderlookup') {
      if (!order) return res.status(400).json({ error: 'order parameter required' });
      const orderNum = String(order).replace(/\D/g, '').slice(0, 20);
      const rows = await queryCosReadOnly(`
        SELECT DISTINCT ON (p2.sku, ppi.label_scan_method)
          p2.sku,
          p2.description,
          ppi.label_scan_method,
          u.name              AS labeled_by,
          ppi.label_scanned_at::text AS labeled_at
        FROM mcp.v_prep_part_item ppi
        JOIN mcp.v_prep_part pp ON pp.id = ppi."prepPartId" AND pp.region = 'CA'
        JOIN mcp.v_part p2 ON p2.id = pp.part_id AND p2.region = 'CA'
        JOIN mcp.v_prep pr ON pr.prep = pp."prepId" AND pr.region = 'CA'
        JOIN mcp.v_order o ON o."shopifyOrderId" = pr.order_id AND o.region = 'CA'
        LEFT JOIN mcp.v_users u ON u.id = ppi.label_scanned_by_user_id AND u.region = 'CA'
        WHERE o."shopifyOrderNumber" = $1
          AND ppi.region = 'CA'
        ORDER BY p2.sku, ppi.label_scan_method, ppi.label_scanned_at DESC
        LIMIT 50
      `, [orderNum]);
      return res.status(200).json({ data: rows });
    }

    // ── PACK TIME BY PRODUCT ───────────────────────────────────────────────
    // v_pnp_packing_compliance updated_at never differs from created_at in COS,
    // so we show top products by pack scan volume instead — equally useful for ops.
    if (tab === 'packtime') {
      const rows = await queryCosReadOnly(`
        SELECT
          p2.model_name,
          p2.description,
          COUNT(ppc.id)  AS scan_count
        FROM mcp.v_pnp_packing_compliance ppc
        JOIN mcp.v_prep_part_item ppi ON ppi.id = ppc.prep_part_item_id AND ppi.region = 'CA'
        JOIN mcp.v_prep_part pp ON pp.id = ppi."prepPartId" AND pp.region = 'CA'
        JOIN mcp.v_part p2 ON p2.id = pp.part_id AND p2.region = 'CA'
        JOIN mcp.v_prep pr ON pr.prep = pp."prepId" AND pr.region = 'CA'
        WHERE pr.location_id = $1
          AND pr.region = 'CA'
          AND DATE(ppc.created_at) BETWEEN $2 AND $3
        GROUP BY p2.model_name, p2.description
        HAVING COUNT(ppc.id) >= 3
        ORDER BY scan_count DESC
        LIMIT 15
      `, [location, safeFrom, safeTo]);
      const payload = { data: rows };
      setCached(cacheKey, payload);
      return res.status(200).json(payload);
    }

    // ── NOT SCANNED ────────────────────────────────────────────────────────
    // v_pnp_packing_compliance has no region column — do not filter on ppc.region.
    // v_collection_prep."prepDate" is used to filter today's preps.
    if (tab === 'notscanned') {
      const rows = await queryCosReadOnly(`
        SELECT DISTINCT ON (p2.sku, ppi.id)
          cp.id              AS prep_id,
          p2.sku,
          p2.description,
          p2.model_name,
          cp.carrier,
          CASE WHEN ppi.label_scanned_by_user_id IS NULL THEN 'Not labeled' ELSE 'Labeled' END AS label_status,
          CASE WHEN ppc.id IS NULL THEN 'Not packed' ELSE 'Packed' END                        AS pack_status
        FROM mcp.v_prep_part_item ppi
        JOIN mcp.v_prep_part pp ON pp.id = ppi."prepPartId" AND pp.region = 'CA'
        JOIN mcp.v_part p2 ON p2.id = pp.part_id AND p2.region = 'CA'
        JOIN mcp.v_collection_prep cp ON cp.id = pp."prepId" AND cp.region = 'CA'
        LEFT JOIN mcp.v_pnp_packing_compliance ppc ON ppc.prep_part_item_id = ppi.id
        WHERE cp.location_id = $1
          AND cp.region = 'CA'
          AND DATE(cp."prepDate") = CURRENT_DATE
          AND ppi.region = 'CA'
          AND (ppi.label_scanned_by_user_id IS NULL OR ppc.id IS NULL)
        ORDER BY p2.sku, ppi.id, cp.carrier
        LIMIT 200
      `, [location]);
      const payload = { data: rows };
      setCached(cacheKey, payload);
      return res.status(200).json(payload);
    }

    // ── WEEKLY SUMMARY ─────────────────────────────────────────────────────
    if (tab === 'weekly') {
      const rows = await queryCosReadOnly(`
        SELECT
          u.name,
          DATE(ppc.created_at) AS scan_date,
          COUNT(ppc.id) FILTER (WHERE ppc.packing_scan_method = 'SCANNER') AS scanner_scans,
          COUNT(ppc.id) FILTER (WHERE ppc.packing_scan_method = 'MANUAL')  AS manual_scans,
          COUNT(ppc.id)                                                     AS total_scans
        FROM mcp.v_pnp_packing_compliance ppc
        JOIN mcp.v_users u ON u.id = ppc.packed_by_user_id AND u.region = 'CA'
        JOIN mcp.v_prep_part_item ppi ON ppi.id = ppc.prep_part_item_id AND ppi.region = 'CA'
        JOIN mcp.v_prep_part pp ON pp.id = ppi."prepPartId" AND pp.region = 'CA'
        JOIN mcp.v_prep p ON p.prep = pp."prepId" AND p.region = 'CA'
        WHERE p.location_id = $1 AND p.region = 'CA'
          AND DATE(ppc.created_at) BETWEEN $2 AND $3
        GROUP BY u.name, DATE(ppc.created_at)
        ORDER BY scan_date DESC, total_scans DESC
        LIMIT 200
      `, [location, safeFrom, safeTo]);
      const payload = { data: rows };
      setCached(cacheKey, payload);
      return res.status(200).json(payload);
    }

    // ── SCAN TREND ─────────────────────────────────────────────────────────
    if (tab === 'scantrend') {
      const rows = await queryCosReadOnly(`
        SELECT
          DATE(ppc.created_at) AS scan_date,
          COUNT(ppc.id) FILTER (WHERE ppc.packing_scan_method = 'SCANNER') AS scanner_scans,
          COUNT(ppc.id) FILTER (WHERE ppc.packing_scan_method = 'MANUAL')  AS manual_scans,
          COUNT(ppc.id)                                                     AS total_scans,
          ROUND(COUNT(ppc.id) FILTER (WHERE ppc.packing_scan_method = 'SCANNER')::numeric / NULLIF(COUNT(ppc.id),0) * 100) AS scanner_pct
        FROM mcp.v_pnp_packing_compliance ppc
        JOIN mcp.v_prep_part_item ppi ON ppi.id = ppc.prep_part_item_id AND ppi.region = 'CA'
        JOIN mcp.v_prep_part pp ON pp.id = ppi."prepPartId" AND pp.region = 'CA'
        JOIN mcp.v_prep p ON p.prep = pp."prepId" AND p.region = 'CA'
        WHERE p.location_id = $1 AND p.region = 'CA'
          AND DATE(ppc.created_at) BETWEEN $2 AND $3
        GROUP BY DATE(ppc.created_at)
        ORDER BY scan_date ASC
      `, [location, safeFrom, safeTo]);
      const payload = { data: rows };
      setCached(cacheKey, payload);
      return res.status(200).json(payload);
    }

    // ── PREP DRILL-DOWN ────────────────────────────────────────────────────
    // ppi.region = 'CA' is required — without it no rows are returned.
    // DISTINCT ON (p2.sku) deduplicates multiple scans per part.
    if (tab === 'prepdrilldown') {
      if (!prep) return res.status(400).json({ error: 'prep parameter required' });
      const prepId = String(prep).replace(/[^a-zA-Z0-9]/g, '').slice(0, 30);
      const rows = await queryCosReadOnly(`
        SELECT DISTINCT ON (p2.sku)
          p2.sku,
          p2.description,
          p2.model_name,
          ppi.label_scan_method,
          u_label.name               AS labeled_by,
          ppi.label_scanned_at::text AS labeled_at,
          ppc.packing_scan_method,
          u_pack.name                AS packed_by,
          ppc.created_at::text       AS packed_at
        FROM mcp.v_prep_part_item ppi
        JOIN mcp.v_prep_part pp ON pp.id = ppi."prepPartId" AND pp.region = 'CA'
        JOIN mcp.v_part p2 ON p2.id = pp.part_id AND p2.region = 'CA'
        LEFT JOIN mcp.v_users u_label ON u_label.id = ppi.label_scanned_by_user_id AND u_label.region = 'CA'
        LEFT JOIN mcp.v_pnp_packing_compliance ppc ON ppc.prep_part_item_id = ppi.id
        LEFT JOIN mcp.v_users u_pack ON u_pack.id = ppc.packed_by_user_id AND u_pack.region = 'CA'
        WHERE pp."prepId" = $1
          AND ppi.region = 'CA'
        ORDER BY p2.sku, ppi.label_scanned_at DESC
        LIMIT 100
      `, [prepId]);
      return res.status(200).json({ data: rows });
    }

    return res.status(400).json({ error: 'Unknown tab' });

  } catch (err) {
    console.error('productivity handler error:', err && err.message);
    return res.status(502).json({ error: 'Failed to fetch productivity data' });
  }
};
