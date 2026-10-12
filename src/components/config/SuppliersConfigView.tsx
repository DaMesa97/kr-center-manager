import { useMemo, useState } from 'react'
import type { Supplier } from '../../types'
import Spinner from '../Spinner'
import DataTable, { type DataTableColumn } from '../DataTable'

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

  const columns = useMemo<DataTableColumn<Supplier>[]>(() => {
    const muted = { color: '#6b7280', fontSize: '0.85rem' }
    const cols: DataTableColumn<Supplier>[] = [
      { key: 'name', label: 'Nazwa', sortValue: (s) => s.name, render: (s) => s.name },
      {
        key: 'contact',
        label: 'Kontakt',
        sortValue: (s) => s.email || null,
        render: (s) => (
          <>
            <div>{s.email || '—'}</div>
            <div style={muted}>{s.phone || '—'}</div>
          </>
        ),
      },
      { key: 'person', label: 'Osoba kontaktowa', sortValue: (s) => s.contact_person || null, render: (s) => s.contact_person || '—' },
      {
        key: 'lead_time',
        label: 'Czas realizacji',
        sortValue: (s) => s.lead_time_days,
        render: (s) => (
          <>
            <strong>{s.lead_time_days} dni</strong>
            <div style={muted}>{weeksLabel(s.lead_time_days)}</div>
          </>
        ),
      },
      {
        key: 'tir',
        label: 'Pełny TIR',
        sortValue: (s) => (s.requires_full_tir ? 0 : 1),
        render: (s) => (
          <span className={`supplier-badge ${s.requires_full_tir ? 'supplier-badge--yes' : 'supplier-badge--no'}`}>
            {s.requires_full_tir ? 'TAK' : 'NIE'}
          </span>
        ),
      },
      {
        key: 'status',
        label: 'Status',
        sortValue: (s) => (s.is_active ? 0 : 1),
        render: (s) => (
          <span className={`supplier-badge ${s.is_active ? 'supplier-badge--active' : 'supplier-badge--inactive'}`}>
            {s.is_active ? 'Aktywny' : 'Nieaktywny'}
          </span>
        ),
      },
    ]
    if (isManager) {
      cols.push({
        key: 'actions',
        label: 'Akcje',
        render: (s) => (
          <div className="contractor-actions">
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={(e) => {
                e.stopPropagation()
                onEdit(s)
              }}
            >
              Edytuj
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={(e) => {
                e.stopPropagation()
                void onToggleActive(s)
              }}
            >
              {s.is_active ? 'Dezaktywuj' : 'Aktywuj'}
            </button>
          </div>
        ),
      })
    }
    return cols
  }, [isManager, onEdit, onToggleActive])

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
        <DataTable
          rows={visible}
          rowKey={(s) => s.id}
          columns={columns}
          rowClassName={(s) => (s.is_active ? '' : 'supplier-row--inactive')}
          onRowClick={isManager ? (s) => onEdit(s) : undefined}
          emptyText="Brak dostawców do wyświetlenia."
        />
      )}
    </div>
  )
}
