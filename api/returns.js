const { queryCosReadOnly } = require('./_cosPool');
const { applyCors } = require('./_auth');

const VALID_DAYS = [7, 30, 60, 90];

module.exports = async (req, res) => {
  applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  let { days = '30', model = 'all' } = req.query;
  const daysNum = VALID_DAYS.includes(parseInt(days)) ? parseInt(days) : 30;
  const safeModel = String(model).replace(/[^a-zA-Z0-9\-\.]/g, '').slice(0, 50);

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');

  try {
    let modelFilter = '';
    const params = [daysNum];
    if (safeModel && safeModel !== 'all') {
      params.push(safeModel);
      modelFilter = `AND p.model_name = $${params.length}`;
    }

    const rows = await queryCosReadOnly(`
      SELECT 
        p.model_name,
        p.category,
        orr."flowName" as flow_name,
        orr."errorType" as error_type,
        COUNT(*) as count
      FROM mcp.v_order_report_response orr
      JOIN mcp.v_order_report_parts orp ON orp."reportResponseId" = orr.id
      JOIN mcp.v_part p ON p.id = orp."partId" AND p.region = 'CA'
      WHERE orr."isDeleted" = false
        AND orr."errorType" IN ('WAREHOUSE', 'QUALITY_ASSURANCE', 'CUSTOMER_PREFERENCE')
        AND orr."createdAt" >= CURRENT_DATE - $1
        ${modelFilter}
      GROUP BY p.model_name, p.category, orr."flowName", orr."errorType"
      ORDER BY count DESC
      LIMIT 200
    `, params);

    // Get all unique models for dropdown
    const models = await queryCosReadOnly(`
      SELECT DISTINCT p.model_name
      FROM mcp.v_order_report_response orr
      JOIN mcp.v_order_report_parts orp ON orp."reportResponseId" = orr.id
      JOIN mcp.v_part p ON p.id = orp."partId" AND p.region = 'CA'
      WHERE orr."isDeleted" = false
        AND p.model_name IS NOT NULL
      ORDER BY p.model_name
      LIMIT 100
    `, []);

    return res.status(200).json({ returns: rows, models: models.map(m => m.model_name) });
  } catch (err) {
    console.error('Returns query failed:', err?.message);
    return res.status(502).json({ error: 'Failed to fetch returns data' });
  }
};
