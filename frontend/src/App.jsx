import { useState, useEffect, useCallback, useRef } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ComposedChart, Area,
} from 'recharts'
import DataManagement from './DataManagement'
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
    const action = r.status === 'Critical' ? `+${r.order_quantity} Order Now`
                 : r.status === 'Watch'    ? `+${Math.round(r.order_quantity * 0.5)} Monitor`
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

const simulateStock = (item, store, avgDaily) => {
  const days = ((item * 17 + store * 31) % 9) + 2
  return Math.round(avgDaily * days)
}

const getStatus = (currentStock, reorderPoint) => {
  if (currentStock < reorderPoint)        return 'Critical'
  if (currentStock < reorderPoint * 1.5)  return 'Watch'
  return 'Healthy'
}

async function apiFetch(path, options) {
  const res = await fetch(path, options)
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
  const [activeTab,    setActiveTab]    = useState('dashboard')
  const [activeModel,  setActiveModel]  = useState('random_forest')
  const [store,        setStore]        = useState(1)
  const [category,     setCategory]     = useState('All')
  const [statusFilter, setStatusFilter] = useState(null)
  const [rawRecs,      setRawRecs]      = useState(null)
  const [recsLoading,  setRecsLoading]  = useState(false)
  const [recsError,    setRecsError]    = useState(null)
  const [selectedItem, setSelectedItem] = useState(null)
  const [forecast7,    setForecast7]    = useState(null)
  const [forecast30,   setForecast30]   = useState(null)
  const [fcastLoading, setFcastLoading] = useState(false)
  const [dbProducts,   setDbProducts]   = useState({})   // item_id → {name, category}
  const [todaySold,    setTodaySold]    = useState({})   // item_id → units sold today
  const tableRef = useRef(null)

  // Fetch product list from DB on mount
  useEffect(() => {
    fetch('/api/v1/products')
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
  const categories = ['All', ...new Set(Object.values(dbProducts).map(p => p.category)
    .filter(Boolean).sort())]

  const recs = rawRecs?.map(r => {
    const baseStock    = simulateStock(r.item, store, r.avg_daily_demand)
    const sold         = todaySold[r.item] ?? 0
    const currentStock = Math.max(0, baseStock - sold)
    return {
      ...r,
      name:         itemLabel(r.item),
      currentStock,
      status:       getStatus(currentStock, r.reorder_point),
      category:     itemCat(r.item),
    }
  })

  const filteredRecs = !recs ? null : recs.filter(r =>
    (category === 'All'   || r.category === category) &&
    (!statusFilter        || r.status   === statusFilter)
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
    try {
      const [d7, d30] = await Promise.all([
        apiFetch('/api/v1/forecast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ store: s, item, horizon_days: 7,  model: activeModel }),
        }),
        apiFetch('/api/v1/forecast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ store: s, item, horizon_days: 30, model: activeModel }),
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
    } catch (_) {}
    finally { setFcastLoading(false) }
  }, [activeModel])

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
  }, [store, loadRecs])

  const handleRowClick = (item) => {
    setSelectedItem(item)
    loadForecasts(store, item)
  }

  return (
    <div className="app">

      {/* ── Header ── */}
      <header className="header">
        <div className="header-brand">
          <span className="brand-icon">🛒</span>
          <span className="brand-name">Inventory Manager</span>
        </div>
        <nav className="header-nav">
          {[
            { id: 'dashboard',        label: 'Dashboard'        },
            { id: 'pos',              label: 'Point of Sale'    },
            { id: 'data-management',  label: 'Data Management'  },
            { id: 'admin',            label: 'Admin Panel'      },
          ].map(t => (
            <span key={t.id}
              className={`nav-tab ${activeTab === t.id ? 'active' : ''}`}
              onClick={() => setActiveTab(t.id)}>
              {t.label}
            </span>
          ))}
        </nav>
      </header>

      {/* ── POS tab ── */}
      {activeTab === 'pos' && <POSPage />}

      {/* ── Data Management tab ── */}
      {activeTab === 'data-management' && <DataManagement />}

      {/* ── Admin Panel tab ── */}
      {activeTab === 'admin' && (
        <AdminPanel activeModel={activeModel} onModelChange={setActiveModel} />
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
              {STORES.map(s => <option key={s} value={s}>#{s} — Store {s}</option>)}
            </select>
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
                { key: 'Critical', cls: 'critical' },
                { key: 'Watch',    cls: 'watch'    },
                { key: 'Healthy',  cls: 'healthy'  },
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
              Loading recommendations… (first request ~30 s while features build)
            </div>
          )}
          {recsError && <div className="error-box" style={{ marginTop: '1rem' }}>Error: {recsError}</div>}

          {filteredRecs && (
            <div className="table-wrap">
              <table className="rec-table">
                <thead>
                  <tr>
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
                      <td className="td-product">
                        <div className="product-name">{r.name}</div>
                        <div className="product-sku">#{r.item}</div>
                      </td>
                      <td>
                        <span className={`status-badge status-${r.status.toLowerCase()}`}>
                          {r.status === 'Critical' && '🔴 '}
                          {r.status === 'Watch'    && '🟡 '}
                          {r.status === 'Healthy'  && '🟢 '}
                          {r.status}
                        </span>
                      </td>
                      <td>{r.currentStock} units</td>
                      <td>{r.forecast_7d} units</td>
                      <td>{r.reorder_point} units</td>
                      <td>
                        {r.status === 'Critical' && (
                          <span className="action-btn action-critical">+{r.order_quantity} Order Now</span>
                        )}
                        {r.status === 'Watch' && (
                          <span className="action-btn action-watch">+{Math.round(r.order_quantity * 0.5)} Monitor</span>
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

          {!fcastLoading && forecast7 && (
            <div className="forecast-section">
              <h4 className="chart-title">
                📈 7-Day Tactical Forecast
                <span className="chart-subtitle">{itemLabel(selectedItem)}</span>
              </h4>
              <ResponsiveContainer width="100%" height={175}>
                <LineChart data={forecast7} margin={{ top: 5, right: 8, left: -15, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={d => d.slice(5)} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={v => [`${v} units`, 'Forecast']} labelFormatter={l => `Date: ${l}`} />
                  <Line type="monotone" dataKey="forecast" name="Forecast"
                    stroke="#6366f1" strokeWidth={2} dot={{ r: 3, fill: '#6366f1' }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {!fcastLoading && forecast30 && (
            <div className="forecast-section">
              <h4 className="chart-title">📅 30-Day Strategic View</h4>
              <ResponsiveContainer width="100%" height={175}>
                <ComposedChart data={forecast30} margin={{ top: 5, right: 8, left: -15, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={d => d.slice(5)} interval={6} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={v => [`${v} units`]} />
                  <Area type="monotone" dataKey="lower" stackId="band" stroke="none" fill="transparent" />
                  <Area type="monotone" dataKey="band"  stackId="band" stroke="none" fill="#e0e7ff" name="±15% band" />
                  <Line type="monotone" dataKey="forecast" name="Forecast"
                    stroke="#6366f1" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
              <p className="chart-note">Shaded area shows ±15% forecast confidence band.</p>
            </div>
          )}
        </aside>

      </div>
      </>}
    </div>
  )
}