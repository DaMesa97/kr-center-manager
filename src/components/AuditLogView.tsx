import { useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { AuditFilters, AuditLogRow } from '../types'
import Spinner from './Spinner'

type AuditLogViewProps = {
  rows: AuditLogRow[]
  loading: boolean
  onRefresh: () => void
  onFilterChange: (filters: AuditFilters) => void
}

type DetailsModalProps = {
  row: AuditLogRow
  onClose: () => void
}

function formatDateTime(value: string): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function renderValue(value: unknown): ReactNode {
  if (value === null || value === undefined || value === '') return <span className="audit-value-empty">—</span>
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="audit-value-empty">[]</span>
    return (
      <ul className="audit-value-list">
        {value.map((item, idx) => (
          <li key={idx}>{renderValue(item)}</li>
        ))}
      </ul>
    )
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return <span className="audit-value-empty">{'{}'}</span>
    return (
      <table className="audit-diff-table audit-diff-table--nested">
        <tbody>
          {entries.map(([k, v]) => (
            <tr key={k}>
              <th>{k}</th>
              <td>{renderValue(v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }
  return String(value)
}

function AuditDetailsModal({ row, onClose }: DetailsModalProps) {
  const changedSet = useMemo(() => new Set(row.changed_fields ?? []), [row.changed_fields])
  const oldData = useMemo(() => row.old_data ?? {}, [row.old_data])
  const newData = useMemo(() => row.new_data ?? {}, [row.new_data])

  const updateKeys = useMemo(() => {
    const keys = new Set([...Object.keys(oldData), ...Object.keys(newData)])
    return Array.from(keys).sort((a, b) => a.localeCompare(b))
  }, [oldData, newData])

  const insertDeleteData = row.operation === 'INSERT' ? newData : oldData
  const insertDeleteKeys = useMemo(
    () => Object.keys(insertDeleteData).sort((a, b) => a.localeCompare(b)),
    [insertDeleteData],
  )

  return createPortal(
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div className="audit-details-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="audit-details-header">
          <h2>Szczegóły audytu</h2>
          <button type="button" className="btn btn-icon btn-ghost" onClick={onClose}>
            X
          </button>
        </div>
        <p className="audit-details-meta">
          <strong>{row.table_name}</strong> • {row.operation} • {formatDateTime(row.created_at)} •{' '}
          {row.user_email || row.user_id || '(brak)'}
        </p>

        {row.operation === 'UPDATE' ? (
          <table className="audit-diff-table">
            <thead>
              <tr>
                <th>Pole</th>
                <th>Przed zmianą</th>
                <th>Po zmianie</th>
              </tr>
            </thead>
            <tbody>
              {updateKeys.map((key) => (
                <tr key={key} className={changedSet.has(key) ? 'audit-diff-field--changed' : ''}>
                  <th>{key}</th>
                  <td>{renderValue(oldData[key])}</td>
                  <td>{renderValue(newData[key])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="audit-diff-table">
            <thead>
              <tr>
                <th>Pole</th>
                <th>Wartość</th>
              </tr>
            </thead>
            <tbody>
              {insertDeleteKeys.map((key) => (
                <tr key={key}>
                  <th>{key}</th>
                  <td>{renderValue(insertDeleteData[key])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>,
    document.body,
  )
}

function previewChangedFields(fields: string[] | null): string {
  if (!fields || fields.length === 0) return '—'
  if (fields.length <= 3) return fields.join(', ')
  return `${fields.slice(0, 3).join(', ')} i ${fields.length - 3} więcej`
}

export default function AuditLogView({ rows, loading, onRefresh, onFilterChange }: AuditLogViewProps) {
  const [detailsRow, setDetailsRow] = useState<AuditLogRow | null>(null)
  const [filters, setFilters] = useState<AuditFilters>({})

  const tableOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.table_name).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [rows],
  )
  const userOptions = useMemo(
    () =>
      Array.from(new Set(rows.map((r) => r.user_id).filter((u): u is string => Boolean(u)))).sort((a, b) =>
        a.localeCompare(b),
      ),
    [rows],
  )

  const updateFilters = (patch: Partial<AuditFilters>) => {
    const next = { ...filters, ...patch }
    setFilters(next)
    onFilterChange(next)
  }

  return (
    <>
      <div className="orders-filters audit-filters">
        <select className="day-filter" value={filters.table ?? ''} onChange={(e) => updateFilters({ table: e.target.value || undefined })}>
          <option value="">Wszystkie tabele</option>
          {tableOptions.map((table) => (
            <option key={table} value={table}>
              {table}
            </option>
          ))}
        </select>

        <select
          className="day-filter"
          value={filters.operation ?? ''}
          onChange={(e) => updateFilters({ operation: e.target.value || undefined })}
        >
          <option value="">Wszystkie operacje</option>
          <option value="INSERT">INSERT</option>
          <option value="UPDATE">UPDATE</option>
          <option value="DELETE">DELETE</option>
        </select>

        <select className="day-filter" value={filters.userId ?? ''} onChange={(e) => updateFilters({ userId: e.target.value || undefined })}>
          <option value="">Wszyscy użytkownicy</option>
          {userOptions.map((userId) => (
            <option key={userId} value={userId}>
              {userId}
            </option>
          ))}
        </select>

        <input
          type="text"
          className="search-input"
          placeholder="Szukaj po record_id, email, polach..."
          value={filters.searchQuery ?? ''}
          onChange={(e) => updateFilters({ searchQuery: e.target.value || undefined })}
        />

        <input
          type="date"
          className="day-filter"
          value={filters.dateFrom ?? ''}
          onChange={(e) => updateFilters({ dateFrom: e.target.value || undefined })}
        />

        <input
          type="date"
          className="day-filter"
          value={filters.dateTo ?? ''}
          onChange={(e) => updateFilters({ dateTo: e.target.value || undefined })}
        />

        <button type="button" className="btn btn-primary" onClick={onRefresh}>
          Odśwież
        </button>
      </div>

      {loading ? (
        <Spinner center label="Ładowanie historii zmian…" />
      ) : (
        <div className="table-wrapper">
          <table className="orders-table audit-table">
            <thead>
              <tr>
                <th>DATA</th>
                <th>UŻYTKOWNIK</th>
                <th>TABELA</th>
                <th>OPERACJA</th>
                <th>ID REKORDU</th>
                <th>ZMIENIONE POLA</th>
                <th>AKCJE</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="no-results">
                    Brak wpisów audytu dla wybranych filtrów.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id}>
                    <td>{formatDateTime(row.created_at)}</td>
                    <td>{row.user_email || row.user_id || '(brak)'}</td>
                    <td>{row.table_name}</td>
                    <td>
                      <span className={`audit-op-badge audit-op-badge--${row.operation.toLowerCase()}`}>{row.operation}</span>
                    </td>
                    <td>{row.record_id || '—'}</td>
                    <td>{previewChangedFields(row.changed_fields)}</td>
                    <td>
                      <button type="button" className="btn btn-primary" onClick={() => setDetailsRow(row)}>
                        Szczegóły
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {detailsRow && <AuditDetailsModal row={detailsRow} onClose={() => setDetailsRow(null)} />}
    </>
  )
}
