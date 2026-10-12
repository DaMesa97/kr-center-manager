import { useCallback, useMemo, useState, type ReactNode } from 'react'
import type { GlassAllowance, LeadTimeRule, Order } from '../types'
import { CATEGORY_LABELS } from '../constants'
import {
  autoSuggestReadyToInvoice,
  countCompletedStages,
  getDaysElapsed,
  getOrderAgeStatus,
  isRushOrderSequence,
  isOrderReadyToInvoice,
} from '../utils'
import ShippingProgressBar from './ShippingProgressBar'
import Spinner from './Spinner'
import StockStatusBadge from './StockStatusBadge'
import DataTable, { type DataTableColumn } from './DataTable'

// Forge Control — kolory kategorii (navy tonal)
const CATEGORY_COLORS: Record<string, string> = {
  STA:             '#005faf',
  Disting:         '#4f46e5',
  ST:              '#1d6d45',
  Techniczne:      '#854d0e',
  Bastion:         '#b3261e',
  DrzwiWewnetrzne: '#0369a1',
}

const CATEGORY_SORT_ORDER = ['STA', 'Disting', 'ST', 'Techniczne', 'Bastion', 'DrzwiWewnetrzne'] as const

const NO_ROUTE_KEY = '__NO_ROUTE__'

function categorySortIndex(category: string): number {
  const i = CATEGORY_SORT_ORDER.indexOf(category as (typeof CATEGORY_SORT_ORDER)[number])
  return i === -1 ? 99 : i
}

function compareOrderNumberDesc(a: string, b: string): number {
  const x = parseInt(a, 10)
  const y = parseInt(b, 10)
  if (!isNaN(x) && !isNaN(y)) return y - x
  return b.localeCompare(a)
}

// Status zamówienia (badge) — też wartość sortowania kolumny STATUS
function orderStatus(order: Order): { cls: string; label: string } {
  const { total, percent } = countCompletedStages(order)
  const cat = order.category ?? ''
  if (cat === 'DrzwiWewnetrzne') {
    return { cls: 'order-status-badge order-status-badge--in-progress', label: 'W realizacji' }
  }
  if (cat === 'Techniczne' || total === 0) {
    return { cls: 'shipping-status-badge shipping-status-badge--technical', label: 'Techniczne' }
  }
  if (percent === 100) return { cls: 'shipping-status-badge shipping-status-badge--done', label: 'Gotowe' }
  if (percent > 0) return { cls: 'shipping-status-badge shipping-status-badge--production', label: 'W produkcji' }
  return { cls: 'shipping-status-badge shipping-status-badge--new', label: 'Nowe' }
}

// Wiersz tabeli: nagłówek grupy trasy albo zamówienie
type RouteRow = { kind: 'route'; route: string; count: number; readyCount: number; urgentCount: number }
type ShippingRow = RouteRow | { kind: 'order'; order: Order }

export type ShippingViewProps = {
  orders: Order[]
  companiesMap: Map<string, { production_day: string; route_day: string }>
  loading: boolean
  onRefresh: () => void
  onShowDetails: (order: Order) => void
  onToggleReadyToInvoice: (order: Order, ready: boolean) => Promise<void>
  onRushToggle: (order: Order, checked: boolean) => Promise<void>
  rushUpdatingOrderId: number | null
  isManager: boolean
  glassAllowances: GlassAllowance[]
  leadTimeRules?: LeadTimeRule[]
}

export default function ShippingView({
  orders,
  companiesMap,
  loading,
  onRefresh,
  onShowDetails,
  onToggleReadyToInvoice,
  onRushToggle,
  rushUpdatingOrderId,
  isManager,
  glassAllowances,
  leadTimeRules = [],
}: ShippingViewProps) {
  const getProductionDay = useCallback((company: string | null | undefined) => {
    if (!company) return ''
    return companiesMap.get(company.trim().toLowerCase())?.production_day ?? ''
  }, [companiesMap])

  const getRouteDay = useCallback((company: string | null | undefined) => {
    if (!company) return ''
    return companiesMap.get(company.trim().toLowerCase())?.route_day ?? ''
  }, [companiesMap])

  const [categoryFilter, setCategoryFilter] = useState<string>('')
  const [companyFilter, setCompanyFilter] = useState('')
  const [onlyReadyToInvoice, setOnlyReadyToInvoice] = useState(false)
  const [productionDayFilter, setProductionDayFilter] = useState<string>('')
  const [routeDayFilter, setRouteDayFilter] = useState<string>('')
  const [onlyWithStockIssues, setOnlyWithStockIssues] = useState(false)
  const [onlyUrgent, setOnlyUrgent] = useState(false)
  const [onlyOverdue, setOnlyOverdue] = useState(false)
  const [groupByRoute, setGroupByRoute] = useState(false)

  const availableProductionDays = useMemo(() => {
    const set = new Set<string>()
    for (const o of orders) {
      const day = getProductionDay(o.company)
      if (day) set.add(day)
    }
    return Array.from(set).sort()
  }, [orders, getProductionDay])

  const availableRouteDays = useMemo(() => {
    const set = new Set<string>()
    for (const o of orders) {
      const route = getRouteDay(o.company)
      if (route) set.add(route)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pl'))
  }, [orders, getRouteDay])

  const filteredOrders = useMemo(() => {
    const companyQ = companyFilter.trim().toLowerCase()
    return orders.filter((o) => {
      if (categoryFilter && (o.category ?? '') !== categoryFilter) return false
      if (companyQ && !String(o.company ?? '').toLowerCase().includes(companyQ)) return false
      if (onlyReadyToInvoice && !isOrderReadyToInvoice(o)) return false
      if (onlyWithStockIssues && (!o.stock_status || o.stock_status === 'ok')) return false
      if (onlyUrgent && !isRushOrderSequence(o.sequence)) return false
      if (productionDayFilter) {
        const day = getProductionDay(o.company)
        if (productionDayFilter === '__EMPTY__') {
          if (day) return false
        } else if (day !== productionDayFilter) {
          return false
        }
      }
      if (routeDayFilter) {
        const route = getRouteDay(o.company)
        if (routeDayFilter === '__EMPTY__') {
          if (route) return false
        } else if (route !== routeDayFilter) {
          return false
        }
      }
      if (onlyOverdue && getOrderAgeStatus(o, leadTimeRules) === 'ok') return false
      return true
    })
  }, [
    orders,
    categoryFilter,
    companyFilter,
    onlyReadyToInvoice,
    onlyWithStockIssues,
    onlyUrgent,
    onlyOverdue,
    productionDayFilter,
    routeDayFilter,
    getProductionDay,
    getRouteDay,
    leadTimeRules,
  ])

  const displayedOrders = useMemo(() => {
    const rows = [...filteredOrders]
    rows.sort((a, b) => {
      const aUrgent = isRushOrderSequence(a.sequence)
      const bUrgent = isRushOrderSequence(b.sequence)
      if (aUrgent !== bUrgent) return aUrgent ? -1 : 1
      const ca = categorySortIndex(a.category ?? '')
      const cb = categorySortIndex(b.category ?? '')
      if (ca !== cb) return ca - cb
      return compareOrderNumberDesc(String(a.order_number ?? ''), String(b.order_number ?? ''))
    })
    return rows
  }, [filteredOrders])

  // Grupowanie po trasie — zachowuje istniejące sortowanie wewnątrz grupy
  const routeGroups = useMemo(() => {
    if (!groupByRoute) return null
    const map = new Map<string, Order[]>()
    for (const order of displayedOrders) {
      const route = getRouteDay(order.company) || NO_ROUTE_KEY
      if (!map.has(route)) map.set(route, [])
      map.get(route)!.push(order)
    }
    return Array.from(map.entries())
      .map(([route, routeOrders]) => ({ route, orders: routeOrders }))
      .sort((a, b) => {
        if (a.route === NO_ROUTE_KEY) return 1
        if (b.route === NO_ROUTE_KEY) return -1
        return a.route.localeCompare(b.route, 'pl')
      })
  }, [groupByRoute, displayedOrders, getRouteDay])

  const openCount = orders.length
  const readyCount = displayedOrders.filter((o) => isOrderReadyToInvoice(o)).length
  const withIssuesCount = useMemo(
    () => orders.filter((o) => o.stock_status && o.stock_status !== 'ok').length,
    [orders],
  )
  const urgentCount = useMemo(
    () => orders.filter((o) => isRushOrderSequence(o.sequence)).length,
    [orders],
  )
  const overdueCount = useMemo(
    () => orders.filter((o) => getOrderAgeStatus(o, leadTimeRules) === 'overdue').length,
    [orders, leadTimeRules],
  )

  const warningCount = useMemo(
    () => orders.filter((o) => getOrderAgeStatus(o, leadTimeRules) === 'warning').length,
    [orders, leadTimeRules],
  )

  // ---------------------------------------------------------------------------
  // Wiersze tabeli — w trybie grupowania nagłówek trasy przed zamówieniami grupy
  // ---------------------------------------------------------------------------

  const tableRows = useMemo<ShippingRow[]>(() => {
    if (!routeGroups) return displayedOrders.map((order): ShippingRow => ({ kind: 'order', order }))
    return routeGroups.flatMap(({ route, orders: groupOrders }): ShippingRow[] => [
      {
        kind: 'route',
        route,
        count: groupOrders.length,
        readyCount: groupOrders.filter((o) => isOrderReadyToInvoice(o)).length,
        urgentCount: groupOrders.filter((o) => isRushOrderSequence(o.sequence)).length,
      },
      ...groupOrders.map((order): ShippingRow => ({ kind: 'order', order })),
    ])
  }, [routeGroups, displayedOrders])

  const renderRouteRow = (row: RouteRow) => {
    const label = row.route === NO_ROUTE_KEY ? 'Bez przypisanej trasy' : row.route
    return (
      <tr className="shipping-route-group-header">
        <td colSpan={11}>
          <div>
            <span className="shipping-route-label">🚛 {label}</span>
            <span className="shipping-route-stats">
              <span className="shipping-route-stat">{row.count} zam.</span>
              {row.readyCount > 0 && (
                <span className="shipping-route-stat shipping-route-stat--ready">
                  ✓ {row.readyCount} gotowych
                </span>
              )}
              {row.urgentCount > 0 && (
                <span className="shipping-route-stat shipping-route-stat--urgent">
                  ⚡ {row.urgentCount} pilnych
                </span>
              )}
            </span>
          </div>
        </td>
      </tr>
    )
  }

  // Sortowanie tylko w trybie płaskim — w grupach rozbiłoby nagłówki tras
  const sv = (get: (o: Order) => unknown) =>
    groupByRoute ? undefined : (r: ShippingRow) => (r.kind === 'order' ? get(r.order) : null)

  // Kolumny dostają tylko wiersze zamówień (nagłówki tras idą przez renderRow)
  const col = (
    c: Omit<DataTableColumn<ShippingRow>, 'render'> & { render: (o: Order) => ReactNode },
  ): DataTableColumn<ShippingRow> => ({
    ...c,
    render: (r) => (r.kind === 'order' ? c.render(r.order) : null),
  })

  const isSuggested = (r: ShippingRow) =>
    r.kind === 'order' && autoSuggestReadyToInvoice(r.order) && !isOrderReadyToInvoice(r.order)

  const columns: DataTableColumn<ShippingRow>[] = [
    col({
      key: 'rush',
      label: 'PILNE',
      className: 'col-rush',
      tdClassName: 'rush-cell',
      stopRowClick: true,
      render: (order) => (
        <input
          type="checkbox"
          className="rush-checkbox"
          checked={isRushOrderSequence(order.sequence)}
          disabled={!isManager || order.id === undefined || rushUpdatingOrderId === order.id}
          title="Pilne zamówienie"
          aria-label="Pilne"
          onChange={(e) => {
            e.stopPropagation()
            void onRushToggle(order, e.target.checked)
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ),
    }),
    col({
      key: 'nr',
      label: 'NR ZLECENIA',
      className: 'col-nr',
      render: (order) => order.order_number,
      sortValue: sv((o) => o.order_number),
    }),
    col({
      key: 'cat',
      label: 'KATEGORIA',
      className: 'col-cat',
      render: (order) => {
        const cat = order.category ?? ''
        const catLabel = CATEGORY_LABELS[cat as keyof typeof CATEGORY_LABELS] ?? cat
        return (
          <span
            className="shipping-category-badge"
            style={{ backgroundColor: CATEGORY_COLORS[cat] ?? '#6b7280' }}
            title={catLabel}
          >
            {catLabel}
          </span>
        )
      },
      sortValue: sv((o) => categorySortIndex(o.category ?? '')),
    }),
    col({
      key: 'firm',
      label: 'FIRMA',
      className: 'col-firm',
      tdStyle: { overflow: 'hidden', textOverflow: 'ellipsis' },
      render: (order) => order.company,
      sortValue: sv((o) => o.company),
    }),
    col({
      key: 'day',
      label: 'DZIEŃ PROD.',
      className: 'col-day',
      render: (order) => getProductionDay(order.company),
      sortValue: sv((o) => getProductionDay(o.company)),
    }),
    col({
      key: 'qty',
      label: 'ILOŚĆ',
      className: 'col-qty',
      render: (order) => order.quantity ?? '—',
      sortValue: sv((o) => o.quantity),
    }),
    col({
      key: 'prog',
      label: 'POSTĘP',
      className: 'col-prog',
      render: (order) => <ShippingProgressBar order={order} />,
      sortValue: sv((o) => countCompletedStages(o).percent),
    }),
    col({
      key: 'status',
      label: 'STATUS',
      className: 'col-status',
      render: (order) => {
        const s = orderStatus(order)
        return <span className={s.cls}>{s.label}</span>
      },
      sortValue: sv((o) => orderStatus(o).label),
    }),
    col({
      key: 'stock',
      label: 'BRAKI',
      className: 'col-stock',
      render: (order) => (
        <StockStatusBadge
          status={order.stock_status}
          issues={order.stock_issues}
          category={order.category}
          glassAllowances={glassAllowances}
        />
      ),
    }),
    col({
      key: 'inv',
      label: 'FAKTURA',
      className: 'col-inv',
      tdClassName: (r) => (isSuggested(r) ? 'shipping-invoice-cell--suggested' : undefined),
      tdTitle: (r) =>
        isSuggested(r)
          ? 'Sugestia: wszystkie etapy ukończone lub data wydania ustawiona — można oznaczyć jako gotowe do fakturowania'
          : undefined,
      render: (order) => (
        <input
          type="checkbox"
          checked={isOrderReadyToInvoice(order)}
          disabled={loading || order.id === undefined}
          onChange={(e) => {
            e.stopPropagation()
            void onToggleReadyToInvoice(order, e.target.checked)
          }}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Gotowe do fakturowania — ${order.order_number}`}
        />
      ),
      sortValue: sv((o) => (isOrderReadyToInvoice(o) ? 1 : 0)),
    }),
    col({
      key: 'act',
      label: 'AKCJE',
      className: 'col-act',
      render: (order) => (
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={(e) => {
            e.stopPropagation()
            onShowDetails(order)
          }}
        >
          Szczegóły
        </button>
      ),
    }),
  ]

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="shipping-view">
      <div className="shipping-meta" role="status">
        <span>
          <strong>Zamówień otwartych:</strong> {openCount}
        </span>
        <span>
          <strong>Pasujących filtrom:</strong> {filteredOrders.length}
        </span>
        <span>
          <strong>Gotowych do fakturowania:</strong> {readyCount}
        </span>
        <span>
          <strong>Z brakami magazynowymi:</strong>{' '}
          <strong style={{ color: '#b91c1c' }}>{withIssuesCount}</strong>
        </span>
        <span>
          <strong>Pilnych:</strong> <strong style={{ color: '#b91c1c' }}>{urgentCount}</strong>
        </span>
        <span>
          <strong>Ostrzeżenia:</strong>{' '}
          <strong style={{ color: warningCount > 0 ? '#b45309' : undefined }}>{warningCount}</strong>
        </span>
        <span>
          <strong>Przeterminowanych:</strong>{' '}
          <strong style={{ color: overdueCount > 0 ? '#b91c1c' : undefined }}>{overdueCount}</strong>
        </span>
        <button type="button" className="btn btn-sm btn-primary" onClick={() => onRefresh()} disabled={loading}>
          Odśwież
        </button>
      </div>

      <div className="orders-filters" style={{ marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        {/* Kategoria */}
        <label className="orders-filter-checkbox" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span>Kategoria</span>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="day-filter">
            <option value="">Wszystkie</option>
            {CATEGORY_SORT_ORDER.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</option>
            ))}
          </select>
        </label>

        {/* Firma */}
        <label className="orders-filter-checkbox" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span>Firma</span>
          <input
            type="text"
            className="search-input"
            style={{ minWidth: 200 }}
            placeholder="Filtruj po firmie…"
            value={companyFilter}
            onChange={(e) => setCompanyFilter(e.target.value)}
          />
        </label>

        {/* Dzień produkcji */}
        <label className="orders-filter-checkbox" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span>Dzień prod.</span>
          <select value={productionDayFilter} onChange={(e) => setProductionDayFilter(e.target.value)} className="day-filter">
            <option value="">wszystkie</option>
            <option value="__EMPTY__">(bez ustawionego)</option>
            {availableProductionDays.map((day) => (
              <option key={day} value={day}>{day}</option>
            ))}
          </select>
        </label>

        {/* Trasa */}
        <label className="orders-filter-checkbox" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span>Trasa</span>
          <select
            value={routeDayFilter}
            onChange={(e) => setRouteDayFilter(e.target.value)}
            className="day-filter"
            disabled={groupByRoute}
            title={groupByRoute ? 'Wyłącz grupowanie by filtrować po trasie' : undefined}
          >
            <option value="">wszystkie</option>
            <option value="__EMPTY__">(bez trasy)</option>
            {availableRouteDays.map((route) => (
              <option key={route} value={route}>{route}</option>
            ))}
          </select>
        </label>

        {/* Checkboxy */}
        <label className="orders-filter-checkbox">
          <input type="checkbox" checked={onlyReadyToInvoice} onChange={(e) => setOnlyReadyToInvoice(e.target.checked)} />
          <span>Tylko gotowe do fakturowania</span>
        </label>
        <label className="orders-filter-checkbox" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={onlyWithStockIssues} onChange={(e) => setOnlyWithStockIssues(e.target.checked)} />
          <span>Tylko z brakami magazynowymi</span>
        </label>
        <label className="orders-filter-checkbox" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={onlyUrgent} onChange={(e) => setOnlyUrgent(e.target.checked)} />
          <span>Tylko pilne</span>
        </label>

        {/* Tylko przeterminowane/z ostrzeżeniem */}
        <label className="orders-filter-checkbox orders-filter-checkbox--overdue" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={onlyOverdue}
            onChange={(e) => setOnlyOverdue(e.target.checked)}
          />
          <span>Tylko opóźnione</span>
          {warningCount > 0 && (
            <span className="overdue-filter-pill overdue-filter-pill--warning">{warningCount}</span>
          )}
          {overdueCount > 0 && (
            <span className="overdue-filter-pill">{overdueCount}</span>
          )}
        </label>

        {/* Grupuj po trasie */}
        <label className="orders-filter-checkbox orders-filter-checkbox--highlight" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={groupByRoute}
            onChange={(e) => {
              setGroupByRoute(e.target.checked)
              if (e.target.checked) setRouteDayFilter('')
            }}
          />
          <span>Grupuj po trasie</span>
        </label>
      </div>

      <div style={{ fontSize: '0.75rem', color: '#6b7280', padding: '4px 0 8px 0' }}>
        💡 Żółte tło w kolumnie "Gotowe do fakturowania" = sugestia systemu (wszystkie etapy
        ukończone lub data wydania ustawiona)
      </div>

      <DataTable
        rows={tableRows}
        rowKey={(r) =>
          r.kind === 'route' ? `group-${r.route}` : (r.order.id ?? `${r.order.category ?? ''}-${r.order.order_number}`)
        }
        columns={columns}
        wrapperClassName="orders-table-wrapper"
        colgroup={
          <colgroup>
            <col className="col-rush" />
            <col className="col-nr" />
            <col className="col-cat" />
            <col className="col-firm" />
            <col className="col-day" />
            <col className="col-qty" />
            <col className="col-prog" />
            <col className="col-status" />
            <col className="col-stock" />
            <col className="col-inv" />
            <col className="col-act" />
          </colgroup>
        }
        loading={loading}
        loadingText={<Spinner center label="Ładowanie…" />}
        emptyText="Brak zamówień spełniających kryteria."
        renderRow={(r) => (r.kind === 'route' ? renderRouteRow(r) : undefined)}
        rowClassName={(r) => {
          if (r.kind !== 'order') return undefined
          const ageStatus = getOrderAgeStatus(r.order, leadTimeRules)
          return [
            'orders-table-row',
            isRushOrderSequence(r.order.sequence) ? 'orders-table-row--priority' : '',
            ageStatus === 'overdue' ? 'orders-table-row--overdue' : '',
            ageStatus === 'warning' ? 'orders-table-row--warning' : '',
          ]
            .filter(Boolean)
            .join(' ')
        }}
        rowTitle={(r) => {
          if (r.kind !== 'order') return undefined
          const ageStatus = getOrderAgeStatus(r.order, leadTimeRules)
          const daysElapsed = getDaysElapsed(r.order)
          if (ageStatus === 'overdue') return `Przeterminowane — ${daysElapsed} dni od złożenia zamówienia`
          if (ageStatus === 'warning') return `Uwaga: ${daysElapsed} dni od złożenia zamówienia`
          return undefined
        }}
        onRowClick={(r) => {
          if (r.kind === 'order') onShowDetails(r.order)
        }}
      />
    </div>
  )
}
