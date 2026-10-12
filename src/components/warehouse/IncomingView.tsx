import { useMemo, useState } from 'react'
import type { IncomingStockRow, WarehouseComponent } from '../../types'
import Spinner from '../Spinner'
import DataTable, { type DataTableColumn } from '../DataTable'

function formatDatePl(d: string | null): string {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  return y && m && day ? `${day}.${m}.${y}` : d
}

function isOverdue(eta: string | null): boolean {
  if (!eta) return false
  const today = new Date()
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  return eta < iso
}

type Props = {
  incoming: IncomingStockRow[]
  components: WarehouseComponent[]
  loading: boolean
  onRefresh: () => void
}

/** Podzakładka Magazyn → W drodze: niedostarczone pozycje z otwartych ZD. */
function IncomingView({ incoming, components, loading, onRefresh }: Props) {
  const [search, setSearch] = useState('')

  const componentById = useMemo(() => {
    const m = new Map<number, WarehouseComponent>()
    components.forEach((c) => m.set(c.id, c))
    return m
  }, [components])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return incoming
      .filter((r) => r.incoming_qty > 0)
      .map((r) => {
        const comp = componentById.get(r.component_id)
        return {
          ...r,
          code: comp?.code ?? '',
          name: comp?.name ?? `#${r.component_id}`,
          unit: comp?.unit ?? '',
        }
      })
      .filter((r) => !q || r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q))
  }, [incoming, componentById, search])

  const totalQty = useMemo(() => rows.reduce((s, r) => s + r.incoming_qty, 0), [rows])
  const overdueCount = useMemo(() => rows.filter((r) => isOverdue(r.earliest_eta)).length, [rows])

  return (
    <>
      <div className="orders-filters" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <input
          type="text"
          className="search-input"
          placeholder="Szukaj po kodzie lub nazwie komponentu…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: 240, flex: '1 1 220px' }}
        />
        <span style={{ alignSelf: 'center', fontSize: 13, color: 'var(--color-text-muted, #64748b)' }}>
          Pozycji: <strong>{rows.length}</strong> · sztuk w drodze: <strong>{totalQty}</strong>
          {overdueCount > 0 && (
            <>
              {' '}· <span style={{ color: '#c62828', fontWeight: 700 }}>{overdueCount} po terminie</span>
            </>
          )}
        </span>
        <button type="button" className="btn btn-sm btn-secondary" onClick={onRefresh}>
          Odśwież
        </button>
      </div>

      {loading ? (
        <Spinner center label="Ładowanie dostaw w drodze…" />
      ) : (
        <DataTable
          rows={rows}
          rowKey={(r) => r.component_id}
          columns={incomingColumns}
          emptyText="Nic nie jest w drodze — brak niedostarczonych pozycji w wysłanych zamówieniach do dostawców."
        />
      )}
    </>
  )
}

type IncomingDisplayRow = IncomingStockRow & { code: string; name: string; unit: string }

const incomingColumns: DataTableColumn<IncomingDisplayRow>[] = [
  { key: 'code', label: 'KOD', sortValue: (r) => r.code, render: (r) => r.code || '—' },
  {
    key: 'name',
    label: 'NAZWA',
    sortValue: (r) => r.name,
    render: (r) => (
      <>
        {r.name}
        {r.unit ? <span style={{ color: 'var(--color-text-muted, #94a3b8)', fontSize: 12 }}> ({r.unit})</span> : null}
      </>
    ),
  },
  { key: 'qty', label: 'W DRODZE', sortValue: (r) => r.incoming_qty, render: (r) => <strong>{r.incoming_qty}</strong> },
  {
    key: 'earliest',
    label: 'NAJBLIŻSZA DOSTAWA',
    sortValue: (r) => r.earliest_eta ?? '9999',
    render: (r) => (
      <>
        {formatDatePl(r.earliest_eta)}
        {isOverdue(r.earliest_eta) && (
          <span
            style={{ color: '#c62828', fontWeight: 700, marginLeft: 6 }}
            title="Data dostawy minęła, a pozycja nie została przyjęta — pogoń dostawcę albo przyjmij dostawę"
          >
            po terminie!
          </span>
        )}
      </>
    ),
  },
  {
    key: 'latest',
    label: 'OSTATNIA DOSTAWA',
    sortValue: (r) => r.latest_eta ?? '9999',
    render: (r) => formatDatePl(r.latest_eta),
  },
  { key: 'pos', label: 'OTWARTE ZD', sortValue: (r) => r.open_pos, render: (r) => r.open_pos },
]

export default IncomingView
