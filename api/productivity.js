// GET /api/productivity — pack/label scan views for the Cozey Ops dashboard.
// READ-ONLY against COS mcp.v_* views via the cos_mcp_reader role.

const { queryCosReadOnly } = require('./_cosPool');
const { applyCors } = require('./_auth');
const { VALID_LOCATIONS } = require('./_domain');

const VALID_TABS = ['pack', 'label', 'leaderboard', 'orderlookup', 'packtime', 'notscanned', 'weekly', 'scantrend', 'prepdrilldown'];

const cache = new Map();
const CACHE_TTL_MS = 55 * 1000;
function getCached(key) { const h = cache.get(key); if (!h || Date.now() - h.ts > CACHE_TTL_MS) { cache.delete(key); return null; } return h; }
function setCached(key, payload) { cache.set(key, { ts: Date.now(), payload }); }

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

    let { location = 'royalmount', tab = 'pack', date = 'today', order, prep } = req.query;
    if (!VALID_LOCATIONS.includes(location)) location = 'royalmount';
    if (!VALID_TABS.includes(tab)) tab = 'pack';
    const dateFilter = date === 'yesterday' ? 'CURRENT_DATE - 1' : 'CURRENT_DATE';

    res.setHeader('Cache-Control', 's-maxage=55, stale-while-revalidate=30');

    const cacheKey = `prod-${tab}-${location}-${date}`;
    const hit = getCached(cacheKey);
    if (hit && tab !== 'orderlookup' && tab !== 'prepdrilldown') {
      return res.status(200).json({ ...hit.payload, stale: false });
    }

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
          AND DATE(ppc.created_at) = ${dateFilter}
        GROUP BY u.name
        ORDER BY total_scans DESC
        LIMIT 20
      `, [location]);
      const payload = { data: rows };
      setCached(cacheKey, payload);
      return res.status(200).json(payload);
    }

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
          AND DATE(ppi.label_scanned_at) = ${dateFilter}
        GROUP BY u.name
        ORDER BY total_scans DESC
        LIMIT 20
      `, [location]);
      const payload = { data: rows };
      setCached(cacheKey, payload);
      return res.status(200).json(payload);
    }

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
          WHERE p.location_id = $1 AND p.region = 'CA' AND DATE(ppc.created_at) = CURRENT_DATE
          GROUP BY u.name ORDER BY total_scans DESC LIMIT 5
        `, [location]),
        queryCosReadOnly(`
          SELECT u.name, COUNT(ppi.id) AS total_scans,
            ROUND(COUNT(ppi.id) FILTER (WHERE ppi.label_scan_method = 'SCANNER')::numeric / NULLIF(COUNT(ppi.id),0) * 100) AS scanner_pct
          FROM mcp.v_prep_part_item ppi
          JOIN mcp.v_users u ON u.id = ppi.label_scanned_by_user_id AND u.region = 'CA'
          JOIN mcp.v_prep_part pp ON pp.id = ppi."prepPartId" AND pp.region = 'CA'
          JOIN mcp.v_prep p ON p.prep = pp."prepId" AND p.region = 'CA'
          WHERE p.location_id = $1 AND p.region = 'CA' AND DATE(ppi.label_scanned_at) = CURRENT_DATE
          GROUP BY u.name ORDER BY total_scans DESC LIMIT 5
        `, [location]),
      ]);
      const payload = { packers: pack, labelers: label };
      setCached(cacheKey, payload);
      return res.status(200).json(payload);
    }

    if (tab === 'orderlookup') {
      if (!order) return res.status(400).json({ error: 'order parameter required' });
      const orderNum = String(order).replace(/\D/g, '').slice(0, 20);
      const rows = await queryCosReadOnly(`
        SELECT
          p2.sku, p2.description,
          ppi.label_scan_method,
          u.name  AS labeled_by,
          ppi.label_scanned_at::text AS labeled_at
        FROM mcp.v_prep_part_item ppi
        JOIN mcp.v_prep_part pp ON pp.id = ppi."prepPartId" AND pp.region = 'CA'
        JOIN mcp.v_part p2 ON p2.id = pp.part_id AND p2.region = 'CA'
        JOIN mcp.v_prep pr ON pr.prep = pp."prepId" AND pr.region = 'CA'
        JOIN mcp.v_order o ON o.id = pr.order_id AND o.region = 'CA'
        LEFT JOIN mcp.v_users u ON u.id = ppi.label_scanned_by_user_id AND u.region = 'CA'
        WHERE o."shopifyOrderNumber" = $1
        ORDER BY p2.description
        LIMIT 50
      `, [orderNum]);
      return res.status(200).json({ data: rows });
    }

    if (tab === 'packtime') {
      const rows = await queryCosReadOnly(`
        SELECT
          p2.model_name, p2.description,
          COUNT(ppc.id) AS scan_count,
          ROUND(AVG(EXTRACT(EPOCH FROM (ppc.updated_at - ppc.created_at))/60)::numeric, 1) AS avg_minutes
        FROM mcp.v_pnp_packing_compliance ppc
        JOIN mcp.v_prep_part_item ppi ON ppi.id = ppc.prep_part_item_id AND ppi.region = 'CA'
        JOIN mcp.v_prep_part pp ON pp.id = ppi."prepPartId" AND pp.region = 'CA'
        JOIN mcp.v_part p2 ON p2.id = pp.part_id AND p2.region = 'CA'
        JOIN mcp.v_prep pr ON pr.prep = pp."prepId" AND pr.region = 'CA'
        WHERE pr.location_id = $1 AND pr.region = 'CA'
          AND DATE(ppc.created_at) >= CURRENT_DATE - 7
          AND ppc.updated_at > ppc.created_at
        GROUP BY p2.model_name, p2.description
        HAVING COUNT(ppc.id) >= 3
        ORDER BY avg_minutes DESC
        LIMIT 15
      `, [location]);
      const payload = { data: rows };
      setCached(cacheKey, payload);
      return res.status(200).json(payload);
    }

    if (tab === 'notscanned') {
      const rows = await queryCosReadOnly(`
        SELECT
          pp."prepId"  AS prep_id,
          p2.sku, p2.description, p2.model_name,
          pr.carrier,
          CASE WHEN ppi.label_scanned_by_user_id IS NULL THEN 'Not labeled' ELSE 'Labeled' END AS label_status,
          CASE WHEN ppc.id IS NULL THEN 'Not packed' ELSE 'Packed' END                        AS pack_status
        FROM mcp.v_prep_part_item ppi
        JOIN mcp.v_prep_part pp ON pp.id = ppi."prepPartId" AND pp.region = 'CA'
        JOIN mcp.v_part p2 ON p2.id = pp.part_id AND p2.region = 'CA'
        JOIN mcp.v_prep pr ON pr.prep = pp."prepId" AND pr.region = 'CA'
        LEFT JOIN mcp.v_pnp_packing_compliance ppc ON ppc.prep_part_item_id = ppi.id AND ppc.region = 'CA'
        WHERE pr.location_id = $1 AND pr.region = 'CA'
          AND DATE(pr."prepDate") = CURRENT_DATE
          AND (ppi.label_scanned_by_user_id IS NULL OR ppc.id IS NULL)
        ORDER BY pr.carrier, p2.model_name
        LIMIT 200
      `, [location]);
      const payload = { data: rows };
      setCached(cacheKey, payload);
      return res.status(200).json(payload);
    }

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
          AND DATE(ppc.created_at) >= CURRENT_DATE - 6
        GROUP BY u.name, DATE(ppc.created_at)
        ORDER BY scan_date DESC, total_scans DESC
        LIMIT 100
      `, [location]);
      const payload = { data: rows };
      setCached(cacheKey, payload);
      return res.status(200).json(payload);
    }

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
          AND DATE(ppc.created_at) >= CURRENT_DATE - 13
        GROUP BY DATE(ppc.created_at)
        ORDER BY scan_date ASC
      `, [location]);
      const payload = { data: rows };
      setCached(cacheKey, payload);
      return res.status(200).json(payload);
    }

    if (tab === 'prepdrilldown') {
      if (!prep) return res.status(400).json({ error: 'prep parameter required' });
      const prepId = String(prep).replace(/[^a-zA-Z0-9]/g, '').slice(0, 30);
      const rows = await queryCosReadOnly(`
        SELECT
          p2.sku, p2.description, p2.model_name,
          ppi.label_scan_method,
          u_label.name            AS labeled_by,
          ppi.label_scanned_at::text AS labeled_at,
          ppc.packing_scan_method,
          u_pack.name             AS packed_by,
          ppc.created_at::text    AS packed_at
        FROM mcp.v_prep_part_item ppi
        JOIN mcp.v_prep_part pp ON pp.id = ppi."prepPartId" AND pp.region = 'CA'
        JOIN mcp.v_part p2 ON p2.id = pp.part_id AND p2.region = 'CA'
        LEFT JOIN mcp.v_users u_label ON u_label.id = ppi.label_scanned_by_user_id AND u_label.region = 'CA'
        LEFT JOIN mcp.v_pnp_packing_compliance ppc ON ppc.prep_part_item_id = ppi.id AND ppc.region = 'CA'
        LEFT JOIN mcp.v_users u_pack ON u_pack.id = ppc.packed_by_user_id AND u_pack.region = 'CA'
        WHERE pp."prepId" = $1
        ORDER BY p2.model_name
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
