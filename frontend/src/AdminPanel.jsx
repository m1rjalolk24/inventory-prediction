import { useState, useEffect, useRef, useCallback } from 'react'

const MODELS = [
  { id: 'random_forest',      label: 'Random Forest',      desc: 'Best overall accuracy — recommended',               disabled: false },
  { id: 'linear_regression',  label: 'Linear Regression',  desc: 'Baseline — fast, interpretable',                    disabled: false },
  { id: 'arima',              label: 'ARIMA',              desc: 'Notebook only — not available for live serving',     disabled: true  },
]

const METRIC_LABELS = {
  MAPE: { label: 'MAPE',  unit: '%',  good: v => v < 15, fmt: v => v.toFixed(2) },
  RMSE: { label: 'RMSE',  unit: '',   good: v => v < 10, fmt: v => v.toFixed(2) },
  MAE:  { label: 'MAE',   unit: '',   good: v => v < 8,  fmt: v => v.toFixed(2) },
  R2:   { label: 'R²',    unit: '',   good: v => v > 0.8, fmt: v => v.toFixed(3) },
}

// Normalize metric keys: results.csv may use 'R2' or 'R²' or 'r2'
function normalizeMetrics(raw) {
  const out = {}
  for (const [k, v] of Object.entries(raw)) {
    const key = k.replace('²', '2').replace(/\s/g, '').toUpperCase()
    out[key] = v
  }
  return out
}

function useRetrain() {
  const [status,   setStatus]   = useState(null)   // retrain status object
  const [confirm,  setConfirm]  = useState(false)
  const pollRef = useRef(null)

  const pollStatus = useCallback(() => {
    fetch('/api/v1/jobs/retrain/status')
      .then(r => r.json())
      .then(data => {
        setStatus(data)
        if (data.state === 'running') {
          pollRef.current = setTimeout(pollStatus, 2000)
        }
      })
      .catch(() => {})
  }, [])

  const startRetrain = async () => {
    setConfirm(false)
    const res  = await fetch('/api/v1/jobs/retrain', { method: 'POST' })
    const data = await res.json()
    if (!res.ok) { setStatus({ state: 'error', message: data.error }); return }
    setStatus(data.status)
    pollRef.current = setTimeout(pollStatus, 2000)
  }

  useEffect(() => () => clearTimeout(pollRef.current), [])

  return { status, confirm, setConfirm, startRetrain }
}

export default function AdminPanel({ activeModel, onModelChange }) {
  const [metrics, setMetrics]         = useState(null)
  const [metricsErr, setMetricsErr]   = useState(null)
  const [health, setHealth]           = useState(null)
  const [dataInfo, setDataInfo]       = useState(null)
  const [ingestResult, setIngestResult] = useState(null)
  const [ingestLoading, setIngestLoading] = useState(false)
  const retrain = useRetrain()

  const runIngest = async () => {
    setIngestLoading(true)
    setIngestResult(null)
    try {
      const res  = await fetch('/api/v1/jobs/ingest', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setIngestResult({ ok: true, ...data })
    } catch (e) {
      setIngestResult({ ok: false, message: e.message })
    } finally {
      setIngestLoading(false)
    }
  }

  useEffect(() => {
    fetch('/health')
      .then(r => r.json())
      .then(setHealth)
      .catch(() => setHealth({ status: 'error' }))

    fetch('/api/v1/metrics')
      .then(r => r.json())
      .then(data => {
        if (data.metrics) {
          const normalized = {}
          for (const [model, vals] of Object.entries(data.metrics)) {
            normalized[model] = normalizeMetrics(vals)
          }
          setMetrics(normalized)
        } else {
          setMetricsErr(data.message || 'No metrics available')
        }
      })
      .catch(() => setMetricsErr('Could not load metrics'))

    fetch('/api/v1/stores')
      .then(r => r.json())
      .then(d => fetch('/api/v1/items').then(r => r.json()).then(di =>
        setDataInfo({ stores: d.count, items: di.count })
      ))
      .catch(() => {})
  }, [])

  const bestModel = metrics
    ? Object.entries(metrics).sort((a, b) =>
        (a[1].MAPE ?? 999) - (b[1].MAPE ?? 999)
      )[0]?.[0]
    : null

  return (
    <div className="admin-page">

      {/* ── Row 1: Status + Active Model ── */}
      <div className="admin-row">

        {/* System Status */}
        <div className="admin-card">
          <h3 className="admin-card-title">System Status</h3>
          <div className="status-rows">
            <div className="status-row">
              <span className="status-row-label">API</span>
              <span className={`sys-badge ${health?.status === 'ok' ? 'sys-ok' : 'sys-err'}`}>
                {health ? (health.status === 'ok' ? 'Online' : 'Error') : 'Checking…'}
              </span>
            </div>
            <div className="status-row">
              <span className="status-row-label">Database</span>
              <span className="sys-badge sys-ok">SQLite</span>
            </div>
            {dataInfo && <>
              <div className="status-row">
                <span className="status-row-label">Stores in dataset</span>
                <span className="status-row-val">{dataInfo.stores}</span>
              </div>
              <div className="status-row">
                <span className="status-row-label">SKUs in dataset</span>
                <span className="status-row-val">{dataInfo.items}</span>
              </div>
            </>}
          </div>
        </div>

        {/* Active Model Selector */}
        <div className="admin-card">
          <h3 className="admin-card-title">Active Forecast Model</h3>
          <p className="admin-card-sub">Used for all Dashboard forecasts and recommendations.</p>
          <div className="model-options">
            {MODELS.map(m => (
              <label
                key={m.id}
                className={`model-option ${activeModel === m.id ? 'model-option-active' : ''} ${m.disabled ? 'model-option-disabled' : ''}`}
                title={m.disabled ? 'Notebook only — not available for live serving' : undefined}
              >
                <input
                  type="radio"
                  name="activeModel"
                  value={m.id}
                  checked={activeModel === m.id}
                  disabled={m.disabled}
                  onChange={() => !m.disabled && onModelChange(m.id)}
                />
                <div className="model-option-body">
                  <div className="model-option-name">
                    {m.label}
                    {bestModel === m.id && <span className="model-best-tag">Best</span>}
                    {m.disabled && <span className="model-disabled-tag">Offline only</span>}
                  </div>
                  <div className="model-option-desc">{m.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

      </div>

      {/* ── Row 2: Operations ── */}
      <div className="admin-card admin-card-full">
        <h3 className="admin-card-title">Operations</h3>
        <div className="ops-row">

          {/* Daily Ingest */}
          <div className="ops-item">
            <div className="ops-item-info">
              <div className="ops-item-title">Run Daily Ingestion</div>
              <div className="ops-item-desc">
                Simulates one new day of sales for all stores and items, appends to training data, and clears the forecast cache.
              </div>
              {ingestResult && (
                <div className={ingestResult.ok ? 'ops-result ops-result-ok' : 'ops-result ops-result-err'}>
                  {ingestResult.ok
                    ? `✓ ${ingestResult.message} · ${ingestResult.total_rows?.toLocaleString()} total rows`
                    : `✗ ${ingestResult.message}`}
                </div>
              )}
            </div>
            <button
              className="btn btn-primary"
              onClick={runIngest}
              disabled={ingestLoading}
            >
              {ingestLoading ? 'Running…' : '▶ Run Ingestion'}
            </button>
          </div>

          <div className="ops-divider" />

          {/* Retrain */}
          <div className="ops-item">
            <div className="ops-item-info">
              <div className="ops-item-title">Retrain Forecast Model</div>
              <div className="ops-item-desc">
                Retrains Random Forest on all available data. Takes 2–5 minutes.
                Forecasts will be unavailable during training.
              </div>
              {retrain.status && retrain.status.state !== 'idle' && (
                <div className={`ops-result ${
                  retrain.status.state === 'done'    ? 'ops-result-ok'  :
                  retrain.status.state === 'error'   ? 'ops-result-err' :
                  'ops-result-running'}`}>
                  {retrain.status.state === 'running' && <span className="ops-spinner" />}
                  {retrain.status.message}
                </div>
              )}
            </div>
            <button
              className="btn btn-warning"
              onClick={() => retrain.setConfirm(true)}
              disabled={retrain.status?.state === 'running'}
            >
              {retrain.status?.state === 'running' ? 'Training…' : '⟳ Retrain Model'}
            </button>
          </div>

        </div>
      </div>

      {/* Retrain confirmation modal */}
      {retrain.confirm && (
        <div className="modal-backdrop" onClick={() => retrain.setConfirm(false)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Retrain Model?</h3>
              <button className="modal-close" onClick={() => retrain.setConfirm(false)}>×</button>
            </div>
            <div className="modal-body">
              <p style={{ color: '#374151', marginBottom: '0.75rem' }}>
                Retraining takes <strong>2–5 minutes</strong>. During this time:
              </p>
              <ul className="retrain-warning-list">
                <li>Forecast requests will fail with a 503 error</li>
                <li>Recommendations will be unavailable</li>
                <li>The new model replaces the current one automatically when done</li>
              </ul>
              <div className="modal-footer" style={{ marginTop: '1.25rem' }}>
                <button className="btn btn-ghost" onClick={() => retrain.setConfirm(false)}>Cancel</button>
                <button className="btn btn-warning" onClick={retrain.startRetrain}>Start Retraining</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Row 3: Metrics Table ── */}
      <div className="admin-card admin-card-full">
        <h3 className="admin-card-title">Model Performance Metrics</h3>
        <p className="admin-card-sub">Evaluated on the held-out test set (last 3 months of data).</p>

        {metricsErr && <div className="error-box" style={{ marginTop: '1rem' }}>{metricsErr}</div>}

        {!metrics && !metricsErr && (
          <div className="info-box" style={{ marginTop: '1rem' }}>Loading metrics…</div>
        )}

        {metrics && (
          <div className="metrics-table-wrap">
            <table className="metrics-table">
              <thead>
                <tr>
                  <th>Model</th>
                  {Object.keys(METRIC_LABELS).map(k => (
                    <th key={k}>{METRIC_LABELS[k].label}{METRIC_LABELS[k].unit && ` (${METRIC_LABELS[k].unit})`}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(metrics).map(([model, vals]) => (
                  <tr key={model} className={model === activeModel ? 'metrics-row-active' : ''}>
                    <td>
                      <span className="metrics-model-name">
                        {model.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                      </span>
                      {model === activeModel && <span className="model-active-tag">Active</span>}
                    </td>
                    {Object.entries(METRIC_LABELS).map(([key, meta]) => {
                      const val = vals[key]
                      const isGood = val != null && meta.good(val)
                      return (
                        <td key={key} className={`metric-cell ${isGood ? 'metric-good' : 'metric-bad'}`}>
                          {val != null ? meta.fmt(val) : '—'}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="metrics-legend">
              <span className="legend-good">Green = target met</span>
              <span className="legend-bad">Red = below target</span>
              <span className="legend-note">MAPE &lt;15% · R² &gt;0.80</span>
            </div>
          </div>
        )}
      </div>

    </div>
  )
}
