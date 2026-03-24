import { useState, useEffect, useCallback } from 'react'

const CATEGORIES = [
  'Fresh Produce', 'Dairy & Eggs', 'Bakery', 'Meat & Poultry',
  'Staples', 'Beverages', 'Snacks & Sweets', 'Household',
  'Frozen & Canned', 'Condiments',
]

const EMPTY_FORM = { item_id: '', name: '', category: CATEGORIES[0], sku: '', is_active: true }

async function apiFetch(path, options) {
  const res = await fetch(path, options)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || res.statusText)
  return json
}

function exportProductsCSV(products) {
  const header = ['Item ID', 'Name', 'Category', 'SKU', 'Active']
  const rows   = products.map(p => [p.item_id, p.name, p.category, p.sku, p.is_active ? 'Yes' : 'No'])
  const csv    = [header, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n')
  const blob   = new Blob([csv], { type: 'text/csv' })
  const url    = URL.createObjectURL(blob)
  const a      = Object.assign(document.createElement('a'), { href: url, download: 'products.csv' })
  a.click()
  URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------
function ProductModal({ initial, onSave, onClose }) {
  const isEdit = !!initial?.id
  const [form, setForm]   = useState(initial ?? EMPTY_FORM)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.name.trim())    return setError('Name is required')
    if (!form.category.trim()) return setError('Category is required')
    if (!isEdit && !form.item_id) return setError('Item ID is required')
    setSaving(true)
    setError('')
    try {
      const url    = isEdit ? `/api/v1/products/${initial.id}` : '/api/v1/products'
      const method = isEdit ? 'PUT' : 'POST'
      const result = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_id:   Number(form.item_id),
          name:      form.name.trim(),
          category:  form.category.trim(),
          sku:       form.sku.trim(),
          is_active: form.is_active,
        }),
      })
      onSave(result.product)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{isEdit ? 'Edit Product' : 'Add Product'}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">
          {!isEdit && (
            <div className="form-group">
              <label className="form-label">Item ID (1–50)</label>
              <input className="form-input" type="number" min="1" max="999"
                value={form.item_id} onChange={e => set('item_id', e.target.value)} />
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Product Name *</label>
            <input className="form-input" type="text" value={form.name}
              onChange={e => set('name', e.target.value)} />
          </div>

          <div className="form-group">
            <label className="form-label">Category *</label>
            <select className="form-select" value={form.category}
              onChange={e => set('category', e.target.value)}>
              {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              <option value="Other">Other</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">SKU</label>
            <input className="form-input" type="text" value={form.sku}
              onChange={e => set('sku', e.target.value)} placeholder="e.g. SKU-001" />
          </div>

          {isEdit && (
            <div className="form-group form-group-inline">
              <label className="form-label" style={{ margin: 0 }}>Active</label>
              <input type="checkbox" checked={form.is_active}
                onChange={e => set('is_active', e.target.checked)} />
            </div>
          )}

          {error && <p className="form-error">{error}</p>}

          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Product'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// DeleteConfirm
// ---------------------------------------------------------------------------
function DeleteConfirm({ product, onConfirm, onClose }) {
  const [loading, setLoading] = useState(false)
  const handleDelete = async () => {
    setLoading(true)
    try {
      await apiFetch(`/api/v1/products/${product.id}`, { method: 'DELETE' })
      onConfirm(product.id)
    } catch (e) {
      alert(e.message)
    } finally {
      setLoading(false)
    }
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Delete Product</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <p style={{ marginBottom: '1.25rem', color: '#374151' }}>
            Remove <strong>{product.name}</strong> (#{product.item_id}) from the product list?
            This cannot be undone.
          </p>
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-danger" onClick={handleDelete} disabled={loading}>
              {loading ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// DataManagement
// ---------------------------------------------------------------------------
export default function DataManagement() {
  const [products, setProducts]   = useState([])
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)
  const [search, setSearch]       = useState('')
  const [catFilter, setCatFilter] = useState('All')
  const [modal, setModal]         = useState(null)   // null | { type: 'add'|'edit'|'delete', product? }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiFetch('/api/v1/products')
      setProducts(data.products)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const visible = products.filter(p => {
    const matchSearch = !search ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.sku.toLowerCase().includes(search.toLowerCase())
    const matchCat = catFilter === 'All' || p.category === catFilter
    return matchSearch && matchCat
  })

  const handleSaved = (product) => {
    setProducts(prev => {
      const idx = prev.findIndex(p => p.id === product.id)
      return idx >= 0
        ? prev.map(p => p.id === product.id ? product : p)
        : [...prev, product].sort((a, b) => a.item_id - b.item_id)
    })
    setModal(null)
  }

  const handleDeleted = (id) => {
    setProducts(prev => prev.filter(p => p.id !== id))
    setModal(null)
  }

  const allCategories = ['All', ...CATEGORIES, 'Other']

  return (
    <div className="dm-page">
      {/* Toolbar */}
      <div className="dm-toolbar">
        <div className="dm-toolbar-left">
          <h2 className="dm-title">Product Management</h2>
          <span className="dm-count">{products.length} products</span>
        </div>
        <div className="dm-toolbar-right">
          <input
            className="dm-search"
            type="text"
            placeholder="Search name or SKU…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select className="filter-select" style={{ width: 'auto' }}
            value={catFilter} onChange={e => setCatFilter(e.target.value)}>
            {allCategories.map(c => <option key={c}>{c}</option>)}
          </select>
          <button className="btn btn-ghost"
            onClick={() => exportProductsCSV(visible)}>
            ↓ Export CSV
          </button>
          <button className="btn btn-primary"
            onClick={() => setModal({ type: 'add' })}>
            + Add Product
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="panel" style={{ marginTop: '1rem' }}>
        {loading && <div className="info-box">Loading products…</div>}
        {error   && <div className="error-box">Error: {error}</div>}

        {!loading && !error && (
          <div className="table-wrap">
            <table className="rec-table">
              <thead>
                <tr>
                  <th>Item ID</th>
                  <th>Name</th>
                  <th>Category</th>
                  <th>SKU</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 && (
                  <tr><td colSpan={6} style={{ textAlign: 'center', color: '#9ca3af', padding: '2rem' }}>
                    No products found.
                  </td></tr>
                )}
                {visible.map(p => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 600, color: '#6366f1' }}>#{p.item_id}</td>
                    <td className="td-product">
                      <div className="product-name">{p.name}</div>
                    </td>
                    <td>
                      <span className="category-chip">{p.category}</span>
                    </td>
                    <td style={{ color: '#9ca3af', fontSize: '0.8rem' }}>{p.sku || '—'}</td>
                    <td>
                      <span className={`status-badge ${p.is_active ? 'status-healthy' : 'status-watch'}`}>
                        {p.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      <div className="row-actions">
                        <button className="action-icon-btn"
                          onClick={() => setModal({ type: 'edit', product: p })}>
                          Edit
                        </button>
                        <button className="action-icon-btn action-icon-danger"
                          onClick={() => setModal({ type: 'delete', product: p })}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modals */}
      {modal?.type === 'add' && (
        <ProductModal initial={EMPTY_FORM} onSave={handleSaved} onClose={() => setModal(null)} />
      )}
      {modal?.type === 'edit' && (
        <ProductModal initial={modal.product} onSave={handleSaved} onClose={() => setModal(null)} />
      )}
      {modal?.type === 'delete' && (
        <DeleteConfirm product={modal.product} onConfirm={handleDeleted} onClose={() => setModal(null)} />
      )}
    </div>
  )
}
