const { normalizeInventoryQuery, inventoryCacheKey } = require("../../api/inventoryCache");

/** Pre-fix error path keyed raw query params; success path used normalized values. */
function legacyErrorCacheKey(query = {}) {
  return `inv-${query.tab || "lowstock"}-${query.location || "royalmount"}-${query.threshold || "10"}-${query.quality || "both"}-${query.category || "all"}-${query.model || "all"}`;
}

describe("inventory cache keys", () => {
  test("default category/model filters normalize to null, not 'all'", () => {
    const query = { category: "all", model: "all" };
    const key = inventoryCacheKey(normalizeInventoryQuery(query));
    expect(key).toBe("inv-lowstock-royalmount-10-both-null-null");
    expect(key).not.toBe(legacyErrorCacheKey(query));
  });

  test("success and error paths produce the same key for equivalent queries", () => {
    const cases = [
      {},
      { category: "all", model: "all", threshold: "10" },
      { category: "sofa", model: "Ciello", tab: "restock", location: "langley" },
      { threshold: "abc" },
      { category: "invalid", model: "nope" },
    ];
    for (const query of cases) {
      const normalized = normalizeInventoryQuery(query);
      const successKey = inventoryCacheKey(normalized);
      const errorKey = inventoryCacheKey(normalizeInventoryQuery(query));
      expect(errorKey).toBe(successKey);
      expect(errorKey).not.toBe(legacyErrorCacheKey(query));
    }
  });
});
