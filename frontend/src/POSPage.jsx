import { useState, useEffect } from 'react'

const STORES = Array.from({ length: 10 }, (_, i) => i + 1)

export default function POSPage() {
  const [store,     setStore]     = useState(1)
  const [itemId,    setItemId]    = useState('')
  const [quantity,  setQuantity]  = useState(1)
  const [products,  setProducts]  = useState([])
  const [todayLog,  setTodayLog]  = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [flash,     setFlash]     = useState(null)   // { type: 'ok'|'err', msg }

  useEffect(() => {
    fetch('/api/v1/products')
      .then(r => r.json())
      .then(d => {
        const active = (d.products || []).filter(p => p.is_active)
        setProducts(active)
        if (active.length) setItemId(active[0].item_id)
      })
      .catch(() => {})
  }, [])

  const fetchLog = () => {
    fetch(`/api/v1/sales/today?store=${store}`)
      .then(r => r.json())
      .then(d => setTodayLog(d.sales || []))
      .catch(() => {})
  }

  useEffect(() => { fetchLog() }, [store])

  const productMap = Object.fromEntries(products.map(p => [p.item_id, p]))

  const handleRecord = async (e) => {
    e.preventDefault()
    if (!itemId) return
    setSubmitting(true)
    setFlash(null)
    try {
      const res = await fetch('/api/v1/sales/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store_id: store, item_id: Number(itemId), quantity: Number(quantity) }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      const name = productMap[Number(itemId)]?.name ?? `Item ${itemId}`
      setFlash({ type: 'ok', msg: `Recorded: ${quantity} × ${name}` })
      setQuantity(1)
      fetchLog()
    } catch (err) {
      setFlash({ type: 'err', msg: err.message })
    } finally {
      setSubmitting(false)
    }
  }

  const totalToday = todayLog.reduce((s, r) => s + r.quantity, 0)

  return (
    <div className="dm-page">
      <div className="dm-toolbar">
        <div className="dm-toolbar-left">
          <h2 className="dm-title">Point of Sale</h2>
          <span className="dm-count">Record today's sales — updates dashboard stock in real time</span>
        </div>
      </div>

      <div className="pos-layout">

        {/* ── Entry form ── */}
        <div className="panel pos-form-panel">
          <h3 className="admin-card-title">Record Sale</h3>

          <form onSubmit={handleRecord} className="pos-form">
            <div className="form-group">
              <label className="filter-label">Store</label>
              <select className="filter-select" value={store}
                onChange={e => { setStore(+e.target.value); setFlash(null) }}>
                {STORES.map(s => <option key={s} value={s}>#{s} — Store {s}</option>)}
              </select>
            </div>

            <div className="form-group">
              <label className="filter-label">Product</label>
              <select className="filter-select" value={itemId}
                onChange={e => setItemId(e.target.value)}>
                {products.map(p => (
                  <option key={p.item_id} value={p.item_id}>
                    #{p.item_id} — {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="filter-label">Quantity Sold</label>
              <input
                className="form-input"
                type="number"
                min="1"
                max="9999"
                value={quantity}
                onChange={e => setQuantity(Math.max(1, +e.target.value))}
              />
            </div>

            {flash && (
              <div className={flash.type === 'ok' ? 'upload-success' : 'error-box'}
                style={{ padding: '0.6rem 0.9rem', marginBottom: '0.5rem' }}>
                {flash.type === 'ok' && <span className="upload-success-icon">✓</span>}
                {flash.msg}
              </div>
            )}

            <button type="submit" className="btn btn-primary" style={{ width: '100%' }}
              disabled={submitting || !itemId}>
              {submitting ? 'Recording…' : '+ Record Sale'}
            </button>
          </form>

          <p className="chart-note" style={{ marginTop: '1rem' }}>
            Sales recorded here reduce current stock on the Dashboard instantly.
            Run <strong>Daily Ingestion</strong> in Admin Panel to include today's sales in future forecasts.
          </p>
        </div>

        {/* ── Today's log ── */}
        <div className="panel pos-log-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '1rem' }}>
            <h3 className="admin-card-title" style={{ margin: 0 }}>Today's Sales Log</h3>
            <span className="dm-count">{totalToday} units sold today · Store #{store}</span>
          </div>

          {todayLog.length === 0 ? (
            <p className="empty-state">No sales recorded today for Store #{store}.</p>
          ) : (
            <div className="table-wrap">
              <table className="rec-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Category</th>
                    <th style={{ textAlign: 'right' }}>Units Sold Today</th>
                  </tr>
                </thead>
                <tbody>
                  {todayLog
                    .sort((a, b) => b.quantity - a.quantity)
                    .map(r => {
                      const p = productMap[r.item_id]
                      return (
                        <tr key={r.item_id}>
                          <td className="td-product">
                            <div className="product-name">{p?.name ?? `Item ${r.item_id}`}</div>
                            <div className="product-sku">#{r.item_id}</div>
                          </td>
                          <td><span className="category-chip">{p?.category ?? '—'}</span></td>
                          <td style={{ textAlign: 'right', fontWeight: 600, color: '#6366f1' }}>
                            {r.quantity}
                          </td>
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
