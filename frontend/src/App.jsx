import { useState, useEffect, useCallback } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ComposedChart, Area,
} from 'recharts'

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------
const STORES = Array.from({ length: 10 }, (_, i) => i + 1)

const ITEM_NAMES = {
   1: 'Tomatoes',           2: 'Potatoes',           3: 'Onions',
   4: 'Carrots',            5: 'Cucumbers',           6: 'White Bread',
   7: 'Whole Wheat Bread',  8: 'Milk (1L)',            9: 'Yogurt',
  10: 'Butter',            11: 'Eggs (12-pack)',      12: 'Chicken Breast',
  13: 'Beef Mince',         14: 'Lamb',               15: 'Rice (5kg)',
  16: 'Flour (2kg)',        17: 'Sugar (1kg)',         18: 'Sunflower Oil (1L)',
  19: 'Pasta',              20: 'Instant Noodles',    21: 'Water (1.5L)',
  22: 'Carbonated Drinks',  23: 'Orange Juice',       24: 'Tea (100g)',
  25: 'Instant Coffee',     26: 'Sliced Cheese',      27: 'Sour Cream',
  28: 'Kefir',              29: 'Ice Cream',          30: 'Frozen Vegetables',
  31: 'Canned Tomatoes',    32: 'Ketchup',            33: 'Mayonnaise',
  34: 'Salt (1kg)',          35: 'Black Pepper',       36: 'Chips',
  37: 'Chocolate Bar',      38: 'Cookies',            39: 'Candy',
  40: 'Chewing Gum',        41: 'Laundry Detergent',  42: 'Dish Soap',
  43: 'Toilet Paper',       44: 'Shampoo',            45: 'Toothpaste',
  46: 'Wet Wipes',          47: 'Diapers',            48: 'Bananas',
  49: 'Apples',             50: 'Watermelon',
}

const ITEM_CATEGORIES_MAP = {
  'Fresh Produce':   [1, 2, 3, 4, 5, 48, 49, 50],
  'Dairy & Eggs':    [8, 9, 10, 11, 26, 27, 28, 29],
  'Bakery':          [6, 7],
  'Meat & Poultry':  [12, 13, 14],
  'Staples':         [15, 16, 17, 18, 19, 20, 34],
  'Beverages':       [21, 22, 23, 24, 25],
  'Snacks & Sweets': [36, 37, 38, 39, 40],
  'Household':       [41, 42, 43, 44, 45, 46, 47],
  'Frozen & Canned': [30, 31],
  'Condiments':      [32, 33, 35],
}

const ITEM_CATEGORY = {}
Object.entries(ITEM_CATEGORIES_MAP).forEach(([cat, ids]) =>
  ids.forEach(id => (ITEM_CATEGORY[id] = cat))
)

const CATEGORIES = ['All', ...Object.keys(ITEM_CATEGORIES_MAP)]

const itemLabel = id => ITEM_NAMES[id] ?? `Item ${id}`

// Deterministic simulated stock so it doesn't flicker between renders
const simulateStock = (item, store, avgDaily) => {
  const days = ((item * 17 + store * 31) % 9) + 2   // 2–10 days of stock on hand
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
  const [store,        setStore]        = useState(1)
  const [category,     setCategory]     = useState('All')
  const [rawRecs,      setRawRecs]      = useState(null)
  const [recsLoading,  setRecsLoading]  = useState(false)
  const [recsError,    setRecsError]    = useState(null)
  const [selectedItem, setSelectedItem] = useState(null)
  const [forecast7,    setForecast7]    = useState(null)
  const [forecast30,   setForecast30]   = useState(null)
  const [fcastLoading, setFcastLoading] = useState(false)

  // Enrich raw API recs with computed fields
  const recs = rawRecs?.map(r => {
    const currentStock = simulateStock(r.item, store, r.avg_daily_demand)
    return {
      ...r,
      name:         itemLabel(r.item),
      currentStock,
      status:       getStatus(currentStock, r.reorder_point),
      category:     ITEM_CATEGORY[r.item] ?? 'Other',
    }
  })

  const filteredRecs = !recs ? null
    : category === 'All' ? recs
    : recs.filter(r => r.category === category)

  const criticalCount = recs?.filter(r => r.status === 'Critical').length ?? 0

  const loadRecs = useCallback(async (s) => {
    setRecsLoading(true)
    setRecsError(null)
    setRawRecs(null)
    setSelectedItem(null)
    setForecast7(null)
    setForecast30(null)
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
          band:     Math.round(d.forecast * 0.30), // stacked on top of lower → upper
        }))
      )
    } catch (_) {
      // forecast errors are non-critical; panel stays empty
    } finally {
      setFcastLoading(false)
    }
  }, [])

  useEffect(() => { loadRecs(store) }, [store, loadRecs])

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
          <span className="brand-name">Korzinka Inventory AI</span>
        </div>
        <nav className="header-nav">
          <span className="nav-tab active">Dashboard</span>
          <span className="nav-tab">Data Management</span>
          <span className="nav-tab">Admin Panel</span>
        </nav>
      </header>

      {/* ── Alert bar ── */}
      {criticalCount > 0 && (
        <div className="alert-bar">
          ⚠️ <strong>Action Required:</strong> {criticalCount} item{criticalCount !== 1 ? 's' : ''} critically
          low in Store #{store} based on latest 7-day forecast.
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
              onChange={e => setStore(+e.target.value)}
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
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {recs && (
            <div className="status-summary">
              {[
                { key: 'Critical', cls: 'critical' },
                { key: 'Watch',    cls: 'watch'    },
                { key: 'Healthy',  cls: 'healthy'  },
              ].map(({ key, cls }) => (
                <div key={key} className="status-count">
                  <span className={`dot dot-${cls}`} />
                  <span>{recs.filter(r => r.status === key).length} {key}</span>
                </div>
              ))}
            </div>
          )}
        </aside>

        {/* CENTER — Action table */}
        <main className="panel panel-center">
          <h3 className="panel-title">
            Inventory Action Center
            <span className="panel-subtitle"> — Recommended Restock Actions (Next 7 Days)</span>
          </h3>

          {recsLoading && (
            <div className="info-box">Loading recommendations… (first request ~30 s while features build)</div>
          )}
          {recsError && <div className="error-box">Error: {recsError}</div>}

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
                          <span className="action-btn action-critical">
                            +{r.order_quantity} Order Now
                          </span>
                        )}
                        {r.status === 'Watch' && (
                          <span className="action-btn action-watch">
                            +{Math.round(r.order_quantity * 0.5)} Monitor
                          </span>
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
                  <Line
                    type="monotone" dataKey="forecast" name="Forecast"
                    stroke="#2563eb" strokeWidth={2} dot={{ r: 3, fill: '#2563eb' }}
                  />
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
                  {/* Confidence band: transparent base + shaded band stacked on it */}
                  <Area type="monotone" dataKey="lower" stackId="band" stroke="none" fill="transparent" />
                  <Area type="monotone" dataKey="band"  stackId="band" stroke="none" fill="#dbeafe" name="±15% band" />
                  <Line type="monotone" dataKey="forecast" name="Forecast"
                    stroke="#2563eb" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
              <p className="chart-note">Shaded area shows ±15% forecast confidence band.</p>
            </div>
          )}
        </aside>

      </div>
    </div>
  )
}
