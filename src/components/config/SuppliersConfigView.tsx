import { useMemo, useState } from 'react'
import type { Supplier } from '../../types'
import Spinner from '../Spinner'

type Props = {
  suppliers: Supplier[]
  loading: boolean
  isManager: boolean
  onCreate: () => void
  onEdit: (supplier: Supplier) => void
  onToggleActive: (supplier: Supplier) => Promise<void>
}

function weeksLabel(days: number): string {
  return `≈ ${Math.round(days / 7)} tyg.`
}

export default function SuppliersConfigView({
  suppliers,
  loading,
  isManager,
  onCreate,
  onEdit,
  onToggleActive,
}: Props) {
  const [showInactive, setShowInactive] = useState(false)

  const sorted = useMemo(
    () =>
      [...suppliers].sort((a, b) => {
        if (a.is_active !== b.is_active) return a.is_active ? -1 : 1
        return a.name.localeCompare(b.name, 'pl')
      }),
    [suppliers],
  )

  const visible = useMemo(
    () => (showInactive ? sorted : sorted.filter((s) => s.is_active)),
    [showInactive, sorted],
  )

  return (
    <div className="config-main">
      <div className="config-main-header">
        <h2 className="config-main-title">Dostawcy</h2>
        {isManager && (
          <button type="button" className="btn btn-success" onClick={onCreate}>
            + Dodaj dostawcę
          </button>
        )}
      </div>

      <div className="orders-filter-checkbox-row" style={{ marginBottom: 12 }}>
        <label className="orders-filter-checkbox">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          <span>Pokaż nieaktywnych</span>
        </label>
      </div>

      {loading ? (
        <Spinner center label="Ładowanie dostawców…" />
      ) : (
        <div className="table-wrapper">
          <table className="orders-table">
            <thead>
              <tr>
                <th>Nazwa</th>
                <th>Kontakt</th>
                <th>Osoba kontaktowa</th>
                <th>Czas realizacji</th>
                <th>Pełny TIR</th>
                <th>Status</th>
                {isManager && <th>Akcje</th>}
              </tr>
            </thead>
            <tbody>
              {visible.map((supplier) => (
                <tr
                  key={supplier.id}
                  className={supplier.is_active ? '' : 'supplier-row--inactive'}
                  onClick={() => {
                    if (isManager) onEdit(supplier)
                  }}
                  style={{ cursor: isManager ? 'pointer' : 'default' }}
                >
                  <td>{supplier.name}</td>
                  <td>
                    <div>{supplier.email || '—'}</div>
                    <div style={{ color: '#6b7280', fontSize: '0.85rem' }}>{supplier.phone || '—'}</div>
                  </td>
                  <td>{supplier.contact_person || '—'}</td>
                  <td>
                    <strong>{supplier.lead_time_days} dni</strong>
                    <div style={{ color: '#6b7280', fontSize: '0.85rem' }}>{weeksLabel(supplier.lead_time_days)}</div>
                  </td>
                  <td>
                    <span className={`supplier-badge ${supplier.requires_full_tir ? 'supplier-badge--yes' : 'supplier-badge--no'}`}>
                      {supplier.requires_full_tir ? 'TAK' : 'NIE'}
                    </span>
                  </td>
                  <td>
                    <span className={`supplier-badge ${supplier.is_active ? 'supplier-badge--active' : 'supplier-badge--inactive'}`}>
                      {supplier.is_active ? 'Aktywny' : 'Nieaktywny'}
                    </span>
                  </td>
                  {isManager && (
                    <td>
                      <div className="contractor-actions">
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          onClick={(e) => {
                            e.stopPropagation()
                            onEdit(supplier)
                          }}
                        >
                          Edytuj
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          onClick={(e) => {
                            e.stopPropagation()
                            void onToggleActive(supplier)
                          }}
                        >
                          {supplier.is_active ? 'Dezaktywuj' : 'Aktywuj'}
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {visible.length === 0 && <p className="no-results">Brak dostawców do wyświetlenia.</p>}
        </div>
      )}
    </div>
  )
}
