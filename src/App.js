import React, { useState, useEffect, useCallback, useMemo } from 'react';
import './App.css';

const LOCATIONS = [
  { id: 'all', name: 'All warehouses', icon: 'ti-building-warehouse' },
  { id: 'royalmount', name: 'Royalmount FC', icon: 'ti-map-pin' },
  { id: 'langley', name: 'Langley FC', icon: 'ti-map-pin' },
  { id: 'windsor', name: 'Windsor FC', icon: 'ti-map-pin' },
];

const CATEGORIES = ['All categories', 'Accessories', 'Bedroom', 'Chairs', 'Dining', 'Metal Legs', 'Rugs', 'Sofas', 'Storage', 'Tables'];

const MODELS_BY_CATEGORY = {
  'Accessories': ['deco-acc'],
  'Bedroom': ['ara-bed', 'bedding', 'cozey-mattress', 'talus'],
  'Chairs': ['mira', 'mistral', 'naos', 'vela'],
  'Dining': ['multi', 'orsa', 'ushi', 'vela'],
  'Metal Legs': ['metal-legs'],
  'Rugs': ['rugs', 'rugs-2.5x8', 'rugs-3x5', 'rugs-5x8', 'rugs-8x10', 'rugs-9x12'],
  'Sofas': ['altus', 'atmosphere', 'ciello', 'ciello-1', 'ciello-2', 'ciello-3', 'ciello-xl', 'ciello-xl-3', 'cozey-original', 'gaia', 'gaia-xl', 'luna', 'mistral', 'neptune', 'orian', 'shinuk'],
  'Storage': ['altitude', 'aurora', 'mensa', 'stella', 'theia'],
  'Tables': [],
};

const TABS = [
  { id: 'lowstock', label: 'Low stock', icon: 'ti-list' },
  { id: 'restock', label: 'Restock intel', icon: 'ti-calendar-stats' },
  { id: 'chart', label: 'Critical chart', icon: 'ti-chart-bar' },
  { id: 'pos', label: 'Incoming POs', icon: 'ti-ship' },
  { id: 'crossfc', label: 'Cross-FC', icon: 'ti-arrows-exchange' },
];

const PAGE_SIZE = 20;

function getStatus(available) {
  if (available < 0) return { label: 'Negative', cls: 'pill-neg', icon: 'ti-alert-triangle' };
  if (available === 0) return { label: 'Out of stock', cls: 'pill-oos', icon: 'ti-circle-x' };
  if (available <= 3) return { label: 'Critical', cls: 'pill-crit', icon: 'ti-alert-circle' };
  if (available <= 9) return { label: 'Low', cls: 'pill-low', icon: 'ti-minus' };
  return { label: 'Good', cls: 'pill-good', icon: 'ti-circle-check' };
}

function getAvailColor(n) {
  if (n < 0) return '#dc2626';
  if (n === 0) return '#dc2626';
  if (n <= 3) return '#d97706';
  if (n <= 9) return '#6b7280';
  return '#059669';
}

function getDaysLeft(available, orders30d) {
  if (!orders30d || orders30d === 0) return { label: 'No demand data', cls: 'days-na' };
  if (available <= 0) return { label: '0 days', cls: 'days-urgent', icon: 'ti-flame' };
  const dailyRate = orders30d / 30;
  const days = Math.round(available / dailyRate);
  if (days < 1) return { label: 'Less than 1 day', cls: 'days-urgent', icon: 'ti-flame' };
  if (days <= 3) return { label: `~${days} day${days > 1 ? 's' : ''}`, cls: 'days-urgent', icon: 'ti-flame' };
  if (days <= 7) return { label: `~${days} days`, cls: 'days-warn', icon: 'ti-clock' };
  if (days <= 14) return { label: `~${days} days`, cls: 'days-warn', icon: 'ti-clock' };
  return { label: `~${days} days`, cls: 'days-ok', icon: 'ti-check' };
}

function formatRestockDate(dateStr) {
  if (!dateStr) return { date: 'Never restocked', ago: 'No PO history' };
  const d = new Date(dateStr);
  const days = Math.floor((Date.now() - d) / 86400000);
  const date = d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
  const ago = days === 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days} days ago`;
  return { date, ago };
}

function exportCSV(data, headers, filename) {
  const rows = data.map(r => headers.map(h => `"${r[h.key] ?? ''}"`).join(','));
  const csv = [headers.map(h => h.label).join(','), ...rows].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = filename;
  a.click();
}

function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id); }, []);
  return <span>{now.toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' })}</span>;
}

function StatBar({ stats, threshold }) {
  return (
    <div className="stats-row">
      <div className="stat info"><div className="stat-val">{stats.total}</div><div className="stat-lbl">SKUs flagged</div><div className="stat-sub" style={{ color: '#2563eb' }}>≤ {threshold} units</div></div>
      <div className="stat danger"><div className="stat-val">{stats.negative}</div><div className="stat-lbl">Negative</div><div className="stat-sub" style={{ color: '#dc2626' }}>oversold</div></div>
      <div className="stat danger"><div className="stat-val">{stats.oos}</div><div className="stat-lbl">Out of stock</div><div className="stat-sub" style={{ color: '#dc2626' }}>0 units</div></div>
      <div className="stat warn"><div className="stat-val">{stats.critical}</div><div className="stat-lbl">Critical</div><div className="stat-sub" style={{ color: '#d97706' }}>1–3 units</div></div>
      <div className="stat success"><div className="stat-val">{stats.good}</div><div className="stat-lbl">Good</div><div className="stat-sub" style={{ color: '#059669' }}>10+ units</div></div>
    </div>
  );
}

function LowStockTab({ inventory, search, setSearch, quality, setQuality, page, setPage }) {
  const filtered = useMemo(() => {
    if (!search.trim()) return inventory;
    const q = search.toLowerCase();
    return inventory.filter(r => r.sku.toLowerCase().includes(q) || r.description.toLowerCase().includes(q) || (r.model_name || '').toLowerCase().includes(q));
  }, [inventory, search]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="panel">
      <div className="tbl-card">
        <div className="toolbar">
          <div className="search-wrap"><i className="ti ti-search" aria-hidden="true"></i><input className="search-inp" placeholder="Search SKU or description..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} /></div>
          <div className="seg">
            <button className={`seg-btn${quality === 'both' ? ' active' : ''}`} onClick={() => { setQuality('both'); setPage(1); }}>All</button>
            <button className={`seg-btn${quality === 'new' ? ' active' : ''}`} onClick={() => { setQuality('new'); setPage(1); }}>New</button>
            <button className={`seg-btn${quality === 'refurbished' ? ' active' : ''}`} onClick={() => { setQuality('refurbished'); setPage(1); }}>Refurb</button>
          </div>
          <div className="result-ct">{filtered.length} SKUs</div>
        </div>
        <div className="tbl-scroll">
          <table>
            <thead><tr>
              <th style={{ width: '14%' }}>SKU</th><th style={{ width: '28%' }}>Description</th>
              <th style={{ width: '8%' }}>Quality</th><th style={{ width: '8%' }}>On hand</th>
              <th style={{ width: '8%' }}>Committed</th><th style={{ width: '8%' }}>Receiving</th>
              <th style={{ width: '8%' }}>Available</th><th style={{ width: '18%' }}>Status</th>
            </tr></thead>
            <tbody>
              {paginated.map((r, i) => {
                const s = getStatus(r.available);
                return (
                  <tr key={i}>
                    <td><div className="sku">{r.sku}</div><div className="model-name">{r.model_name}</div></td>
                    <td title={r.description}>{r.description}</td>
                    <td><span className={`badge ${r.quality_id === 'new' ? 'badge-new' : 'badge-ref'}`}>{r.quality_id === 'new' ? 'New' : 'Refurb'}</span></td>
                    <td><span className="oh" style={{ color: r.on_hand < 0 ? '#dc2626' : 'var(--color-text-primary)' }}>{r.on_hand}</span></td>
                    <td style={{ fontFamily: 'monospace', color: 'var(--color-text-secondary)' }}>{r.committed}</td>
                    <td><span className="receiving">+{r.receiving || 0}</span></td>
                    <td><span className="oh" style={{ color: getAvailColor(r.available) }}>{r.available}</span></td>
                    <td><span className={`pill ${s.cls}`}><i className={`ti ${s.icon}`} aria-hidden="true"></i>{s.label}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="tbl-footer">
          <button className="export-btn" onClick={() => exportCSV(filtered, [{ key: 'sku', label: 'SKU' }, { key: 'description', label: 'Description' }, { key: 'quality_id', label: 'Quality' }, { key: 'on_hand', label: 'On Hand' }, { key: 'committed', label: 'Committed' }, { key: 'receiving', label: 'Receiving' }, { key: 'available', label: 'Available' }], 'low-stock.csv')}>
            <i className="ti ti-download" style={{ fontSize: 12 }} aria-hidden="true"></i>Export CSV
          </button>
          <div className="pag">
            <button className="pag-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
            <div className="pag-info">Page {page} of {totalPages} · {filtered.length} items</div>
            <button className="pag-btn" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RestockTab({ inventory, page, setPage }) {
  const totalPages = Math.max(1, Math.ceil(inventory.length / PAGE_SIZE));
  const paginated = inventory.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  return (
    <div className="panel">
      <div className="tbl-card">
        <div className="toolbar">
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Last restock date and estimated days of stock left based on 30-day order velocity</div>
          <div className="result-ct" style={{ marginLeft: 'auto' }}>{inventory.length} SKUs</div>
        </div>
        <div className="tbl-scroll">
          <table>
            <thead><tr>
              <th style={{ width: '13%' }}>SKU</th><th style={{ width: '25%' }}>Description</th>
              <th style={{ width: '7%' }}>Quality</th><th style={{ width: '7%' }}>Available</th>
              <th style={{ width: '10%' }}>30d orders</th><th style={{ width: '18%' }}>Last restocked</th>
              <th style={{ width: '20%' }}>Days of stock left</th>
            </tr></thead>
            <tbody>
              {paginated.map((r, i) => {
                const days = getDaysLeft(r.available, r.orders_30d);
                const restock = formatRestockDate(r.last_restock_date);
                return (
                  <tr key={i}>
                    <td><div className="sku">{r.sku}</div><div className="model-name">{r.model_name}</div></td>
                    <td title={r.description}>{r.description}</td>
                    <td><span className={`badge ${r.quality_id === 'new' ? 'badge-new' : 'badge-ref'}`}>{r.quality_id === 'new' ? 'New' : 'Refurb'}</span></td>
                    <td><span className="oh" style={{ color: getAvailColor(r.available) }}>{r.available}</span></td>
                    <td style={{ fontFamily: 'monospace', color: 'var(--color-text-secondary)' }}>{r.orders_30d || 0}</td>
                    <td>
                      <div style={{ fontSize: 11, color: 'var(--color-text-primary)' }}>{restock.date}</div>
                      <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>{restock.ago}</div>
                    </td>
                    <td><span className={`days-chip ${days.cls}`}>{days.icon && <i className={`ti ${days.icon}`} style={{ fontSize: 10 }} aria-hidden="true"></i>}{days.label}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="tbl-footer">
          <div></div>
          <div className="pag">
            <button className="pag-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
            <div className="pag-info">Page {page} of {totalPages} · {inventory.length} items</div>
            <button className="pag-btn" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChartTab({ inventory }) {
  const critical = useMemo(() => inventory.filter(r => r.available <= 5).slice(0, 15), [inventory]);
  const max = Math.max(...critical.map(r => Math.abs(r.available)), 1);
  return (
    <div className="panel">
      <div className="tbl-card" style={{ padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)', marginBottom: 4 }}>Critical items — 5 units or fewer</div>
        <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 16 }}>Top {critical.length} most urgent SKUs sorted by available stock</div>
        {critical.length === 0 ? <div className="empty"><i className="ti ti-mood-happy" aria-hidden="true"></i><span>No critical items!</span></div> :
          critical.map((r, i) => {
            const color = r.available < 0 ? '#dc2626' : r.available === 0 ? '#dc2626' : r.available <= 3 ? '#d97706' : '#6b7280';
            const pct = Math.max(2, Math.round((Math.abs(r.available) / max) * 100));
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <div style={{ fontSize: 10, color: 'var(--color-text-secondary)', width: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0, fontFamily: 'monospace' }}>{r.sku}</div>
                <div style={{ flex: 1, height: 22, background: 'var(--color-background-secondary)', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: pct + '%', height: '100%', background: color, borderRadius: 4, display: 'flex', alignItems: 'center', paddingLeft: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 500, color: '#fff', whiteSpace: 'nowrap' }}>{r.available}</span>
                  </div>
                </div>
                <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', width: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>{r.description.substring(0, 30)}</div>
              </div>
            );
          })
        }
      </div>
    </div>
  );
}

function POTab({ pos, loading }) {
  const freightLabel = { apptBooked: 'Appt booked', pendingAppt: 'Pending appt', onRail: 'On rail', onVessel: 'On vessel', atPort: 'At port', delivered: 'Delivered', inProduction: 'In production' };
  if (loading) return <div className="loading"><i className="ti ti-loader-2" style={{ fontSize: 20 }} aria-hidden="true"></i>Loading POs...</div>;
  return (
    <div className="panel">
      <div className="tbl-card">
        <div className="tbl-scroll">
          <table>
            <thead><tr>
              <th style={{ width: '12%' }}>PO number</th><th style={{ width: '15%' }}>Container</th>
              <th style={{ width: '10%' }}>Shipping line</th><th style={{ width: '13%' }}>Status</th>
              <th style={{ width: '13%' }}>Freight status</th><th style={{ width: '10%' }}>ETA</th>
              <th style={{ width: '8%' }}>Lines</th><th style={{ width: '8%' }}>Units</th>
            </tr></thead>
            <tbody>
              {pos.map((p, i) => {
                const eta = p.eta ? new Date(p.eta).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) : '—';
                const statusCls = p.status === 'In Transit' ? 's-transit' : p.status === 'In Production' ? 's-prod' : 's-other';
                return (
                  <tr key={i}>
                    <td style={{ fontFamily: 'monospace', fontWeight: 500 }}>{p.po_number}</td>
                    <td><div className="sku">{p.container || '—'}</div></td>
                    <td style={{ color: 'var(--color-text-secondary)' }}>{p.shipping_line || '—'}</td>
                    <td><span className={`status-pill ${statusCls}`}>{p.status}</span></td>
                    <td style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{freightLabel[p.freight_status] || p.freight_status || '—'}</td>
                    <td style={{ fontWeight: 500 }}>{eta}</td>
                    <td style={{ fontFamily: 'monospace', color: 'var(--color-text-secondary)' }}>{p.line_items || 0}</td>
                    <td style={{ fontFamily: 'monospace', color: 'var(--color-text-secondary)' }}>{p.total_units || 0}</td>
                  </tr>
                );
              })}
              {pos.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', padding: 30, color: 'var(--color-text-tertiary)' }}>No incoming POs found</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function CrossFCTab({ inventory, page, setPage }) {
  const totalPages = Math.max(1, Math.ceil(inventory.length / PAGE_SIZE));
  const paginated = inventory.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  function transferOption(r) {
    const rm = r.royalmount ?? 999, la = r.langley ?? 999, wi = r.windsor ?? 999;
    if (rm <= 0 && la > 0) return { label: 'Transfer from Langley', available: la };
    if (rm <= 0 && wi > 0) return { label: 'Transfer from Windsor', available: wi };
    if (rm <= 3 && la > 3) return { label: 'Transfer from Langley', available: la };
    if (rm <= 3 && wi > 3) return { label: 'Transfer from Windsor', available: wi };
    return null;
  }
  return (
    <div className="panel">
      <div className="tbl-card">
        <div className="toolbar">
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Same SKU across all 3 Canadian FCs — blue badge shows transfer opportunities</div>
          <div className="result-ct" style={{ marginLeft: 'auto' }}>{inventory.length} SKUs</div>
        </div>
        <div className="tbl-scroll">
          <table>
            <thead><tr>
              <th style={{ width: '13%' }}>SKU</th><th style={{ width: '26%' }}>Description</th>
              <th style={{ width: '7%' }}>Quality</th>
              <th style={{ width: '11%', textAlign: 'center' }}>Royalmount</th>
              <th style={{ width: '9%', textAlign: 'center' }}>Langley</th>
              <th style={{ width: '9%', textAlign: 'center' }}>Windsor</th>
              <th style={{ width: '25%' }}>Transfer option</th>
            </tr></thead>
            <tbody>
              {paginated.map((r, i) => {
                const t = transferOption(r);
                return (
                  <tr key={i}>
                    <td><div className="sku">{r.sku}</div><div className="model-name">{r.model_name}</div></td>
                    <td title={r.description}>{r.description}</td>
                    <td><span className={`badge ${r.quality_id === 'new' ? 'badge-new' : 'badge-ref'}`}>{r.quality_id === 'new' ? 'New' : 'Refurb'}</span></td>
                    <td style={{ textAlign: 'center', fontFamily: 'monospace', fontWeight: 500, color: getAvailColor(r.royalmount ?? 0) }}>{r.royalmount ?? '—'}</td>
                    <td style={{ textAlign: 'center', fontFamily: 'monospace', fontWeight: 500, color: getAvailColor(r.langley ?? 0) }}>{r.langley ?? '—'}</td>
                    <td style={{ textAlign: 'center', fontFamily: 'monospace', fontWeight: 500, color: getAvailColor(r.windsor ?? 0) }}>{r.windsor ?? '—'}</td>
                    <td>{t ? <span className="days-chip days-transfer"><i className="ti ti-arrow-right" style={{ fontSize: 10 }} aria-hidden="true"></i>{t.label} ({t.available} units)</span> : <span className="days-chip days-na">None available</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="tbl-footer">
          <div></div>
          <div className="pag">
            <button className="pag-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
            <div className="pag-info">Page {page} of {totalPages} · {inventory.length} items</div>
            <button className="pag-btn" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState('lowstock');
  const [inventory, setInventory] = useState([]);
  const [pos, setPos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [poLoading, setPoLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastSync, setLastSync] = useState(null);
  const [location, setLocation] = useState('royalmount');
  const [threshold, setThreshold] = useState(10);
  const [thresholdInput, setThresholdInput] = useState('10');
  const [quality, setQuality] = useState('both');
  const [category, setCategory] = useState('all');
  const [model, setModel] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const availableModels = category !== 'all' ? (MODELS_BY_CATEGORY[category] || []) : [];

  const fetchInventory = useCallback(async (tab) => {
    try {
      const t = tab || activeTab;
      const params = new URLSearchParams({ location, threshold, quality, category, model, tab: t });
      const res = await fetch(`/api/inventory?${params}`);
      const data = await res.json();
      if (data.error) throw new Error(data.details || data.error);
      if (t === 'pos') { setPos(data.pos || []); setPoLoading(false); }
      else { setInventory(data.inventory || []); }
      setLastSync(new Date());
      setError(null);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); setPoLoading(false); }
  }, [location, threshold, quality, category, model, activeTab]);

  useEffect(() => {
    setLoading(true); setPage(1);
    fetchInventory(activeTab);
    const id = setInterval(() => fetchInventory(activeTab), 60000);
    return () => clearInterval(id);
  }, [fetchInventory, activeTab]);

  function handleTabChange(tab) {
    setActiveTab(tab); setPage(1); setSearch('');
    if (tab === 'pos') { setPoLoading(true); fetchInventory('pos'); }
    else fetchInventory(tab);
  }

  const stats = useMemo(() => ({
    total: inventory.length,
    negative: inventory.filter(r => r.available < 0).length,
    oos: inventory.filter(r => r.available === 0).length,
    critical: inventory.filter(r => r.available > 0 && r.available <= 3).length,
    good: inventory.filter(r => r.available >= 10).length,
  }), [inventory]);

  const locationName = LOCATIONS.find(l => l.id === location)?.name || 'All warehouses';

  return (
    <div className="shell">
      <div className="sidebar">
        <div className="logo-row">
          <div className="logo-mark">C</div>
          <div><div className="logo-title">Inventory</div><div className="logo-sub">Stock monitor</div></div>
        </div>
        <div className="s-label">Warehouses</div>
        {LOCATIONS.map(l => (
          <button key={l.id} className={`nav-item${location === l.id ? ' active' : ''}`} onClick={() => { setLocation(l.id); setPage(1); }}>
            <i className={`ti ${l.icon}`} aria-hidden="true"></i>{l.name}
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
          <select className="filter-sel" value={category} onChange={e => { setCategory(e.target.value === 'All categories' ? 'all' : e.target.value); setModel('all'); setPage(1); }}>
            {CATEGORIES.map(c => <option key={c} value={c === 'All categories' ? 'all' : c}>{c}</option>)}
          </select>
        </div>
        <div className="filter-block">
          <div className="filter-lbl">Model</div>
          <select className="filter-sel" value={model} onChange={e => { setModel(e.target.value); setPage(1); }} disabled={availableModels.length === 0}>
            <option value="all">All models</option>
            {availableModels.map(m => <option key={m} value={m}>{m}</option>)}
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
          <div className="foot-updated"><i className="ti ti-clock" style={{ fontSize: 12 }} aria-hidden="true"></i>{lastSync ? <Clock /> : '—'}</div>
          <div className="foot-note">Auto-refreshes every 60s</div>
        </div>
      </div>

      <div className="main">
        <div className="topbar">
          <div><div className="page-title">{locationName}</div><div className="page-sub">{quality === 'both' ? 'New & Refurbished' : quality === 'new' ? 'New' : 'Refurbished'} · ≤ {threshold} units available</div></div>
          <div className="topbar-right">
            <div className="badge-live"><div className="pulse"></div>Live</div>
            <button className="btn-sm" onClick={() => { setLoading(true); fetchInventory(activeTab); }}>
              <i className="ti ti-refresh" style={{ fontSize: 13 }} aria-hidden="true"></i>Refresh
            </button>
          </div>
        </div>

        {activeTab !== 'pos' && activeTab !== 'crossfc' && <StatBar stats={stats} threshold={threshold} />}

        <div className="tabs">
          {TABS.map(t => (
            <button key={t.id} className={`tab${activeTab === t.id ? ' active' : ''}`} onClick={() => handleTabChange(t.id)}>
              <i className={`ti ${t.icon}`} aria-hidden="true"></i>{t.label}
              {t.id === 'lowstock' && inventory.length > 0 && activeTab !== 'restock' && <span className="tab-badge">{stats.negative + stats.oos + stats.critical}</span>}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="loading"><i className="ti ti-loader-2" style={{ fontSize: 20, animation: 'spin 1s linear infinite' }} aria-hidden="true"></i>Loading...</div>
        ) : error ? (
          <div className="error-msg"><i className="ti ti-alert-circle" style={{ fontSize: 20 }} aria-hidden="true"></i>{error}</div>
        ) : (
          <>
            {activeTab === 'lowstock' && <LowStockTab inventory={inventory} search={search} setSearch={setSearch} quality={quality} setQuality={setQuality} page={page} setPage={setPage} />}
            {activeTab === 'restock' && <RestockTab inventory={inventory} page={page} setPage={setPage} />}
            {activeTab === 'chart' && <ChartTab inventory={inventory} />}
            {activeTab === 'pos' && <POTab pos={pos} loading={poLoading} />}
            {activeTab === 'crossfc' && <CrossFCTab inventory={inventory} page={page} setPage={setPage} />}
          </>
        )}
      </div>
    </div>
  );
}
