import React, { useState, useEffect, useCallback, useMemo } from 'react';
import './App.css';

const LOCATIONS = [
  { id: 'all', name: 'All warehouses', icon: 'ti-building-warehouse' },
  { id: 'royalmount', name: 'Royalmount FC', icon: 'ti-map-pin' },
  { id: 'langley', name: 'Langley FC', icon: 'ti-map-pin' },
  { id: 'windsor', name: 'Windsor FC', icon: 'ti-map-pin' },
];

const CATEGORIES = ['All categories', 'Sofas', 'Chairs', 'Bedroom', 'Rugs', 'Tables', 'Dining', 'Accessories', 'Storage', 'Metal Legs'];

const PAGE_SIZE = 20;

function getStatus(available) {
  if (available < 0) return { label: 'Negative', cls: 'pill-neg', icon: 'ti-alert-triangle' };
  if (available === 0) return { label: 'Out of stock', cls: 'pill-oos', icon: 'ti-circle-x' };
  if (available <= 3) return { label: 'Critical', cls: 'pill-crit', icon: 'ti-alert-circle' };
  if (available <= 9) return { label: 'Low', cls: 'pill-low', icon: 'ti-minus' };
  return { label: 'Good', cls: 'pill-good', icon: 'ti-circle-check' };
}

function getAvailableColor(available) {
  if (available < 0) return '#dc2626';
  if (available === 0) return '#dc2626';
  if (available <= 3) return '#d97706';
  if (available <= 9) return '#6b7280';
  return '#059669';
}

function exportCSV(data, location) {
  const headers = ['SKU', 'Description', 'Model', 'Category', 'Quality', 'On Hand', 'Committed', 'Receiving', 'Available', 'Status'];
  const rows = data.map(r => [
    r.sku, `"${r.description}"`, r.model_name, r.category, r.quality_id,
    r.on_hand, r.committed, r.receiving, r.available, getStatus(r.available).label
  ]);
  const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `inventory-${location}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function App() {
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastSync, setLastSync] = useState(null);
  const [location, setLocation] = useState('royalmount');
  const [threshold, setThreshold] = useState(10);
  const [thresholdInput, setThresholdInput] = useState('10');
  const [quality, setQuality] = useState('both');
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const fetchInventory = useCallback(async () => {
    try {
      const params = new URLSearchParams({ location, threshold, quality, category });
      const res = await fetch(`/api/inventory?${params}`);
      const data = await res.json();
      if (data.error) throw new Error(data.details || data.error);
      setInventory(data.inventory || []);
      setLastSync(new Date());
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [location, threshold, quality, category]);

  useEffect(() => {
    setLoading(true);
    setPage(1);
    fetchInventory();
    const id = setInterval(fetchInventory, 60000);
    return () => clearInterval(id);
  }, [fetchInventory]);

  const filtered = useMemo(() => {
    if (!search.trim()) return inventory;
    const q = search.toLowerCase();
    return inventory.filter(r =>
      r.sku.toLowerCase().includes(q) ||
      r.description.toLowerCase().includes(q) ||
      r.model_name?.toLowerCase().includes(q)
    );
  }, [inventory, search]);

  const stats = useMemo(() => ({
    total: filtered.length,
    negative: filtered.filter(r => r.available < 0).length,
    oos: filtered.filter(r => r.available === 0).length,
    critical: filtered.filter(r => r.available > 0 && r.available <= 3).length,
    low: filtered.filter(r => r.available > 3 && r.available <= 9).length,
    good: filtered.filter(r => r.available >= 10).length,
  }), [filtered]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const locationName = LOCATIONS.find(l => l.id === location)?.name || 'All warehouses';

  return (
    <div className="shell">
      <div className="sidebar">
        <div className="logo-row">
          <div className="logo-mark">C</div>
          <div>
            <div className="logo-title">Inventory</div>
            <div className="logo-sub">Stock monitor</div>
          </div>
        </div>

        <div className="s-label">Warehouses</div>
        {LOCATIONS.map(l => (
          <button key={l.id} className={`nav-item${location === l.id ? ' active' : ''}`} onClick={() => { setLocation(l.id); setPage(1); }}>
            <i className={`ti ${l.icon}`} aria-hidden="true"></i>
            {l.name}
          </button>
        ))}

        <div className="sb-divider" />

        <div className="s-label">Filters</div>
        <div className="filter-block">
          <div className="filter-lbl">Quality</div>
          <select className="filter-sel" value={quality} onChange={e => { setQuality(e.target.value); setPage(1); }}>
            <option value="both">New & Refurbished</option>
            <option value="new">New only</option>
            <option value="refurbished">Refurbished only</option>
          </select>
        </div>
        <div className="filter-block">
          <div className="filter-lbl">Category</div>
          <select className="filter-sel" value={category} onChange={e => { setCategory(e.target.value === 'All categories' ? 'all' : e.target.value); setPage(1); }}>
            {CATEGORIES.map(c => <option key={c} value={c === 'All categories' ? 'all' : c}>{c}</option>)}
          </select>
        </div>
        <div className="filter-block">
          <div className="filter-lbl">Low stock threshold</div>
          <div className="thresh-row">
            <input className="thresh-inp" type="number" min="1" max="100" value={thresholdInput}
              onChange={e => setThresholdInput(e.target.value)}
              onBlur={() => { const v = parseInt(thresholdInput); if (v > 0) { setThreshold(v); setPage(1); } }}
              onKeyDown={e => { if (e.key === 'Enter') { const v = parseInt(thresholdInput); if (v > 0) { setThreshold(v); setPage(1); } } }}
            />
            <span style={{ fontSize: 11, color: '#565d73' }}>units</span>
          </div>
        </div>

        <div className="sidebar-foot">
          <div className="foot-updated">
            <i className="ti ti-clock" style={{ fontSize: 12 }} aria-hidden="true"></i>
            {lastSync ? lastSync.toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' }) : '—'}
          </div>
          <div className="foot-note">Auto-refreshes every 60s</div>
        </div>
      </div>

      <div className="main">
        <div className="topbar">
          <div>
            <div className="page-title">{locationName}</div>
            <div className="page-sub">
              {quality === 'both' ? 'New & Refurbished' : quality === 'new' ? 'New' : 'Refurbished'}
              {' · '}items with {threshold} or fewer units available
            </div>
          </div>
          <div className="topbar-right">
            <div className="badge-live"><div className="pulse"></div>Live</div>
            <button className="btn-sm" onClick={() => { setLoading(true); fetchInventory(); }}>
              <i className="ti ti-refresh" style={{ fontSize: 13 }} aria-hidden="true"></i>
              Refresh
            </button>
          </div>
        </div>

        <div className="content">
          <div className="stats-row">
            <div className="stat info">
              <div className="stat-val">{stats.total}</div>
              <div className="stat-lbl">SKUs flagged</div>
              <div className="stat-sub" style={{ color: '#2563eb' }}>≤ {threshold} units</div>
            </div>
            <div className="stat danger">
              <div className="stat-val">{stats.negative}</div>
              <div className="stat-lbl">Negative stock</div>
              <div className="stat-sub" style={{ color: '#dc2626' }}>oversold</div>
            </div>
            <div className="stat danger">
              <div className="stat-val">{stats.oos}</div>
              <div className="stat-lbl">Out of stock</div>
              <div className="stat-sub" style={{ color: '#dc2626' }}>0 units</div>
            </div>
            <div className="stat warn">
              <div className="stat-val">{stats.critical}</div>
              <div className="stat-lbl">Critical</div>
              <div className="stat-sub" style={{ color: '#d97706' }}>1–3 units</div>
            </div>
            <div className="stat success">
              <div className="stat-val">{stats.good}</div>
              <div className="stat-lbl">Good</div>
              <div className="stat-sub" style={{ color: '#059669' }}>10+ units</div>
            </div>
          </div>

          <div className="toolbar">
            <div className="search-wrap">
              <i className="ti ti-search" aria-hidden="true"></i>
              <input className="search-inp" placeholder="Search SKU or description..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
            </div>
            <div className="seg">
              <button className={`seg-btn${quality === 'both' ? ' active' : ''}`} onClick={() => { setQuality('both'); setPage(1); }}>All</button>
              <button className={`seg-btn${quality === 'new' ? ' active' : ''}`} onClick={() => { setQuality('new'); setPage(1); }}>New</button>
              <button className={`seg-btn${quality === 'refurbished' ? ' active' : ''}`} onClick={() => { setQuality('refurbished'); setPage(1); }}>Refurb</button>
            </div>
            <div className="result-ct">{filtered.length} SKUs</div>
          </div>

          <div className="tbl-wrap">
            {loading ? (
              <div className="loading"><i className="ti ti-loader-2" style={{ fontSize: 20, animation: 'spin 1s linear infinite' }} aria-hidden="true"></i>Loading inventory...</div>
            ) : error ? (
              <div className="error-msg"><i className="ti ti-alert-circle" style={{ fontSize: 20 }} aria-hidden="true"></i>{error}</div>
            ) : filtered.length === 0 ? (
              <div className="empty"><i className="ti ti-mood-happy" aria-hidden="true"></i><span>No low stock items found!</span></div>
            ) : (
              <>
                <div className="tbl-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: '14%' }}>SKU</th>
                        <th style={{ width: '28%' }}>Description</th>
                        <th style={{ width: '9%' }}>Quality</th>
                        <th style={{ width: '8%' }}>On hand</th>
                        <th style={{ width: '8%' }}>Committed</th>
                        <th style={{ width: '9%' }}>Receiving</th>
                        <th style={{ width: '9%' }}>Available</th>
                        <th style={{ width: '15%' }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginated.map((r, i) => {
                        const status = getStatus(r.available);
                        return (
                          <tr key={i}>
                            <td>
                              <div className="sku">{r.sku}</div>
                              <div className="model-name">{r.model_name}</div>
                            </td>
                            <td title={r.description}>{r.description}</td>
                            <td>
                              <span className={`badge ${r.quality_id === 'new' ? 'badge-new' : 'badge-ref'}`}>
                                {r.quality_id === 'new' ? 'New' : 'Refurb'}
                              </span>
                            </td>
                            <td><span className="oh" style={{ color: r.on_hand < 0 ? '#dc2626' : '#111827' }}>{r.on_hand}</span></td>
                            <td style={{ fontFamily: 'monospace', color: '#9ca3af' }}>{r.committed}</td>
                            <td><span className="receiving">+{r.receiving || 0}</span></td>
                            <td><span className="oh" style={{ color: getAvailableColor(r.available) }}>{r.available}</span></td>
                            <td>
                              <span className={`pill ${status.cls}`}>
                                <i className={`ti ${status.icon}`} aria-hidden="true"></i>
                                {status.label}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="tbl-footer">
                  <button className="export-btn" onClick={() => exportCSV(filtered, location)}>
                    <i className="ti ti-download" style={{ fontSize: 13 }} aria-hidden="true"></i>
                    Export CSV
                  </button>
                  <div className="pag">
                    <button className="pag-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
                    <div className="pag-info">Page {page} of {totalPages} · {filtered.length} items</div>
                    <button className="pag-btn" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
