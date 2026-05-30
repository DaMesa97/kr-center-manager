import { useCallback, useMemo, useState } from 'react'
import type { GlassAllowance, Order } from '../types'
import { CATEGORY_LABELS } from '../constants'
import {
  autoSuggestReadyToInvoice,
  countCompletedStages,
  isRushOrderSequence,
  isOrderReadyToInvoice,
} from '../utils'
import ShippingProgressBar from './ShippingProgressBar'
import StockStatusBadge from './StockStatusBadge'

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
}: ShippingViewProps) {
  const getProductionDay = useCallback((company: string | null | undefined) => {
    if (!company) return ''
    const key = company.trim().toLowerCase()
    return companiesMap.get(key)?.production_day ?? ''
  }, [companiesMap])

  const [categoryFilter, setCategoryFilter] = useState<string>('')
  const [companyFilter, setCompanyFilter] = useState('')
  const [onlyReadyToInvoice, setOnlyReadyToInvoice] = useState(false)
  const [productionDayFilter, setProductionDayFilter] = useState<string>('')
  const [onlyWithStockIssues, setOnlyWithStockIssues] = useState(false)
  const [onlyUrgent, setOnlyUrgent] = useState(false)

  const availableProductionDays = useMemo(() => {
    const set = new Set<string>()
    for (const o of orders) {
      const day = getProductionDay(o.company)
      if (day) set.add(day)
    }
    return Array.from(set).sort()
  }, [orders, getProductionDay])

  const filteredOrders = useMemo(() => {
    const companyQ = companyFilter.trim().toLowerCase()
    return orders.filter((o) => {
      if (categoryFilter && (o.category ?? '') !== categoryFilter) {
        return false
      }
      if (companyQ && !String(o.company ?? '').toLowerCase().includes(companyQ)) {
        return false
      }
      if (onlyReadyToInvoice && !isOrderReadyToInvoice(o)) {
        return false
      }
      if (onlyWithStockIssues) {
        if (!o.stock_status || o.stock_status === 'ok') return false
      }
      if (onlyUrgent && !isRushOrderSequence(o.sequence)) {
        return false
      }
      if (productionDayFilter) {
        const day = getProductionDay(o.company)
        if (productionDayFilter === '__EMPTY__') {
          if (day) return false
        } else if (day !== productionDayFilter) {
          return false
        }
      }

      return true
    })
  }, [
    orders,
    categoryFilter,
    companyFilter,
    onlyReadyToInvoice,
    onlyWithStockIssues,
    onlyUrgent,
    productionDayFilter,
    getProductionDay,
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
        <button type="button" className="btn btn-sm btn-primary" onClick={() => onRefresh()} disabled={loading}>
          Odśwież
        </button>
      </div>

      <div className="orders-filters" style={{ marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <label className="orders-filter-checkbox" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span>Kategoria</span>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="day-filter"
          >
            <option value="">Wszystkie</option>
            {CATEGORY_SORT_ORDER.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c] ?? c}
              </option>
            ))}
          </select>
        </label>
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
        <label className="orders-filter-checkbox" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span>Dzień produkcji</span>
          <select
            value={productionDayFilter}
            onChange={(e) => setProductionDayFilter(e.target.value)}
            className="day-filter"
          >
            <option value="">wszystkie</option>
            <option value="__EMPTY__">(bez ustawionego)</option>
            {availableProductionDays.map((day) => (
              <option key={day} value={day}>
                {day}
              </option>
            ))}
          </select>
        </label>
        <label className="orders-filter-checkbox">
          <input
            type="checkbox"
            checked={onlyReadyToInvoice}
            onChange={(e) => setOnlyReadyToInvoice(e.target.checked)}
          />
          <span>Tylko gotowe do fakturowania</span>
        </label>
        <label className="orders-filter-checkbox" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={onlyWithStockIssues}
            onChange={(e) => setOnlyWithStockIssues(e.target.checked)}
          />
          <span>Tylko z brakami magazynowymi</span>
        </label>
        <label className="orders-filter-checkbox" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={onlyUrgent}
            onChange={(e) => setOnlyUrgent(e.target.checked)}
          />
          <span>Tylko pilne</span>
        </label>
      </div>

      <div
        style={{ fontSize: '0.75rem', color: '#6b7280', padding: '4px 0 8px 0' }}
      >
        💡 Żółte tło w kolumnie "Gotowe do fakturowania" = sugestia systemu (wszystkie etapy
        ukończone lub data wydania ustawiona)
      </div>

      <div className="table-wrapper orders-table-wrapper">
        <table className="orders-table">
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
          <thead>
            <tr>
              <th className="col-rush">PILNE</th>
              <th className="col-nr">NR ZLECENIA</th>
              <th className="col-cat">KATEGORIA</th>
              <th className="col-firm">FIRMA</th>
              <th className="col-day">DZIEŃ PROD.</th>
              <th className="col-qty">ILość</th>
              <th className="col-prog">POSTĘP</th>
              <th className="col-status">STATUS</th>
              <th className="col-stock">BRAKI</th>
              <th className="col-inv">FAKTURA</th>
              <th className="col-act">AKCJE</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={11} style={{ textAlign: 'center', padding: '2rem' }}>
                  Ładowanie…
                </td>
              </tr>
            ) : displayedOrders.length === 0 ? (
              <tr>
                <td colSpan={11} style={{ textAlign: 'center', padding: '2rem' }}>
                  Brak zamówień spełniających kryteria.
                </td>
              </tr>
            ) : (
              displayedOrders.map((order) => {
                const { total, percent } = countCompletedStages(order)
                const cat = order.category ?? ''
                const badgeBg = CATEGORY_COLORS[cat] ?? '#6b7280'

                let statusClass = 'shipping-status-badge shipping-status-badge--new'
                let statusLabel = 'Nowe'
                if (cat === 'DrzwiWewnetrzne') {
                  statusClass = 'order-status-badge order-status-badge--in-progress'
                  statusLabel = 'W realizacji'
                } else if (cat === 'Techniczne' || total === 0) {
                  statusClass = 'shipping-status-badge shipping-status-badge--technical'
                  statusLabel = 'Techniczne'
                } else if (percent === 100) {
                  statusClass = 'shipping-status-badge shipping-status-badge--done'
                  statusLabel = 'Gotowe'
                } else if (percent > 0) {
                  statusClass = 'shipping-status-badge shipping-status-badge--production'
                  statusLabel = 'W produkcji'
                }

                const ready = isOrderReadyToInvoice(order)
                const suggested = autoSuggestReadyToInvoice(order) && !ready
                const invoiceCellClass = suggested ? 'shipping-invoice-cell--suggested' : ''

                return (
                  <tr
                    key={order.id ?? `${cat}-${order.order_number}`}
                    className={[
                      'orders-table-row',
                      isRushOrderSequence(order.sequence) ? 'orders-table-row--priority' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => onShowDetails(order)}
                  >
                    <td className="rush-cell col-rush" onClick={(e) => e.stopPropagation()}>
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
                    </td>
                    <td className="col-nr">{order.order_number}</td>
                    <td className="col-cat">
                      <span
                        className="shipping-category-badge"
                        style={{ backgroundColor: badgeBg }}
                        title={CATEGORY_LABELS[cat as keyof typeof CATEGORY_LABELS] ?? cat}
                      >
                        {CATEGORY_LABELS[cat as keyof typeof CATEGORY_LABELS] ?? cat}
                      </span>
                    </td>
                    <td className="col-firm" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{order.company}</td>
                    <td className="col-day">{getProductionDay(order.company)}</td>
                    <td className="col-qty">{order.quantity ?? '—'}</td>
                    <td className="col-prog">
                      <ShippingProgressBar order={order} />
                    </td>
                    <td className="col-status">
                      <span className={statusClass}>{statusLabel}</span>
                    </td>
                    <td className="col-stock">
                      <StockStatusBadge
                        status={order.stock_status}
                        issues={order.stock_issues}
                        category={order.category}
                        glassAllowances={glassAllowances}
                      />
                    </td>
                    <td
                      className={`col-inv${invoiceCellClass ? ` ${invoiceCellClass}` : ''}`}
                      title={
                        !ready && suggested
                          ? 'Sugestia: wszystkie etapy ukończone lub data wydania ustawiona — można oznaczyć jako gotowe do fakturowania'
                          : undefined
                      }
                    >
                      <input
                        type="checkbox"
                        checked={ready}
                        disabled={loading || order.id === undefined}
                        onChange={(e) => {
                          e.stopPropagation()
                          void onToggleReadyToInvoice(order, e.target.checked)
                        }}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Gotowe do fakturowania — ${order.order_number}`}
                      />
                    </td>
                    <td className="col-act">
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
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
