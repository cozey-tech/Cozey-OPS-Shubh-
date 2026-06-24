const { VALID_LOCATIONS, VALID_TABS_INVENTORY, VALID_QUALITY, VALID_CATEGORIES, ALL_MODELS } = require('./_domain');

function normalizeInventoryQuery(query = {}) {
  let { location = 'royalmount', threshold = '10', quality = 'both', category = 'all', model = 'all', tab = 'lowstock' } = query;

  if (!VALID_LOCATIONS.includes(location)) location = 'royalmount';
  if (!VALID_TABS_INVENTORY.includes(tab)) tab = 'lowstock';
  if (!VALID_QUALITY.includes(quality)) quality = 'both';
  const thresh = Math.min(100, Math.max(1, parseInt(threshold) || 10));
  const safeCategory = VALID_CATEGORIES.includes(category) ? category : null;
  const safeModel = ALL_MODELS.includes(model) ? model : null;

  return { tab, location, thresh, quality, safeCategory, safeModel };
}

function inventoryCacheKey(normalized) {
  const { tab, location, thresh, quality, safeCategory, safeModel } = normalized;
  return `inv-${tab}-${location}-${thresh}-${quality}-${safeCategory}-${safeModel}`;
}

module.exports = { normalizeInventoryQuery, inventoryCacheKey };
