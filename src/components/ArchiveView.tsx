import { useMemo, useState } from 'react'
import ArchivedOrderDetailsModal from './ArchivedOrderDetailsModal'
import type { ArchivedOrder, ArchiveRunLog } from '../types'
import Spinner from './Spinner'

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
        <div className="table-wrapper">
          <table className="orders-table audit-table">
            <thead>
              <tr>
                <th>NR ZLECENIA</th>
                <th>DATA UTWORZENIA</th>
                <th>DATA ARCH.</th>
                <th>KATEGORIA</th>
                <th>FIRMA</th>
                <th>SYSTEM</th>
                <th>MODEL</th>
                <th>ILOŚĆ</th>
                <th>AKCJE</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={9} className="no-results">
                    Brak archiwalnych zamówień dla podanych filtrów.
                  </td>
                </tr>
              ) : (
                filteredOrders.map((order) => (
                  <tr key={`${order.id ?? order.order_number}-${order.archived_at}`}>
                    <td>{order.order_number}</td>
                    <td>{formatDate(order.created_at)}</td>
                    <td>{formatDate(order.archived_at)}</td>
                    <td>{order.category}</td>
                    <td>{order.company}</td>
                    <td>{order.system}</td>
                    <td>{order.model}</td>
                    <td>{order.quantity}</td>
                    <td className="col-order-actions">
                      <button type="button" className="btn btn-sm btn-primary" onClick={() => setSelectedOrder(order)}>
                        Szczegóły
                      </button>
                      <button type="button" className="btn btn-primary" onClick={() => onCreateComplaint(order)}>
                        Utwórz reklamację
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="archive-run-log">
        <h3>Historia archiwizacji</h3>
        <div className="table-wrapper">
          <table className="orders-table audit-table">
            <thead>
              <tr>
                <th>DATA</th>
                <th>STATUS</th>
                <th>LICZBA ARCHIWIZOWANYCH</th>
                <th>CZAS (ms)</th>
              </tr>
            </thead>
            <tbody>
              {runLogs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="no-results">
                    Brak logów archiwizacji.
                  </td>
                </tr>
              ) : (
                runLogs.map((log) => (
                  <tr key={log.id} title={log.error_message ?? undefined}>
                    <td>{formatDate(log.run_at)}</td>
                    <td>
                      <span className={`archive-run-log-status--${log.status}`}>{log.status}</span>
                    </td>
                    <td>{log.archived_count}</td>
                    <td>{log.duration_ms ?? '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
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
