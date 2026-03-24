import { useState, useEffect, useRef } from 'react'

const STORES = Array.from({ length: 10 }, (_, i) => i + 1)

// ---------------------------------------------------------------------------
// Sales CSV Upload
// ---------------------------------------------------------------------------
const REQUIRED_COLS = ['date', 'store', 'item', 'sales']

function SalesUpload() {
  const [file,      setFile]      = useState(null)
  const [preview,   setPreview]   = useState(null)
  const [uploading, setUploading] = useState(false)
  const [result,    setResult]    = useState(null)
  const [error,     setError]     = useState(null)
  const inputRef = useRef(null)

  const parsePreview = (f) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const lines   = e.target.result.split('\n').filter(Boolean)
      if (!lines.length) return
      const cols    = lines[0].split(',').map(c => c.trim().replace(/"/g, '').toLowerCase())
      const missing = REQUIRED_COLS.filter(c => !cols.includes(c))
      const rows    = lines.slice(1, 6).map(l => l.split(',').map(v => v.trim().replace(/"/g, '')))
      setPreview({ cols, rows, missing, valid: missing.length === 0 })
    }
    reader.readAsText(f)
  }

  const handleFile = (f) => {
    if (!f) return
    setFile(f); setResult(null); setError(null)
    parsePreview(f)
  }

  const handleUpload = async () => {
    if (!file || !preview?.valid) return
    setUploading(true); setError(null); setResult(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res  = await fetch('/api/v1/sales/upload', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setResult(data); setFile(null); setPreview(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setUploading(false)
    }
  }

  const reset = () => { setFile(null); setPreview(null); setResult(null); setError(null) }

  return (
    <div className="panel" style={{ marginBottom: '1.25rem' }}>
      <h3 className="admin-card-title">Bulk Sales Upload</h3>
      <p className="admin-card-sub">
        Upload a CSV with columns: <code>date, store, item, sales</code>.
        Duplicates (same date + store + item) are overwritten automatically.
      </p>

      {!file && !result && (
        <div className="upload-zone"
          onClick={() => inputRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f?.name.endsWith('.csv')) handleFile(f) }}>
          <input ref={inputRef} type="file" accept=".csv" style={{ display: 'none' }}
            onChange={e => handleFile(e.target.files[0])} />
          <div className="upload-icon">↑</div>
          <div className="upload-label">Click or drag a CSV file here</div>
          <div className="upload-hint">date, store, item, sales</div>
        </div>
      )}

      {file && preview && (
        <div className="upload-preview">
          <div className="upload-file-row">
            <span className="upload-filename">{file.name}</span>
            <button className="btn btn-ghost btn-sm" onClick={reset}>× Remove</button>
          </div>
          {preview.missing.length > 0 && (
            <div className="error-box" style={{ marginBottom: '0.75rem' }}>
              Missing columns: <strong>{preview.missing.join(', ')}</strong>
            </div>
          )}
          {preview.valid && (
            <>
              <p className="upload-preview-label">Preview (first 5 rows):</p>
              <div className="table-wrap" style={{ marginBottom: '0.75rem' }}>
                <table className="rec-table">
                  <thead><tr>{preview.cols.map(c => <th key={c}>{c}</th>)}</tr></thead>
                  <tbody>{preview.rows.map((row, i) => <tr key={i}>{row.map((v, j) => <td key={j}>{v}</td>)}</tr>)}</tbody>
                </table>
              </div>
              <button className="btn btn-primary" onClick={handleUpload} disabled={uploading}>
                {uploading ? 'Uploading…' : 'Upload & Append to Training Data'}
              </button>
            </>
          )}
        </div>
      )}

      {result && (
        <div className="upload-success">
          <div className="upload-success-icon">✓</div>
          <div>
            <strong>Upload successful</strong>
            <div className="upload-success-detail">
              {result.rows_uploaded} rows · {result.duplicates_dropped} duplicates removed · {result.total_rows.toLocaleString()} total
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={reset} style={{ marginLeft: 'auto' }}>Upload another</button>
        </div>
      )}

      {error && <div className="error-box" style={{ marginTop: '0.75rem' }}>{error}</div>}
    </div>
  )
}

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

      <SalesUpload />

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
