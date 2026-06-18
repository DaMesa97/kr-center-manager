import { useCallback, useEffect, useLayoutEffect, type MutableRefObject } from 'react'
import { BASTION_STAGE_DEFS, BASTION_TITAN_STAGE_DEFS } from '../constants'
import StockStatusBadge from './StockStatusBadge'
import { TopScrollTableWrapper } from './TopScrollTableWrapper'
import type { ConfigOptionRecord, GlassAllowance, Order, ToastVariant } from '../types'
import {
  isReleaseDateEmpty,
  isRushOrderSequence,
  orderCellTooltip,
  orderNumberCellTooltip,
  parseOrderExtraFields,
  parseProductionStages,
} from '../utils'
import ProductionStageCell from './ProductionStageCell'

// Titan w Bastionie: mapowanie etapów OKU/MONT/PAK na 3 sąsiednie kolumny tabeli.
// Pozostałe kolumny Bastiona są dla Titana zablokowane.
const TITAN_BASTION_COL_MAP: Record<string, string> = {
  okuwanie_skrzydla: 'tit_oku',
  oscieznica_cnc: 'tit_mon',
  oscieznica_skrecanie: 'tit_pak',
}

type BastionOrdersTableViewProps = {
  filteredOrders: Order[]
  linkedOrders?: Order[]
  isManager: boolean
  canSeePrices?: boolean
  productionStageUpdating: string | null
  releaseDateUpdating: number | null
  rushUpdatingOrderId: number | null
  glassAllowances: GlassAllowance[]
  orderCommentsCounts: Map<number, { total: number; unread: number }>
  onOpenCommentsPanel: (order: Order) => void
  tableWrapperRef: MutableRefObject<HTMLDivElement | null>
  openEditOrderModal: (order: Order) => void
  handleRushToggle: (order: Order, checked: boolean) => void | Promise<void>
  markProductionStageWithProfileInitials: (orderId: number, stageKey: string) => void | Promise<void>
  setStageRevertTarget: (target: { orderId: number; stageKey: string }) => void
  applyReleaseDateUpdate: (orderId: number, date: string | null) => void | Promise<void>
  setReleaseClearTarget: (target: { orderId: number }) => void
  handleCancelOrderClick: (order: Order) => void
  handleRestoreOrder: (order: Order) => void | Promise<void>
  onShowHistory?: (order: Order) => void
  pushToast: (message: string, variant: ToastVariant) => void
  bastionFrameOptions: ConfigOptionRecord[]
  canEditSalesChanges: boolean
  onUpdateSalesChanges: (orderId: number, value: string) => void | Promise<void>
  onUpdateProductionPriority: (orderId: number, value: string) => void | Promise<void>
  onLabelToggle: (orderId: number, current: string) => void | Promise<void>
}

export default function BastionOrdersTableView({
  filteredOrders,
  linkedOrders = [],
  isManager,
  canSeePrices = true,
  productionStageUpdating,
  releaseDateUpdating,
  rushUpdatingOrderId,
  glassAllowances,
  orderCommentsCounts,
  onOpenCommentsPanel,
  tableWrapperRef,
  openEditOrderModal,
  handleRushToggle,
  markProductionStageWithProfileInitials,
  setStageRevertTarget,
  applyReleaseDateUpdate,
  setReleaseClearTarget,
  handleCancelOrderClick,
  handleRestoreOrder,
  onShowHistory,
  pushToast,
  bastionFrameOptions,
  canEditSalesChanges,
  onUpdateSalesChanges,
  onUpdateProductionPriority,
  onLabelToggle,
}: BastionOrdersTableViewProps) {
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

  return (
    <TopScrollTableWrapper className="table-wrapper orders-table-wrapper" tableWrapperRef={tableWrapperRef}>
      <table className="orders-table">
      <thead>
        <tr>
          <th className="sticky-col sticky-1 col-order-number">NR. ZLECENIA</th>
          <th className="sticky-col sticky-2 col-company">FIRMA</th>
          <th className="col-order-text col-order-date">DATA</th>
          <th className="col-order-text">PRODUKCJA</th>
          <th className="col-order-text">ILOŚĆ</th>
          <th className="rush-cell">PILNE</th>
          <th className="col-order-text">KOLEKCJA</th>
          <th className="col-order-text">SYSTEM</th>
          <th className="col-order-text col-order-model">MODEL</th>
          <th className="col-order-text col-wing-color">KOLOR SKRZYDŁA</th>
          <th className="col-order-text col-frame-color">KOLOR OŚCIEŻNICY</th>
          <th className="col-order-text">KOLOR PROGU</th>
          <th className="col-order-text">SZEROKOŚĆ</th>
          <th className="col-order-text">KIERUNEK</th>
          <th className="col-order-text">OTWIERANIE</th>
          <th className="col-order-text">WYSOKOŚĆ</th>
          <th className="col-order-text">SZKLENIE</th>
          <th className="col-order-text">WIZJER</th>
          <th className="col-order-text">OKUCIA</th>
          <th className="col-order-text">OŚCIEŻNICA</th>
          <th className="col-order-text">ZAKRES</th>
          <th className="col-order-text">PRÓG</th>
          <th className="col-notes">UWAGI</th>
          <th className="col-order-text">ZMIANY-SPRZEDAŻ</th>
          <th className="col-order-text">PILNE/TERMIN WYKONANIA</th>
          <th className="col-order-text">DZIEŃ TYGODNIA</th>
          <th className="col-order-text">PROMO</th>
          <th className="col-order-text">KOLEJNOŚĆ PRODUKCJI OŚCIEŻNIC REG.</th>
          {BASTION_STAGE_DEFS.map((def) => (
            <th key={def.key} className="production-stage-th col-stage" title={def.title}>
              {def.header}
            </th>
          ))}
          <th className="col-order-text">ILOŚĆ ETYKIET</th>
          <th className="col-order-text">NAKLEJKA</th>
          <th className="col-order-text">UWAGI 2</th>
          <th className="col-order-text release-date-th">ZREALIZOWANE</th>
          <th className="col-order-text">NUMER ZAMÓWIENIA KLIENTA</th>
          {canSeePrices && <th className="col-order-text">WARTOŚĆ KONFIGURATOR</th>}
          <th className="col-order-text">WPISAŁ</th>
          <th className="col-order-text">AIRTABLE ID</th>
          {isManager && <th className="col-order-actions">Akcje</th>}
        </tr>
      </thead>
      <tbody>
        {filteredOrders.map((order) => {
          const rowOrderId = order.id
          const rowStages = parseProductionStages(order.production_stages, 'Bastion')
          const rowBusy = rowOrderId !== undefined && productionStageUpdating === String(rowOrderId)
          const rowReleaseBusy = rowOrderId !== undefined && releaseDateUpdating === rowOrderId
          const rushRow = isRushOrderSequence(order.sequence)
          const rowReleased = !isReleaseDateEmpty(order.release_date)
          const rowExtra = parseOrderExtraFields(order.extra_fields)
          const isSelfCancelled =
            typeof order.extra_fields === 'object' &&
            order.extra_fields !== null &&
            (order.extra_fields as Record<string, unknown>).cancelled === true

          const bastionRow = order as Record<string, unknown>
          const collection = String(bastionRow.bastion_collection ?? '')
          const frameType = String(bastionRow.bastion_frame_type ?? '')
          const frameRange = String(bastionRow.bastion_frame_range ?? '')
          const salesChanges = String(bastionRow.bastion_sales_changes ?? '')
          const rushDate = String(bastionRow.bastion_rush_date ?? '')
          const dayOfWeek = String(bastionRow.bastion_day_of_week ?? '')
          const productionPriority = String(bastionRow.bastion_production_priority ?? '')
          const labelQty = String(bastionRow.bastion_label_qty ?? '')
          const labelValue = String(order.label ?? '').trim()
          const notes2 = String(bastionRow.bastion_notes_2 ?? '')
          const isPromo = Boolean(bastionRow.bastion_is_promo)
          const frameOption = bastionFrameOptions.find((o) => o.value === frameType.trim())
          const canEditPriority = !!frameOption?.add_to_batch && isManager && rowOrderId !== undefined

          // Titan: status dojazdu rodzeństwa (ościeżnica z ST, skrzydło ze STA) po wydaniu
          const titanGroup = Number((order.extra_fields as Record<string, unknown> | null)?.titan_group)
          const isTitanBastion = Number.isFinite(titanGroup) && titanGroup > 0
          let oscArrived = false
          let skrArrived = false
          if (isTitanBastion) {
            const staBase = linkedOrders.find((o) => o.id === titanGroup)
            const stSib = linkedOrders.find((o) => o.category === 'ST' && o.linked_order_id === titanGroup)
            skrArrived = !!staBase && !isReleaseDateEmpty(staBase.release_date)
            oscArrived = !!stSib && !isReleaseDateEmpty(stSib.release_date)
          }

          return (
            <tr
              key={rowOrderId ?? order.airtable_id ?? order.order_number}
              className={[
                'orders-table-row',
                isManager ? 'orders-table-row--clickable' : '',
                rushRow ? 'orders-table-row--priority' : '',
                rowReleased ? 'orders-table-row--released' : '',
                rowReleased ? 'orders-table-row--completed' : '',
                rowExtra.cancelled ? 'orders-table-row--cancelled' : '',
                isSelfCancelled ? 'orders-table-row--cancelled-own' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => isManager && openEditOrderModal(order)}
            >
              <td
                className={[
                  'sticky-col sticky-1 order-num-td col-order-number',
                  rowReleased ? 'col-order-number--with-badges' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                title={orderNumberCellTooltip(order, null, rowReleased)}
              >
                {rowReleased ? (
                  <span className="released-badge order-badge" title="Zrealizowane (wydanie)">
                    ZREALIZOWANE
                  </span>
                ) : null}
                <span className="order-number-wrapper">
                  <span className="order-num-value order-number-value">{order.order_number}</span>
                  {isTitanBastion && (
                    <span
                      className="titan-arrival"
                      title={`Titan — ościeżnica (ST): ${oscArrived ? 'dojechała' : 'czeka'}; skrzydło (STA): ${skrArrived ? 'dojechało' : 'czeka'}`}
                    >
                      <span className={`titan-arrival-chip ${oscArrived ? 'titan-arrival-chip--ok' : 'titan-arrival-chip--wait'}`}>
                        OŚC {oscArrived ? '✓' : '…'}
                      </span>
                      <span className={`titan-arrival-chip ${skrArrived ? 'titan-arrival-chip--ok' : 'titan-arrival-chip--wait'}`}>
                        SKRZ {skrArrived ? '✓' : '…'}
                      </span>
                    </span>
                  )}
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
                    void handleRushToggle(order, e.target.checked)
                  }}
                />
              </td>
              <td className="col-order-text" title={orderCellTooltip(collection)}>
                {collection}
              </td>
              <td className="col-order-text" title={orderCellTooltip(order.system)}>
                {order.system}
              </td>
              <td className="col-order-text col-order-model" title={orderCellTooltip(order.model)}>
                {order.model}
              </td>
              <td className="col-order-text col-wing-color" title={orderCellTooltip(order.wing_color)}>
                {order.wing_color}
              </td>
              <td className="col-order-text col-frame-color" title={orderCellTooltip(order.frame_color)}>
                {order.frame_color}
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
              <td className="col-order-text" title={orderCellTooltip(order.peephole)}>
                {order.peephole}
              </td>
              <td className="col-order-text" title={orderCellTooltip(order.hardware)}>
                {order.hardware}
              </td>
              <td className="col-order-text" title={orderCellTooltip(frameType)}>
                {frameType}
              </td>
              <td className="col-order-text" title={orderCellTooltip(frameRange)}>
                {frameRange}
              </td>
              <td className="col-order-text" title={orderCellTooltip(order.threshold_color)}>
                {order.threshold_color}
              </td>
              <td className="col-notes" title={orderCellTooltip(order.notes)}>
                {order.notes}
              </td>
              {canEditSalesChanges ? (
                <td className="col-order-text" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="text"
                    className="inline-edit-input"
                    defaultValue={salesChanges}
                    disabled={rowOrderId === undefined}
                    onBlur={(e) => {
                      if (rowOrderId === undefined) return
                      const newValue = e.target.value
                      if (newValue !== salesChanges) {
                        void onUpdateSalesChanges(rowOrderId, newValue)
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur()
                    }}
                  />
                </td>
              ) : (
                <td className="col-order-text" title={orderCellTooltip(salesChanges)}>
                  {salesChanges}
                </td>
              )}
              <td className="col-order-text" title={orderCellTooltip(rushDate)}>
                {rushDate}
              </td>
              <td className="col-order-text" title={orderCellTooltip(dayOfWeek)}>
                {dayOfWeek}
              </td>
              <td className="col-order-text">
                {isPromo ? <span className="released-badge order-badge">PROMO</span> : '—'}
              </td>
              <td className="col-order-text" onClick={(e) => e.stopPropagation()}>
                {canEditPriority ? (
                  <input
                    type="text"
                    className="inline-edit-input"
                    defaultValue={productionPriority}
                    onBlur={(e) => {
                      const newValue = e.target.value
                      if (newValue !== productionPriority) {
                        void onUpdateProductionPriority(rowOrderId, newValue)
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur()
                    }}
                  />
                ) : (
                  <span className="col-order-text">{productionPriority || '—'}</span>
                )}
              </td>
              {BASTION_STAGE_DEFS.map((def) => {
                // Titan: w wybranych kolumnach pokazujemy etap OKU/MONT/PAK, resztę blokujemy
                if (isTitanBastion) {
                  const titKey = TITAN_BASTION_COL_MAP[def.key]
                  if (!titKey) {
                    return (
                      <td
                        key={def.key}
                        className="production-stage-td col-stage"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span
                          className="production-stage-readonly production-stage-readonly--linked-empty"
                          title="Nie dotyczy Titana"
                        >
                          —
                        </span>
                      </td>
                    )
                  }
                  const titDef = BASTION_TITAN_STAGE_DEFS.find((d) => d.key === titKey)
                  const value = rowStages[titKey] ?? ''
                  return (
                    <td
                      key={def.key}
                      className="production-stage-td col-stage"
                      title={titDef?.title}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="bastion-titan-step">
                        <span className="bastion-titan-step-label">{titDef?.header}</span>
                        <ProductionStageCell
                          value={value}
                          disabled={rowBusy || isSelfCancelled || rowOrderId === undefined}
                          onPickEmpty={() => {
                            if (rowOrderId === undefined) {
                              pushToast('Brak identyfikatora zamówienia', 'error')
                              return
                            }
                            void markProductionStageWithProfileInitials(rowOrderId, titKey)
                          }}
                          onPickFilled={() => {
                            if (rowOrderId === undefined) {
                              pushToast('Brak identyfikatora zamówienia', 'error')
                              return
                            }
                            setStageRevertTarget({ orderId: rowOrderId, stageKey: titKey })
                          }}
                        />
                      </div>
                    </td>
                  )
                }
                const value = rowStages[def.key] ?? ''
                return (
                  <td
                    key={def.key}
                    className="production-stage-td col-stage"
                    title={value.trim() ? value.trim() : undefined}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ProductionStageCell
                      value={value}
                      disabled={rowBusy || isSelfCancelled || rowOrderId === undefined}
                      onPickEmpty={() => {
                        if (rowOrderId === undefined) {
                          pushToast('Brak identyfikatora zamówienia', 'error')
                          return
                        }
                        void markProductionStageWithProfileInitials(rowOrderId, def.key)
                      }}
                      onPickFilled={() => {
                        if (rowOrderId === undefined) {
                          pushToast('Brak identyfikatora zamówienia', 'error')
                          return
                        }
                        setStageRevertTarget({ orderId: rowOrderId, stageKey: def.key })
                      }}
                    />
                  </td>
                )
              })}
              <td className="col-order-text" title={orderCellTooltip(labelQty)}>
                {labelQty}
              </td>
              <td
                className="col-order-text"
                title={labelValue ? orderCellTooltip(labelValue) : undefined}
                onClick={(e) => e.stopPropagation()}
              >
                {labelValue ? (
                  <button
                    type="button"
                    className="release-date-value"
                    disabled={!isManager || rowOrderId === undefined || isSelfCancelled}
                    title={isManager ? 'Kliknij, aby odznaczyć naklejkę' : labelValue}
                    onClick={() => {
                      if (!isManager || rowOrderId === undefined) return
                      void onLabelToggle(rowOrderId, labelValue)
                    }}
                  >
                    {/^\d{4}-\d{2}-\d{2}$/.test(labelValue) ? labelValue : '✓'}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="release-checkbox-btn"
                    disabled={!isManager || rowOrderId === undefined || isSelfCancelled}
                    role="checkbox"
                    aria-checked={false}
                    aria-label="Oznacz naklejkę"
                    title={isManager ? 'Oznacz naklejkę' : 'Naklejka'}
                    onClick={() => {
                      if (!isManager || rowOrderId === undefined) return
                      void onLabelToggle(rowOrderId, labelValue)
                    }}
                  />
                )}
              </td>
              <td className="col-order-text" title={orderCellTooltip(notes2)}>
                {notes2}
              </td>
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
                    aria-label="Oznacz realizację dzisiejszą datą"
                    title="Oznacz realizację"
                    onClick={() => {
                      if (rowOrderId === undefined) {
                        pushToast('Brak identyfikatora zamówienia', 'error')
                        return
                      }
                      void applyReleaseDateUpdate(rowOrderId, new Date().toISOString().split('T')[0])
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="release-date-value"
                    disabled={rowReleaseBusy || rowOrderId === undefined || isSelfCancelled}
                    title="Kliknij, aby cofnąć realizację"
                    onClick={() => {
                      if (rowOrderId === undefined) {
                        pushToast('Brak identyfikatora zamówienia', 'error')
                        return
                      }
                      setReleaseClearTarget({ orderId: rowOrderId })
                    }}
                  >
                    {String(order.release_date).trim()}
                  </button>
                )}
              </td>
              <td className="col-order-text" title={orderCellTooltip(order.client_order_number)}>
                {order.client_order_number}
              </td>
              {canSeePrices && (
                <td className="col-order-text" title={orderCellTooltip(order.configurator_value)}>
                  {order.configurator_value}
                </td>
              )}
              <td className="col-order-text" title={orderCellTooltip(order.entered_by)}>
                {order.entered_by}
              </td>
              <td className="col-order-text" title={orderCellTooltip(order.airtable_id)}>
                {order.airtable_id}
              </td>
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
                            onClick={() => handleCancelOrderClick(order)}
                          >
                            Anuluj
                          </button>
                        )}
                        {isCancelled && (
                          <button
                            type="button"
                            className="btn btn-sm btn-primary"
                            onClick={() => void handleRestoreOrder(order)}
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
        })}
      </tbody>
      </table>
    </TopScrollTableWrapper>
  )
}
