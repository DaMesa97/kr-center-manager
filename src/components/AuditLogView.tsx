import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { AuditLogRow } from '../types'
import { supabase } from '../supabaseClient'
import { AUDIT_PAGE_SIZE, type AuditQueryFilters } from '../hooks/useAudit'
import Spinner from './Spinner'
import DataTable, { type DataTableColumn } from './DataTable'

type AuditLogViewProps = {
  rows: AuditLogRow[]
  loading: boolean
  onRefresh: () => void
  onFilterChange: (filters: AuditQueryFilters) => void
}

type DetailsModalProps = {
  row: AuditLogRow
  userLabel: string
  onClose: () => void
}

// Tabele objęte triggerem audytu (stan bazy 10.2026). Lista stała, bo PostgREST
// nie zrobi DISTINCT — do tego dokładamy nazwy z wczytanych wierszy.
const AUDITED_TABLES = [
  'orders',
  'config_options',
  'profiles',
  'stock_reservations',
  'warehouse_components',
  'warehouse_movements',
  'warehouse_recipes',
  'warehouse_stock',
]

const SEARCH_DEBOUNCE_MS = 300

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

function AuditDetailsModal({ row, userLabel, onClose }: DetailsModalProps) {
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
          {userLabel}
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

type ProfileOption = { id: string; label: string }

export default function AuditLogView({ rows, loading, onRefresh, onFilterChange }: AuditLogViewProps) {
  const [detailsRow, setDetailsRow] = useState<AuditLogRow | null>(null)
  const [filters, setFilters] = useState<AuditQueryFilters>({})
  const [searchInput, setSearchInput] = useState('')
  const [profiles, setProfiles] = useState<ProfileOption[]>([])

  // Imiona zamiast UUID + lista „Użytkownik" ze WSZYSTKICH profili (nie z 1000 wierszy)
  useEffect(() => {
    let cancelled = false
    void supabase
      .from('profiles')
      .select('id, full_name, initials')
      .then(({ data }) => {
        if (cancelled || !data) return
        const list = (data as Array<{ id: string; full_name: string | null; initials: string | null }>)
          .map((p) => ({
            id: p.id,
            label: p.full_name ? (p.initials ? `${p.full_name} (${p.initials})` : p.full_name) : p.initials || p.id,
          }))
          .sort((a, b) => a.label.localeCompare(b.label, 'pl'))
        setProfiles(list)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const profileLabel = useMemo(() => new Map(profiles.map((p) => [p.id, p.label])), [profiles])
  const userLabel = (r: AuditLogRow) =>
    (r.user_id && profileLabel.get(r.user_id)) || r.user_email || r.user_id || '(system)'

  const tableOptions = useMemo(
    () =>
      Array.from(new Set([...AUDITED_TABLES, ...rows.map((r) => r.table_name).filter(Boolean)])).sort((a, b) =>
        a.localeCompare(b),
      ),
    [rows],
  )

  const columns = useMemo<DataTableColumn<AuditLogRow>[]>(() => {
    const label = (r: AuditLogRow) =>
      (r.user_id && profileLabel.get(r.user_id)) || r.user_email || r.user_id || '(system)'
    return [
      { key: 'created_at', label: 'DATA', sortValue: (r) => r.created_at, render: (r) => formatDateTime(r.created_at) },
      {
        key: 'user',
        label: 'UŻYTKOWNIK',
        stackUnder: 'created_at',
        sortValue: (r) => label(r),
        render: (r) => <span title={r.user_email || r.user_id || undefined}>{label(r)}</span>,
      },
      { key: 'table_name', label: 'TABELA', sortValue: (r) => r.table_name, render: (r) => r.table_name },
      {
        key: 'operation',
        label: 'OPERACJA',
        stackUnder: 'table_name',
        sortValue: (r) => r.operation,
        render: (r) => <span className={`audit-op-badge audit-op-badge--${r.operation.toLowerCase()}`}>{r.operation}</span>,
      },
      {
        key: 'record_id',
        label: 'ID REKORDU',
        sortValue: (r) => r.record_id || null,
        render: (r) => {
          const nr = r.new_data?.order_number ?? r.old_data?.order_number
          return nr ? `${r.record_id ?? '—'} · ${String(nr)}` : r.record_id || '—'
        },
      },
      { key: 'changed_fields', label: 'ZMIENIONE POLA', render: (r) => previewChangedFields(r.changed_fields) },
      {
        key: 'actions',
        label: 'AKCJE',
        render: (r) => (
          <button type="button" className="btn btn-primary" onClick={() => setDetailsRow(r)}>
            Szczegóły
          </button>
        ),
      },
    ]
  }, [profileLabel])

  // Każda zmiana filtra wraca do pierwszej porcji
  const updateFilters = (patch: Partial<AuditQueryFilters>) => {
    const next = { ...filters, limit: undefined, ...patch }
    setFilters(next)
    onFilterChange(next)
  }

  // Szukajka z opóźnieniem — zapytanie leci do serwera dopiero po przerwie w pisaniu
  const filtersRef = useRef(filters)
  useEffect(() => {
    filtersRef.current = filters
  }, [filters])
  useEffect(() => {
    const q = searchInput.trim() || undefined
    if (q === (filtersRef.current.searchQuery ?? undefined)) return
    const t = window.setTimeout(() => {
      const next = { ...filtersRef.current, limit: undefined, searchQuery: q }
      setFilters(next)
      onFilterChange(next)
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [searchInput, onFilterChange])

  const limit = filters.limit ?? AUDIT_PAGE_SIZE
  const canLoadMore = !loading && rows.length >= limit

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
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>

        <input
          type="text"
          className="search-input"
          placeholder="Szukaj po nr zlecenia, record_id, email, nazwie pola..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
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

        <label
          className="audit-system-toggle"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', whiteSpace: 'nowrap' }}
          title="Wpisy systemowe (bez użytkownika): triggery, synchronizacja par, importy i Edge Functions"
        >
          <input
            type="checkbox"
            checked={!filters.showSystem}
            onChange={(e) => updateFilters({ showSystem: e.target.checked ? undefined : true })}
          />{' '}
          Ukryj systemowe
        </label>

        <button type="button" className="btn btn-primary" onClick={onRefresh}>
          Odśwież
        </button>
      </div>

      {loading && rows.length === 0 ? (
        <Spinner center label="Ładowanie historii zmian…" />
      ) : (
        <>
          <DataTable
            rows={rows}
            rowKey={(r) => r.id}
            columns={columns}
            className="audit-table"
            emptyText="Brak wpisów audytu dla wybranych filtrów."
          />
          <div className="audit-load-more" style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', margin: '0.75rem 0' }}>
            {loading ? (
              <Spinner inline label="Ładowanie…" />
            ) : (
              <span style={{ color: '#64748b', fontSize: '0.85rem' }}>Wczytano {rows.length} najnowszych wpisów</span>
            )}
            {canLoadMore && (
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                onClick={() => {
                  // bez updateFilters — ono zeruje limit
                  const next = { ...filters, limit: limit + AUDIT_PAGE_SIZE }
                  setFilters(next)
                  onFilterChange(next)
                }}
              >
                Załaduj więcej (+{AUDIT_PAGE_SIZE})
              </button>
            )}
          </div>
        </>
      )}

      {detailsRow && <AuditDetailsModal row={detailsRow} userLabel={userLabel(detailsRow)} onClose={() => setDetailsRow(null)} />}
    </>
  )
}
