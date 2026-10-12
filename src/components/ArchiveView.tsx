import { useMemo, useState } from 'react'
import ArchivedOrderDetailsModal from './ArchivedOrderDetailsModal'
import type { ArchivedOrder, ArchiveRunLog } from '../types'
import Spinner from './Spinner'
import DataTable, { type DataTableColumn } from './DataTable'

type ArchiveViewProps = {
  orders: ArchivedOrder[]
  loading: boolean
  runLogs: ArchiveRunLog[]
  onRefresh: () => void
  onCreateComplaint: (archivedOrder: ArchivedOrder) => void
}

type ArchiveFilters = {
  category: string
  company: string
  dateFrom: string
  dateTo: string
  query: string
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const runLogColumns: DataTableColumn<ArchiveRunLog>[] = [
  { key: 'run_at', label: 'DATA', sortValue: (l) => l.run_at, render: (l) => formatDate(l.run_at) },
  {
    key: 'status',
    label: 'STATUS',
    sortValue: (l) => l.status,
    render: (l) => <span className={`archive-run-log-status--${l.status}`}>{l.status}</span>,
  },
  { key: 'archived_count', label: 'LICZBA ARCHIWIZOWANYCH', sortValue: (l) => l.archived_count, render: (l) => l.archived_count },
  { key: 'duration_ms', label: 'CZAS (ms)', sortValue: (l) => l.duration_ms, render: (l) => l.duration_ms ?? '—' },
]

export default function ArchiveView({ orders, loading, runLogs, onRefresh, onCreateComplaint }: ArchiveViewProps) {
  const [filters, setFilters] = useState<ArchiveFilters>({
    category: '',
    company: '',
    dateFrom: '',
    dateTo: '',
    query: '',
  })
  const [selectedOrder, setSelectedOrder] = useState<ArchivedOrder | null>(null)

  const companyOptions = useMemo(
    () => Array.from(new Set(orders.map((o) => o.company).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [orders],
  )

  const filteredOrders = useMemo(() => {
    const q = filters.query.trim().toLowerCase()
    return orders.filter((o) => {
      if (filters.category && o.category !== filters.category) return false
      if (filters.company && !o.company.toLowerCase().includes(filters.company.toLowerCase())) return false
      if (filters.dateFrom && o.created_at && o.created_at < filters.dateFrom) return false
      if (filters.dateTo && o.created_at && o.created_at > `${filters.dateTo}T23:59:59.999`) return false
      if (q) {
        const hit =
          o.order_number.toLowerCase().includes(q) ||
          o.client_order_number.toLowerCase().includes(q) ||
          o.company.toLowerCase().includes(q)
        if (!hit) return false
      }
      return true
    })
  }, [orders, filters])

  const latestRun = runLogs[0]

  const orderColumns = useMemo<DataTableColumn<ArchivedOrder>[]>(
    () => [
      { key: 'order_number', label: 'NR ZLECENIA', sortValue: (o) => o.order_number, render: (o) => o.order_number },
      { key: 'created_at', label: 'DATA UTWORZENIA', sortValue: (o) => o.created_at, render: (o) => formatDate(o.created_at) },
      { key: 'archived_at', label: 'DATA ARCH.', sortValue: (o) => o.archived_at, render: (o) => formatDate(o.archived_at) },
      { key: 'category', label: 'KATEGORIA', sortValue: (o) => o.category, render: (o) => o.category },
      { key: 'company', label: 'FIRMA', sortValue: (o) => o.company, render: (o) => o.company },
      { key: 'system', label: 'SYSTEM', sortValue: (o) => o.system, render: (o) => o.system },
      { key: 'model', label: 'MODEL', sortValue: (o) => o.model, render: (o) => o.model },
      { key: 'quantity', label: 'ILOŚĆ', sortValue: (o) => o.quantity, render: (o) => o.quantity },
      {
        key: 'actions',
        label: 'AKCJE',
        tdClassName: 'col-order-actions',
        render: (o) => (
          <>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setSelectedOrder(o)}>
              Szczegóły
            </button>
            <button type="button" className="btn btn-primary" onClick={() => onCreateComplaint(o)}>
              Utwórz reklamację
            </button>
          </>
        ),
      },
    ],
    [onCreateComplaint],
  )

  return (
    <div>
      <div className="archive-meta">
        <span>
          Ostatnia archiwizacja:{' '}
          <strong>
            {latestRun ? `${formatDate(latestRun.run_at)} (${latestRun.archived_count} zarchiwizowanych)` : '—'}
          </strong>
        </span>
        <span>
          Następna archiwizacja: <strong>codziennie o 4:00 (rano)</strong>
        </span>
        <span>
          W archiwum łącznie: <strong>{orders.length} zamówień</strong>
        </span>
        <button type="button" className="btn btn-primary" onClick={onRefresh}>
          Odśwież
        </button>
      </div>

      <div className="orders-filters">
        <select
          className="day-filter"
          value={filters.category}
          onChange={(e) => setFilters((p) => ({ ...p, category: e.target.value }))}
        >
          <option value="">Wszystkie kategorie</option>
          <option value="STA">STA</option>
          <option value="Disting">Disting</option>
          <option value="ST">ST</option>
          <option value="Techniczne">Techniczne</option>
          <option value="Bastion">Bastion</option>
        </select>
        <input
          list="archive-companies"
          className="day-filter"
          placeholder="Firma"
          value={filters.company}
          onChange={(e) => setFilters((p) => ({ ...p, company: e.target.value }))}
        />
        <datalist id="archive-companies">
          {companyOptions.map((company) => (
            <option key={company} value={company} />
          ))}
        </datalist>
        <input
          type="date"
          className="day-filter"
          value={filters.dateFrom}
          onChange={(e) => setFilters((p) => ({ ...p, dateFrom: e.target.value }))}
        />
        <input
          type="date"
          className="day-filter"
          value={filters.dateTo}
          onChange={(e) => setFilters((p) => ({ ...p, dateTo: e.target.value }))}
        />
        <input
          type="text"
          className="search-input"
          placeholder="Szukaj po numerze zlecenia / numerze klienta..."
          value={filters.query}
          onChange={(e) => setFilters((p) => ({ ...p, query: e.target.value }))}
        />
      </div>

      {loading ? (
        <Spinner center label="Ładowanie archiwum…" />
      ) : (
        <DataTable
          rows={filteredOrders}
          rowKey={(o) => `${o.id ?? o.order_number}-${o.archived_at}`}
          columns={orderColumns}
          className="audit-table"
          emptyText="Brak archiwalnych zamówień dla podanych filtrów."
        />
      )}

      <div className="archive-run-log">
        <h3>Historia archiwizacji</h3>
        <DataTable
          rows={runLogs}
          rowKey={(log) => log.id}
          columns={runLogColumns}
          className="audit-table"
          rowTitle={(log) => log.error_message ?? undefined}
          emptyText="Brak logów archiwizacji."
        />
      </div>

      <ArchivedOrderDetailsModal
        open={selectedOrder !== null}
        order={selectedOrder}
        onClose={() => setSelectedOrder(null)}
        onCreateComplaint={onCreateComplaint}
      />
    </div>
  )
}
