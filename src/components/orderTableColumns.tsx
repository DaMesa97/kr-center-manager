// =====================================================================
// Wspólne kolumny tabel zamówień (Techniczne, ST, Bastion, STA-Disting)
// dla DataTable. Każda tabela składa swoją listę z tych klocków + własne
// kolumny (etapy produkcji, pola specyficzne dla kategorii).
// =====================================================================
import { useCallback, useEffect, useLayoutEffect, type DependencyList, type MutableRefObject, type ReactNode } from 'react'
import StockStatusBadge from './StockStatusBadge'
import OrderCommentsButton from './OrderCommentsButton'
import type { DataTableColumn } from './DataTable'
import type { GlassAllowance, Order, ToastVariant } from '../types'
import {
  isReleaseDateEmpty,
  isRushOrderSequence,
  orderCellTooltip,
  orderNumberCellTooltip,
  productionDaySortValue,
} from '../utils'

/** Propsy wspólne dla wszystkich tabel zamówień (przekazywane z App). */
export type OrderTableCtx = {
  isManager: boolean
  selectedForLabel?: Set<number>
  onToggleLabelSelect?: (order: Order) => void
  releaseDateUpdating: number | null
  rushUpdatingOrderId: number | null
  glassAllowances: GlassAllowance[]
  orderCommentsCounts: Map<number, { total: number; unread: number }>
  onOpenCommentsPanel: (order: Order) => void
  onHandleRushToggle: (order: Order, checked: boolean) => void | Promise<void>
  onApplyReleaseDateUpdate: (orderId: number, date: string) => void | Promise<void>
  onSetReleaseClearTarget: (target: { orderId: number }) => void
  onHandleCancelOrderClick: (order: Order) => void
  onHandleRestoreOrder: (order: Order) => void | Promise<void>
  onShowHistory?: (order: Order) => void
  onPrintOrder?: (order: Order) => void
  pushToast: (message: string, variant: ToastVariant) => void
}

/** Zależności useMemo kolumn — stała długość i kolejność (ctx to nowy obiekt przy każdym renderze). */
export const orderCtxDeps = (c: OrderTableCtx): unknown[] => [
  c.isManager,
  c.selectedForLabel,
  c.onToggleLabelSelect,
  c.releaseDateUpdating,
  c.rushUpdatingOrderId,
  c.glassAllowances,
  c.orderCommentsCounts,
  c.onOpenCommentsPanel,
  c.onHandleRushToggle,
  c.onApplyReleaseDateUpdate,
  c.onSetReleaseClearTarget,
  c.onHandleCancelOrderClick,
  c.onHandleRestoreOrder,
  c.onShowHistory,
  c.onPrintOrder,
  c.pushToast,
]

/** Zamówienie anulowane u nas (extra_fields.cancelled), nie przez partnera. */
export const isCancelledOwn = (order: Order) =>
  typeof order.extra_fields === 'object' &&
  order.extra_fields !== null &&
  (order.extra_fields as Record<string, unknown>).cancelled === true

/** Wartość dodatkowej kolumny z wiersza (pola spoza typu Order, np. bastion_*). */
export const orderField = (order: Order, key: string) => String((order as Record<string, unknown>)[key] ?? '')

const join = (...cls: (string | false | null | undefined)[]) => cls.filter(Boolean).join(' ')

type TextColOpts = {
  /** Klasy th+td (domyślnie col-order-text). */
  className?: string
  /** Tooltip nagłówka (domyślnie = label). */
  title?: string
  /** false = bez tooltipa na komórce. */
  cellTooltip?: boolean
  sortValue?: (o: Order) => unknown
}

/** Zwykła kolumna tekstowa: wartość + tooltip z pełną treścią + sortowanie. */
export function textCol(
  key: string,
  label: string,
  get: (o: Order) => string | number | null | undefined,
  opts: TextColOpts = {},
): DataTableColumn<Order> {
  return {
    key,
    label,
    title: opts.title ?? label,
    className: opts.className ?? 'col-order-text',
    tdTitle: opts.cellTooltip === false ? undefined : (o) => orderCellTooltip(get(o)),
    sortValue: opts.sortValue ?? get,
    render: get,
  }
}

type OrderNumberOpts = {
  /** Dodatkowa klasa td (np. order-num-td w Bastionie). */
  tdClassName?: string
  /** Badge anulowania po stronie partnera (np. „ANULOWANO W STA”). */
  partnerBadge?: (o: Order) => string | null
  /** Treść tuż za numerem (np. chipy dojazdu Titana). */
  afterNumber?: (o: Order) => ReactNode
}

/** NR. ZLECENIA (przyklejona): checkbox etykiety, badge'e, numer, komentarze, status magazynu. */
export function orderNumberCol(ctx: OrderTableCtx, opts: OrderNumberOpts = {}): DataTableColumn<Order> {
  return {
    key: 'order_number',
    label: 'NR. ZLECENIA',
    title: 'NR. ZLECENIA',
    thClassName: 'sticky-col sticky-1 col-order-number',
    tdClassName: (o) => {
      const released = !isReleaseDateEmpty(o.release_date)
      return join(
        'sticky-col sticky-1',
        opts.tdClassName,
        'col-order-number',
        (opts.partnerBadge?.(o) || released) && 'col-order-number--with-badges',
      )
    },
    tdTitle: (o) => orderNumberCellTooltip(o, opts.partnerBadge?.(o) ?? null, !isReleaseDateEmpty(o.release_date)),
    sortValue: (o) => o.order_number,
    render: (o) => {
      const partner = opts.partnerBadge?.(o)
      return (
        <>
          {ctx.onToggleLabelSelect && (
            <input
              type="checkbox"
              className="order-select-check"
              checked={o.id !== undefined && !!ctx.selectedForLabel?.has(o.id)}
              onClick={(e) => e.stopPropagation()}
              onChange={() => ctx.onToggleLabelSelect?.(o)}
              title="Zaznacz do druku etykiety"
            />
          )}
          {partner ? (
            <span className="linked-cancel-badge order-badge" title={partner}>
              {partner}
            </span>
          ) : null}
          {!isReleaseDateEmpty(o.release_date) ? (
            <span className="released-badge order-badge" title="Zrealizowane (wydanie)">
              ZREALIZOWANE
            </span>
          ) : null}
          <span className="order-number-wrapper">
            <span className="order-num-value order-number-value">{o.order_number}</span>
            {opts.afterNumber?.(o)}
            <OrderCommentsButton
              order={o}
              counts={o.id !== undefined ? ctx.orderCommentsCounts.get(o.id) : undefined}
              onOpen={ctx.onOpenCommentsPanel}
            />
          </span>
          <StockStatusBadge
            status={o.stock_status}
            issues={o.stock_issues}
            category={o.category}
            glassAllowances={ctx.glassAllowances}
          />
        </>
      )
    },
  }
}

/** FIRMA (przyklejona druga kolumna). */
export const companyCol = (): DataTableColumn<Order> =>
  textCol('company', 'FIRMA', (o) => o.company, { className: 'sticky-col sticky-2 col-company' })

export const orderDateCol = (): DataTableColumn<Order> =>
  textCol('order_date', 'DATA', (o) => o.order_date, { className: 'col-order-text col-order-date' })

/** PRODUKCJA — sortowana po dniu tygodnia (pon → pt), nie alfabetycznie. */
export const productionDayCol = (): DataTableColumn<Order> =>
  textCol('production_day', 'PRODUKCJA', (o) => o.production_day, {
    sortValue: (o) => productionDaySortValue(o.production_day),
  })

export const quantityCol = (): DataTableColumn<Order> => textCol('quantity', 'ILOŚĆ', (o) => o.quantity)

/** PILNE — checkbox (zmienia tylko kierownik); klik nie otwiera edycji. */
export function rushCol(ctx: OrderTableCtx): DataTableColumn<Order> {
  return {
    key: 'rush',
    label: 'PILNE',
    title: 'PILNE',
    className: 'rush-cell',
    stopRowClick: true,
    sortValue: (o) => (isRushOrderSequence(o.sequence) ? 0 : 1),
    render: (o) => (
      <input
        type="checkbox"
        className="rush-checkbox"
        checked={isRushOrderSequence(o.sequence)}
        disabled={!ctx.isManager || isCancelledOwn(o) || o.id === undefined || ctx.rushUpdatingOrderId === o.id}
        title={ctx.isManager ? 'Pilne zamówienie' : 'Pilne (tylko kierownik może zmienić)'}
        aria-label="Pilne"
        onChange={(e) => {
          e.stopPropagation()
          void ctx.onHandleRushToggle(o, e.target.checked)
        }}
      />
    ),
  }
}

type ReleaseColOpts = {
  label?: string
  /** Dodatkowa klasa nagłówka (np. release-date-th). */
  thClassName?: string
}

/** WYDANIE — pusty: „oznacz dziś”; wypełniony: data, klik = cofnięcie (z potwierdzeniem). */
export function releaseCol(ctx: OrderTableCtx, opts: ReleaseColOpts = {}): DataTableColumn<Order> {
  const label = opts.label ?? 'WYDANIE'
  return {
    key: 'release_date',
    label,
    title: label,
    thClassName: join('col-order-text', opts.thClassName),
    tdClassName: 'release-date-td col-order-text',
    stopRowClick: true,
    tdTitle: (o) =>
      isReleaseDateEmpty(o.release_date) ? undefined : String(o.release_date ?? '').trim() || undefined,
    sortValue: (o) => (isReleaseDateEmpty(o.release_date) ? null : String(o.release_date).trim()),
    render: (o) => {
      const id = o.id
      const disabled = (id !== undefined && ctx.releaseDateUpdating === id) || id === undefined || isCancelledOwn(o)
      const withId = (fn: (id: number) => void) => () => {
        if (id === undefined) {
          ctx.pushToast('Brak identyfikatora zamówienia', 'error')
          return
        }
        fn(id)
      }
      return isReleaseDateEmpty(o.release_date) ? (
        <button
          type="button"
          className="release-checkbox-btn"
          disabled={disabled}
          role="checkbox"
          aria-checked={false}
          aria-label="Oznacz wydanie dzisiejszą datą"
          title="Oznacz wydanie"
          onClick={withId((id) => void ctx.onApplyReleaseDateUpdate(id, new Date().toISOString().split('T')[0]))}
        />
      ) : (
        <button
          type="button"
          className="release-date-value"
          disabled={disabled}
          title="Kliknij, aby cofnąć wydanie"
          onClick={withId((id) => ctx.onSetReleaseClearTarget({ orderId: id }))}
        >
          {String(o.release_date).trim()}
        </button>
      )
    },
  }
}

/** Akcje kierownika: druk, historia, anuluj/przywróć. */
export function actionsCol(ctx: OrderTableCtx): DataTableColumn<Order> {
  return {
    key: 'actions',
    label: 'Akcje',
    className: 'col-order-actions',
    stopRowClick: true,
    render: (o) => (
      <>
        {ctx.onPrintOrder && (
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={() => ctx.onPrintOrder?.(o)}
            title="Drukuj etykietę / deklarację DoP"
          >
            🖨️
          </button>
        )}
        {ctx.onShowHistory && (
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => ctx.onShowHistory?.(o)}
            title="Historia zmian"
          >
            Historia
          </button>
        )}
        {isCancelledOwn(o) ? (
          <button type="button" className="btn btn-sm btn-primary" onClick={() => void ctx.onHandleRestoreOrder(o)}>
            Przywróć
          </button>
        ) : (
          <button type="button" className="btn btn-sm btn-danger" onClick={() => ctx.onHandleCancelOrderClick(o)}>
            Anuluj
          </button>
        )}
      </>
    ),
  }
}

/**
 * Szerokość przyklejonej kolumny NR → zmienna --orders-sticky-col1-width na
 * wrapperze (od niej liczy się `left` przyklejonej FIRMY).
 */
export function useStickyCol1Width(tableWrapperRef: MutableRefObject<HTMLDivElement | null>, deps: DependencyList) {
  const sync = useCallback(() => {
    const root = tableWrapperRef.current
    if (!root) return
    const th = root.querySelector<HTMLElement>('thead th.sticky-col.sticky-1')
    if (!th) return
    const w = th.offsetWidth
    if (w > 0) root.style.setProperty('--orders-sticky-col1-width', `${w}px`)
  }, [tableWrapperRef])

  useLayoutEffect(() => {
    sync()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync, ...deps])

  useEffect(() => {
    const th = tableWrapperRef.current?.querySelector('thead th.sticky-col.sticky-1') ?? null
    if (!th) return
    const ro = new ResizeObserver(sync)
    ro.observe(th)
    window.addEventListener('resize', sync)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', sync)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync, tableWrapperRef, ...deps])
}

/** Klasy wiersza wspólne dla tabel zamówień (+ dodatkowe z widoku). */
export function orderRowClassName(
  order: Order,
  isManager: boolean,
  opts: { releasedHighlight?: boolean; extra?: (string | false | null | undefined)[] } = {},
) {
  const released = opts.releasedHighlight ?? !isReleaseDateEmpty(order.release_date)
  return join(
    'orders-table-row',
    isManager && 'orders-table-row--clickable',
    isRushOrderSequence(order.sequence) && 'orders-table-row--priority',
    ...(opts.extra ?? []),
    released && 'orders-table-row--released',
    released && 'orders-table-row--completed',
    isCancelledOwn(order) && 'orders-table-row--cancelled-own',
  )
}
