import { useState, useEffect, useRef } from 'react'
import { authHeaders } from './AuthContext'

const STORES = Array.from({ length: 10 }, (_, i) => i + 1)

// ---------------------------------------------------------------------------
// POS CSV Upload with column mapping
// ---------------------------------------------------------------------------

// Common column name guesses per required field
const GUESSES = {
  date:     ['date', 'transaction_date', 'order_date', 'sale_date', 'created_at', 'datetime', 'time', 'dt'],
  store:    ['store', 'store_id', 'store_number', 'branch', 'branch_id', 'shop_id', 'location_id'],
  item:     ['item', 'item_id', 'product_id', 'sku', 'product_sku', 'product_code', 'code', 'barcode'],
  quantity: ['qty', 'quantity', 'sales', 'units_sold', 'quantity_sold', 'qty_sold', 'amount', 'count', 'sold'],
}

const FIELD_LABELS = { date: 'Date', store: 'Store ID', item: 'Item / SKU', quantity: 'Quantity Sold' }

function autoGuess(cols) {
  const lower = cols.map(c => c.toLowerCase())
  const mapping = {}
  for (const [field, candidates] of Object.entries(GUESSES)) {
    const match = candidates.find(c => lower.includes(c))
    if (match) mapping[field] = cols[lower.indexOf(match)]
  }
  return mapping
}

function parseCsvText(text) {
  const lines = text.split('\n').filter(Boolean)
  if (!lines.length) return { cols: [], rows: [] }
  const cols = lines[0].split(',').map(c => c.trim().replace(/^"|"$/g, ''))
  const rows = lines.slice(1, 6).map(l =>
    l.split(',').map(v => v.trim().replace(/^"|"$/g, ''))
  )
  return { cols, rows }
}

function SalesUpload({ onDataUpdated }) {
  const [step,      setStep]      = useState('idle')   // idle | mapping | uploading | done
  const [file,      setFile]      = useState(null)
  const [parsed,    setParsed]    = useState(null)     // { cols, rows }
  const [mapping,   setMapping]   = useState({})
  const [result,    setResult]    = useState(null)
  const [error,     setError]     = useState(null)
  const inputRef = useRef(null)

  const reset = () => {
    setStep('idle'); setFile(null); setParsed(null)
    setMapping({}); setResult(null); setError(null)
  }

  const handleFile = (f) => {
    if (!f) return
    setError(null); setResult(null)
    const reader = new FileReader()
    reader.onload = (e) => {
      const { cols, rows } = parseCsvText(e.target.result)
      const guessed = autoGuess(cols)
      setFile(f)
      setParsed({ cols, rows })
      setMapping(guessed)
      setStep('mapping')
    }
    reader.readAsText(f)
  }

  const mappingComplete = Object.keys(GUESSES).every(f => mapping[f])

  // Build preview rows using current mapping
  const previewRows = parsed?.rows.map(row => {
    const get = (field) => {
      const col = mapping[field]
      const idx = parsed.cols.indexOf(col)
      return idx >= 0 ? row[idx] : '—'
    }
    return [get('date'), get('store'), get('item'), get('quantity')]
  }) ?? []

  const handleUpload = async () => {
    if (!mappingComplete) return
    setStep('uploading'); setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('mapping', JSON.stringify({
        date:     mapping.date,
        store:    mapping.store,
        item:     mapping.item,
        quantity: mapping.quantity,
      }))
      const res  = await fetch('/api/v1/sales/upload-pos', { method: 'POST', body: form, headers: authHeaders() })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setResult(data); setStep('done')
      onDataUpdated?.()
    } catch (e) {
      setError(e.message); setStep('mapping')
    }
  }

  return (
    <div className="panel" style={{ marginBottom: '1.25rem' }}>
      <h3 className="admin-card-title">Sales Data Upload</h3>
      <p className="admin-card-sub">
        Upload any POS report CSV — map your columns to the required fields.
        Order-level rows are automatically aggregated to daily totals.
      </p>

      {/* Step: idle */}
      {step === 'idle' && (
        <div className="upload-zone"
          onClick={() => inputRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f?.name.endsWith('.csv')) handleFile(f) }}>
          <input ref={inputRef} type="file" accept=".csv" style={{ display: 'none' }}
            onChange={e => handleFile(e.target.files[0])} />
          <div className="upload-icon">↑</div>
          <div className="upload-label">Click or drag any POS CSV here</div>
          <div className="upload-hint">Any column names — you'll map them in the next step</div>
        </div>
      )}

      {/* Step: mapping */}
      {step === 'mapping' && parsed && (
        <div className="upload-preview">
          <div className="upload-file-row">
            <span className="upload-filename">{file.name} — {parsed.cols.length} columns detected</span>
            <button className="btn btn-ghost btn-sm" onClick={reset}>× Remove</button>
          </div>

          <p className="upload-preview-label" style={{ marginBottom: '0.75rem' }}>
            Map your CSV columns to the required fields:
          </p>

          <div className="pos-mapping-grid">
            {Object.entries(FIELD_LABELS).map(([field, label]) => (
              <div key={field} className="pos-mapping-row">
                <span className="pos-mapping-label">{label}</span>
                <select
                  className="filter-select"
                  value={mapping[field] || ''}
                  onChange={e => setMapping(m => ({ ...m, [field]: e.target.value }))}
                >
                  <option value="">— select column —</option>
                  {parsed.cols.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                {mapping[field] && (
                  <span className="pos-mapping-sample">
                    e.g. {parsed.rows[0]?.[parsed.cols.indexOf(mapping[field])] ?? ''}
                  </span>
                )}
              </div>
            ))}
          </div>

          {mappingComplete && (
            <>
              <p className="upload-preview-label" style={{ margin: '1rem 0 0.5rem' }}>
                Preview after mapping (first 5 rows):
              </p>
              <div className="table-wrap" style={{ marginBottom: '0.75rem' }}>
                <table className="rec-table">
                  <thead>
                    <tr>
                      <th>Date</th><th>Store</th><th>Item / SKU</th><th>Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, i) => (
                      <tr key={i}>{row.map((v, j) => <td key={j}>{v}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="chart-note">
                Rows with the same date + store + item will be summed. Items not matching a known SKU or ID will be skipped.
              </p>
            </>
          )}

          {error && <div className="error-box" style={{ margin: '0.75rem 0' }}>{error}</div>}

          <button className="btn btn-primary" onClick={handleUpload} disabled={!mappingComplete}>
            Upload & Append to Training Data
          </button>
        </div>
      )}

      {/* Step: uploading */}
      {step === 'uploading' && (
        <div className="info-box">Uploading and processing…</div>
      )}

      {/* Step: done */}
      {step === 'done' && result && (
        <div className="upload-success">
          <div className="upload-success-icon">✓</div>
          <div>
            <strong>Upload successful</strong>
            <div className="upload-success-detail">
              {result.rows_uploaded} daily totals added
              · {result.duplicates_dropped} duplicates overwritten
              · {result.total_rows.toLocaleString()} total rows
              {result.unresolved_items > 0 && ` · ${result.unresolved_items} items skipped (unknown SKU)`}
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={reset} style={{ marginLeft: 'auto' }}>
            Upload another
          </button>
        </div>
      )}
    </div>
  )
}

export default function POSPage({ onDataUpdated }) {
  const [store,     setStore]     = useState(1)
  const [itemId,    setItemId]    = useState('')
  const [quantity,  setQuantity]  = useState(1)
  const [products,  setProducts]  = useState([])
  const [todayLog,  setTodayLog]  = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [flash,     setFlash]     = useState(null)   // { type: 'ok'|'err', msg }
  const [posTab,    setPosTab]    = useState('sale') // 'sale' | 'receive'

  useEffect(() => {
    fetch('/api/v1/products', { headers: authHeaders() })
      .then(r => r.json())
      .then(d => {
        const active = (d.products || []).filter(p => p.is_active)
        setProducts(active)
        if (active.length) setItemId(active[0].item_id)
      })
      .catch(() => {})
  }, [])

  const fetchLog = () => {
    fetch(`/api/v1/sales/today?store=${store}`, { headers: authHeaders() })
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
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
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

  const handleReceive = async (e) => {
    e.preventDefault()
    if (!itemId) return
    setSubmitting(true)
    setFlash(null)
    try {
      const res = await fetch('/api/v1/stock/receive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ store_id: store, item_id: Number(itemId), quantity: Number(quantity) }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      const p = productMap[Number(itemId)]
      setFlash({ type: 'ok', msg: `+${quantity} ${p?.unit ?? 'units'} of ${p?.name ?? `Item ${itemId}`} received into Store #${store}` })
      setQuantity(1)
      onDataUpdated?.()
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

      <SalesUpload onDataUpdated={onDataUpdated} />

      <div className="pos-layout">

        {/* ── Entry form ── */}
        <div className="panel pos-form-panel">

          {/* Tab switcher */}
          <div className="pos-tabs">
            <button className={`pos-tab ${posTab === 'sale'    ? 'active' : ''}`}
              onClick={() => { setPosTab('sale');    setFlash(null) }}>
              Record Sale
            </button>
            <button className={`pos-tab ${posTab === 'receive' ? 'active' : ''}`}
              onClick={() => { setPosTab('receive'); setFlash(null) }}>
              Receive Delivery
            </button>
          </div>

          {/* Shared store + product + quantity fields */}
          <form onSubmit={posTab === 'sale' ? handleRecord : handleReceive} className="pos-form">
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
              <label className="filter-label">
                {posTab === 'sale' ? 'Quantity Sold' : 'Quantity Received'}
              </label>
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

            {posTab === 'sale' ? (
              <button type="submit" className="btn btn-primary" style={{ width: '100%' }}
                disabled={submitting || !itemId}>
                {submitting ? 'Recording…' : '− Record Sale'}
              </button>
            ) : (
              <button type="submit" className="btn btn-success" style={{ width: '100%' }}
                disabled={submitting || !itemId}>
                {submitting ? 'Saving…' : '+ Receive Delivery'}
              </button>
            )}
          </form>

          <p className="chart-note" style={{ marginTop: '1rem' }}>
            {posTab === 'sale'
              ? 'Sales reduce current stock on the Dashboard instantly.'
              : 'Received deliveries increase current stock on the Dashboard instantly.'}
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
