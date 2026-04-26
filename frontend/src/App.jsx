import { useState, useEffect, useCallback, useRef } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ComposedChart, Area,
} from 'recharts'
import DataManagement from './DataManagement'
import { AuthProvider, useAuth, authHeaders } from './AuthContext'
import LoginPage from './LoginPage'
import AdminPanel from './AdminPanel'
import POSPage from './POSPage'

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------
const STORES = Array.from({ length: 10 }, (_, i) => i + 1)

// Products come from the DB; this is a fallback while loading
const FALLBACK_NAMES = { 1:'Tomatoes',2:'Potatoes',3:'Onions',4:'Carrots',5:'Cucumbers',
  6:'White Bread',7:'Whole Wheat Bread',8:'Milk (1L)',9:'Yogurt',10:'Butter',
  11:'Eggs (12-pack)',12:'Chicken Breast',13:'Beef Mince',14:'Lamb',15:'Rice (5kg)',
  16:'Flour (2kg)',17:'Sugar (1kg)',18:'Sunflower Oil (1L)',19:'Pasta',20:'Instant Noodles',
  21:'Water (1.5L)',22:'Carbonated Drinks',23:'Orange Juice',24:'Tea (100g)',25:'Instant Coffee',
  26:'Sliced Cheese',27:'Sour Cream',28:'Kefir',29:'Ice Cream',30:'Frozen Vegetables',
  31:'Canned Tomatoes',32:'Ketchup',33:'Mayonnaise',34:'Salt (1kg)',35:'Black Pepper',
  36:'Chips',37:'Chocolate Bar',38:'Cookies',39:'Candy',40:'Chewing Gum',
  41:'Laundry Detergent',42:'Dish Soap',43:'Toilet Paper',44:'Shampoo',45:'Toothpaste',
  46:'Wet Wipes',47:'Diapers',48:'Bananas',49:'Apples',50:'Watermelon',
}

function exportRecsCSV(recs, store) {
  const header = ['Product', 'Item ID', 'Category', 'Status', 'Current Stock',
                  '7-Day Forecast', 'Reorder Point', 'Recommended Action']
  const rows = recs.map(r => {
    const action = r.status === 'Waste Risk' ? 'Transfer Out / Promote'
                 : r.status === 'Critical'   ? `+${r.order_quantity} Order Now`
                 : r.status === 'Overstock'  ? 'Reduce Orders / Transfer'
                 : r.status === 'Watch'      ? `+${Math.round(r.order_quantity * 0.5)} Monitor`
                 : 'No Action Needed'
    return [r.name, r.item, r.category, r.status,
            r.currentStock, r.forecast_7d, r.reorder_point, action]
  })
  const csv  = [header, ...rows].map(row => row.map(v => `"${v}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = Object.assign(document.createElement('a'),
               { href: url, download: `recommendations_store${store}.csv` })
  a.click()
  URL.revokeObjectURL(url)
}

const SHELF_LIFE = {
  'Fresh Produce':   7,
  'Bakery':          3,
  'Meat & Poultry':  5,
  'Dairy & Eggs':   14,
  'Staples':        365,
  'Beverages':      180,
  'Frozen & Canned':365,
  'Condiments':     180,
  'Snacks & Sweets': 90,
  'Household':      365,
}


const getStatus = (currentStock, reorderPoint, forecast7d, avgDaily, category) => {
  const dos       = avgDaily > 0 ? currentStock / avgDaily : 999
  const shelfLife = SHELF_LIFE[category] ?? 30
  if (shelfLife <= 14 && dos > shelfLife) return 'Waste Risk'
  if (currentStock < reorderPoint)         return 'Critical'
  if (currentStock > forecast7d * 2)       return 'Overstock'
  if (currentStock < reorderPoint * 1.5)   return 'Watch'
  return 'Healthy'
}

async function apiFetch(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) },
  })
  if (res.status === 401) {
    localStorage.removeItem('token')
    window.location.reload()
    return
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || res.statusText)
  }
  return res.json()
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
export default function App() {
  return <AuthProvider><AppInner /></AuthProvider>
}

function AppInner() {
  const { user, loading, logout } = useAuth()
  if (loading) return null
  if (!user)   return <LoginPage />
  const [activeTab,    setActiveTab]    = useState('dashboard')
  const [store,        setStore]        = useState(1)
  const [category,     setCategory]     = useState('All')
  const [search,       setSearch]       = useState('')
  const [statusFilter, setStatusFilter] = useState(null)
  const [rawRecs,      setRawRecs]      = useState(null)
  const [recsLoading,  setRecsLoading]  = useState(false)
  const [recsError,    setRecsError]    = useState(null)
  const [selectedItem, setSelectedItem] = useState(null)
  const [forecast7,    setForecast7]    = useState(null)
  const [forecast30,   setForecast30]   = useState(null)
  const [fcastLoading, setFcastLoading] = useState(false)
  const [fullscreenChart, setFullscreenChart] = useState(null)  // '7d' | '30d' | null
  const [dbProducts,   setDbProducts]   = useState({})   // item_id → {name, category}
  const [todaySold,    setTodaySold]    = useState({})   // item_id → units sold today
  const [transfers,      setTransfers]      = useState([])   // inter-store transfer suggestions
  const [transfersError, setTransfersError] = useState(null)
  const [forecastError,  setForecastError]  = useState(null)
  const [markFlash,      setMarkFlash]      = useState(null)
  const [receivingItem,  setReceivingItem]  = useState(null)
  const tableRef = useRef(null)

  // Fetch product list from DB on mount
  useEffect(() => {
    fetch('/api/v1/products', { headers: authHeaders() })
      .then(r => r.json())
      .then(data => {
        const map = {}
        data.products?.forEach(p => { map[p.item_id] = p })
        setDbProducts(map)
      })
      .catch(() => {})   // fallback to FALLBACK_NAMES silently
  }, [])

  const itemLabel  = id => dbProducts[id]?.name     ?? FALLBACK_NAMES[id] ?? `Item ${id}`
  const itemCat    = id => dbProducts[id]?.category ?? 'Other'
  const itemUnit   = id => dbProducts[id]?.unit     ?? 'pcs'
  const categories = ['All', ...new Set(Object.values(dbProducts).map(p => p.category)
    .filter(Boolean).sort())]

  const recs = rawRecs?.map(r => {
    const sold         = todaySold[r.item] ?? 0
    const currentStock = Math.max(0, (r.current_stock ?? 0) - sold)
    return {
      ...r,
      name:         itemLabel(r.item),
      currentStock,
      status:       getStatus(currentStock, r.reorder_point, r.forecast_7d, r.avg_daily_demand, itemCat(r.item)),
      category:     itemCat(r.item),
      unit:         itemUnit(r.item),
    }
  })

  const searchLower  = search.trim().toLowerCase()
  const filteredRecs = !recs ? null : recs.filter(r =>
    (category === 'All'   || r.category === category) &&
    (!statusFilter        || r.status   === statusFilter) &&
    (!searchLower         || r.name.toLowerCase().includes(searchLower) || String(r.item).includes(searchLower))
  )

  const criticalCount = recs?.filter(r => r.status === 'Critical').length ?? 0

  const handleAlertClick = () => {
    setStatusFilter('Critical')
    setCategory('All')
    setTimeout(() => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  const loadRecs = useCallback(async (s) => {
    setRecsLoading(true)
    setRecsError(null)
    setRawRecs(null)
    setSelectedItem(null)
    setForecast7(null)
    setForecast30(null)
    setStatusFilter(null)
    try {
      const data = await apiFetch(`/api/v1/recommendations?store=${s}`)
      setRawRecs(data.recommendations)
    } catch (e) {
      setRecsError(e.message)
    } finally {
      setRecsLoading(false)
    }
  }, [])

  const loadForecasts = useCallback(async (s, item) => {
    setFcastLoading(true)
    setForecast7(null)
    setForecast30(null)
    setForecastError(null)
    try {
      const [d7, d30] = await Promise.all([
        apiFetch('/api/v1/forecast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ store: s, item, horizon_days: 7,  model: 'random_forest' }),
        }),
        apiFetch('/api/v1/forecast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ store: s, item, horizon_days: 30, model: 'random_forest' }),
        }),
      ])
      setForecast7(d7.forecast)
      setForecast30(
        d30.forecast.map(d => ({
          date:     d.date,
          forecast: d.forecast,
          lower:    Math.round(d.forecast * 0.85),
          band:     Math.round(d.forecast * 0.30),
        }))
      )
    } catch (e) { setForecastError(e.message) }
    finally { setFcastLoading(false) }
  }, [])

  useEffect(() => {
    loadRecs(store)
    fetch(`/api/v1/sales/today?store=${store}`)
      .then(r => r.json())
      .then(d => {
        const map = {}
        d.sales?.forEach(s => { map[s.item_id] = s.quantity })
        setTodaySold(map)
      })
      .catch(() => {})
    apiFetch(`/api/v1/transfer-suggestions?store=${store}`)
      .then(d => { setTransfers(d.suggestions ?? []); setTransfersError(null) })
      .catch(() => { setTransfers([]); setTransfersError('Unable to load transfer suggestions') })
  }, [store, loadRecs])

  const handleRowClick = (item) => {
    setSelectedItem(item)
    loadForecasts(store, item)
  }

  const handleMarkReceived = async (itemId, qty) => {
    setReceivingItem(itemId)
    try {
      await apiFetch('/api/v1/stock/receive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store_id: store, item_id: itemId, quantity: qty }),
      })
      setMarkFlash('✓ Stock updated')
      setTimeout(() => setMarkFlash(null), 3000)
      loadRecs(store)
    } catch (e) {
      console.error('Receive failed', e)
    } finally {
      setReceivingItem(null)
    }
  }

  return (
    <div className="app">

      {/* ── Header ── */}
      <header className="header">
        <div className="header-brand">
          <span className="brand-name">Inventory Management System</span>
        </div>
        <nav className="header-nav">
          {[
            { id: 'dashboard',       label: 'Dashboard'       },
            { id: 'pos',             label: 'Point of Sale'   },
            { id: 'data-management', label: 'Data Management' },
            ...(user.role === 'admin' ? [{ id: 'admin', label: 'Admin Panel' }] : []),
          ].map(t => (
            <span key={t.id}
              className={`nav-tab ${activeTab === t.id ? 'active' : ''}`}
              onClick={() => setActiveTab(t.id)}>
              {t.label}
            </span>
          ))}
        </nav>
        <div className="header-user">
          <span className="header-username">
            <span className={`role-badge role-${user.role}`}>{user.role}</span>
            {user.username}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={logout}>Sign out</button>
        </div>
      </header>

      {/* ── POS tab ── */}
      {activeTab === 'pos' && <POSPage onDataUpdated={() => loadRecs(store)} />}

      {/* ── Data Management tab ── */}
      {activeTab === 'data-management' && <DataManagement />}

      {/* ── Admin Panel tab ── */}
      {activeTab === 'admin' && (
        <AdminPanel />
      )}

      {activeTab === 'dashboard' && <>

      {/* ── Alert bar ── */}
      {criticalCount > 0 && (
        <div className="alert-bar">
          ⚠️ <strong>Action Required:</strong>{' '}
          <button className="alert-link" onClick={handleAlertClick}>
            {criticalCount} item{criticalCount !== 1 ? 's' : ''}
          </button>
          {' '}critically low in Store #{store} based on latest 7-day forecast.
        </div>
      )}

      {/* ── Transfer Suggestions — above the table grid ── */}
      {transfersError && (
        <div className="error-box" style={{ margin: '0 1rem 0.75rem' }}>{transfersError}</div>
      )}
      {transfers.length > 0 && (
        <div className="transfers-panel">
          <h3 className="transfers-title">🔄 Inter-Store Transfer Suggestions</h3>
          <p className="transfers-subtitle">
            These products are overstocked in Store #{store}. Transferring them reduces waste and fills gaps elsewhere.
          </p>
          <table className="transfers-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Transfer To</th>
                <th>Qty</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {transfers.map((t, i) => (
                <tr key={i}>
                  <td><strong>{itemLabel(t.item)}</strong></td>
                  <td>Store #{t.to_store}</td>
                  <td>{t.transfer_qty} {itemUnit(t.item)}</td>
                  <td className="transfers-reason">{t.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Three-column layout ── */}
      <div className="layout">

        {/* LEFT — Filters */}
        <aside className="panel panel-left">
          <h3 className="panel-title">Filters &amp; Scope</h3>

          <div className="filter-group">
            <label className="filter-label">Store</label>
            <select
              className="filter-select"
              value={store}
              onChange={e => { setStore(+e.target.value); setStatusFilter(null) }}
            >
              {STORES.map(s => <option key={s} value={s}>Store #{s}</option>)}
            </select>
          </div>

          <div className="filter-group">
            <label className="filter-label">Search</label>
            <input
              className="filter-select"
              type="text"
              placeholder="Name or ID..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <div className="filter-group">
            <label className="filter-label">Category</label>
            <select
              className="filter-select"
              value={category}
              onChange={e => setCategory(e.target.value)}
            >
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {recs && (
            <div className="status-summary">
              <p className="filter-label" style={{ marginBottom: '0.5rem' }}>Status</p>
              {[
                { key: 'Waste Risk', cls: 'waste-risk' },
                { key: 'Critical',   cls: 'critical'   },
                { key: 'Overstock',  cls: 'overstock'  },
                { key: 'Watch',      cls: 'watch'       },
                { key: 'Healthy',    cls: 'healthy'     },
              ].map(({ key, cls }) => (
                <button
                  key={key}
                  className={`status-count ${statusFilter === key ? 'status-count-active' : ''}`}
                  onClick={() => setStatusFilter(statusFilter === key ? null : key)}
                >
                  <span className={`dot dot-${cls}`} />
                  <span>{recs.filter(r => r.status === key).length} {key}</span>
                </button>
              ))}
              {statusFilter && (
                <button className="clear-filter" onClick={() => setStatusFilter(null)}>
                  × Clear filter
                </button>
              )}
            </div>
          )}
        </aside>

        {/* CENTER — Action table */}
        <main className="panel panel-center" ref={tableRef}>
          <div className="center-header">
            <h3 className="panel-title" style={{ marginBottom: 0 }}>
              Inventory Action Center
              <span className="panel-subtitle"> — Restock Actions (Next 7 Days)</span>
            </h3>
            <button className="btn btn-ghost btn-sm" onClick={() => loadRecs(store)}
              disabled={recsLoading} title="Re-fetch stock levels">
              {recsLoading ? '↺ Refreshing…' : '↺ Refresh'}
            </button>
            {statusFilter && (
              <span className="filter-chip">
                {statusFilter}
                <button onClick={() => setStatusFilter(null)}>×</button>
              </span>
            )}
            {filteredRecs?.length > 0 && (
              <button className="btn btn-ghost btn-sm"
                onClick={() => exportRecsCSV(filteredRecs, store)}
                style={{ marginLeft: 'auto' }}>
                ↓ Export CSV
              </button>
            )}
          </div>

          {recsLoading && (
            <div className="info-box" style={{ marginTop: '1rem' }}>
              Loading recommendations… (may take up to 30 seconds on first load)
            </div>
          )}
          {recsError && <div className="error-box" style={{ marginTop: '1rem' }}>Error: {recsError}</div>}

          {markFlash && (
            <div className="upload-success" style={{ marginTop: '0.75rem', padding: '0.6rem 0.9rem' }}>
              <span className="upload-success-icon">✓</span>{markFlash}
            </div>
          )}

          {filteredRecs && (
            <div className="table-wrap">
              <table className="rec-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Product</th>
                    <th>Status</th>
                    <th>Current Stock</th>
                    <th>7-Day Forecast</th>
                    <th>Reorder Point</th>
                    <th>Recommended Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRecs.map(r => (
                    <tr
                      key={r.item}
                      onClick={() => handleRowClick(r.item)}
                      className={selectedItem === r.item ? 'row-selected' : ''}
                    >
                      <td className="td-id">#{r.item}</td>
                      <td className="td-product">
                        <div className="product-name">{r.name}</div>
                        <div className="product-sku">{r.category}</div>
                      </td>
                      <td>
                        <span className={`status-badge status-${r.status.toLowerCase().replace(' ', '-')}`}>
                          {r.status === 'Waste Risk' && '🟠 '}
                          {r.status === 'Critical'   && '🔴 '}
                          {r.status === 'Overstock'  && '🟡 '}
                          {r.status === 'Watch'      && '🟡 '}
                          {r.status === 'Healthy'    && '🟢 '}
                          {r.status}
                        </span>
                      </td>
                      <td>{r.currentStock} {r.unit}</td>
                      <td>{r.forecast_7d} {r.unit}</td>
                      <td>{r.reorder_point} {r.unit}</td>
                      <td>
                        {r.status === 'Waste Risk' && (
                          <span className="action-btn action-waste-risk">Transfer Out / Promote</span>
                        )}
                        {r.status === 'Critical' && (
                          <button className="action-btn action-critical"
                            onClick={e => { e.stopPropagation(); handleMarkReceived(r.item, r.order_quantity) }}
                            disabled={receivingItem === r.item}
                            title="Mark order as received — adds stock">
                            {receivingItem === r.item ? 'Saving…' : `+${r.order_quantity} ${r.unit} · Mark Received`}
                          </button>
                        )}
                        {r.status === 'Overstock' && (
                          <span className="action-btn action-overstock">Reduce Orders / Transfer</span>
                        )}
                        {r.status === 'Watch' && (
                          <button className="action-btn action-watch"
                            onClick={e => { e.stopPropagation(); handleMarkReceived(r.item, Math.round(r.order_quantity * 0.5)) }}
                            disabled={receivingItem === r.item}
                            title="Mark partial order as received">
                            {receivingItem === r.item ? 'Saving…' : `+${Math.round(r.order_quantity * 0.5)} ${r.unit} · Mark Received`}
                          </button>
                        )}
                        {r.status === 'Healthy' && (
                          <span className="action-btn action-healthy">No Action Needed</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </main>

        {/* RIGHT — Demand charts */}
        <aside className="panel panel-right">
          <h3 className="panel-title">Demand Intelligence</h3>

          {!selectedItem && !fcastLoading && (
            <p className="empty-state">Click any row in the table to see demand forecasts.</p>
          )}

          {fcastLoading && <div className="info-box">Loading forecast…</div>}

          {!fcastLoading && forecastError && (
            <div className="error-box">Failed to load forecast: {forecastError}</div>
          )}

          {!fcastLoading && forecast7 && (
            <div className="forecast-section">
              <h4 className="chart-title">
                📈 7-Day Tactical Forecast
                <span className="chart-subtitle">{itemLabel(selectedItem)}</span>
                <button className="chart-expand-btn" onClick={() => setFullscreenChart('7d')} title="Fullscreen">⤢</button>
              </h4>
              <ResponsiveContainer width="100%" height={175}>
                <LineChart data={forecast7} margin={{ top: 5, right: 8, left: -15, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={d => d.slice(5)} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={v => [`${v} ${itemUnit(selectedItem)}`, 'Forecast']} labelFormatter={l => `Date: ${l}`} />
                  <Line type="monotone" dataKey="forecast" name="Forecast"
                    stroke="#6366f1" strokeWidth={2} dot={{ r: 3, fill: '#6366f1' }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {!fcastLoading && forecast30 && (
            <div className="forecast-section">
              <h4 className="chart-title">
                📅 30-Day Strategic View
                <button className="chart-expand-btn" onClick={() => setFullscreenChart('30d')} title="Fullscreen">⤢</button>
              </h4>
              <ResponsiveContainer width="100%" height={175}>
                <ComposedChart data={forecast30} margin={{ top: 5, right: 8, left: -15, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={d => d.slice(5)} interval={6} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={v => [`${v} ${itemUnit(selectedItem)}`]} />
                  <Area type="monotone" dataKey="lower" stackId="band" stroke="none" fill="transparent" />
                  <Area type="monotone" dataKey="band"  stackId="band" stroke="none" fill="#e0e7ff" name="±30% band" />
                  <Line type="monotone" dataKey="forecast" name="Forecast"
                    stroke="#6366f1" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
              <p className="chart-note">Shaded area shows ±30% forecast confidence band.</p>
            </div>
          )}
        </aside>

        {/* Fullscreen chart modal */}
        {fullscreenChart && (forecast7 || forecast30) && (
          <div className="modal-backdrop" onClick={() => setFullscreenChart(null)}>
            <div className="chart-modal" onClick={e => e.stopPropagation()}>
              <div className="chart-modal-header">
                <div>
                  <h3 className="chart-modal-title">
                    {fullscreenChart === '7d' ? '7-Day Tactical Forecast' : '30-Day Strategic View'}
                  </h3>
                  <span className="chart-subtitle">{itemLabel(selectedItem)} — Store #{store}</span>
                </div>
                <button className="modal-close" onClick={() => setFullscreenChart(null)}>×</button>
              </div>

              <div className="chart-modal-body">
                <ResponsiveContainer width="100%" height={340}>
                  {fullscreenChart === '7d' ? (
                    <LineChart data={forecast7} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip formatter={v => [`${v} ${itemUnit(selectedItem)}`, 'Forecast']} labelFormatter={l => `Date: ${l}`} />
                      <Line type="monotone" dataKey="forecast" name="Forecast"
                        stroke="#6366f1" strokeWidth={3} dot={{ r: 5, fill: '#6366f1' }} />
                    </LineChart>
                  ) : (
                    <ComposedChart data={forecast30} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="date" tick={{ fontSize: 12 }} tickFormatter={d => d.slice(5)} interval={4} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip formatter={v => [`${v} ${itemUnit(selectedItem)}`]} />
                      <Area type="monotone" dataKey="lower" stackId="band" stroke="none" fill="transparent" />
                      <Area type="monotone" dataKey="band"  stackId="band" stroke="none" fill="#e0e7ff" name="±30% band" />
                      <Line type="monotone" dataKey="forecast" name="Forecast"
                        stroke="#6366f1" strokeWidth={3} dot={false} />
                    </ComposedChart>
                  )}
                </ResponsiveContainer>

                <div className="chart-insights">
                  {fullscreenChart === '7d' && forecast7.length > 0 && (() => {
                    const vals    = forecast7.map(d => d.forecast)
                    const total   = vals.reduce((a, b) => a + b, 0)
                    const avg     = Math.round(total / vals.length)
                    const peak    = forecast7[vals.indexOf(Math.max(...vals))]
                    const low     = forecast7[vals.indexOf(Math.min(...vals))]
                    const trend   = vals[vals.length - 1] > vals[0] ? 'upward' : 'downward'
                    const trendPct = vals[0] === 0 ? 0 : Math.abs(Math.round(((vals[vals.length-1] - vals[0]) / vals[0]) * 100))
                    return (
                      <div className="insights-grid">
                        <div className="insight-card">
                          <div className="insight-value">{total}</div>
                          <div className="insight-label">Total 7-day demand</div>
                        </div>
                        <div className="insight-card">
                          <div className="insight-value">{avg}</div>
                          <div className="insight-label">Daily average</div>
                        </div>
                        <div className="insight-card insight-highlight">
                          <div className="insight-value">{peak.forecast}</div>
                          <div className="insight-label">Peak — {peak.date}</div>
                        </div>
                        <div className="insight-card">
                          <div className="insight-value">{low.forecast}</div>
                          <div className="insight-label">Lowest — {low.date}</div>
                        </div>
                        <div className="insight-card insight-full">
                          <div className="insight-text">
                            <strong>Interpretation:</strong> Demand is trending <strong>{trend}</strong> by {trendPct}% over the next 7 days.
                            {trend === 'upward'
                              ? ' Consider placing an order ahead of the peak to avoid stockout.'
                              : ' Stock levels should remain adequate — monitor but no immediate action needed.'}
                          </div>
                        </div>
                      </div>
                    )
                  })()}

                  {fullscreenChart === '30d' && forecast30.length > 0 && (() => {
                    const vals    = forecast30.map(d => d.forecast)
                    const total   = vals.reduce((a, b) => a + b, 0)
                    const avg     = Math.round(total / vals.length)
                    const peak    = forecast30[vals.indexOf(Math.max(...vals))]
                    const trend   = vals[vals.length - 1] > vals[0] ? 'upward' : 'downward'
                    const maxUpper = Math.round(Math.max(...vals) * 1.15)
                    const minLower = Math.round(Math.min(...vals) * 0.85)
                    return (
                      <div className="insights-grid">
                        <div className="insight-card">
                          <div className="insight-value">{total}</div>
                          <div className="insight-label">Total 30-day demand</div>
                        </div>
                        <div className="insight-card">
                          <div className="insight-value">{avg}</div>
                          <div className="insight-label">Daily average</div>
                        </div>
                        <div className="insight-card insight-highlight">
                          <div className="insight-value">{peak.forecast}</div>
                          <div className="insight-label">Peak — {peak.date?.slice(5)}</div>
                        </div>
                        <div className="insight-card">
                          <div className="insight-value">{minLower}–{maxUpper}</div>
                          <div className="insight-label">Confidence range</div>
                        </div>
                        <div className="insight-card insight-full">
                          <div className="insight-text">
                            <strong>Interpretation:</strong> Over the next 30 days, demand shows an <strong>{trend}</strong> trend
                            with a total forecasted volume of <strong>{total} {itemUnit(selectedItem)}</strong>.
                            The confidence band (±30%) suggests ordering between <strong>{minLower}</strong> and <strong>{maxUpper}</strong> {itemUnit(selectedItem)}
                            per day to maintain optimal stock levels.
                          </div>
                        </div>
                      </div>
                    )
                  })()}
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
      </>}
    </div>
  )
}