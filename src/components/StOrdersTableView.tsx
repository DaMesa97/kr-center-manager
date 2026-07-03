import {
  useCallback,
  useEffect,
  useLayoutEffect,
  type MouseEvent,
  type MutableRefObject,
} from 'react'
import ProductionStageCell from './ProductionStageCell'
import StockStatusBadge from './StockStatusBadge'
import { TopScrollTableWrapper } from './TopScrollTableWrapper'
import type { GlassAllowance, Order, StageDef, StStageLayoutMode, ToastVariant } from '../types'
import {
  isReleaseDateEmpty,
  isRushOrderSequence,
  isStTitanOrder,
  orderCellTooltip,
  orderNumberCellTooltip,
  parseOrderExtraFields,
  parseProductionStages,
  stStageCellKind,
} from '../utils'

type StOrdersTableViewProps = {
  filteredOrders: Order[]
  stOrdersStageLayout: { mode: StStageLayoutMode; defs: StageDef[] }
  tableWrapperRef: MutableRefObject<HTMLDivElement | null>
  isManager: boolean
  canSeePrices?: boolean
  selectedForLabel?: Set<number>
  onToggleLabelSelect?: (order: Order) => void
  releaseDateUpdating: number | null
  rushUpdatingOrderId: number | null
  productionStageUpdating: string | null
  glassAllowances: GlassAllowance[]
  orderCommentsCounts: Map<number, { total: number; unread: number }>
  onOpenCommentsPanel: (order: Order) => void
  onOpenEditOrderModal: (order: Order) => void
  onHandleRushToggle: (order: Order, checked: boolean) => void | Promise<void>
  onMarkProductionStageWithProfileInitials: (orderId: number, stageKey: string) => void | Promise<void>
  onSetStageRevertTarget: (target: { orderId: number; stageKey: string }) => void
  onApplyReleaseDateUpdate: (orderId: number, date: string) => void | Promise<void>
  onSetReleaseClearTarget: (target: { orderId: number }) => void
  onHandleStTitanStaSheetNavigate: (staRef: string, event: MouseEvent<HTMLButtonElement>) => void
  onHandleCancelOrderClick: (order: Order) => void
  onHandleRestoreOrder: (order: Order) => void | Promise<void>
  onShowHistory?: (order: Order) => void
  pushToast: (message: string, variant: ToastVariant) => void
}

export default function StOrdersTableView({
  filteredOrders,
  stOrdersStageLayout,
  tableWrapperRef,
  isManager,
  canSeePrices = true,
  selectedForLabel,
  onToggleLabelSelect,
  releaseDateUpdating,
  rushUpdatingOrderId,
  productionStageUpdating,
  glassAllowances,
  orderCommentsCounts,
  onOpenCommentsPanel,
  onOpenEditOrderModal,
  onHandleRushToggle,
  onMarkProductionStageWithProfileInitials,
  onSetStageRevertTarget,
  onApplyReleaseDateUpdate,
  onSetReleaseClearTarget,
  onHandleStTitanStaSheetNavigate,
  onHandleCancelOrderClick,
  onHandleRestoreOrder,
  onShowHistory,
  pushToast,
}: StOrdersTableViewProps) {
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
  }, [syncStickyCol1Width, filteredOrders, stOrdersStageLayout, isManager])

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
  }, [syncStickyCol1Width, filteredOrders, stOrdersStageLayout, isManager, tableWrapperRef])

  return (
    <TopScrollTableWrapper className="table-wrapper orders-table-wrapper" tableWrapperRef={tableWrapperRef}>
      <table className="orders-table orders-table--st-stages">
      <thead>
        <tr>
          <th className="sticky-col sticky-1 col-order-number" title="NR. ZLECENIA">
            NR. ZLECENIA
          </th>
          <th className="sticky-col sticky-2 col-company" title="FIRMA">
            FIRMA
          </th>
          <th className="col-order-text col-order-date" title="DATA">
            DATA
          </th>
          <th className="col-order-text" title="PRODUKCJA">
            PRODUKCJA
          </th>
          <th className="col-order-text" title="ILOŚĆ">
            ILOŚĆ
          </th>
          <th className="col-order-text" title="KOLEJNOŚĆ">
            KOLEJNOŚĆ
          </th>
          <th className="rush-cell" title="PILNE">
            PILNE
          </th>
          <th className="col-order-text" title="SYSTEM">
            SYSTEM
          </th>
          <th className="col-order-text" title="MODEL">
            MODEL
          </th>
          <th className="col-order-text" title="KOLOR">
            KOLOR
          </th>
          <th className="col-order-text" title="PRÓG">
            PRÓG
          </th>
          <th className="col-order-text" title="SZEROKOŚĆ">
            SZEROKOŚĆ
          </th>
          <th className="col-order-text" title="KIERUNEK">
            KIERUNEK
          </th>
          <th className="col-order-text" title="OTWIERANIE">
            OTWIERANIE
          </th>
          <th className="col-order-text" title="WYSOKOŚĆ">
            WYSOKOŚĆ
          </th>
          <th className="col-order-text" title="SZKLENIE">
            SZKLENIE
          </th>
          <th className="col-order-text" title="OKUCIA">
            OKUCIA
          </th>
          <th className="col-order-text" title="POCHWYT">
            POCHWYT
          </th>
          <th className="col-order-text" title="WIZJER">
            WIZJER
          </th>
          {stOrdersStageLayout.defs.map((def) => (
            <th key={def.key} className="production-stage-th col-stage" title={def.title}>
              {def.header}
            </th>
          ))}
          <th className="col-order-text" title="WYDANIE">
            WYDANIE
          </th>
          <th className="col-order-text" title="INFO">
            INFO
          </th>
          <th className="col-order-text" title="UWAGI">
            UWAGI
          </th>
          <th className="col-order-text" title="NUMER ZAMÓWIENIA KLIENTA">
            NUMER ZAMÓWIENIA KLIENTA
          </th>
          <th className="col-order-text" title="WPISAŁ">
            WPISAŁ
          </th>
          {canSeePrices && (
            <th className="col-order-text" title="WARTOŚĆ KONFIGURATOR">
              WARTOŚĆ KONFIGURATOR
            </th>
          )}
          <th className="col-order-text" title="AIRTABLE ID">
            AIRTABLE ID
          </th>
          <th className="col-order-text" title="NR W ARKUSZU STA">
            NR W ARKUSZU STA
          </th>
          <th className="col-order-text" title="NAKLEJKA">
            NAKLEJKA
          </th>
          {isManager && <th className="col-order-actions">Akcje</th>}
        </tr>
      </thead>
      <tbody>
        {filteredOrders.length === 0 ? (
          <tr>
            <td
              colSpan={
                19 +
                stOrdersStageLayout.defs.length +
                8 +
                (isManager ? 1 : 0)
              }
              style={{ textAlign: 'center', padding: '2rem', color: '#888' }}
            >
              Brak zamówień spełniających kryteria wyszukiwania.
            </td>
          </tr>
        ) : (
          filteredOrders.map((order) => {
            const rowOrderId = order.id
            const rowStages = parseProductionStages(order.production_stages, 'ST')
            const rowReleaseBusy = rowOrderId !== undefined && releaseDateUpdating === rowOrderId
            const rushRow = isRushOrderSequence(order.sequence)
            const rowReleased = !isReleaseDateEmpty(order.release_date)
            const rowExtra = parseOrderExtraFields(order.extra_fields)
            const partnerRowCancelled = order.category === 'ST' && rowExtra.sta_cancelled
            const partnerCancelBadgeLabel = partnerRowCancelled ? 'ANULOWANO W STA' : null
            const rowReleasedHighlight = rowReleased && !partnerRowCancelled
            const stLayoutMode = stOrdersStageLayout.mode
            const stDefs = stOrdersStageLayout.defs
            const isTitanSt = isStTitanOrder(order)
            const isSelfCancelled =
              typeof order.extra_fields === 'object' &&
              order.extra_fields !== null &&
              (order.extra_fields as Record<string, unknown>).cancelled === true
            return (
              <tr
                key={rowOrderId ?? order.order_number}
                className={[
                  'orders-table-row',
                  isManager ? 'orders-table-row--clickable' : '',
                  rushRow ? 'orders-table-row--priority' : '',
                  partnerRowCancelled ? 'orders-table-row--partner-cancelled' : '',
                  partnerRowCancelled ? 'orders-table-row--cancelled' : '',
                  rowReleasedHighlight ? 'orders-table-row--released' : '',
                  rowReleasedHighlight ? 'orders-table-row--completed' : '',
                  isSelfCancelled ? 'orders-table-row--cancelled-own' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => isManager && onOpenEditOrderModal(order)}
              >
                <td
                  className={[
                    'sticky-col sticky-1 col-order-number',
                    partnerCancelBadgeLabel || rowReleased ? 'col-order-number--with-badges' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  title={orderNumberCellTooltip(order, partnerCancelBadgeLabel, rowReleased)}
                >
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
                  {partnerCancelBadgeLabel ? (
                    <span className="linked-cancel-badge order-badge" title={partnerCancelBadgeLabel}>
                      {partnerCancelBadgeLabel}
                    </span>
                  ) : null}
                  {rowReleased ? (
                    <span className="released-badge order-badge" title="Zrealizowane (wydanie)">
                      ZREALIZOWANE
                    </span>
                  ) : null}
                  <span className="order-number-wrapper">
                    <span className="order-num-value order-number-value">{order.order_number}</span>
                    {(() => {
                      const counts = order.id !== undefined ? orderCommentsCounts.get(order.id) : undefined
                      const total = counts?.total ?? 0
                      const unread = counts?.unread ?? 0
                      return (
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
                      )
                    })()}
                  </span>
                  <StockStatusBadge
                    status={order.stock_status}
                    issues={order.stock_issues}
                    category={order.category}
                    glassAllowances={glassAllowances}
                  />
                </td>
                <td className="sticky-col sticky-2 col-company" title={orderCellTooltip(order.company)}>
                  {order.company}
                </td>
                <td className="col-order-text col-order-date" title={orderCellTooltip(order.order_date)}>
                  {order.order_date}
                </td>
                <td className="col-order-text" title={orderCellTooltip(order.production_day)}>
                  {order.production_day}
                </td>
                <td className="col-order-text" title={orderCellTooltip(order.quantity)}>
                  {order.quantity}
                </td>
                <td className="col-order-text">{order.sequence}</td>
                <td className="rush-cell" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    className="rush-checkbox"
                    checked={rushRow}
                    disabled={
                      !isManager ||
                      isSelfCancelled ||
                      rowOrderId === undefined ||
                      rushUpdatingOrderId === rowOrderId
                    }
                    title={isManager ? 'Pilne zamówienie' : 'Pilne (tylko kierownik może zmienić)'}
                    aria-label="Pilne"
                    onChange={(e) => {
                      e.stopPropagation()
                      void onHandleRushToggle(order, e.target.checked)
                    }}
                  />
                </td>
                <td className="col-order-text" title={orderCellTooltip(order.system)}>
                  {order.system}
                </td>
                <td className="col-order-text" title={orderCellTooltip(order.model)}>
                  {order.model}
                </td>
                <td className="col-order-text" title={orderCellTooltip(order.wing_color)}>
                  {order.wing_color}
                </td>
                <td className="col-order-text" title={orderCellTooltip(order.threshold_color)}>
                  {order.threshold_color}
                </td>
                <td className="col-order-text" title={orderCellTooltip(order.width)}>
                  {order.width}
                </td>
                <td className="col-order-text" title={orderCellTooltip(order.direction)}>
                  {order.direction}
                </td>
                <td className="col-order-text" title={orderCellTooltip(order.opening)}>
                  {order.opening}
                </td>
                <td className="col-order-text" title={orderCellTooltip(order.height)}>
                  {order.height}
                </td>
                <td className="col-order-text" title={orderCellTooltip(order.glazing)}>
                  {order.glazing}
                </td>
                <td className="col-order-text" title={orderCellTooltip(order.hardware)}>
                  {order.hardware}
                </td>
                <td className="col-order-text" title={orderCellTooltip(order.handle)}>
                  {order.handle}
                </td>
                <td className="col-order-text" title={orderCellTooltip(order.peephole)}>
                  {order.peephole}
                </td>
                {stDefs.map((def) => {
                  const cellKind = stStageCellKind(def, isTitanSt, stLayoutMode)
                  const rowBusy =
                    rowOrderId !== undefined && productionStageUpdating === String(rowOrderId)
                  if (cellKind.kind === 'none') {
                    return (
                      <td
                        key={def.key}
                        className="production-stage-td col-stage"
                        onClick={(e) => e.stopPropagation()}
                      >
                        —
                      </td>
                    )
                  }
                  if (cellKind.kind === 'skr_badge') {
                    const skrInitials = String(rowStages.sta_e5 ?? '').trim()
                    const skrDone = Boolean(skrInitials)
                    return (
                      <td
                        key={def.key}
                        className="production-stage-td sta-osc-pack-td col-osc-pack"
                        title={
                          skrDone
                            ? 'Skrzydło spakowane w STA (E5)'
                            : 'Oczekiwanie na pakowanie skrzydła w STA (E5)'
                        }
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span
                          className={
                            skrDone
                              ? 'st-skr-pack-badge st-skr-pack-badge--done'
                              : 'st-skr-pack-badge st-skr-pack-badge--wait'
                          }
                        >
                          {skrDone ? (
                            <>
                              SKR ✓ <span className="sta-osc-badge-initials">{skrInitials}</span>
                            </>
                          ) : (
                            'SKR —'
                          )}
                        </span>
                      </td>
                    )
                  }
                  if (cellKind.kind === 'e2_sta') {
                    const e2Val = String(rowStages.sta_e5 ?? '').trim()
                    const filled = Boolean(e2Val)
                    return (
                      <td
                        key={def.key}
                        className="production-stage-td col-stage"
                        title={filled ? e2Val : 'Status z arkusza STA (E5)'}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span
                          className={[
                            'production-stage-readonly',
                            filled
                              ? 'production-stage-readonly--linked-done'
                              : 'production-stage-readonly--linked-empty',
                          ].join(' ')}
                          title="E2 — skrzydło odebrane (STA E5)"
                        >
                          {filled ? e2Val : '—'}
                        </span>
                      </td>
                    )
                  }
                  const stageKey = cellKind.stageKey
                  return (
                    <td
                      key={def.key}
                      className="production-stage-td col-stage"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ProductionStageCell
                        value={rowStages[stageKey] ?? ''}
                        disabled={rowBusy || isSelfCancelled || rowOrderId === undefined}
                        onPickEmpty={() => {
                          if (rowOrderId === undefined) {
                            pushToast('Brak identyfikatora zamówienia', 'error')
                            return
                          }
                          void onMarkProductionStageWithProfileInitials(rowOrderId, stageKey)
                        }}
                        onPickFilled={() => {
                          if (rowOrderId === undefined) {
                            pushToast('Brak identyfikatora zamówienia', 'error')
                            return
                          }
                          onSetStageRevertTarget({ orderId: rowOrderId, stageKey })
                        }}
                      />
                    </td>
                  )
                })}
                {false && stLayoutMode === 'mixed' &&
                  (() => {
                    const skrInitials = String(rowStages.sta_e5 ?? '').trim()
                    const skrDone = Boolean(skrInitials)
                    if (!isTitanSt) {
                      return (
                        <td
                          className="production-stage-td sta-osc-pack-td col-osc-pack"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {'\u00a0'}
                        </td>
                      )
                    }
                    return (
                      <td
                        className="production-stage-td sta-osc-pack-td col-osc-pack"
                        title={
                          skrDone
                            ? 'Skrzydło spakowane w STA (E5)'
                            : 'Oczekiwanie na pakowanie skrzydła w STA (E5)'
                        }
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span
                          className={
                            skrDone
                              ? 'st-skr-pack-badge st-skr-pack-badge--done'
                              : 'st-skr-pack-badge st-skr-pack-badge--wait'
                          }
                        >
                          {skrDone ? (
                            <>
                              SKR ✓ <span className="sta-osc-badge-initials">{skrInitials}</span>
                            </>
                          ) : (
                            'SKR —'
                          )}
                        </span>
                      </td>
                    )
                  })()}
                <td
                  className="release-date-td col-order-text"
                  title={
                    isReleaseDateEmpty(order.release_date)
                      ? undefined
                      : String(order.release_date ?? '').trim() || undefined
                  }
                  onClick={(e) => e.stopPropagation()}
                >
                  {isReleaseDateEmpty(order.release_date) ? (
                    <button
                      type="button"
                      className="release-checkbox-btn"
                      disabled={rowReleaseBusy || rowOrderId === undefined || isSelfCancelled}
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
                      disabled={rowReleaseBusy || rowOrderId === undefined || isSelfCancelled}
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
                  )}
                </td>
                <td className="col-order-text" title={orderCellTooltip(order.info)}>
                  {order.info}
                </td>
                <td className="col-order-text" title={orderCellTooltip(order.notes)}>
                  {order.notes}
                </td>
                <td className="col-order-text" title={orderCellTooltip(order.client_order_number)}>
                  {order.client_order_number}
                </td>
                <td className="col-order-text" title={orderCellTooltip(order.entered_by)}>
                  {order.entered_by}
                </td>
                {canSeePrices && (
                  <td className="col-order-text" title={orderCellTooltip(order.configurator_value)}>
                    {order.configurator_value}
                  </td>
                )}
                <td className="col-order-text" title={orderCellTooltip(order.airtable_id)}>
                  {order.airtable_id}
                </td>
                <td className="col-order-text" onClick={(e) => e.stopPropagation()}>
                  {order.sta_ref?.trim() ? (
                    <button
                      type="button"
                      className="disting-sheet-link"
                      onClick={(e) => onHandleStTitanStaSheetNavigate(order.sta_ref!.trim(), e)}
                    >
                      {order.sta_ref.trim()}
                    </button>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="col-order-text">{order.label}</td>
                {isManager && (
                  <td className="col-order-actions" onClick={(e) => e.stopPropagation()}>
                    {(() => {
                      const ef = order.extra_fields
                      const isCancelled =
                        typeof ef === 'object' &&
                        ef !== null &&
                        (ef as Record<string, unknown>).cancelled === true
                      return (
                        <>
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
                          {!isCancelled && (
                            <button
                              type="button"
                              className="btn btn-sm btn-danger"
                              onClick={() => onHandleCancelOrderClick(order)}
                            >
                              Anuluj
                            </button>
                          )}
                          {isCancelled && (
                            <button
                              type="button"
                              className="btn btn-sm btn-primary"
                              onClick={() => void onHandleRestoreOrder(order)}
                            >
                              Przywróć
                            </button>
                          )}
                        </>
                      )
                    })()}
                  </td>
                )}
              </tr>
            )
          })
        )}
      </tbody>
      </table>
    </TopScrollTableWrapper>
  )
}
