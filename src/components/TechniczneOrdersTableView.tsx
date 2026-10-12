import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  type MutableRefObject,
} from 'react'
import StockStatusBadge from './StockStatusBadge'
import DataTable, { type DataTableColumn } from './DataTable'
import type { GlassAllowance, Order, ToastVariant } from '../types'
import {
  isReleaseDateEmpty,
  isRushOrderSequence,
  orderCellTooltip,
  orderNumberCellTooltip,
  productionDaySortValue,
} from '../utils'

type TechniczneOrdersTableViewProps = {
  filteredOrders: Order[]
  tableWrapperRef: MutableRefObject<HTMLDivElement | null>
  isManager: boolean
  canSeePrices?: boolean
  selectedForLabel?: Set<number>
  onToggleLabelSelect?: (order: Order) => void
  releaseDateUpdating: number | null
  rushUpdatingOrderId: number | null
  glassAllowances: GlassAllowance[]
  orderCommentsCounts: Map<number, { total: number; unread: number }>
  onOpenCommentsPanel: (order: Order) => void
  onOpenEditOrderModal: (order: Order) => void
  onHandleRushToggle: (order: Order, checked: boolean) => void | Promise<void>
  onApplyReleaseDateUpdate: (orderId: number, date: string) => void | Promise<void>
  onSetReleaseClearTarget: (target: { orderId: number }) => void
  onHandleCancelOrderClick: (order: Order) => void
  onHandleRestoreOrder: (order: Order) => void | Promise<void>
  onShowHistory?: (order: Order) => void
  onPrintOrder?: (order: Order) => void
  pushToast: (message: string, variant: ToastVariant) => void
}

const isCancelledOwn = (order: Order) =>
  typeof order.extra_fields === 'object' &&
  order.extra_fields !== null &&
  (order.extra_fields as Record<string, unknown>).cancelled === true

const wentylacjaOf = (order: Order) => String((order as Record<string, unknown>).wentylacja ?? '')

// Zwykła kolumna tekstowa: wartość + tooltip z pełną treścią + sortowanie
function textCol(key: string, label: string, get: (o: Order) => string | number | null | undefined): DataTableColumn<Order> {
  return {
    key,
    label,
    title: label,
    className: 'col-order-text',
    tdTitle: (o) => orderCellTooltip(get(o)),
    sortValue: get,
    render: get,
  }
}

// memo: tabela re-renderuje się tylko gdy zmienią się jej propsy (nie każdy toast/stan App)
function TechniczneOrdersTableView({
  filteredOrders,
  tableWrapperRef,
  isManager,
  canSeePrices = true,
  selectedForLabel,
  onToggleLabelSelect,
  releaseDateUpdating,
  rushUpdatingOrderId,
  glassAllowances,
  orderCommentsCounts,
  onOpenCommentsPanel,
  onOpenEditOrderModal,
  onHandleRushToggle,
  onApplyReleaseDateUpdate,
  onSetReleaseClearTarget,
  onHandleCancelOrderClick,
  onHandleRestoreOrder,
  onShowHistory,
  onPrintOrder,
  pushToast,
}: TechniczneOrdersTableViewProps) {
  const syncStickyCol1Width = useCallback(() => {
    const root = tableWrapperRef.current
    if (!root) return
    const th = root.querySelector<HTMLElement>('thead th.sticky-col.sticky-1')
    if (!th) return
    const w = th.offsetWidth
    if (w > 0) {
      root.style.setProperty('--orders-sticky-col1-width', `${w}px`)
    }
  }, [tableWrapperRef])

  useLayoutEffect(() => {
    syncStickyCol1Width()
  }, [syncStickyCol1Width, filteredOrders, isManager])

  useEffect(() => {
    const root = tableWrapperRef.current
    const th = root?.querySelector('thead th.sticky-col.sticky-1') ?? null
    const ro = th
      ? new ResizeObserver(() => {
          syncStickyCol1Width()
        })
      : null
    if (ro && th) {
      ro.observe(th)
      window.addEventListener('resize', syncStickyCol1Width)
    }
    return () => {
      if (ro) {
        ro.disconnect()
        window.removeEventListener('resize', syncStickyCol1Width)
      }
    }
  }, [syncStickyCol1Width, filteredOrders, isManager, tableWrapperRef])

  const columns = useMemo<DataTableColumn<Order>[]>(() => {
    const cols: DataTableColumn<Order>[] = [
      {
        key: 'order_number',
        label: 'NR. ZLECENIA',
        title: 'NR. ZLECENIA',
        className: 'sticky-col sticky-1 col-order-number',
        tdTitle: (order) => orderNumberCellTooltip(order, null, !isReleaseDateEmpty(order.release_date)),
        sortValue: (order) => order.order_number,
        render: (order) => {
          const counts = order.id !== undefined ? orderCommentsCounts.get(order.id) : undefined
          const total = counts?.total ?? 0
          const unread = counts?.unread ?? 0
          return (
            <>
              {onToggleLabelSelect && (
                <input
                  type="checkbox"
                  className="order-select-check"
                  checked={order.id !== undefined && !!selectedForLabel?.has(order.id)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => onToggleLabelSelect(order)}
                  title="Zaznacz do druku etykiety"
                />
              )}
              {!isReleaseDateEmpty(order.release_date) ? (
                <span className="released-badge order-badge" title="Zrealizowane (wydanie)">
                  ZREALIZOWANE
                </span>
              ) : null}
              <span className="order-number-wrapper">
                <span className="order-num-value order-number-value">{order.order_number}</span>
                <button
                  type="button"
                  className={`btn btn-sm btn-ghost order-comments-inline-btn ${unread > 0 ? 'order-comments-inline-btn--unread' : ''} ${
                    total === 0 ? 'order-comments-inline-btn--empty' : ''
                  }`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpenCommentsPanel(order)
                  }}
                  title={
                    total === 0
                      ? 'Dodaj komentarz'
                      : unread > 0
                        ? `${total} komentarzy · ${unread} nieprzeczytanych`
                        : `${total} komentarzy`
                  }
                >
                  <span className="order-comments-inline-icon">
                    💬
                    {unread > 0 && <span className="order-comments-inline-dot" />}
                  </span>
                  {total > 0 && <span className="order-comments-inline-count">{total}</span>}
                </button>
              </span>
              <StockStatusBadge
                status={order.stock_status}
                issues={order.stock_issues}
                category={order.category}
                glassAllowances={glassAllowances}
              />
            </>
          )
        },
      },
      {
        key: 'company',
        label: 'FIRMA',
        title: 'FIRMA',
        className: 'sticky-col sticky-2 col-company',
        tdTitle: (order) => orderCellTooltip(order.company),
        sortValue: (order) => order.company,
        render: (order) => order.company,
      },
      { ...textCol('order_date', 'DATA', (o) => o.order_date), className: 'col-order-text col-order-date' },
      { ...textCol('production_day', 'PRODUKCJA', (o) => o.production_day), sortValue: (o) => productionDaySortValue(o.production_day) },
      textCol('quantity', 'ILOŚĆ', (o) => o.quantity),
      { ...textCol('sequence', 'KOLEJNOŚĆ', (o) => o.sequence), tdTitle: undefined },
      {
        key: 'rush',
        label: 'PILNE',
        title: 'PILNE',
        className: 'rush-cell',
        stopRowClick: true,
        sortValue: (order) => (isRushOrderSequence(order.sequence) ? 0 : 1),
        render: (order) => (
          <input
            type="checkbox"
            className="rush-checkbox"
            checked={isRushOrderSequence(order.sequence)}
            disabled={
              !isManager ||
              isCancelledOwn(order) ||
              order.id === undefined ||
              rushUpdatingOrderId === order.id
            }
            title={isManager ? 'Pilne zamówienie' : 'Pilne (tylko kierownik może zmienić)'}
            aria-label="Pilne"
            onChange={(e) => {
              e.stopPropagation()
              void onHandleRushToggle(order, e.target.checked)
            }}
          />
        ),
      },
      textCol('system', 'SYSTEM', (o) => o.system),
      textCol('model', 'MODEL', (o) => o.model),
      textCol('wing_color', 'KOLOR', (o) => o.wing_color),
      textCol('threshold_color', 'PRÓG', (o) => o.threshold_color),
      textCol('width', 'SZEROKOŚĆ', (o) => o.width),
      textCol('direction', 'KIERUNEK', (o) => o.direction),
      textCol('opening', 'OTWIERANIE', (o) => o.opening),
      textCol('height', 'WYSOKOŚĆ', (o) => o.height),
      textCol('glazing', 'SZKLENIE', (o) => o.glazing),
      textCol('hardware', 'OKUCIA', (o) => o.hardware),
      textCol('handle', 'POCHWYT', (o) => o.handle),
      textCol('peephole', 'WIZJER', (o) => o.peephole),
      textCol('wentylacja', 'WENTYLACJA', wentylacjaOf),
      {
        key: 'release_date',
        label: 'WYDANIE',
        title: 'WYDANIE',
        className: 'col-order-text',
        tdClassName: 'release-date-td',
        stopRowClick: true,
        tdTitle: (order) =>
          isReleaseDateEmpty(order.release_date) ? undefined : String(order.release_date ?? '').trim() || undefined,
        sortValue: (order) => (isReleaseDateEmpty(order.release_date) ? null : String(order.release_date).trim()),
        render: (order) => {
          const rowOrderId = order.id
          const busy =
            (rowOrderId !== undefined && releaseDateUpdating === rowOrderId) ||
            rowOrderId === undefined ||
            isCancelledOwn(order)
          return isReleaseDateEmpty(order.release_date) ? (
            <button
              type="button"
              className="release-checkbox-btn"
              disabled={busy}
              role="checkbox"
              aria-checked={false}
              aria-label="Oznacz wydanie dzisiejszą datą"
              title="Oznacz wydanie"
              onClick={() => {
                if (rowOrderId === undefined) {
                  pushToast('Brak identyfikatora zamówienia', 'error')
                  return
                }
                void onApplyReleaseDateUpdate(rowOrderId, new Date().toISOString().split('T')[0])
              }}
            />
          ) : (
            <button
              type="button"
              className="release-date-value"
              disabled={busy}
              title="Kliknij, aby cofnąć wydanie"
              onClick={() => {
                if (rowOrderId === undefined) {
                  pushToast('Brak identyfikatora zamówienia', 'error')
                  return
                }
                onSetReleaseClearTarget({ orderId: rowOrderId })
              }}
            >
              {String(order.release_date).trim()}
            </button>
          )
        },
      },
      textCol('info', 'INFO', (o) => o.info),
      textCol('notes', 'UWAGI', (o) => o.notes),
      textCol('client_order_number', 'NUMER ZAMÓWIENIA KLIENTA', (o) => o.client_order_number),
      textCol('entered_by', 'WPISAŁ', (o) => o.entered_by),
    ]
    if (canSeePrices) cols.push(textCol('configurator_value', 'WARTOŚĆ KONFIGURATOR', (o) => o.configurator_value))
    cols.push(
      textCol('airtable_id', 'AIRTABLE ID', (o) => o.airtable_id),
      { ...textCol('label', 'NAKLEJKA', (o) => o.label), tdTitle: undefined },
    )
    if (isManager) {
      cols.push({
        key: 'actions',
        label: 'Akcje',
        className: 'col-order-actions',
        stopRowClick: true,
        render: (order) => (
          <>
            {onPrintOrder && (
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                onClick={() => onPrintOrder(order)}
                title="Drukuj etykietę / deklarację DoP"
              >
                🖨️
              </button>
            )}
            {onShowHistory && (
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => onShowHistory(order)}
                title="Historia zmian"
              >
                Historia
              </button>
            )}
            {!isCancelledOwn(order) && (
              <button type="button" className="btn btn-sm btn-danger" onClick={() => onHandleCancelOrderClick(order)}>
                Anuluj
              </button>
            )}
            {isCancelledOwn(order) && (
              <button type="button" className="btn btn-sm btn-primary" onClick={() => void onHandleRestoreOrder(order)}>
                Przywróć
              </button>
            )}
          </>
        ),
      })
    }
    return cols
  }, [
    isManager,
    canSeePrices,
    selectedForLabel,
    onToggleLabelSelect,
    releaseDateUpdating,
    rushUpdatingOrderId,
    glassAllowances,
    orderCommentsCounts,
    onOpenCommentsPanel,
    onHandleRushToggle,
    onApplyReleaseDateUpdate,
    onSetReleaseClearTarget,
    onHandleCancelOrderClick,
    onHandleRestoreOrder,
    onShowHistory,
    onPrintOrder,
    pushToast,
  ])

  return (
    <DataTable
      rows={filteredOrders}
      rowKey={(order) => order.id ?? order.order_number}
      columns={columns}
      wrapperClassName="orders-table-wrapper"
      tableWrapperRef={tableWrapperRef}
      emptyText="Brak zamówień spełniających kryteria wyszukiwania."
      rowClassName={(order) => {
        const rowReleased = !isReleaseDateEmpty(order.release_date)
        return [
          'orders-table-row',
          isManager ? 'orders-table-row--clickable' : '',
          isRushOrderSequence(order.sequence) ? 'orders-table-row--priority' : '',
          rowReleased ? 'orders-table-row--released' : '',
          rowReleased ? 'orders-table-row--completed' : '',
          isCancelledOwn(order) ? 'orders-table-row--cancelled-own' : '',
        ]
          .filter(Boolean)
          .join(' ')
      }}
      onRowClick={isManager ? (order) => onOpenEditOrderModal(order) : undefined}
    />
  )
}

export default memo(TechniczneOrdersTableView)
