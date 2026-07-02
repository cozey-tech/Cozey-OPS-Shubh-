import React, { useState, useEffect, useCallback, useMemo } from 'react';
import './App.css';

// ─── Constants ────────────────────────────────────────────────────────────────

const LOCATIONS = [
  { id: 'royalmount', name: 'Royalmount FC' },
  { id: 'langley',    name: 'Langley FC' },
  { id: 'windsor',    name: 'Windsor FC' },
];

const CATEGORIES = ['All categories','Accessories','Bedroom','Chairs','Dining',
                    'Metal Legs','Rugs','Sofas','Storage','Tables'];

const MODELS_BY_CATEGORY = {
  'Accessories': ['deco-acc'],
  'Bedroom': ['ara-bed','bedding','cozey-mattress','talus'],
  'Chairs': ['mira','mistral','naos','vela'],
  'Dining': ['multi','orsa','ushi','vela'],
  'Metal Legs': ['metal-legs'],
  'Rugs': ['rugs','rugs-2.5x8','rugs-3x5','rugs-5x8','rugs-8x10','rugs-9x12'],
  'Sofas': ['altus','atmosphere','ciello','ciello-1','ciello-2','ciello-3','ciello-xl',
            'ciello-xl-3','cozey-original','gaia','gaia-xl','luna','mistral','neptune','orian','shinuk'],
  'Storage': ['altitude','aurora','mensa','stella','theia'],
  'Tables': [],
};

const PAGE_SIZES = [25, 50, 100, 200];

function today() { return new Date().toISOString().split('T')[0]; }
function daysAgo(n) { return new Date(Date.now() - n * 86400000).toISOString().split('T')[0]; }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getStatus(available) {
  if (available < 0)  return { label: 'Negative',     cls: 'pill-neg',  icon: 'ti-alert-triangle' };
  if (available === 0) return { label: 'Out of stock', cls: 'pill-oos',  icon: 'ti-circle-x' };
  if (available <= 3)  return { label: 'Critical',     cls: 'pill-crit', icon: 'ti-alert-circle' };
  if (available <= 9)  return { label: 'Low',          cls: 'pill-low',  icon: 'ti-minus' };
  return                      { label: 'Good',          cls: 'pill-good', icon: 'ti-circle-check' };
}

function getAvailColor(n) {
  if (n < 0)  return 'var(--color-text-danger)';
  if (n === 0) return 'var(--color-text-danger)';
  if (n <= 3)  return 'var(--color-text-warning)';
  if (n <= 9)  return 'var(--color-text-secondary)';
  return 'var(--color-text-success)';
}

function formatRestockDate(dateStr) {
  if (!dateStr) return { date: 'Never restocked', ago: 'No PO history' };
  const d = new Date(dateStr);
  const days = Math.floor((Date.now() - d) / 86400000);
  return {
    date: d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }),
    ago:  days === 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days} days ago`,
  };
}

function getDaysLeft(available, orders30d) {
  if (!orders30d || orders30d === 0) return { label: 'No demand data', cls: 'days-na' };
  if (available <= 0) return { label: '0 days', cls: 'days-urgent', icon: 'ti-flame' };
  const days = Math.round(available / (orders30d / 30));
  if (days < 1)  return { label: 'Less than 1 day', cls: 'days-urgent', icon: 'ti-flame' };
  if (days <= 7) return { label: `~${days} days`,   cls: 'days-warn',   icon: 'ti-clock' };
  return               { label: `~${days} days`,   cls: 'days-ok',     icon: 'ti-check' };
}

function escapeCell(v) {
  const s = String(v ?? '');
  const safe = /^[=+\-@]/.test(s) ? "'" + s : s;
  return '"' + safe.replace(/"/g, '""') + '"';
}

function exportCSV(data, headers, filename) {
  const rows = data.map(r => headers.map(h => escapeCell(r[h.key])).join(','));
  const csv  = [headers.map(h => h.label).join(','), ...rows].join('\n');
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = filename;
  a.click();
}

function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id); }, []);
  return <span>{now.toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' })}</span>;
}

// ─── Date Range Picker ────────────────────────────────────────────────────────

function DateRangePicker({ dateFrom, dateTo, onChange }) {
  return (
    <div className="date-range-wrap">
      <input type="date" className="filter-sel-inline" value={dateFrom}
        max={dateTo} onChange={e => onChange(e.target.value, dateTo)} />
      <span className="date-range-sep">→</span>
      <input type="date" className="filter-sel-inline" value={dateTo}
        min={dateFrom} max={today()} onChange={e => onChange(dateFrom, e.target.value)} />
    </div>
  );
}

// ─── Barcode rendering ────────────────────────────────────────────────────────

function renderBarcodeSVG(num, width = 200, height = 50) {
  const str = String(num).padStart(9, '0');
  const patterns = { '0':'212222','1':'222122','2':'222221','3':'121223','4':'121322',
                     '5':'131222','6':'122213','7':'122312','8':'132212','9':'221213' };
  let bars = [];
  for (let ch of str) {
    for (let b of (patterns[ch] || '111111').split('')) bars.push(parseInt(b));
  }
  const totalUnits = bars.reduce((s, b) => s + b, 0);
  const unitW = width / totalUnits;
  let x = 0;
  const rects = bars.map((w, i) => {
    const rect = i % 2 === 0
      ? `<rect x="${x.toFixed(2)}" y="0" width="${(w * unitW).toFixed(2)}" height="${height}" fill="#111"/>`
      : '';
    x += w * unitW;
    return rect;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${rects}</svg>`;
}

function BarcodeLabel({ part }) {
  const svgBarcode = renderBarcodeSVG(part.barcode || 0, 180, 40);
  return (
    <div className="label-card">
      <div className="label-header"><span className="label-brand">COZEY</span><span className="label-location">Royalmount FC</span></div>
      <div className="label-sku">{part.sku}</div>
      <div className="label-desc">{part.description}</div>
      <div dangerouslySetInnerHTML={{ __html: svgBarcode }} />
      <div className="label-barcode-num">{String(part.barcode || 0).padStart(9, '0')}</div>
      {(part.length || part.weight) && (
        <div className="label-dims">
          {part.length && <span>L: {part.length}"</span>}
          {part.width  && <span>W: {part.width}"</span>}
          {part.height && <span>H: {part.height}"</span>}
          {part.weight && <span>{part.weight} lb</span>}
        </div>
      )}
    </div>
  );
}

// ─── Inventory Section ────────────────────────────────────────────────────────

function InventorySection({ location, activeView }) {
  const [inventory, setInventory] = useState([]);
  const [apiStats, setApiStats]   = useState({ total: 0, negative: 0, oos: 0, critical: 0, good: 0 });
  const [totalCount, setTotalCount] = useState(0);
  const [truncated,  setTruncated]  = useState(false);
  const [pos, setPos]               = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [lastSync, setLastSync]     = useState(null);
  const [threshold, setThreshold]   = useState(10);
  const [thresholdInput, setThresholdInput] = useState('10');
  const [quality,   setQuality]     = useState('both');
  const [category,  setCategory]    = useState('all');
  const [model,     setModel]       = useState('all');
  const [search,    setSearch]      = useState('');
  const [page,      setPage]        = useState(1);
  const [pageSize,  setPageSize]    = useState(50);
  const [etaFilter, setEtaFilter]   = useState('all');

  const availableModels = category !== 'all' ? (MODELS_BY_CATEGORY[category] || []) : [];
  const isInvTab = activeView.startsWith('inv-');
  const isPosTab = activeView === 'inv-pos';

  const fetchInventory = useCallback(async () => {
    if (!isInvTab) return;
    setLoading(true);
    try {
      const tab = activeView === 'inv-pos' ? 'pos' : activeView.replace('inv-', '');
      const params = new URLSearchParams({ location, threshold, quality, category, model, tab });
      if (isPosTab) params.set('etaFilter', etaFilter);
      const res  = await fetch(`/api/inventory?${params}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (isPosTab) {
        setPos(data.pos || []);
      } else {
        setInventory(data.inventory || []);
        if (data.stats) setApiStats(data.stats);
        setTotalCount(data.totalCount || 0);
        setTruncated(data.truncated   || false);
      }
      setLastSync(new Date());
      setError(null);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [location, threshold, quality, category, model, activeView, etaFilter, isInvTab, isPosTab]);

  useEffect(() => {
    setPage(1);
    fetchInventory();
    const id = setInterval(() => { if (!document.hidden) fetchInventory(); }, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [fetchInventory]);

  const filtered = useMemo(() => {
    if (activeView !== 'inv-lowstock' || !search.trim()) return inventory;
    const q = search.toLowerCase();
    return inventory.filter(r =>
      r.sku?.toLowerCase().includes(q) ||
      r.description?.toLowerCase().includes(q) ||
      (r.model_name || '').toLowerCase().includes(q),
    );
  }, [inventory, search, activeView]);

  const totalPages  = Math.max(1, Math.ceil(filtered.length / pageSize));
  const clampedPage = Math.min(page, totalPages);
  const paginated   = filtered.slice((clampedPage - 1) * pageSize, clampedPage * pageSize);

  // Stats row — shown on low stock and chart only, with accurate numbers from API CTE
  const showStats = activeView === 'inv-lowstock' || activeView === 'inv-chart';

  return (
    <div className="section-wrap">
      {/* Filters — hidden on POs tab (different filters shown there) */}
      {!isPosTab && (
        <div className="section-filters">
          <select className="filter-sel-inline" value={quality} onChange={e => { setQuality(e.target.value); setPage(1); }}>
            <option value="both">New & Refurb</option>
            <option value="new">New only</option>
            <option value="refurbished">Refurb only</option>
          </select>
          <select className="filter-sel-inline" value={category} onChange={e => { setCategory(e.target.value === 'All categories' ? 'all' : e.target.value); setModel('all'); setPage(1); }}>
            {CATEGORIES.map(c => <option key={c} value={c === 'All categories' ? 'all' : c}>{c}</option>)}
          </select>
          <select className="filter-sel-inline" value={model} onChange={e => { setModel(e.target.value); setPage(1); }} disabled={availableModels.length === 0}>
            <option value="all">All models</option>
            {availableModels.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <div className="thresh-inline">
            <span className="thresh-lbl">Threshold:</span>
            <input className="thresh-inp-sm" type="number" min="1" max="100" value={thresholdInput}
              onChange={e => setThresholdInput(e.target.value)}
              onBlur={() => { const v = parseInt(thresholdInput); if (v > 0) { setThreshold(v); setPage(1); } }}
              onKeyDown={e => { if (e.key === 'Enter') { const v = parseInt(thresholdInput); if (v > 0) { setThreshold(v); setPage(1); } } }}
            />
            <span className="thresh-lbl">units</span>
          </div>
          <div className="filter-sync"><i className="ti ti-clock" aria-hidden="true"></i>{lastSync ? <Clock /> : '—'}</div>
        </div>
      )}

      {/* POs tab — date filter only */}
      {isPosTab && (
        <div className="section-filters">
          <select className="filter-sel-inline" value={etaFilter} onChange={e => setEtaFilter(e.target.value)}>
            <option value="all">All upcoming</option>
            <option value="today">Arriving today</option>
            <option value="week">This week</option>
            <option value="next7">Next 7 days</option>
            <option value="next30">Next 30 days</option>
          </select>
          <div className="filter-sync"><i className="ti ti-clock" aria-hidden="true"></i>{lastSync ? <Clock /> : '—'}</div>
        </div>
      )}

      {/* Stats row — only on low stock and chart, numbers from API CTE (accurate) */}
      {showStats && (
        <div className="stats-row">
          <div className="stat info"><div className="stat-val">{apiStats.total}</div><div className="stat-lbl">Flagged</div><div className="stat-sub" style={{ color: 'var(--color-text-info)' }}>≤ {threshold}</div></div>
          <div className="stat danger"><div className="stat-val">{apiStats.negative}</div><div className="stat-lbl">Negative</div></div>
          <div className="stat danger"><div className="stat-val">{apiStats.oos}</div><div className="stat-lbl">Out of stock</div></div>
          <div className="stat warn"><div className="stat-val">{apiStats.critical}</div><div className="stat-lbl">Critical</div></div>
          <div className="stat success"><div className="stat-val">{apiStats.good}</div><div className="stat-lbl">Good</div></div>
        </div>
      )}

      {loading ? <div className="loading"><i className="ti ti-loader-2" style={{ animation: 'spin 1s linear infinite' }} aria-hidden="true"></i>Loading...</div>
      : error   ? <div className="error-msg"><i className="ti ti-alert-circle" aria-hidden="true"></i>{error}</div>
      : (
        <>
          {activeView === 'inv-lowstock' && (
            <div className="tbl-section">
              <div className="tbl-toolbar">
                <div className="search-wrap"><i className="ti ti-search" aria-hidden="true"></i>
                  <input className="search-inp" placeholder="Search SKU or description..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
                </div>
                <select className="filter-sel-inline" value={pageSize} onChange={e => { setPageSize(parseInt(e.target.value)); setPage(1); }}>
                  {PAGE_SIZES.map(s => <option key={s} value={s}>{s} per page</option>)}
                </select>
                <span className="result-ct">{filtered.length} SKUs{truncated ? ` (first ${inventory.length} of ${totalCount})` : ''}</span>
              </div>
              <div className="tbl-scroll">
                <table><thead><tr>
                  <th style={{width:'14%'}}>SKU</th><th style={{width:'28%'}}>Description</th>
                  <th style={{width:'8%'}}>Quality</th><th style={{width:'7%'}}>On hand</th>
                  <th style={{width:'7%'}}>Committed</th><th style={{width:'8%'}}>Receiving</th>
                  <th style={{width:'8%'}}>Available</th><th style={{width:'20%'}}>Status</th>
                </tr></thead>
                  <tbody>{paginated.map((r, i) => { const s = getStatus(r.available); return (
                    <tr key={r.sku + (r.quality_id || '') + i}>
                      <td><div className="sku">{r.sku}</div><div className="model-name">{r.model_name}</div></td>
                      <td title={r.description}>{r.description}</td>
                      <td><span className={`badge ${r.quality_id === 'new' ? 'badge-new' : 'badge-ref'}`}>{r.quality_id === 'new' ? 'New' : 'Refurb'}</span></td>
                      <td><span className="oh" style={{color: r.on_hand < 0 ? 'var(--color-text-danger)' : 'inherit'}}>{r.on_hand}</span></td>
                      <td style={{fontFamily:'monospace',color:'var(--color-text-secondary)'}}>{r.committed}</td>
                      <td><span className="receiving">+{r.receiving || 0}</span></td>
                      <td><span className="oh" style={{color: getAvailColor(r.available)}}>{r.available}</span></td>
                      <td><span className={`pill ${s.cls}`}><i className={`ti ${s.icon}`} aria-hidden="true"></i>{s.label}</span></td>
                    </tr>); })}
                  </tbody>
                </table>
              </div>
              <div className="tbl-footer">
                <button className="export-btn" onClick={() => exportCSV(filtered, [
                  {key:'sku',label:'SKU'},{key:'description',label:'Description'},{key:'quality_id',label:'Quality'},
                  {key:'on_hand',label:'On Hand'},{key:'committed',label:'Committed'},{key:'receiving',label:'Receiving'},{key:'available',label:'Available'}
                ], 'low-stock.csv')}><i className="ti ti-download" aria-hidden="true"></i>Export CSV</button>
                <div className="pag">
                  <button className="pag-btn" disabled={clampedPage===1} onClick={() => setPage(p=>p-1)}>← Prev</button>
                  <span className="pag-info">Page {clampedPage} of {totalPages} · {filtered.length} items</span>
                  <button className="pag-btn" disabled={clampedPage===totalPages} onClick={() => setPage(p=>p+1)}>Next →</button>
                </div>
              </div>
              {truncated && <div className="truncation-notice"><i className="ti ti-info-circle" aria-hidden="true"></i>Showing first {inventory.length} of {totalCount} SKUs. Use filters to narrow results.</div>}
            </div>
          )}

          {activeView === 'inv-restock' && (
            <div className="tbl-section">
              <div className="tbl-toolbar">
                <select className="filter-sel-inline" value={pageSize} onChange={e => { setPageSize(parseInt(e.target.value)); setPage(1); }}>
                  {PAGE_SIZES.map(s => <option key={s} value={s}>{s} per page</option>)}
                </select>
                <span className="result-ct">{inventory.length} SKUs{truncated ? ` of ${totalCount}` : ''}</span>
              </div>
              <div className="tbl-scroll">
                <table><thead><tr>
                  <th style={{width:'13%'}}>SKU</th><th style={{width:'25%'}}>Description</th>
                  <th style={{width:'7%'}}>Quality</th><th style={{width:'7%'}}>Available</th>
                  <th style={{width:'10%'}}>30d orders</th><th style={{width:'18%'}}>Last restocked</th>
                  <th style={{width:'20%'}}>Days left</th>
                </tr></thead>
                  <tbody>{paginated.map((r, i) => { const dl = getDaysLeft(r.available, r.orders_30d); const restock = formatRestockDate(r.last_restock_date); return (
                    <tr key={r.sku + (r.quality_id || '') + i}>
                      <td><div className="sku">{r.sku}</div><div className="model-name">{r.model_name}</div></td>
                      <td title={r.description}>{r.description}</td>
                      <td><span className={`badge ${r.quality_id === 'new' ? 'badge-new' : 'badge-ref'}`}>{r.quality_id === 'new' ? 'New' : 'Refurb'}</span></td>
                      <td><span className="oh" style={{color: getAvailColor(r.available)}}>{r.available}</span></td>
                      <td style={{fontFamily:'monospace',color:'var(--color-text-secondary)'}}>{r.orders_30d || 0}</td>
                      <td><div style={{fontSize:11}}>{restock.date}</div><div style={{fontSize:10,color:'var(--color-text-tertiary)'}}>{restock.ago}</div></td>
                      <td><span className={`days-chip ${dl.cls}`}>{dl.icon && <i className={`ti ${dl.icon}`} aria-hidden="true"></i>}{dl.label}</span></td>
                    </tr>); })}
                  </tbody>
                </table>
              </div>
              <div className="tbl-footer">
                <button className="export-btn" onClick={() => exportCSV(inventory, [
                  {key:'sku',label:'SKU'},{key:'description',label:'Description'},{key:'available',label:'Available'},
                  {key:'orders_30d',label:'30d Orders'},{key:'last_restock_date',label:'Last Restock'}
                ], 'restock-intel.csv')}><i className="ti ti-download" aria-hidden="true"></i>Export CSV</button>
                <div className="pag">
                  <button className="pag-btn" disabled={clampedPage===1} onClick={() => setPage(p=>p-1)}>← Prev</button>
                  <span className="pag-info">Page {clampedPage} of {totalPages} · {filtered.length} items</span>
                  <button className="pag-btn" disabled={clampedPage===totalPages} onClick={() => setPage(p=>p+1)}>Next →</button>
                </div>
              </div>
            </div>
          )}

          {activeView === 'inv-chart' && (
            <div className="chart-section">
              <div className="chart-title">Critical items — {threshold} units or fewer</div>
              <div className="chart-sub">Top {Math.min(inventory.filter(r => r.available <= threshold).length, 15)} most urgent SKUs</div>
              <div className="tbl-footer" style={{marginBottom:12,border:'none',background:'transparent',padding:'0'}}>
                <button className="export-btn" onClick={() => exportCSV(inventory, [
                  {key:'sku',label:'SKU'},{key:'description',label:'Description'},{key:'available',label:'Available'}
                ], 'critical-items.csv')}><i className="ti ti-download" aria-hidden="true"></i>Export CSV</button>
              </div>
              {(() => {
                const critical = inventory.filter(r => r.available <= threshold).slice(0, 15);
                const max = Math.max(...critical.map(r => Math.abs(r.available)), 1);
                return critical.map((r, i) => {
                  const color = r.available < 0 ? '#dc2626' : r.available === 0 ? '#dc2626' : r.available <= 3 ? '#d97706' : '#6b7280';
                  const pct   = Math.max(2, Math.round((Math.abs(r.available) / max) * 100));
                  return (
                    <div key={i} className="chart-bar-row">
                      <div className="chart-bar-lbl" title={r.sku}>{r.sku}</div>
                      <div className="chart-bar-track"><div className="chart-bar-fill" style={{width: pct+'%', background: color}}><span>{r.available}</span></div></div>
                      <div className="chart-bar-desc" title={r.description}>{r.description?.substring(0, 35)}</div>
                    </div>
                  );
                });
              })()}
            </div>
          )}

          {activeView === 'inv-pos' && (
            <div className="tbl-section">
              <div className="tbl-scroll">
                <table><thead><tr>
                  <th style={{width:'12%'}}>PO</th><th style={{width:'18%'}}>Container</th>
                  <th style={{width:'10%'}}>Line</th><th style={{width:'12%'}}>Status</th>
                  <th style={{width:'18%'}}>Freight</th><th style={{width:'18%'}}>ETA</th>
                </tr></thead>
                  <tbody>
                    {pos.map((p, i) => {
                      const eta = p.eta ? new Date(p.eta).toLocaleDateString('en-CA', {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
                      return (<tr key={i}>
                        <td style={{fontFamily:'monospace',fontWeight:500}}>{p.po_number}</td>
                        <td><div className="sku">{p.container || '—'}</div></td>
                        <td style={{color:'var(--color-text-secondary)'}}>{p.shipping_line || '—'}</td>
                        <td><span className={`pill ${p.status === 'In Transit' ? 'pill-s' : 'pill-low'}`}>{p.status}</span></td>
                        <td style={{fontSize:11,color:'var(--color-text-secondary)'}}>{p.freight_status || '—'}</td>
                        <td style={{fontWeight:500,fontSize:11}}>{eta}</td>
                      </tr>);
                    })}
                    {pos.length === 0 && <tr><td colSpan={6} style={{textAlign:'center',padding:30,color:'var(--color-text-tertiary)'}}>No incoming POs found</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeView === 'inv-crossfc' && (
            <div className="tbl-section">
              <div className="tbl-toolbar">
                <select className="filter-sel-inline" value={pageSize} onChange={e => { setPageSize(parseInt(e.target.value)); setPage(1); }}>
                  {PAGE_SIZES.map(s => <option key={s} value={s}>{s} per page</option>)}
                </select>
                <span className="result-ct">{inventory.length} SKUs{truncated ? ` of ${totalCount}` : ''}</span>
              </div>
              <div className="tbl-scroll">
                <table><thead><tr>
                  <th style={{width:'13%'}}>SKU</th><th style={{width:'26%'}}>Description</th><th style={{width:'7%'}}>Quality</th>
                  <th style={{width:'11%',textAlign:'center'}}>Royalmount</th>
                  <th style={{width:'9%',textAlign:'center'}}>Langley</th>
                  <th style={{width:'9%',textAlign:'center'}}>Windsor</th>
                  <th style={{width:'25%'}}>Transfer option</th>
                </tr></thead>
                  <tbody>{paginated.map((r, i) => {
                    const rm = r.royalmount ?? null, la = r.langley ?? null, wi = r.windsor ?? null;
                    let transfer = null;
                    if (rm !== null && rm <= 0 && la > 0)  transfer = `Transfer from Langley (${la})`;
                    else if (rm !== null && rm <= 0 && wi > 0)  transfer = `Transfer from Windsor (${wi})`;
                    else if (rm !== null && rm <= 3 && la > 3)  transfer = `Transfer from Langley (${la})`;
                    else if (rm !== null && rm <= 3 && wi > 3)  transfer = `Transfer from Windsor (${wi})`;
                    return (<tr key={i}>
                      <td><div className="sku">{r.sku}</div><div className="model-name">{r.model_name}</div></td>
                      <td title={r.description}>{r.description}</td>
                      <td><span className={`badge ${r.quality_id === 'new' ? 'badge-new' : 'badge-ref'}`}>{r.quality_id === 'new' ? 'New' : 'Refurb'}</span></td>
                      <td style={{textAlign:'center',fontFamily:'monospace',fontWeight:500,color:getAvailColor(rm??0)}}>{rm ?? '—'}</td>
                      <td style={{textAlign:'center',fontFamily:'monospace',fontWeight:500,color:getAvailColor(la??0)}}>{la ?? '—'}</td>
                      <td style={{textAlign:'center',fontFamily:'monospace',fontWeight:500,color:getAvailColor(wi??0)}}>{wi ?? '—'}</td>
                      <td>{transfer ? <span className="days-chip days-transfer"><i className="ti ti-arrow-right" aria-hidden="true"></i>{transfer}</span> : <span className="days-chip days-na">None available</span>}</td>
                    </tr>); })}
                  </tbody>
                </table>
              </div>
              <div className="tbl-footer">
                <button className="export-btn" onClick={() => exportCSV(inventory, [
                  {key:'sku',label:'SKU'},{key:'description',label:'Description'},{key:'quality_id',label:'Quality'},
                  {key:'royalmount',label:'Royalmount'},{key:'langley',label:'Langley'},{key:'windsor',label:'Windsor'}
                ], 'cross-fc.csv')}><i className="ti ti-download" aria-hidden="true"></i>Export CSV</button>
                <div className="pag">
                  <button className="pag-btn" disabled={clampedPage===1} onClick={() => setPage(p=>p-1)}>← Prev</button>
                  <span className="pag-info">Page {clampedPage} of {totalPages} · {filtered.length} items</span>
                  <button className="pag-btn" disabled={clampedPage===totalPages} onClick={() => setPage(p=>p+1)}>Next →</button>
                </div>
              </div>
              {truncated && <div className="truncation-notice"><i className="ti ti-info-circle" aria-hidden="true"></i>Showing first {inventory.length} of {totalCount} SKUs. Use filters to narrow results.</div>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Productivity Section ─────────────────────────────────────────────────────

function ProductivitySection({ location, activeView }) {
  const defaultFrom = daysAgo(6);
  const defaultTo   = today();

  const [data,        setData]        = useState([]);
  const [extra,       setExtra]       = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);
  const [dateFrom,    setDateFrom]    = useState(defaultFrom);
  const [dateTo,      setDateTo]      = useState(defaultTo);
  const [orderInput,  setOrderInput]  = useState('');
  const [orderResult, setOrderResult] = useState(null);
  const [orderLoading,setOrderLoading]= useState(false);
  const [prepInput,   setPrepInput]   = useState('');
  const [prepResult,  setPrepResult]  = useState(null);
  const [lastSync,    setLastSync]    = useState(null);

  const tabMap = {
    'prod-pack':'pack','prod-label':'label','prod-leaderboard':'leaderboard',
    'prod-packtime':'packtime','prod-notscanned':'notscanned',
    'prod-weekly':'weekly','prod-scantrend':'scantrend','prod-prepdrilldown':'prepdrilldown',
  };

  const isLookup = activeView === 'prod-orderlookup' || activeView === 'prod-prepdrilldown';
  // Scan trend and not scanned don't use date range pickers in the API
  const showDateRange = !isLookup && activeView !== 'prod-notscanned' && activeView !== 'prod-scantrend';

  const fetchData = useCallback(async () => {
    const tab = tabMap[activeView];
    if (!tab || isLookup) { setLoading(false); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams({ location, tab, dateFrom, dateTo });
      const res    = await fetch(`/api/productivity?${params}`);
      const json   = await res.json();
      if (json.error) throw new Error(json.error);
      if (activeView === 'prod-leaderboard') { setData(json.packers || []); setExtra(json.labelers || []); }
      else setData(json.data || []);
      setLastSync(new Date());
      setError(null);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [location, activeView, dateFrom, dateTo, isLookup]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchData();
    const id = setInterval(() => { if (!document.hidden) fetchData(); }, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [fetchData]);

  async function lookupOrder() {
    if (!orderInput.trim()) return;
    setOrderLoading(true);
    try {
      const res  = await fetch(`/api/productivity?tab=orderlookup&location=${location}&order=${encodeURIComponent(orderInput.trim())}`);
      const json = await res.json();
      setOrderResult(json.data || []);
    } catch { setOrderResult([]); }
    setOrderLoading(false);
  }

  async function lookupPrep() {
    if (!prepInput.trim()) return;
    setLoading(true);
    try {
      const res  = await fetch(`/api/productivity?tab=prepdrilldown&location=${location}&prep=${encodeURIComponent(prepInput.trim())}`);
      const json = await res.json();
      setPrepResult(json.data || []);
    } catch { setPrepResult([]); }
    setLoading(false);
  }

  const totalScans   = data.reduce((s, r) => s + parseInt(r.total_scans   || 0), 0);
  const totalScanner = data.reduce((s, r) => s + parseInt(r.scanner_scans || 0), 0);
  const scannerPct   = totalScans > 0 ? Math.round(totalScanner / totalScans * 100) : 0;

  if (loading && !isLookup) return <div className="loading"><i className="ti ti-loader-2" style={{animation:'spin 1s linear infinite'}} aria-hidden="true"></i>Loading...</div>;
  if (error)                return <div className="error-msg"><i className="ti ti-alert-circle" aria-hidden="true"></i>{error}</div>;

  return (
    <div className="section-wrap">
      {/* Date range — shown on most productivity tabs */}
      {showDateRange && (
        <div className="section-filters">
          <DateRangePicker dateFrom={dateFrom} dateTo={dateTo}
            onChange={(f, t) => { setDateFrom(f); setDateTo(t); }} />
          {(activeView === 'prod-pack' || activeView === 'prod-label') && (
            <>
              <div className="stat-inline"><span style={{color:'var(--color-text-info)',fontWeight:500}}>{totalScans}</span> total scans</div>
              <div className="stat-inline"><span style={{color:'var(--color-text-success)',fontWeight:500}}>{scannerPct}%</span> scanner</div>
              <div className="stat-inline"><span style={{color:'var(--color-text-warning)',fontWeight:500}}>{100 - scannerPct}%</span> manual</div>
            </>
          )}
          <div className="filter-sync"><i className="ti ti-clock" aria-hidden="true"></i>{lastSync ? <Clock /> : '—'}</div>
        </div>
      )}

      {/* PACK + LABEL */}
      {(activeView === 'prod-pack' || activeView === 'prod-label') && (
        <div className="tbl-section">
          <div className="tbl-scroll">
            <table><thead><tr>
              <th style={{width:'35%'}}>User</th><th style={{width:'18%'}}>Scanner</th>
              <th style={{width:'15%'}}>Manual</th><th style={{width:'32%'}}>Total</th>
            </tr></thead>
              <tbody>{data.map((r, i) => {
                const initials = r.name?.split('.').map(p => p[0]?.toUpperCase()).join('') || '??';
                const colors   = ['#ede9fe,#7c3aed','#dbeafe,#1d4ed8','#d1fae5,#065f46',
                                  '#fef3c7,#92400e','#fce7f3,#9d174d','#e0f2fe,#0369a1'];
                const [bg, fg] = colors[i % colors.length].split(',');
                const total    = parseInt(r.total_scans || 0);
                const maxTotal = parseInt(data[0]?.total_scans || 1);
                return (<tr key={i}>
                  <td><div className="ur"><div className="av" style={{background:bg,color:fg}}>{initials}</div>{r.name}</div></td>
                  <td style={{fontFamily:'monospace',color:'var(--color-text-success)',fontWeight:500}}>{r.scanner_scans}</td>
                  <td style={{fontFamily:'monospace',color:'var(--color-text-warning)'}}>{r.manual_scans}</td>
                  <td><div style={{fontFamily:'monospace',fontWeight:500}}>{total}</div><div className="bm"><div className="bf" style={{width: Math.round(total/maxTotal*100)+'%',background:'#7c3aed'}}></div></div></td>
                </tr>); })}
              </tbody>
            </table>
          </div>
          <div className="tbl-footer">
            <button className="export-btn" onClick={() => exportCSV(data,[
              {key:'name',label:'User'},{key:'scanner_scans',label:'Scanner'},
              {key:'manual_scans',label:'Manual'},{key:'total_scans',label:'Total'}
            ],'scan-report.csv')}><i className="ti ti-download" aria-hidden="true"></i>Export CSV</button>
          </div>
        </div>
      )}

      {/* LEADERBOARD */}
      {activeView === 'prod-leaderboard' && (
        <div className="leaderboard-wrap">
          <div className="leaderboard-col">
            <div className="lb-title"><i className="ti ti-box" aria-hidden="true"></i>Top packers</div>
            {data.map((r, i) => { const initials = r.name?.split('.').map(p=>p[0]?.toUpperCase()).join('')||'??';
              const medals = ['ti-medal','ti-medal-2','ti-medal-3']; const mcolors = ['#d97706','#9ca3af','#d97706'];
              return (<div key={i} className="lb-row">
                <i className={`ti ${medals[i]||'ti-minus'}`} style={{fontSize:20,color:mcolors[i]||'var(--color-text-tertiary)'}} aria-hidden="true"></i>
                <div className="av" style={{background:'#ede9fe',color:'#7c3aed'}}>{initials}</div>
                <div style={{flex:1}}><div className="lb-name">{r.name}</div><div className="lb-sub">{r.total_scans} scans · {r.scanner_pct}% scanner</div></div>
                <div className="lb-score">{r.total_scans}</div>
              </div>); })}
          </div>
          <div className="leaderboard-col">
            <div className="lb-title"><i className="ti ti-tag" aria-hidden="true"></i>Top labelers</div>
            {(extra||[]).map((r, i) => { const initials = r.name?.split('.').map(p=>p[0]?.toUpperCase()).join('')||'??';
              const medals = ['ti-medal','ti-medal-2','ti-medal-3']; const mcolors = ['#d97706','#9ca3af','#d97706'];
              return (<div key={i} className="lb-row">
                <i className={`ti ${medals[i]||'ti-minus'}`} style={{fontSize:20,color:mcolors[i]||'var(--color-text-tertiary)'}} aria-hidden="true"></i>
                <div className="av" style={{background:'#dbeafe',color:'#1d4ed8'}}>{initials}</div>
                <div style={{flex:1}}><div className="lb-name">{r.name}</div><div className="lb-sub">{r.total_scans} scans · {r.scanner_pct}% scanner</div></div>
                <div className="lb-score">{r.total_scans}</div>
              </div>); })}
          </div>
        </div>
      )}

      {/* ORDER LOOKUP */}
      {activeView === 'prod-orderlookup' && (
        <div className="lookup-section">
          <div className="lookup-box">
            <div className="lookup-title">Who labeled each part of this order?</div>
            <div style={{fontSize:12,color:'var(--color-text-secondary)',marginBottom:8}}>Enter the short order number (e.g. 369427) — not the full Shopify ID</div>
            <div className="lookup-row">
              <input className="lookup-inp" placeholder="e.g. 369427" value={orderInput}
                onChange={e => setOrderInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && lookupOrder()} />
              <button className="lookup-btn" onClick={lookupOrder} disabled={orderLoading}>
                <i className="ti ti-search" aria-hidden="true"></i>{orderLoading ? 'Searching...' : 'Search'}
              </button>
            </div>
          </div>
          {orderResult && (
            <div className="tbl-section" style={{marginTop:12}}>
              <div className="tbl-scroll">
                <table><thead><tr>
                  <th style={{width:'15%'}}>SKU</th><th style={{width:'35%'}}>Description</th>
                  <th style={{width:'20%'}}>Labeled by</th><th style={{width:'15%'}}>Method</th><th style={{width:'15%'}}>Time</th>
                </tr></thead>
                  <tbody>{orderResult.length === 0
                    ? <tr><td colSpan={5} style={{textAlign:'center',padding:30,color:'var(--color-text-tertiary)'}}>No results — try the short order number (e.g. 369427)</td></tr>
                    : orderResult.map((r, i) => (<tr key={i}>
                        <td style={{fontFamily:'monospace',fontSize:11}}>{r.sku}</td>
                        <td title={r.description}>{r.description}</td>
                        <td style={{fontWeight:r.labeled_by?500:400,color:r.labeled_by?'var(--color-text-primary)':'var(--color-text-tertiary)'}}>{r.labeled_by || 'Not labeled'}</td>
                        <td>{r.label_scan_method ? <span className={`pill ${r.label_scan_method==='SCANNER'?'pill-s':'pill-m'}`}>{r.label_scan_method==='SCANNER'?'Scanner':'Manual'}</span> : '—'}</td>
                        <td style={{fontSize:10,color:'var(--color-text-secondary)'}}>{r.labeled_at ? new Date(r.labeled_at).toLocaleTimeString('en-CA',{hour:'2-digit',minute:'2-digit'}) : '—'}</td>
                      </tr>))}
                  </tbody>
                </table>
              </div>
              {orderResult.length > 0 && <div className="tbl-footer"><button className="export-btn" onClick={() => exportCSV(orderResult,[
                {key:'sku',label:'SKU'},{key:'description',label:'Description'},
                {key:'labeled_by',label:'Labeled By'},{key:'label_scan_method',label:'Method'},{key:'labeled_at',label:'Time'}
              ],'order-scan-report.csv')}><i className="ti ti-download" aria-hidden="true"></i>Export CSV</button></div>}
            </div>
          )}
        </div>
      )}

      {/* PACK TIME — now shows top products by scan volume */}
      {activeView === 'prod-packtime' && (
        <div className="chart-section">
          <div className="chart-title">Top products by pack scan volume</div>
          <div className="chart-sub">Selected date range · minimum 3 scans per product</div>
          {data.length === 0 ? <div style={{color:'var(--color-text-tertiary)',padding:20}}>No pack scan data for this date range</div> :
            data.map((r, i) => {
              const max = parseInt(data[0]?.scan_count || 1);
              const pct = Math.max(5, Math.round(parseInt(r.scan_count || 0) / max * 100));
              const color = '#7c3aed';
              return (<div key={i} className="chart-bar-row">
                <div className="chart-bar-lbl" title={r.description}>{r.description?.substring(0,28)}</div>
                <div className="chart-bar-track"><div className="chart-bar-fill" style={{width:pct+'%',background:color}}><span>{r.scan_count}</span></div></div>
                {i===0 && <span className="chart-badge-slow">Most packed</span>}
              </div>); })}
        </div>
      )}

      {/* NOT SCANNED */}
      {activeView === 'prod-notscanned' && (
        <div className="tbl-section">
          <div className="tbl-toolbar">
            <span style={{fontSize:12,color:'var(--color-text-secondary)'}}>Items missing label or pack scan today</span>
            <span className="result-ct">{data.length} items</span>
          </div>
          <div className="tbl-scroll">
            <table><thead><tr>
              <th style={{width:'15%'}}>Prep</th><th style={{width:'15%'}}>SKU</th>
              <th style={{width:'28%'}}>Description</th><th style={{width:'10%'}}>Carrier</th>
              <th style={{width:'16%'}}>Label</th><th style={{width:'16%'}}>Pack</th>
            </tr></thead>
              <tbody>{data.map((r, i) => (<tr key={i}>
                <td style={{fontFamily:'monospace',fontSize:10}}>{r.prep_id}</td>
                <td style={{fontFamily:'monospace',fontSize:11}}>{r.sku}</td>
                <td title={r.description}>{r.description}</td>
                <td><span className="badge badge-new">{r.carrier}</span></td>
                <td><span className={`pill ${r.label_status==='Not labeled'?'pill-neg':'pill-good'}`}>{r.label_status}</span></td>
                <td><span className={`pill ${r.pack_status==='Not packed'?'pill-neg':'pill-good'}`}>{r.pack_status}</span></td>
              </tr>))}
              </tbody>
            </table>
          </div>
          <div className="tbl-footer"><button className="export-btn" onClick={() => exportCSV(data,[
            {key:'prep_id',label:'Prep'},{key:'sku',label:'SKU'},{key:'description',label:'Description'},
            {key:'carrier',label:'Carrier'},{key:'label_status',label:'Label'},{key:'pack_status',label:'Pack'}
          ],'not-scanned.csv')}><i className="ti ti-download" aria-hidden="true"></i>Export CSV</button></div>
        </div>
      )}

      {/* WEEKLY SUMMARY */}
      {activeView === 'prod-weekly' && (
        <div className="tbl-section">
          <div className="tbl-scroll">
            <table><thead><tr>
              <th style={{width:'25%'}}>User</th><th style={{width:'15%'}}>Date</th>
              <th style={{width:'18%'}}>Scanner</th><th style={{width:'15%'}}>Manual</th><th style={{width:'27%'}}>Total</th>
            </tr></thead>
              <tbody>{data.map((r, i) => { const total = parseInt(r.total_scans||0); const max = parseInt(data[0]?.total_scans||1); return (<tr key={i}>
                <td style={{fontWeight:500}}>{r.name}</td>
                <td style={{fontSize:11,color:'var(--color-text-secondary)'}}>{r.scan_date}</td>
                <td style={{fontFamily:'monospace',color:'var(--color-text-success)'}}>{r.scanner_scans}</td>
                <td style={{fontFamily:'monospace',color:'var(--color-text-warning)'}}>{r.manual_scans}</td>
                <td><div style={{fontFamily:'monospace',fontWeight:500}}>{total}</div><div className="bm"><div className="bf" style={{width:Math.round(total/max*100)+'%',background:'#7c3aed'}}></div></div></td>
              </tr>); })}
              </tbody>
            </table>
          </div>
          <div className="tbl-footer"><button className="export-btn" onClick={() => exportCSV(data,[
            {key:'name',label:'User'},{key:'scan_date',label:'Date'},
            {key:'scanner_scans',label:'Scanner'},{key:'manual_scans',label:'Manual'},{key:'total_scans',label:'Total'}
          ],'weekly-summary.csv')}><i className="ti ti-download" aria-hidden="true"></i>Export CSV</button></div>
        </div>
      )}

      {/* SCAN TREND — no date picker, shows last 14 days always */}
      {activeView === 'prod-scantrend' && (
        <div className="chart-section">
          <div className="chart-title">Scanner vs manual trend</div>
          <div className="chart-sub">Last 14 days · pack scans only</div>
          <div style={{display:'flex',alignItems:'flex-end',gap:4,height:160,padding:'10px 0 20px'}}>
            {data.map((r, i) => {
              const max       = Math.max(...data.map(d => parseInt(d.total_scans||0)), 1);
              const h         = Math.max(4, Math.round(parseInt(r.total_scans||0)/max*140));
              const scannerH  = Math.round(parseInt(r.scanner_scans||0)/parseInt(r.total_scans||1)*h);
              const d         = new Date(r.scan_date);
              const label     = d.toLocaleDateString('en-CA',{month:'short',day:'numeric'});
              return (<div key={i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:3}}>
                <div style={{display:'flex',flexDirection:'column',justifyContent:'flex-end',height:140,width:'100%',gap:0}}>
                  <div style={{background:'#7c3aed',borderRadius:'3px 3px 0 0',height:scannerH+'px',width:'100%'}}></div>
                  <div style={{background:'#d97706',height:(h-scannerH)+'px',width:'100%'}}></div>
                </div>
                <div style={{fontSize:8,color:'var(--color-text-tertiary)',textAlign:'center',whiteSpace:'nowrap'}}>{label}</div>
              </div>); })}
          </div>
          <div style={{display:'flex',gap:12,marginTop:4}}>
            <div style={{display:'flex',alignItems:'center',gap:4,fontSize:11,color:'var(--color-text-secondary)'}}><div style={{width:10,height:10,background:'#7c3aed',borderRadius:2}}></div>Scanner</div>
            <div style={{display:'flex',alignItems:'center',gap:4,fontSize:11,color:'var(--color-text-secondary)'}}><div style={{width:10,height:10,background:'#d97706',borderRadius:2}}></div>Manual</div>
          </div>
        </div>
      )}

      {/* PREP DRILL-DOWN */}
      {activeView === 'prod-prepdrilldown' && (
        <div className="lookup-section">
          <div className="lookup-box">
            <div className="lookup-title">Who packed and labeled each part of this prep?</div>
            <div style={{fontSize:12,color:'var(--color-text-secondary)',marginBottom:8}}>Enter a prep ID (e.g. 369427A) or collection prep ID</div>
            <div className="lookup-row">
              <input className="lookup-inp" placeholder="e.g. 369427A" value={prepInput}
                onChange={e => setPrepInput(e.target.value)}
                onKeyDown={e => e.key==='Enter' && lookupPrep()} />
              <button className="lookup-btn" onClick={lookupPrep}><i className="ti ti-search" aria-hidden="true"></i>Search</button>
            </div>
          </div>
          {prepResult && (
            <div className="tbl-section" style={{marginTop:12}}>
              <div className="tbl-scroll">
                <table><thead><tr>
                  <th style={{width:'15%'}}>SKU</th><th style={{width:'30%'}}>Description</th>
                  <th style={{width:'18%'}}>Packed by</th><th style={{width:'12%'}}>Pack method</th>
                  <th style={{width:'18%'}}>Labeled by</th><th style={{width:'12%'}}>Label method</th>
                </tr></thead>
                  <tbody>{prepResult.length===0
                    ? <tr><td colSpan={6} style={{textAlign:'center',padding:30,color:'var(--color-text-tertiary)'}}>No results found</td></tr>
                    : prepResult.map((r,i)=>(<tr key={i}>
                        <td style={{fontFamily:'monospace',fontSize:11}}>{r.sku}</td>
                        <td title={r.description}>{r.description}</td>
                        <td style={{fontWeight:r.packed_by?500:400,color:r.packed_by?'var(--color-text-primary)':'var(--color-text-tertiary)'}}>{r.packed_by||'Not packed'}</td>
                        <td>{r.packing_scan_method?<span className={`pill ${r.packing_scan_method==='SCANNER'?'pill-s':'pill-m'}`}>{r.packing_scan_method==='SCANNER'?'Scanner':'Manual'}</span>:'—'}</td>
                        <td style={{fontWeight:r.labeled_by?500:400,color:r.labeled_by?'var(--color-text-primary)':'var(--color-text-tertiary)'}}>{r.labeled_by||'Not labeled'}</td>
                        <td>{r.label_scan_method?<span className={`pill ${r.label_scan_method==='SCANNER'?'pill-s':'pill-m'}`}>{r.label_scan_method==='SCANNER'?'Scanner':'Manual'}</span>:'—'}</td>
                      </tr>))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Barcode Section ──────────────────────────────────────────────────────────

function BarcodeSection() {
  const [search,      setSearch]      = useState('');
  const [category,    setCategory]    = useState('all');
  const [quality,     setQuality]     = useState('new');
  const [parts,       setParts]       = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [selected,    setSelected]    = useState(new Set());
  const [showPreview, setShowPreview] = useState(false);

  async function doSearch() {
    if (!search.trim()) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ search, category, quality });
      const res    = await fetch(`/api/barcodes?${params}`);
      const data   = await res.json();
      setParts(data.parts || []);
      setSelected(new Set());
      setShowPreview(false);
    } catch {}
    setLoading(false);
  }

  function toggleSelect(sku) {
    setSelected(s => { const n = new Set(s); n.has(sku) ? n.delete(sku) : n.add(sku); return n; });
  }

  function downloadPDF() {
    const selectedParts = parts.filter(p => selected.has(p.sku));
    const labelHTML = selectedParts.map(p => {
      const svgBarcode = renderBarcodeSVG(p.barcode || 0, 220, 50);
      return `<div class="label">
        <div class="brand">COZEY</div>
        <div class="sku">${p.sku}</div>
        <div class="desc">${p.description}</div>
        ${svgBarcode}
        <div class="barcode-num">${String(p.barcode||0).padStart(9,'0')}</div>
        ${p.length ? `<div class="dims">L: ${p.length}" · W: ${p.width}" · H: ${p.height}" · ${p.weight} lb</div>` : ''}
      </div>`;
    }).join('');

    const html = `<!DOCTYPE html><html><head><style>
      body{font-family:monospace;margin:20px;}
      .label{border:1px solid #ccc;padding:10px 14px;margin-bottom:12px;page-break-inside:avoid;width:280px;display:inline-block;margin-right:12px;vertical-align:top;}
      .brand{font-size:10px;font-weight:700;color:#111;margin-bottom:2px;}
      .sku{font-size:13px;font-weight:700;color:#111;margin-bottom:2px;}
      .desc{font-size:9px;color:#374151;margin-bottom:6px;line-height:1.3;}
      svg{display:block;margin-bottom:2px;}
      .barcode-num{font-size:9px;text-align:center;letter-spacing:.1em;margin-bottom:4px;}
      .dims{font-size:8px;color:#6b7280;border-top:0.5px solid #e5e7eb;padding-top:4px;}
    </style></head><body>${labelHTML}</body></html>`;

    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 500);
  }

  return (
    <div className="section-wrap">
      <div className="section-filters">
        <input className="search-inp" style={{maxWidth:280}} placeholder="Search by name, SKU or colour..."
          value={search} onChange={e => setSearch(e.target.value)}
          onKeyDown={e => e.key==='Enter' && doSearch()} />
        <select className="filter-sel-inline" value={category} onChange={e => setCategory(e.target.value === 'All categories' ? 'all' : e.target.value)}>
          {CATEGORIES.map(c => <option key={c} value={c==='All categories'?'all':c}>{c}</option>)}
        </select>
        <select className="filter-sel-inline" value={quality} onChange={e => setQuality(e.target.value)}>
          <option value="new">New only</option>
          <option value="refurbished">Refurb only</option>
          <option value="both">Both</option>
        </select>
        <button className="lookup-btn" onClick={doSearch}><i className="ti ti-search" aria-hidden="true"></i>Search</button>
      </div>

      {loading && <div className="loading"><i className="ti ti-loader-2" style={{animation:'spin 1s linear infinite'}} aria-hidden="true"></i>Searching...</div>}

      {parts.length > 0 && !loading && (
        <>
          <div style={{fontSize:12,color:'var(--color-text-secondary)',padding:'8px 20px'}}>{parts.length} results · {selected.size} selected</div>
          <div className="barcode-grid">
            {parts.map(p => (
              <div key={p.sku} className={`barcode-result-card${selected.has(p.sku) ? ' selected' : ''}`} onClick={() => toggleSelect(p.sku)}>
                <div className={`bc-check${selected.has(p.sku) ? ' checked' : ''}`}>{selected.has(p.sku) && <i className="ti ti-check" aria-hidden="true"></i>}</div>
                <div className="bc-info">
                  <div className="sku">{p.sku}</div>
                  <div style={{fontSize:12,fontWeight:500,color:'var(--color-text-primary)',margin:'2px 0'}}>{p.description}</div>
                  <div style={{display:'flex',gap:6}}>
                    <span className={`badge ${p.quality_id==='new'?'badge-new':'badge-ref'}`}>{p.quality_id==='new'?'New':'Refurb'}</span>
                    <span style={{fontSize:10,color:'var(--color-text-tertiary)'}}>Barcode: {p.barcode}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Sticky action bar — always visible at bottom */}
          {selected.size > 0 && (
            <div className="bc-action-bar">
              <span style={{fontSize:12,color:'var(--color-text-secondary)'}}><strong style={{color:'var(--color-text-primary)'}}>{selected.size} items</strong> selected</span>
              <div style={{display:'flex',gap:8}}>
                <button className="btn-sm" onClick={() => setShowPreview(!showPreview)}><i className="ti ti-eye" aria-hidden="true"></i>{showPreview ? 'Hide' : 'Preview'}</button>
                <button className="lookup-btn" onClick={downloadPDF}><i className="ti ti-download" aria-hidden="true"></i>Download PDF ({selected.size} labels)</button>
              </div>
            </div>
          )}

          {showPreview && selected.size > 0 && (
            <div style={{padding:'12px 20px'}}>
              <div style={{fontSize:12,fontWeight:500,color:'var(--color-text-primary)',marginBottom:8}}>Label preview</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:12}}>
                {parts.filter(p => selected.has(p.sku)).map(p => <BarcodeLabel key={p.sku} part={p} />)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Returns Section ──────────────────────────────────────────────────────────

function ReturnsSection() {
  const [data,    setData]    = useState([]);
  const [models,  setModels]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [days,    setDays]    = useState('30');
  const [model,   setModel]   = useState('all');

  const fetchReturns = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ days, model });
      const res    = await fetch(`/api/returns?${params}`);
      const json   = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json.returns   || []);
      setModels(json.models  || []);
      setError(null);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [days, model]);

  useEffect(() => { fetchReturns(); }, [fetchReturns]);

  const byModel = useMemo(() => {
    const map = {};
    data.forEach(r => {
      const key = r.model_name || 'Unknown';
      if (!map[key]) map[key] = { model: key, category: r.category, total: 0, damaged: 0, missing: 0, incorrect: 0, customerPref: 0, other: 0 };
      const count = parseInt(r.count || 0);
      map[key].total += count;
      if (r.error_type === 'CUSTOMER_PREFERENCE' || r.flow_name === 'customer-preference') {
        map[key].customerPref += count;
      } else if (r.flow_name === 'damaged-item')         map[key].damaged   += count;
      else if (r.flow_name === 'missing-item')    map[key].missing      += count;
      else if (r.flow_name === 'incorrect-item')  map[key].incorrect    += count;
      else map[key].other += count;
    });
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [data]);

  const totalReturns = byModel.reduce((s, r) => s + r.total, 0);

  if (loading) return <div className="loading"><i className="ti ti-loader-2" style={{animation:'spin 1s linear infinite'}} aria-hidden="true"></i>Loading returns...</div>;
  if (error)   return <div className="error-msg"><i className="ti ti-alert-circle" aria-hidden="true"></i>{error}</div>;

  return (
    <div className="section-wrap">
      <div className="section-filters">
        <select className="filter-sel-inline" value={days} onChange={e => setDays(e.target.value)}>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="60">Last 60 days</option>
          <option value="90">Last 90 days</option>
        </select>
        <select className="filter-sel-inline" value={model} onChange={e => setModel(e.target.value)}>
          <option value="all">All models</option>
          {models.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <div className="stat-inline"><span style={{color:'var(--color-text-info)',fontWeight:500}}>{totalReturns}</span> total returns</div>
        <button className="export-btn" onClick={() => exportCSV(byModel,[
          {key:'model',label:'Model'},{key:'category',label:'Category'},{key:'total',label:'Total'},
          {key:'damaged',label:'Damaged'},{key:'missing',label:'Missing'},
          {key:'incorrect',label:'Incorrect'},{key:'customerPref',label:'Customer Preference'}
        ],'returns.csv')}><i className="ti ti-download" aria-hidden="true"></i>Export CSV</button>
      </div>
      <div className="tbl-section">
        <div className="tbl-scroll">
          <table><thead><tr>
            <th style={{width:'15%'}}>Model</th><th style={{width:'10%'}}>Category</th>
            <th style={{width:'8%'}}>Total</th><th style={{width:'17%'}}>Damaged</th>
            <th style={{width:'17%'}}>Missing</th><th style={{width:'17%'}}>Incorrect</th>
            <th style={{width:'16%'}}>Cust. Pref.</th>
          </tr></thead>
            <tbody>{byModel.map((r, i) => {
              const maxTotal = byModel[0]?.total || 1;
              function bar(val, color) {
                return <div style={{display:'flex',alignItems:'center',gap:6}}>
                  <div style={{flex:1,height:6,background:'var(--color-background-secondary)',borderRadius:3,overflow:'hidden'}}>
                    <div style={{width:Math.round(val/maxTotal*100)+'%',height:'100%',background:color,borderRadius:3}}></div>
                  </div>
                  <span style={{fontSize:10,fontFamily:'monospace',color}}>{val}</span>
                </div>;
              }
              return (<tr key={i}>
                <td style={{fontWeight:500}}>{r.model}</td>
                <td><span className="badge badge-new">{r.category}</span></td>
                <td style={{fontFamily:'monospace',fontWeight:500}}>{r.total}</td>
                <td>{bar(r.damaged,      '#dc2626')}</td>
                <td>{bar(r.missing,      '#d97706')}</td>
                <td>{bar(r.incorrect,    '#7c3aed')}</td>
                <td>{bar(r.customerPref, '#6b7280')}</td>
              </tr>); })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [activeView, setActiveView] = useState('inv-lowstock');
  const [location,   setLocation]   = useState('royalmount');

  const locationName = LOCATIONS.find(l => l.id === location)?.name || 'Royalmount FC';

  const NAV = [
    { section: 'Inventory', items: [
      { id: 'inv-lowstock', label: 'Low stock',     icon: 'ti-list' },
      { id: 'inv-restock',  label: 'Restock intel', icon: 'ti-calendar-stats' },
      { id: 'inv-chart',    label: 'Critical chart', icon: 'ti-chart-bar' },
      { id: 'inv-pos',      label: 'Incoming POs',  icon: 'ti-ship' },
      { id: 'inv-crossfc',  label: 'Cross-FC',      icon: 'ti-arrows-exchange' },
    ]},
    { section: 'Productivity', items: [
      { id: 'prod-pack',          label: 'Pack scans',     icon: 'ti-box' },
      { id: 'prod-label',         label: 'Label scans',    icon: 'ti-tag' },
      { id: 'prod-leaderboard',   label: 'Leaderboard',    icon: 'ti-trophy' },
      { id: 'prod-orderlookup',   label: 'Order lookup',   icon: 'ti-search' },
      { id: 'prod-packtime',      label: 'Pack volume',    icon: 'ti-clock' },
      { id: 'prod-notscanned',    label: 'Not scanned',    icon: 'ti-alert-circle' },
      { id: 'prod-weekly',        label: 'Weekly summary', icon: 'ti-calendar' },
      { id: 'prod-scantrend',     label: 'Scan trend',     icon: 'ti-trending-up' },
      { id: 'prod-prepdrilldown', label: 'Prep drill-down',icon: 'ti-zoom-in' },
    ]},
    { section: 'Tools', items: [
      { id: 'barcode',  label: 'Barcode generator',  icon: 'ti-barcode' },
      { id: 'returns',  label: 'Returns by product', icon: 'ti-rotate' },
    ]},
  ];

  const section   = activeView.startsWith('inv-')  ? 'inventory'    :
                    activeView.startsWith('prod-') ? 'productivity'  : activeView;
  const viewTitle = NAV.flatMap(n => n.items).find(i => i.id === activeView)?.label || '';

  return (
    <div className="shell">
      <div className="sidebar">
        <div className="logo-row">
          <div className="logo-mark"><i className="ti ti-building-warehouse" style={{fontSize:14}} aria-hidden="true"></i></div>
          <div><div className="logo-title">Cozey Ops</div><div className="logo-sub">FC operations</div></div>
        </div>
        <div className="sb-loc">
          <div className="sb-loc-label">Location</div>
          <select className="loc-sel" value={location} onChange={e => setLocation(e.target.value)}>
            {LOCATIONS.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        {NAV.map(({ section: sec, items }) => (
          <div key={sec}>
            <div className="s-label">{sec}</div>
            {items.map(item => (
              <button key={item.id} className={`nav-item${activeView === item.id ? ' active' : ''}`} onClick={() => setActiveView(item.id)}>
                <i className={`ti ${item.icon}`} aria-hidden="true"></i>
                <span style={{flex:1}}>{item.label}</span>
              </button>
            ))}
            <div className="sb-divider" />
          </div>
        ))}
        <div className="sidebar-foot">
          <div className="foot-updated"><i className="ti ti-clock" style={{fontSize:12}} aria-hidden="true"></i><Clock /></div>
          <div className="foot-note">Auto-refreshes every 5 mins</div>
        </div>
      </div>

      <div className="main">
        <div className="topbar">
          <div><div className="page-title">{viewTitle}</div><div className="page-sub">{locationName}</div></div>
          <div className="topbar-right"><div className="badge-live"><div className="pulse"></div>Live</div></div>
        </div>
        {section === 'inventory'    && <InventorySection    location={location} activeView={activeView} />}
        {section === 'productivity' && <ProductivitySection location={location} activeView={activeView} />}
        {activeView === 'barcode'   && <BarcodeSection />}
        {activeView === 'returns'   && <ReturnsSection />}
      </div>
    </div>
  );
}
