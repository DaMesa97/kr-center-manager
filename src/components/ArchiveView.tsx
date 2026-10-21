import { useEffect, useMemo, useState } from 'react'
import ArchivedOrderDetailsModal from './ArchivedOrderDetailsModal'
import type { ArchivedOrder, ArchiveRunLog } from '../types'
import { supabase } from '../supabaseClient'
import { localDayEndExclusiveIso, localDayStartIso } from '../lib/localDates'
import Spinner from './Spinner'
import DataTable, { type DataTableColumn } from './DataTable'

type ArchiveViewProps = {
  orders: ArchivedOrder[]
  loading: boolean
  runLogs: ArchiveRunLog[]
  onRefresh: () => void
  onCreateComplaint: (archivedOrder: ArchivedOrder) => void
  /** Fraza z globalnej lupki (wynik z archiwum) — prefiluje pole Szukaj */
  searchSeed?: string
}

type ArchiveFilters = {
  category: string
  company: string
  dateFrom: string
  dateTo: string
  query: string
}

const EMPTY_FILTERS: ArchiveFilters = { category: '', company: '', dateFrom: '', dateTo: '', query: '' }

// cron.job 'archive-old-orders-daily' = '0 3 * * *', a pg_cron liczy w GMT →
// lokalnie 5:00 latem (CEST), 4:00 zimą (CET)
const ARCHIVE_CRON_UTC_HOUR = 3

function archiveLocalTime(): string {
  const d = new Date()
  d.setUTCHours(ARCHIVE_CRON_UTC_HOUR, 0, 0, 0)
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

// App nigdy nie czyści archiveSearchSeed — bez tego każde ponowne wejście
// w Archiwum wracało z tą samą frazą. Seed konsumujemy raz (na wartość).
let consumedSearchSeed = ''

const lc = (v: unknown) => String(v ?? '').toLowerCase()

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

export default function ArchiveView({ orders, loading, runLogs, onRefresh, onCreateComplaint, searchSeed }: ArchiveViewProps) {
  const [filters, setFilters] = useState<ArchiveFilters>(() => ({
    ...EMPTY_FILTERS,
    query: searchSeed && searchSeed !== consumedSearchSeed ? searchSeed : '',
  }))
  useEffect(() => {
    // globalna lupka → wynik z archiwum: wyczyść filtry i wyszukaj numer (raz)
    if (!searchSeed || searchSeed === consumedSearchSeed) return
    consumedSearchSeed = searchSeed
    setFilters({ ...EMPTY_FILTERS, query: searchSeed })
  }, [searchSeed])
  const [selectedOrder, setSelectedOrder] = useState<ArchivedOrder | null>(null)

  // Prawdziwa liczba w archiwum (count z serwera), niezależnie od tego, ile wczytano
  const [totalCount, setTotalCount] = useState<number | null>(null)
  useEffect(() => {
    let cancelled = false
    void supabase
      .from('orders_archive')
      .select('id', { count: 'exact', head: true })
      .then(({ count, error }) => {
        if (!cancelled && !error) setTotalCount(count ?? 0)
      })
    return () => {
      cancelled = true
    }
  }, [orders])

  const isPartial = totalCount != null && totalCount > orders.length

  // Gdy wczytana jest tylko część archiwum — szukajka pyta też serwer (z opóźnieniem)
  const [remoteHits, setRemoteHits] = useState<ArchivedOrder[]>([])
  useEffect(() => {
    const q = filters.query.trim().replace(/["\\*,()]/g, '')
    if (!isPartial || q.length < 2) {
      setRemoteHits((p) => (p.length ? [] : p))
      return
    }
    let cancelled = false
    const t = window.setTimeout(() => {
      const v = `"*${q}*"`
      void supabase
        .from('orders_archive')
        .select('*')
        .or(`order_number.ilike.${v},client_order_number.ilike.${v},company.ilike.${v}`)
        .order('created_at', { ascending: false })
        .limit(500)
        .then(({ data }) => {
          if (!cancelled) setRemoteHits((data ?? []) as ArchivedOrder[])
        })
    }, 300)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [filters.query, isPartial])

  const sourceOrders = useMemo(() => {
    if (remoteHits.length === 0) return orders
    const seen = new Set(orders.map((o) => o.id))
    return [...orders, ...remoteHits.filter((o) => !seen.has(o.id))]
  }, [orders, remoteHits])

  const companyOptions = useMemo(
    () =>
      Array.from(new Set(orders.map((o) => (o.company ?? '').trim()).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b),
      ),
    [orders],
  )

  const filteredOrders = useMemo(() => {
    const q = filters.query.trim().toLowerCase()
    const company = filters.company.toLowerCase()
    // created_at to timestamptz — granice dnia wg czasu lokalnego
    const fromTs = filters.dateFrom ? new Date(localDayStartIso(filters.dateFrom)).getTime() : null
    const toTs = filters.dateTo ? new Date(localDayEndExclusiveIso(filters.dateTo)).getTime() : null
    return sourceOrders.filter((o) => {
      if (filters.category && o.category !== filters.category) return false
      if (company && !lc(o.company).includes(company)) return false
      const created = o.created_at ? new Date(o.created_at).getTime() : null
      if (fromTs != null && created != null && created < fromTs) return false
      if (toTs != null && created != null && created >= toTs) return false
      if (q) {
        // client_order_number bywa NULL — bez ?? szukajka wywalała cały widok
        const hit = lc(o.order_number).includes(q) || lc(o.client_order_number).includes(q) || lc(o.company).includes(q)
        if (!hit) return false
      }
      return true
    })
  }, [sourceOrders, filters])

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
        <span title="Zadanie pg_cron o 3:00 UTC — latem 5:00, zimą 4:00 czasu polskiego">
          Następna archiwizacja: <strong>codziennie o {archiveLocalTime()} (rano)</strong>
        </span>
        <span>
          W archiwum łącznie: <strong>{totalCount ?? orders.length} zamówień</strong>
          {isPartial && (
            <span title="Szukajka sprawdza też starsze zamówienia na serwerze">
              {' '}
              (wczytano {orders.length} najnowszych)
            </span>
          )}
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
