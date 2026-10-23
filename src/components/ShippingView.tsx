import { useCallback, useMemo, useState, type ReactNode } from 'react'
import type { GlassAllowance, LeadTimeRule, Order } from '../types'
import { CATEGORY_LABELS } from '../constants'
import { aluOrderExtra } from '../lib/alu'
import {
  autoSuggestReadyToInvoice,
  countCompletedStages,
  getDaysElapsed,
  getOrderAgeStatus,
  hasGlassExtra,
  isRushOrderSequence,
  isOrderReadyToInvoice,
  orderRouteMark,
  orderSetCompleteness,
} from '../utils'
import ShippingProgressBar from './ShippingProgressBar'
import Spinner from './Spinner'
import StockStatusBadge from './StockStatusBadge'
import DataTable, { type DataTableColumn } from './DataTable'
import {
  PERSONAL_PICKUP_ROUTE,
  createCompanyResolver,
  getOrderProductionDay,
  getOrderRouteDay,
} from '../lib/companyMatch'

// Forge Control — kolory kategorii (navy tonal)
const CATEGORY_COLORS: Record<string, string> = {
  STA:             '#005faf',
  Disting:         '#4f46e5',
  ST:              '#1d6d45',
  Techniczne:      '#854d0e',
  Bastion:         '#b3261e',
  DrzwiWewnetrzne: '#0369a1',
  Aluminium:       '#475569',
}

const CATEGORY_SORT_ORDER = ['STA', 'Disting', 'ST', 'Techniczne', 'Bastion', 'DrzwiWewnetrzne', 'Aluminium'] as const

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
  if (order.release_date) {
    return { cls: 'shipping-status-badge shipping-status-badge--done', label: 'Wydane' }
  }
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
  /** Wydane w ostatnich 14 dniach — do dokończenia oznaczania fakturowania */
  releasedOrders?: Order[]
  /** PEŁNA (niezawężona) lista otwartych — kompletność kompletu musi widzieć
   *  nogi z innych kategorii, nawet gdy user ma zawężone kategorie */
  fullOrders?: Order[]
  companiesMap: Map<string, { production_day: string; route_day: string }>
  loading: boolean
  onRefresh: () => void
  onShowDetails: (order: Order) => void
  onToggleReadyToInvoice: (order: Order, ready: boolean) => Promise<void>
  /** Plan wydań: klik przełącza puste → X (jutro) → XX (dziś) → puste */
  onToggleRouteMark: (order: Order) => Promise<void>
  onRushToggle: (order: Order, checked: boolean) => Promise<void>
  rushUpdatingOrderId: number | null
  isManager: boolean
  /** shipping.invoice — bez tego checkbox FAKTURA tylko do odczytu */
  canInvoice: boolean
  glassAllowances: GlassAllowance[]
  leadTimeRules?: LeadTimeRule[]
}

export default function ShippingView({
  orders,
  releasedOrders = [],
  fullOrders,
  companiesMap,
  loading,
  onRefresh,
  onShowDetails,
  onToggleReadyToInvoice,
  onToggleRouteMark,
  onRushToggle,
  rushUpdatingOrderId,
  isManager,
  canInvoice,
  glassAllowances,
  leadTimeRules = [],
}: ShippingViewProps) {
  // Dzień prod. z zamówienia (firma jako fallback), trasa z firmy dopasowanej
  // tolerancyjnie — liczone raz na zamówienie, filtry/sort wołają to wielokrotnie
  const getLogistics = useMemo(() => {
    const resolve = createCompanyResolver(companiesMap)
    const cache = new WeakMap<Order, { productionDay: string; routeDay: string }>()
    return (order: Order) => {
      let v = cache.get(order)
      if (!v) {
        const info = resolve(order.company)
        v = { productionDay: getOrderProductionDay(order, info), routeDay: getOrderRouteDay(order, info) }
        cache.set(order, v)
      }
      return v
    }
  }, [companiesMap])

  const getProductionDay = useCallback((order: Order) => getLogistics(order).productionDay, [getLogistics])
  const getRouteDay = useCallback((order: Order) => getLogistics(order).routeDay, [getLogistics])

  const [categoryFilter, setCategoryFilter] = useState<string>('')
  const [companyFilter, setCompanyFilter] = useState('')
  const [onlyReadyToInvoice, setOnlyReadyToInvoice] = useState(false)
  const [productionDayFilter, setProductionDayFilter] = useState<string>('')
  const [routeDayFilter, setRouteDayFilter] = useState<string>('')
  const [onlyWithStockIssues, setOnlyWithStockIssues] = useState(false)
  // Plan wydań: '' = wszystkie, 'XX' = na dziś, 'X' = na jutro
  const [routeMarkFilter, setRouteMarkFilter] = useState<string>('')
  const [onlyUrgent, setOnlyUrgent] = useState(false)
  const [onlyOverdue, setOnlyOverdue] = useState(false)
  const [groupByRoute, setGroupByRoute] = useState(false)
  // „Gotowe do fakturowania" nie znika już w momencie wydania — wydane
  // z ostatnich 14 dni można dociągnąć na listę i dokończyć oznaczanie
  const [showReleased, setShowReleased] = useState(false)
  const visibleOrders = useMemo(
    () => (showReleased ? [...orders, ...releasedOrders] : orders),
    [orders, releasedOrders, showReleased],
  )

  const availableProductionDays = useMemo(() => {
    const set = new Set<string>()
    for (const o of orders) {
      const day = getProductionDay(o)
      if (day) set.add(day)
    }
    return Array.from(set).sort()
  }, [orders, getProductionDay])

  const availableRouteDays = useMemo(() => {
    const set = new Set<string>()
    for (const o of orders) {
      const route = getRouteDay(o)
      if (route) set.add(route)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pl'))
  }, [orders, getRouteDay])

  const filteredOrders = useMemo(() => {
    const companyQ = companyFilter.trim().toLowerCase()
    return visibleOrders.filter((o) => {
      if (categoryFilter && (o.category ?? '') !== categoryFilter) return false
      if (companyQ && !String(o.company ?? '').toLowerCase().includes(companyQ)) return false
      if (onlyReadyToInvoice && !isOrderReadyToInvoice(o)) return false
      if (routeMarkFilter && orderRouteMark(o) !== routeMarkFilter) return false
      if (onlyWithStockIssues && (!o.stock_status || o.stock_status === 'ok')) return false
      if (onlyUrgent && !isRushOrderSequence(o.sequence)) return false
      if (productionDayFilter) {
        const day = getProductionDay(o)
        if (productionDayFilter === '__EMPTY__') {
          if (day) return false
        } else if (day !== productionDayFilter) {
          return false
        }
      }
      if (routeDayFilter) {
        const route = getRouteDay(o)
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
    visibleOrders,
    categoryFilter,
    companyFilter,
    onlyReadyToInvoice,
    routeMarkFilter,
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
    // Domyślna kolejka wysyłki (decyzja Tymka): XX → X → reszta,
    // w obrębie grupy pilne na górze, potem NAJSTARSZE pierwsze
    const markRank = (o: Order) => (orderRouteMark(o) === 'XX' ? 2 : orderRouteMark(o) === 'X' ? 1 : 0)
    const rows = [...filteredOrders]
    rows.sort((a, b) => {
      const mr = markRank(b) - markRank(a)
      if (mr !== 0) return mr
      const aUrgent = isRushOrderSequence(a.sequence)
      const bUrgent = isRushOrderSequence(b.sequence)
      if (aUrgent !== bUrgent) return aUrgent ? -1 : 1
      const da = String(a.order_date ?? '9999')
      const db = String(b.order_date ?? '9999')
      if (da !== db) return da.localeCompare(db)
      return compareOrderNumberDesc(String(a.order_number ?? ''), String(b.order_number ?? ''))
    })
    return rows
  }, [filteredOrders])

  // Kompletność kompletu liczona na PEŁNEJ liście (nogi z innych kategorii)
  const completenessOf = useMemo(() => {
    const base = fullOrders ?? orders
    const cache = new Map<number, ReturnType<typeof orderSetCompleteness>>()
    return (o: Order) => {
      if (o.id == null) return null
      let v = cache.get(o.id)
      if (v === undefined) {
        v = orderSetCompleteness(o, base)
        cache.set(o.id, v)
      }
      return v
    }
  }, [fullOrders, orders])

  // Grupowanie po trasie — zachowuje istniejące sortowanie wewnątrz grupy
  const routeGroups = useMemo(() => {
    if (!groupByRoute) return null
    const map = new Map<string, Order[]>()
    for (const order of displayedOrders) {
      const route = getRouteDay(order) || NO_ROUTE_KEY
      if (!map.has(route)) map.set(route, [])
      map.get(route)!.push(order)
    }
    return Array.from(map.entries())
      .map(([route, routeOrders]) => ({ route, orders: routeOrders }))
      .sort((a, b) => {
        // kolejność: trasy, odbiór osobisty, bez trasy
        const rank = (r: string) => (r === NO_ROUTE_KEY ? 2 : r === PERSONAL_PICKUP_ROUTE ? 1 : 0)
        if (rank(a.route) !== rank(b.route)) return rank(a.route) - rank(b.route)
        return a.route.localeCompare(b.route, 'pl')
      })
  }, [groupByRoute, displayedOrders, getRouteDay])

  const openCount = orders.length
  // z OTWARTYCH — po włączeniu "Pokaż wydane" licznik nie może rosnąć o wydane,
  // gdy pozostałe liczniki belki liczą się z otwartych
  const readyCount = orders.filter((o) => isOrderReadyToInvoice(o)).length
  const routeTodayCount = orders.filter((o) => orderRouteMark(o) === 'XX').length
  const routeTomorrowCount = orders.filter((o) => orderRouteMark(o) === 'X').length
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
    const icon = row.route === PERSONAL_PICKUP_ROUTE ? '🙋' : '🚛'
    return (
      <tr className="shipping-route-group-header">
        <td colSpan={17}>
          <div>
            <span className="shipping-route-label">{icon} {label}</span>
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
      render: (order) => (
        <>
          {order.order_number}
          {order.category === 'Aluminium' && aluOrderExtra(order).realizacja === 'montaz' && (
            <span className="alu-realizacja-chip alu-realizacja-chip--montaz" style={{ marginLeft: 6 }} title="Realizacja montażem własnym — nie jedzie transportem">
              MONTAŻ
            </span>
          )}
        </>
      ),
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
      key: 'model',
      label: 'MODEL',
      className: 'col-ship-model',
      render: (order) => (
        <>
          <div className="ship-cell-main">{order.model || '—'}</div>
          <div className="ship-cell-sub">{order.system || ''}</div>
        </>
      ),
      sortValue: sv((o) => `${o.model ?? ''} ${o.system ?? ''}`),
    }),
    col({
      key: 'ordered',
      label: 'ZŁOŻONE',
      title: 'Data złożenia zamówienia i ile DNI ROBOCZYCH czeka (kolor wg reguł terminów; weekendy nie liczą się)',
      className: 'col-ordered',
      render: (order) => {
        const d = String(order.order_date ?? '').slice(0, 10)
        if (!d) return '—'
        const days = getDaysElapsed(order)
        const age = getOrderAgeStatus(order, leadTimeRules)
        return (
          <span className={`shipping-age shipping-age--${age}`} title={`Złożone ${d}`}>
            {d.slice(8, 10)}.{d.slice(5, 7)}
            <span className="shipping-age-days">{days} dn. rob.</span>
          </span>
        )
      },
      sortValue: sv((o) => String(o.order_date ?? '9999')),
    }),
    col({
      key: 'day',
      label: 'DZIEŃ PROD.',
      className: 'col-day',
      render: (order) => getProductionDay(order),
      sortValue: sv((o) => getProductionDay(o)),
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
      key: 'komplet',
      label: 'KOMPLET',
      title: 'Para Disting Plus / trójka Titan: czy WSZYSTKIE nogi kompletu są gotowe do wysyłki',
      className: 'col-komplet',
      render: (order) => {
        const c = completenessOf(order)
        if (!c) return <span className="shipping-komplet-na">—</span>
        if (c.complete) return <span className="shipping-komplet shipping-komplet--ok">KOMPLET</span>
        return (
          <span className="shipping-komplet shipping-komplet--missing" title={`Czeka na: ${c.missing.join(', ')}`}>
            czeka: {c.missing[0]}
            {c.missing.length > 1 ? ` +${c.missing.length - 1}` : ''}
          </span>
        )
      },
      sortValue: sv((o) => {
        const c = completenessOf(o)
        return c == null ? 1 : c.complete ? 0 : 2
      }),
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
      key: 'glass',
      label: 'SZYBA',
      title: 'Szyba dostawki/naświetla: BRAK → zamówiona → ✓ jest (bez szyby nie ma co wysyłać)',
      className: 'col-glass',
      render: (order) => {
        if (!hasGlassExtra(order)) return <span className="shipping-komplet-na">—</span>
        if (order.glass_received) return <span className="shipping-glass shipping-glass--ok">✓ jest</span>
        if (order.glass_order_date) return <span className="shipping-glass shipping-glass--ordered">zamówiona</span>
        return <span className="shipping-glass shipping-glass--missing">BRAK</span>
      },
      sortValue: sv((o) =>
        !hasGlassExtra(o) ? 0 : o.glass_received ? 1 : o.glass_order_date ? 2 : 3,
      ),
    }),
    col({
      key: 'route_mark',
      label: 'X/XX',
      title: 'Plan wydań: X = towar na magazyn JUTRO, XX = DZIŚ. Klik przełącza: puste → X → XX → puste.',
      className: 'col-route-mark',
      render: (order) => {
        const mark = orderRouteMark(order)
        return (
          <button
            type="button"
            className={`route-mark-btn ${mark ? `route-mark-btn--${mark.toLowerCase()}` : ''}`}
            disabled={!isManager || loading || order.id === undefined}
            title={
              isManager
                ? 'X = na jutro, XX = na dziś — klik przełącza'
                : 'Plan wydań oznacza brygadzista/kierownik'
            }
            onClick={(e) => {
              e.stopPropagation()
              void onToggleRouteMark(order)
            }}
          >
            {mark || '—'}
          </button>
        )
      },
      sortValue: sv((o) => (orderRouteMark(o) === 'XX' ? 2 : orderRouteMark(o) === 'X' ? 1 : 0)),
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
          disabled={!canInvoice || loading || order.id === undefined}
          title={canInvoice ? undefined : 'Brak uprawnień do oznaczania fakturowania'}
          onChange={(e) => {
            e.stopPropagation()
            if (!canInvoice) return
            void onToggleReadyToInvoice(order, e.target.checked)
          }}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Gotowe do fakturowania — ${order.order_number}`}
        />
      ),
      sortValue: sv((o) => (isOrderReadyToInvoice(o) ? 1 : 0)),
    }),
    col({
      key: 'notes',
      label: 'UWAGI',
      className: 'col-ship-notes',
      tdTitle: (r) => (r.kind === 'order' ? String(r.order.notes ?? '') || undefined : undefined),
      render: (order) => {
        const n = String(order.notes ?? '').trim()
        if (!n) return '—'
        return <span className="shipping-notes-cell">{n}</span>
      },
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
        <span title="Plan wydań: XX = towar na magazyn dziś, X = na jutro">
          <strong>Na dziś (XX):</strong> {routeTodayCount} · <strong>Na jutro (X):</strong> {routeTomorrowCount}
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

        {/* Plan wydań */}
        <label className="orders-filter-checkbox" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span>Plan wydań</span>
          <select value={routeMarkFilter} onChange={(e) => setRouteMarkFilter(e.target.value)} className="day-filter">
            <option value="">wszystkie</option>
            <option value="XX">XX — na dziś</option>
            <option value="X">X — na jutro</option>
          </select>
        </label>

        {/* Checkboxy */}
        <label className="orders-filter-checkbox">
          <input type="checkbox" checked={onlyReadyToInvoice} onChange={(e) => setOnlyReadyToInvoice(e.target.checked)} />
          <span>Tylko gotowe do fakturowania</span>
        </label>
        <label className="orders-filter-checkbox" title="Dociąga zamówienia wydane w ostatnich 14 dniach — można dokończyć oznaczanie fakturowania po wydaniu">
          <input type="checkbox" checked={showReleased} onChange={(e) => setShowReleased(e.target.checked)} />
          <span>Pokaż wydane (ost. 14 dni){releasedOrders.length ? ` — ${releasedOrders.length}` : ''}</span>
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
          // KOLEJNOŚĆ MUSI zgadzać się 1:1 z listą kolumn — brakujący <col>
          // przesuwa szerokości na złe kolumny i rozjeżdża cały układ
          <colgroup>
            <col className="col-rush" />
            <col className="col-nr" />
            <col className="col-cat" />
            <col className="col-firm" />
            <col className="col-ship-model" />
            <col className="col-ordered" />
            <col className="col-day" />
            <col className="col-qty" />
            <col className="col-prog" />
            <col className="col-komplet" />
            <col className="col-status" />
            <col className="col-stock" />
            <col className="col-glass" />
            <col className="col-route-mark" />
            <col className="col-inv" />
            <col className="col-ship-notes" />
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
