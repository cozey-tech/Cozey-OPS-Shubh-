// Single source of truth for allowlists shared between api/ and src/
// Consumed by api/inventory.js, api/productivity.js, api/barcodes.js, api/returns.js
// Frontend reads /api/meta at load time for the same data.

const VALID_LOCATIONS = ['royalmount', 'langley', 'windsor'];

const VALID_QUALITY = ['new', 'refurbished', 'both'];

const VALID_TABS_INVENTORY = ['lowstock', 'restock', 'chart', 'pos', 'crossfc'];

const VALID_CATEGORIES = [
  'Accessories', 'Bedroom', 'Chairs', 'Dining',
  'Metal Legs', 'Rugs', 'Sofas', 'Storage', 'Tables',
];

const MODELS_BY_CATEGORY = {
  'Accessories': ['deco-acc'],
  'Bedroom': ['ara-bed', 'bedding', 'cozey-mattress', 'talus'],
  'Chairs': ['mira', 'mistral', 'naos', 'vela'],
  'Dining': ['multi', 'orsa', 'ushi', 'vela'],
  'Metal Legs': ['metal-legs'],
  'Rugs': ['rugs', 'rugs-2.5x8', 'rugs-3x5', 'rugs-5x8', 'rugs-8x10', 'rugs-9x12'],
  'Sofas': [
    'altus', 'atmosphere', 'ciello', 'ciello-1', 'ciello-2', 'ciello-3',
    'ciello-xl', 'ciello-xl-3', 'cozey-original', 'gaia', 'gaia-xl',
    'luna', 'mistral', 'neptune', 'orian', 'shinuk',
  ],
  'Storage': ['altitude', 'aurora', 'mensa', 'stella', 'theia'],
  'Tables': [],
};

const ALL_MODELS = Object.values(MODELS_BY_CATEGORY).flat();

module.exports = {
  VALID_LOCATIONS,
  VALID_QUALITY,
  VALID_TABS_INVENTORY,
  VALID_CATEGORIES,
  MODELS_BY_CATEGORY,
  ALL_MODELS,
};
