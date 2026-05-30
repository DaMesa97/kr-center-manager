import { useEffect, useState } from 'react'
import { Copy, Check, Key, Plus, Power, PowerOff } from 'lucide-react'
import type { ApiKey } from '../types'

type Filter = 'all' | 'active' | 'inactive'

type GenerateModalState = {
  open: boolean
  name: string
  rateLimit: number
  saving: boolean
  generatedKey: string | null
}

type Props = {
  apiKeys: ApiKey[]
  filteredApiKeys: ApiKey[]
  loading: boolean
  filter: Filter
  setFilter: (f: Filter) => void
  generateModal: GenerateModalState
  setGenerateModal: (patch: (prev: GenerateModalState) => GenerateModalState) => void
  deactivatingId: number | null
  onRefresh: () => void
  onGenerateKey: () => void
  onSetActive: (id: number, active: boolean) => void
  openGenerateModal: () => void
  closeGenerateModal: () => void
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <button type="button" className="btn btn-sm btn-secondary" onClick={handleCopy} title="Kopiuj">
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied ? 'Skopiowano' : 'Kopiuj'}
    </button>
  )
}

export default function ApiKeysView({
  filteredApiKeys,
  loading,
  filter,
  setFilter,
  generateModal,
  setGenerateModal,
  deactivatingId,
  onRefresh,
  onGenerateKey,
  onSetActive,
  openGenerateModal,
  closeGenerateModal,
}: Props) {
  // Odśwież przy pierwszym montowaniu
  useEffect(() => {
    onRefresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="config-view" style={{ padding: '1.5rem' }}>
      {/* Nagłówek */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Key size={20} />
          <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 600 }}>Klucze API</h2>
          <span className="badge badge-neutral" style={{ fontSize: '0.75rem' }}>
            {filteredApiKeys.length} {filteredApiKeys.length === 1 ? 'klucz' : 'kluczy'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button type="button" className="btn btn-sm btn-secondary" onClick={onRefresh} disabled={loading}>
            {loading ? 'Ładowanie...' : 'Odśwież'}
          </button>
          <button type="button" className="btn btn-sm btn-primary" onClick={openGenerateModal}>
            <Plus size={14} />
            Nowy klucz
          </button>
        </div>
      </div>

      {/* Filter */}
      <div className="subtab-bar" style={{ marginBottom: '1rem' }}>
        {(['all', 'active', 'inactive'] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? 'Wszystkie' : f === 'active' ? 'Aktywne' : 'Nieaktywne'}
          </button>
        ))}
      </div>

      {/* Tabela */}
      {loading ? (
        <p className="no-results">Ładowanie kluczy API...</p>
      ) : filteredApiKeys.length === 0 ? (
        <p className="no-results">Brak kluczy API. Wygeneruj nowy.</p>
      ) : (
        <div className="orders-table-wrapper" style={{ overflowX: 'auto' }}>
          <table className="orders-table">
            <thead>
              <tr>
                <th>Nazwa</th>
                <th>Prefiks</th>
                <th>Status</th>
                <th>Limit req/min</th>
                <th style={{ textAlign: 'right' }}>Łączne zapytania</th>
                <th style={{ textAlign: 'right' }}>Zamówień z API</th>
                <th>Ostatnie użycie</th>
                <th>Utworzony</th>
                <th style={{ textAlign: 'center' }}>Akcja</th>
              </tr>
            </thead>
            <tbody>
              {filteredApiKeys.map((key) => (
                <tr key={key.id} style={{ opacity: key.is_active ? 1 : 0.55 }}>
                  <td style={{ fontWeight: 500 }}>{key.name}</td>
                  <td>
                    <code style={{ fontSize: '0.8rem', background: 'var(--color-bg-subtle, #f5f5f5)', padding: '2px 6px', borderRadius: '4px' }}>
                      {key.key_prefix ? `${key.key_prefix}...` : '—'}
                    </code>
                  </td>
                  <td>
                    {key.is_active ? (
                      <span className="badge badge-success">Aktywny</span>
                    ) : (
                      <span className="badge badge-neutral">Nieaktywny</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'center' }}>{key.rate_limit_per_minute}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {key.total_requests.toLocaleString('pl-PL')}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {key.total_orders_created.toLocaleString('pl-PL')}
                  </td>
                  <td style={{ fontSize: '0.85rem', color: 'var(--color-text-muted, #666)' }}>{formatDate(key.last_used_at)}</td>
                  <td style={{ fontSize: '0.85rem', color: 'var(--color-text-muted, #666)' }}>{formatDate(key.created_at)}</td>
                  <td style={{ textAlign: 'center' }}>
                    <button
                      type="button"
                      className={`btn btn-sm ${key.is_active ? 'btn-danger' : 'btn-secondary'}`}
                      onClick={() => onSetActive(key.id, !key.is_active)}
                      disabled={deactivatingId === key.id}
                      title={key.is_active ? 'Dezaktywuj klucz' : 'Reaktywuj klucz'}
                    >
                      {key.is_active ? <PowerOff size={13} /> : <Power size={13} />}
                      {deactivatingId === key.id ? '...' : key.is_active ? 'Dezaktywuj' : 'Reaktywuj'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal generowania klucza */}
      {generateModal.open && (
        <div className="modal-overlay" onClick={closeGenerateModal}>
          <div className="modal-content" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">
                <Key size={16} />
                Generuj nowy klucz API
              </h3>
              <button type="button" className="modal-close" onClick={closeGenerateModal}>✕</button>
            </div>
            <div className="modal-body">
              {generateModal.generatedKey ? (
                /* Po wygenerowaniu — pokaż klucz */
                <div>
                  <div style={{ background: 'var(--color-warning-bg, #fef9c3)', border: '1px solid var(--color-warning, #ca8a04)', borderRadius: '8px', padding: '1rem', marginBottom: '1rem' }}>
                    <p style={{ margin: '0 0 0.5rem', fontWeight: 600, color: 'var(--color-warning-text, #713f12)' }}>
                      ⚠️ Skopiuj klucz TERAZ — nie zostanie pokazany ponownie!
                    </p>
                    <code style={{ display: 'block', wordBreak: 'break-all', fontSize: '0.85rem', padding: '0.5rem', background: 'white', borderRadius: '4px', border: '1px solid #e5e7eb' }}>
                      {generateModal.generatedKey}
                    </code>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                    <CopyButton text={generateModal.generatedKey} />
                    <button type="button" className="btn btn-sm btn-primary" onClick={closeGenerateModal}>
                      Gotowe — zamknij
                    </button>
                  </div>
                </div>
              ) : (
                /* Formularz */
                <>
                  <div className="form-group">
                    <label className="form-label">Nazwa klucza *</label>
                    <input
                      type="text"
                      className="form-control"
                      placeholder="np. Konfigurator KR Center - prod"
                      value={generateModal.name}
                      onChange={(e) => setGenerateModal((p) => ({ ...p, name: e.target.value }))}
                      autoFocus
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Limit zapytań / minuta</label>
                    <input
                      type="number"
                      className="form-control"
                      min={1}
                      max={1000}
                      value={generateModal.rateLimit}
                      onChange={(e) => setGenerateModal((p) => ({ ...p, rateLimit: Number(e.target.value) }))}
                    />
                    <small style={{ color: 'var(--color-text-muted, #666)' }}>Domyślnie 60 req/min</small>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
                    <button type="button" className="btn btn-sm btn-secondary" onClick={closeGenerateModal} disabled={generateModal.saving}>
                      Anuluj
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      onClick={onGenerateKey}
                      disabled={generateModal.saving || !generateModal.name.trim()}
                    >
                      {generateModal.saving ? 'Generowanie...' : 'Generuj klucz'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
