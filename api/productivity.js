const { queryCosReadOnly } = require('./_cosPool');
const { applyCors } = require('./_auth');

const VALID_LOCATIONS = ['royalmount', 'langley', 'windsor'];
const VALID_TABS = ['pack', 'label', 'leaderboard', 'orderlookup', 'packtime', 'notscanned', 'hourly', 'weekly', 'prepdrilldown', 'scantrend'];

module.exports = async (req, res) => {
  applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  let { location = 'royalmount', tab = 'pack', date = 'today', order, prep } = req.query;

  if (!VALID_LOCATIONS.includes(location)) location = 'royalmount';
  if (!VALID_TABS.includes(tab)) tab = 'pack';

  const cacheKey = `${tab}-${location}-${date}`;
  res.setHeader('Cache-Control', 's-maxage=55, stale-while-revalidate=30');

  try {
    let rows = [];

    if (tab === 'pack') {
      rows = await queryCosReadOnly(`
        SELECT 
          u.name,
          COUNT(ppc.id) FILTER (WHERE ppc.packing_scan_method = 'SCANNER') as scanner_scans,
          COUNT(ppc.id) FILTER (WHERE ppc.packing_scan_method = 'MANUAL') as manual_scans,
          COUNT(ppc.id) as total_scans
        FROM mcp.v_pnp_packing_compliance ppc
        JOIN mcp.v_users u ON u.id = ppc.packed_by_user_id AND u.region = 'CA'
        JOIN mcp.v_prep_part_item ppi ON ppi.id = ppc.prep_part_item_id AND ppi.region = 'CA'
        JOIN mcp.v_prep_part pp ON pp.id = ppi."prepPartId" AND pp.region = 'CA'
        JOIN mcp.v_prep p ON p.prep = pp."prepId" AND p.region = 'CA'
        WHERE p.location_id = $1
          AND p.region = 'CA'
          AND DATE(ppc.created_at) = CASE WHEN $2 = 'today' THEN CURRENT_DATE ELSE CURRENT_DATE - 1 END
        GROUP BY u.name
        ORDER BY total_scans DESC
        LIMIT 20
      `, [location, date]);
    }

    else if (tab === 'label') {
      rows = await queryCosReadOnly(`
        SELECT 
          u.name,
          COUNT(ppi.id) FILTER (WHERE ppi.label_scan_method = 'SCANNER') as scanner_scans,
          COUNT(ppi.id) FILTER (WHERE ppi.label_scan_method = 'MANUAL') as manual_scans,
          COUNT(ppi.id) as total_scans
        FROM mcp.v_prep_part_item ppi
        JOIN mcp.v_users u ON u.id = ppi.label_scanned_by_user_id AND u.region = 'CA'
        JOIN mcp.v_prep_part pp ON pp.id = ppi."prepPartId" AND pp.region = 'CA'
        JOIN mcp.v_prep p ON p.prep = pp."prepId" AND p.region = 'CA'
        WHERE p.location_id = $1
          AND p.region = 'CA'
          AND DATE(ppi.label_scanned_at) = CASE WHEN $2 = 'today' THEN CURRENT_DATE ELSE CURRENT_DATE - 1 END
        GROUP BY u.name
        ORDER BY total_scans DESC
        LIMIT 20
      `, [location, date]);
    }

    else if (tab === 'leaderboard') {
      const pack = await queryCosReadOnly(`
        SELECT u.name, COUNT(ppc.id) as total_scans, 
          ROUND(COUNT(ppc.id) FILTER (WHERE ppc.packing_scan_method = 'SCANNER')::numeric / NULLIF(COUNT(ppc.id),0) * 100) as scanner_pct
        FROM mcp.v_pnp_packing_compliance ppc
        JOIN mcp.v_users u ON u.id = ppc.packed_by_user_id AND u.region = 'CA'
        JOIN mcp.v_prep_part_item ppi ON ppi.id = ppc.prep_part_item_id AND ppi.region = 'CA'
        JOIN mcp.v_prep_part pp ON pp.id = ppi."prepPartId" AND pp.region = 'CA'
        JOIN mcp.v_prep p ON p.prep = pp."prepId" AND p.region = 'CA'
        WHERE p.location_id = $1 AND p.region = 'CA'
          AND DATE(ppc.created_at) = CURRENT_DATE
        GROUP BY u.name ORDER BY total_scans DESC LIMIT 5
      `, [location]);

      const label = await queryCosReadOnly(`
        SELECT u.name, COUNT(ppi.id) as total_scans,
          ROUND(COUNT(ppi.id) FILTER (WHERE ppi.label_scan_method = 'SCANNER')::numeric / NULLIF(COUNT(ppi.id),0) * 100) as scanner_pct
        FROM mcp.v_prep_part_item ppi
        JOIN mcp.v_users u ON u.id = ppi.label_scanned_by_user_id AND u.region = 'CA'
        JOIN mcp.v_prep_part pp ON pp.id = ppi."prepPartId" AND pp.region = 'CA'
        JOIN mcp.v_prep p ON p.prep = pp."prepId" AND p.region = 'CA'
        WHERE p.location_id = $1 AND p.region = 'CA'
          AND DATE(ppi.label_scanned_at) = CURRENT_DATE
        GROUP BY u.name ORDER BY total_scans DESC LIMIT 5
      `, [location]);

      return res.status(200).json({ packers: pack, labelers: label });
    }

    else if (tab === 'orderlookup') {
      if (!order) return res.status(400).json({ error: 'order parameter required' });
      const orderNum = String(order).replace(/\D/g, '').slice(0, 20);
      rows = await queryCosReadOnly(`
        SELECT 
          ppi.id,
          p2.sku,
          p2.description,
          ppi.label_scan_method,
          u.name as labeled_by,
          ppi.label_scanned_at::text as labeled_at
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
    }

    else if (tab === 'packtime') {
      rows = await queryCosReadOnly(`
        SELECT 
          p2.model_name,
          p2.description,
          COUNT(ppc.id) as scan_count,
          ROUND(AVG(EXTRACT(EPOCH FROM (ppc.updated_at - ppc.created_at))/60)::numeric, 1) as avg_minutes
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
    }

    else if (tab === 'notscanned') {
      rows = await queryCosReadOnly(`
        SELECT 
          pp."prepId" as prep_id,
          p2.sku,
          p2.description,
          p2.model_name,
          pr.carrier,
          CASE WHEN ppi.label_scanned_by_user_id IS NULL THEN 'Not labeled' ELSE 'Labeled' END as label_status,
          CASE WHEN ppc.id IS NULL THEN 'Not packed' ELSE 'Packed' END as pack_status
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
    }

    else if (tab === 'weekly') {
      rows = await queryCosReadOnly(`
        SELECT 
          u.name,
          DATE(ppc.created_at) as scan_date,
          COUNT(ppc.id) FILTER (WHERE ppc.packing_scan_method = 'SCANNER') as scanner_scans,
          COUNT(ppc.id) FILTER (WHERE ppc.packing_scan_method = 'MANUAL') as manual_scans,
          COUNT(ppc.id) as total_scans
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
    }

    else if (tab === 'scantrend') {
      rows = await queryCosReadOnly(`
        SELECT 
          DATE(ppc.created_at) as scan_date,
          COUNT(ppc.id) FILTER (WHERE ppc.packing_scan_method = 'SCANNER') as scanner_scans,
          COUNT(ppc.id) FILTER (WHERE ppc.packing_scan_method = 'MANUAL') as manual_scans,
          COUNT(ppc.id) as total_scans,
          ROUND(COUNT(ppc.id) FILTER (WHERE ppc.packing_scan_method = 'SCANNER')::numeric / NULLIF(COUNT(ppc.id),0) * 100) as scanner_pct
        FROM mcp.v_pnp_packing_compliance ppc
        JOIN mcp.v_prep_part_item ppi ON ppi.id = ppc.prep_part_item_id AND ppi.region = 'CA'
        JOIN mcp.v_prep_part pp ON pp.id = ppi."prepPartId" AND pp.region = 'CA'
        JOIN mcp.v_prep p ON p.prep = pp."prepId" AND p.region = 'CA'
        WHERE p.location_id = $1 AND p.region = 'CA'
          AND DATE(ppc.created_at) >= CURRENT_DATE - 13
        GROUP BY DATE(ppc.created_at)
        ORDER BY scan_date ASC
      `, [location]);
    }

    else if (tab === 'prepdrilldown') {
      if (!prep) return res.status(400).json({ error: 'prep parameter required' });
      const prepId = String(prep).replace(/[^a-zA-Z0-9]/g, '').slice(0, 30);
      rows = await queryCosReadOnly(`
        SELECT 
          p2.sku,
          p2.description,
          p2.model_name,
          ppi.label_scan_method,
          u_label.name as labeled_by,
          ppi.label_scanned_at::text as labeled_at,
          ppc.packing_scan_method,
          u_pack.name as packed_by,
          ppc.created_at::text as packed_at
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
    }

    return res.status(200).json({ data: rows });
  } catch (err) {
    console.error('Productivity query failed:', err?.message);
    return res.status(502).json({ error: 'Failed to fetch productivity data' });
  }
};
