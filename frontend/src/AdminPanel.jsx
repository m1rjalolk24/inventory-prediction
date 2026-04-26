import { useState, useEffect, useCallback } from 'react'
import { authHeaders, useAuth } from './AuthContext'

const EMPTY_USER = { username: '', password: '', role: 'planner' }

function UserModal({ initial, onSave, onClose }) {
  const isEdit = !!initial?.id
  const [form,  setForm]  = useState(initial ?? EMPTY_USER)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!isEdit && !form.username.trim()) return setError('Username is required')
    if (!isEdit && !form.password)        return setError('Password is required')
    setSaving(true); setError('')
    try {
      const url    = isEdit ? `/api/v1/users/${initial.id}` : '/api/v1/users'
      const method = isEdit ? 'PUT' : 'POST'
      const res    = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      onSave(data.user)
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{isEdit ? 'Edit User' : 'Add User'}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          {!isEdit && (
            <div className="form-group">
              <label className="form-label">Username *</label>
              <input className="form-input" type="text" value={form.username}
                onChange={e => set('username', e.target.value)} placeholder="e.g. planner2" />
            </div>
          )}
          <div className="form-group">
            <label className="form-label">{isEdit ? 'New Password (leave blank to keep)' : 'Password *'}</label>
            <input className="form-input" type="password" value={form.password}
              onChange={e => set('password', e.target.value)} placeholder="Min 6 characters" />
          </div>
          <div className="form-group">
            <label className="form-label">Role</label>
            <select className="form-select" value={form.role} onChange={e => set('role', e.target.value)}>
              <option value="planner">Planner — Dashboard + POS</option>
              <option value="admin">Admin — Full access</option>
            </select>
          </div>
          {isEdit && (
            <div className="form-group form-group-inline">
              <label className="form-label" style={{ margin: 0 }}>Active</label>
              <input type="checkbox" checked={form.is_active ?? true}
                onChange={e => set('is_active', e.target.checked)} />
            </div>
          )}
          {error && <p className="form-error">{error}</p>}
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function UsersPanel() {
  const { user: currentUser } = useAuth()
  const [users,  setUsers]  = useState([])
  const [modal,  setModal]  = useState(null)
  const [error,  setError]  = useState(null)

  const load = useCallback(async () => {
    try {
      const res  = await fetch('/api/v1/users', { headers: authHeaders() })
      const data = await res.json()
      setUsers(data.users || [])
    } catch { setError('Failed to load users') }
  }, [])

  useEffect(() => { load() }, [load])

  const handleSaved = (u) => {
    setUsers(prev => {
      const idx = prev.findIndex(x => x.id === u.id)
      return idx >= 0 ? prev.map(x => x.id === u.id ? u : x) : [...prev, u]
    })
    setModal(null)
  }

  const handleDelete = async (u) => {
    if (!window.confirm(`Delete user "${u.username}"?`)) return
    const res  = await fetch(`/api/v1/users/${u.id}`, { method: 'DELETE', headers: authHeaders() })
    const data = await res.json()
    if (!res.ok) return alert(data.error)
    setUsers(prev => prev.filter(x => x.id !== u.id))
  }

  return (
    <div className="admin-card" style={{ marginTop: '1.25rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h3 className="admin-card-title" style={{ margin: 0 }}>User Management</h3>
        <button className="btn btn-primary btn-sm" onClick={() => setModal({ type: 'add' })}>+ Add User</button>
      </div>
      {error && <div className="error-box">{error}</div>}
      <div className="table-wrap">
        <table className="rec-table">
          <thead>
            <tr><th>Username</th><th>Role</th><th>Status</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td className="product-name">{u.username} {u.username === currentUser?.username && <span style={{ color: '#6366f1', fontSize: '0.75rem' }}>(you)</span>}</td>
                <td><span className={`role-badge role-${u.role}`}>{u.role}</span></td>
                <td><span className={`status-badge ${u.is_active ? 'status-healthy' : 'status-watch'}`}>{u.is_active ? 'Active' : 'Inactive'}</span></td>
                <td>
                  <div className="row-actions">
                    <button className="action-icon-btn" onClick={() => setModal({ type: 'edit', user: { ...u, password: '' } })}>Edit</button>
                    <button className="action-icon-btn action-icon-danger" onClick={() => handleDelete(u)}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {modal?.type === 'add'  && <UserModal initial={EMPTY_USER}  onSave={handleSaved} onClose={() => setModal(null)} />}
      {modal?.type === 'edit' && <UserModal initial={modal.user}  onSave={handleSaved} onClose={() => setModal(null)} />}
    </div>
  )
}

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

export default function AdminPanel() {
  const [metrics, setMetrics]         = useState(null)
  const [metricsErr, setMetricsErr]   = useState(null)
  const [health, setHealth]           = useState(null)
  const [dataInfo, setDataInfo]       = useState(null)

  useEffect(() => {
    fetch('/health')
      .then(r => r.json())
      .then(setHealth)
      .catch(() => setHealth({ status: 'error' }))

    fetch('/api/v1/metrics', { headers: authHeaders() })
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

    fetch('/api/v1/stores', { headers: authHeaders() })
      .then(r => r.json())
      .then(d => fetch('/api/v1/items', { headers: authHeaders() }).then(r => r.json()).then(di =>
        setDataInfo({ stores: d.count, items: di.count })
      ))
      .catch(() => {})
  }, [])

  return (
    <div className="admin-page">

      {/* ── System Status ── */}
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

      {/* ── Metrics Table ── */}
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
                  <tr key={model} className={model === 'random_forest' ? 'metrics-row-active' : ''}>
                    <td>
                      <span className="metrics-model-name">
                        {model.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                      </span>
                      {model === 'random_forest' && <span className="model-active-tag">Active</span>}
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

      {/* ── User Management ── */}
      <UsersPanel />

    </div>
  )
}
