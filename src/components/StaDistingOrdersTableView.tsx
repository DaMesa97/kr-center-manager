import type { MouseEvent, MutableRefObject } from 'react'
import ProductionStageCell from './ProductionStageCell'
import type { GlassAllowance, Order, StageDef, ToastVariant } from '../types'
import StockStatusBadge from './StockStatusBadge'
import { TopScrollTableWrapper } from './TopScrollTableWrapper'
import {
  distingPlusMirrorTitle,
  isE22StageLockedNoAddons,
  isReleaseDateEmpty,
  isRushOrderSequence,
  isStaTitanLinked,
  orderCellTooltip,
  orderNumberCellTooltip,
  parseOrderExtraFields,
  parseProductionStages,
  staDistingPlusMirrorStorageKey,
  staDistingPlusMirrorTitle,
} from '../utils'

type StaDistingOrdersTableViewProps = {
  activeTab: string
  filteredOrders: Order[]
  tableWrapperRef: MutableRefObject<HTMLDivElement | null>
  orderStageColumnDefs: StageDef[]
  isManager: boolean
  canSeePrices?: boolean
  selectedForLabel?: Set<number>
  onToggleLabelSelect?: (order: Order) => void
  productionStageUpdating: string | null
  releaseDateUpdating: number | null
  rushUpdatingOrderId: number | null
  orders: Order[]
  linkedOrders: Order[]
  glassAllowances: GlassAllowance[]
  orderCommentsCounts: Map<number, { total: number; unread: number }>
  onOpenCommentsPanel: (order: Order) => void
  openEditOrderModal: (order: Order) => void
  handleRushToggle: (order: Order, checked: boolean) => void | Promise<void>
  markProductionStageWithProfileInitials: (orderId: number, stageKey: string) => void | Promise<void>
  setStageRevertTarget: (target: { orderId: number; stageKey: string }) => void
  applyReleaseDateUpdate: (orderId: number, date: string | null) => void | Promise<void>
  onToggleOscReceived?: (order: Order) => void | Promise<void>
  setReleaseClearTarget: (target: { orderId: number }) => void
  handleDistingStaSheetNavigate: (staVal: string, event: MouseEvent<HTMLButtonElement>) => void
  handleStaDistingSheetNavigate: (distingVal: string, event: MouseEvent<HTMLButtonElement>) => void
  handleCancelOrderClick: (order: Order) => void
  handleRestoreOrder: (order: Order) => void | Promise<void>
  onShowHistory?: (order: Order) => void
  pushToast: (message: string, variant: ToastVariant) => void
}

export default function StaDistingOrdersTableView({
  activeTab,
  filteredOrders,
  tableWrapperRef,
  orderStageColumnDefs,
  isManager,
  canSeePrices = true,
  selectedForLabel,
  onToggleLabelSelect,
  productionStageUpdating,
  releaseDateUpdating,
  rushUpdatingOrderId,
  orders,
  linkedOrders,
  glassAllowances,
  orderCommentsCounts,
  onOpenCommentsPanel,
  openEditOrderModal,
  handleRushToggle,
  markProductionStageWithProfileInitials,
  setStageRevertTarget,
  applyReleaseDateUpdate,
  onToggleOscReceived,
  setReleaseClearTarget,
  handleDistingStaSheetNavigate,
  handleStaDistingSheetNavigate,
  handleCancelOrderClick,
  handleRestoreOrder,
  onShowHistory,
  pushToast,
}: StaDistingOrdersTableViewProps) {
  return (
    <TopScrollTableWrapper className="table-wrapper orders-table-wrapper" tableWrapperRef={tableWrapperRef}>
      <table className="orders-table">
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
          <th className="rush-cell" title="PILNE">
            PILNE
          </th>
          <th className="col-order-text" title="SYSTEM">
            SYSTEM
          </th>
          <th className="col-order-text col-order-model" title="MODEL">
            MODEL
          </th>
          <th className="col-order-text col-wing-color" title="KOLOR SKRZYDŁA">
            KOLOR SKRZYDŁA
          </th>
          <th className="col-order-text col-frame-color" title="KOLOR OŚCIEŻNICY">
            KOLOR OŚCIEŻNICY
          </th>
          <th className="col-order-text" title="KOLOR PROGU">
            KOLOR PROGU
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
          <th className="col-order-text" title="PANEL DEKORACYJNY">
            PANEL DEKORACYJNY
          </th>
          <th className="col-order-text" title="OKUCIA">
            OKUCIA
          </th>
          <th className="col-order-text" title="POCHWYT">
            POCHWYT
          </th>
          <th className="col-order-text" title="ELEKTROZACZEP">
            ELEKTROZACZEP
          </th>
          <th className="col-order-text" title="WIZJER">
            WIZJER
          </th>
          <th className="col-order-text" title="NAŚWIETLE GÓRNE">
            NAŚWIETLE GÓRNE
          </th>
          <th className="col-order-text" title="SZKLENIE NAŚWIETLE GÓRNE">
            SZKLENIE NAŚWIETLE GÓRNE
          </th>
          <th className="col-order-text" title="DOSTAWKA BOCZNA A">
            DOSTAWKA A
          </th>
          <th className="col-order-text" title="DOSTAWKA BOCZNA B">
            DOSTAWKA B
          </th>
          <th className="col-order-text" title="SZKLENIE DOSTAWKI A">
            SZKLENIE A
          </th>
          <th className="col-order-text" title="SZKLENIE DOSTAWKI B">
            SZKLENIE B
          </th>
          <th className="col-order-text" title="POSZERZENIE">
            POSZERZENIE
          </th>
          {orderStageColumnDefs.map((def) => (
            <th key={def.key} className="production-stage-th col-stage" title={def.title ?? def.header}>
              {def.header}
            </th>
          ))}
          {activeTab === 'STA' && (
            <th
              className="production-stage-th sta-osc-pack-th col-osc-pack"
              title="Pakowanie ościeżnicy (Disting E5) — tylko DISTING PLUS"
            >
              OŚC.
            </th>
          )}
          {activeTab === 'STA' && (
            <th
              className="production-stage-th sta-osc-pack-th col-osc-pack"
              title="Ościeżnica odebrana na Marklowickiej (ręcznie, kierownik) — DISTING PLUS"
            >
              ODBIÓR
            </th>
          )}
          <th className="col-order-text release-date-th" title="WYDANIE">
            WYDANIE
          </th>
          <th className="col-order-text" title="NR. W ARKUSZU STA">
            NR. W ARKUSZU STA
          </th>
          <th className="col-order-text" title="NR. W ARKUSZU DISTING">
            NR. W ARKUSZU DISTING
          </th>
          <th className="col-notes" title="UWAGI">
            UWAGI
          </th>
          <th className="col-order-text" title="NUMER ZAMÓWIENIA KLIENTA">
            NUMER ZAMÓWIENIA KLIENTA
          </th>
          <th className="col-order-text" title="BRAKI">
            BRAKI
          </th>
          <th className="col-order-text" title="WPISAŁ">
            WPISAŁ
          </th>
          {canSeePrices && (
            <th className="col-order-text" title="WARTOŚĆ KONFIGURATOR">
              WARTOŚĆ KONFIGURATOR
            </th>
          )}
          <th className="col-order-text" title="INFO">
            INFO
          </th>
          <th className="col-order-text" title="AIRTABLE ID">
            AIRTABLE ID
          </th>
          <th className="col-order-text" title="ETYKIETA">
            ETYKIETA
          </th>
          {isManager && (
            <th className="col-order-actions" title="Akcje">
              Akcje
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {filteredOrders.map((order) => {
          const rowStages = parseProductionStages(order.production_stages, order.category)
          const rowOrderId = order.id
          const rowBusy = rowOrderId !== undefined && productionStageUpdating === String(rowOrderId)
          const rowReleaseBusy = rowOrderId !== undefined && releaseDateUpdating === rowOrderId
          const rushRow = isRushOrderSequence(order.sequence)
          const rowExtra = parseOrderExtraFields(order.extra_fields)
          const partnerRowCancelled =
            (order.category === 'STA' && rowExtra.disting_cancelled) ||
            (order.category === 'Disting' && rowExtra.sta_cancelled) ||
            (order.category === 'STA' && rowExtra.sta_cancelled)
          const partnerCancelBadgeLabel =
            order.category === 'STA' && rowExtra.disting_cancelled
              ? 'ANULOWANO W DISTING'
              : order.category === 'Disting' && rowExtra.sta_cancelled
                ? 'ANULOWANO W STA'
                : order.category === 'STA' && rowExtra.sta_cancelled
                  ? 'ANULOWANO W ST'
                  : null
          const rowReleased = !isReleaseDateEmpty(order.release_date)
          const releasedBadgeLabel =
            order.category === 'Disting' && order.linked_order_id != null ? 'WYSŁANE DO STA' : 'ZREALIZOWANE'
          const rawTopLight = String(order.top_light ?? '')
          const topLightDisplay =
            rawTopLight.includes('×') && rawTopLight.split('×')[1]?.trim() ? rawTopLight : 'NIE'
          const rawSidePanelA = String(order.side_panel_a || order.side_panel || '')
          const sidePanelAParts = rawSidePanelA.split('×')
          const sidePanelAHasWidth = sidePanelAParts[0]?.trim() !== ''
          const sidePanelADisplay = sidePanelAHasWidth ? rawSidePanelA : 'NIE'
          const rawSidePanelB = String(order.side_panel_b ?? '')
          const sidePanelBParts = rawSidePanelB.split('×')
          const sidePanelBHasWidth = sidePanelBParts[0]?.trim() !== ''
          const sidePanelBDisplay = sidePanelBHasWidth ? rawSidePanelB : 'NIE'
          const topLightGlazingDisplay = topLightDisplay === 'NIE' ? 'NIE' : String(order.top_light_glazing ?? '')
          const sidePanelAGlazingDisplay = !sidePanelAHasWidth
            ? 'NIE'
            : String(order.side_panel_a_glazing || order.side_panel_glazing || '')
          const sidePanelBGlazingDisplay = !sidePanelBHasWidth ? 'NIE' : String(order.side_panel_b_glazing ?? '')
          const rowReleasedHighlight = rowReleased && !partnerRowCancelled
          const isTitanLinked = isStaTitanLinked(order, [...orders, ...linkedOrders])
          const isSelfCancelled =
            typeof order.extra_fields === 'object' &&
            order.extra_fields !== null &&
            (order.extra_fields as Record<string, unknown>).cancelled === true
          return (
            <tr
              key={rowOrderId ?? order.airtable_id ?? order.order_number}
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
              onClick={() => isManager && openEditOrderModal(order)}
            >
              <td
                className={[
                  'sticky-col sticky-1 order-num-td col-order-number',
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
                    {releasedBadgeLabel}
                  </span>
                ) : null}
                <span className="order-number-wrapper">
                  <span className="order-num-value order-number-value">{order.order_number}</span>
                  {(() => {
                    const wyk = (order.extra_fields as Record<string, unknown> | null)?.wykonawca as string | undefined
                    if (!wyk) return null
                    const colorMap: Record<string, string> = { Center: '#9b1c1c', Profil: '#16a34a', WZ: '#0369a1' }
                    return (
                      <span className="wykonawca-badge" style={{ background: colorMap[wyk] ?? '#475569' }}>
                        {wyk}
                      </span>
                    )
                  })()}
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
                  checked={isRushOrderSequence(order.sequence)}
                  disabled={
                    !isManager || isSelfCancelled || rowOrderId === undefined || rushUpdatingOrderId === rowOrderId
                  }
                  title={isManager ? 'Pilne zamówienie' : 'Pilne (tylko kierownik może zmienić)'}
                  aria-label="Pilne"
                  onChange={(e) => {
                    e.stopPropagation()
                    void handleRushToggle(order, e.target.checked)
                  }}
                />
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
              <td className="col-order-text" title={orderCellTooltip(order.decorative_panel)}>
                {order.decorative_panel}
              </td>
              <td className="col-order-text" title={orderCellTooltip(order.hardware)}>
                {order.hardware}
              </td>
              <td className="col-order-text" title={orderCellTooltip(order.handle)}>
                {order.handle}
              </td>
              <td className="col-order-text" title={orderCellTooltip(order.electric_strike)}>
                {order.electric_strike}
              </td>
              <td className="col-order-text" title={orderCellTooltip(order.peephole)}>
                {order.peephole}
              </td>
              <td className="col-order-text" title={orderCellTooltip(topLightDisplay)}>
                {topLightDisplay}
              </td>
              <td className="col-order-text" title={orderCellTooltip(topLightGlazingDisplay)}>
                {topLightGlazingDisplay}
              </td>
              <td className="col-order-text" title={orderCellTooltip(sidePanelADisplay)}>
                {sidePanelADisplay}
              </td>
              <td className="col-order-text" title={orderCellTooltip(sidePanelBDisplay)}>
                {sidePanelBDisplay}
              </td>
              <td className="col-order-text" title={orderCellTooltip(sidePanelAGlazingDisplay)}>
                {sidePanelAGlazingDisplay}
              </td>
              <td className="col-order-text" title={orderCellTooltip(sidePanelBGlazingDisplay)}>
                {sidePanelBGlazingDisplay}
              </td>
              <td className="col-order-text" title={orderCellTooltip(order.extension)}>
                {order.extension}
              </td>
              {orderStageColumnDefs.map((def) => {
                const value = rowStages[def.key] ?? ''
                const linkedPlus = order.linked_order_id != null && !isTitanLinked
                const staMirrorKey =
                  order.category === 'STA' && linkedPlus ? staDistingPlusMirrorStorageKey(def.key) : null
                const distingPlusReadonly =
                  order.category === 'Disting' && linkedPlus && (def.key === 'e3' || def.key === 'e4')

                if (isTitanLinked) {
                  // STA Titan robi TYLKO skrzydło (E3 frezowanie, E5 pakowanie).
                  // Ościeżnica (E1) = ST, dostawka (E2.1) n/d, okuwanie (E4) = Bastion → zablokowane.
                  const titanBlocked: Record<string, string> = {
                    e1: 'Ościeżnica — realizowana w ST',
                    e2_1: 'Dostawka — nie dotyczy Titana',
                    e4: 'Okuwanie skrzydła — realizowane na Bastionie',
                  }
                  if (titanBlocked[def.key]) {
                    const v = String(rowStages[def.key] ?? '').trim()
                    const filled = Boolean(v)
                    return (
                      <td key={def.key} className="production-stage-td col-stage" onClick={(e) => e.stopPropagation()}>
                        <span
                          className={[
                            'production-stage-readonly',
                            filled ? 'production-stage-readonly--linked-done' : 'production-stage-readonly--linked-empty',
                          ].join(' ')}
                          title={titanBlocked[def.key]}
                        >
                          {filled ? v : '—'}
                        </span>
                      </td>
                    )
                  }
                }

                if (staMirrorKey) {
                  const mirrorRaw =
                    staMirrorKey === 'dist_e2_1' ? rowStages.dist_e2_1 ?? rowStages.dist_e2 ?? '' : rowStages[staMirrorKey] ?? ''
                  const mirrorVal = String(mirrorRaw).trim()
                  const filled = Boolean(mirrorVal)
                  return (
                    <td
                      key={def.key}
                      className="production-stage-td col-stage"
                      title={filled ? mirrorVal : staDistingPlusMirrorTitle(def.key)}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span
                        className={[
                          'production-stage-readonly',
                          filled ? 'production-stage-readonly--linked-done' : 'production-stage-readonly--linked-empty',
                        ].join(' ')}
                        title={staDistingPlusMirrorTitle(def.key)}
                      >
                        {filled ? mirrorVal : '—'}
                      </span>
                    </td>
                  )
                }

                if (distingPlusReadonly) {
                  const mirrorKey = def.key === 'e3' ? 'sta_e3' : 'sta_e4'
                  const mirrorVal = String(rowStages[mirrorKey] ?? '').trim()
                  const filled = Boolean(mirrorVal)
                  return (
                    <td
                      key={def.key}
                      className="production-stage-td col-stage"
                      title={filled ? mirrorVal : distingPlusMirrorTitle(def.key)}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span
                        className={[
                          'production-stage-readonly',
                          filled ? 'production-stage-readonly--linked-done' : 'production-stage-readonly--linked-empty',
                        ].join(' ')}
                        title={distingPlusMirrorTitle(def.key)}
                      >
                        {filled ? mirrorVal : '—'}
                      </span>
                    </td>
                  )
                }

                const e22NoAddonsLocked =
                  def.key === 'e2_2' &&
                  (order.category === 'STA' || order.category === 'Disting') &&
                  staMirrorKey == null &&
                  isE22StageLockedNoAddons(order)

                if (e22NoAddonsLocked) {
                  const e22Val = String(rowStages.e2_2 ?? '').trim()
                  const e22Filled = Boolean(e22Val)
                  return (
                    <td
                      key={def.key}
                      className="production-stage-td col-stage"
                      title={e22Filled ? e22Val : 'Brak dostawki i naświetla — etap zablokowany'}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span
                        className={[
                          'production-stage-readonly',
                          e22Filled ? 'production-stage-readonly--linked-done' : 'production-stage-readonly--linked-empty',
                        ].join(' ')}
                        title="Brak dostawki i naświetla"
                      >
                        {e22Filled ? e22Val : '—'}
                      </span>
                    </td>
                  )
                }

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
              {activeTab === 'STA' && (
                <td
                  className="production-stage-td sta-osc-pack-td col-osc-pack"
                  title={
                    order.linked_order_id != null && !isTitanLinked ? orderCellTooltip(rowStages.dist_e5) : undefined
                  }
                  onClick={(e) => e.stopPropagation()}
                >
                  {order.linked_order_id != null && !isTitanLinked ? (
                    (() => {
                      const oscInitials = String(rowStages.dist_e5 ?? '').trim()
                      const oscDone = Boolean(oscInitials)
                      return (
                        <span
                          className={oscDone ? 'sta-osc-badge sta-osc-badge--done' : 'sta-osc-badge sta-osc-badge--wait'}
                          title={
                            oscDone
                              ? 'Ościeżnica spakowana do transportu'
                              : 'Oczekiwanie na pakowanie ościeżnicy w Disting (E5)'
                          }
                        >
                          {oscDone ? (
                            <>
                              OŚC ✓ <span className="sta-osc-badge-initials">{oscInitials}</span>
                            </>
                          ) : (
                            'OŚC —'
                          )}
                        </span>
                      )
                    })()
                  ) : (
                    '\u00a0'
                  )}
                </td>
              )}
              {activeTab === 'STA' && (
                <td className="production-stage-td sta-osc-pack-td col-osc-pack" onClick={(e) => e.stopPropagation()}>
                  {order.linked_order_id != null && !isTitanLinked ? (
                    (() => {
                      const recv = String((order.extra_fields as Record<string, unknown> | null)?.osc_received ?? '').trim()
                      const done = Boolean(recv)
                      const clickable = isManager && !!onToggleOscReceived && rowOrderId !== undefined
                      return (
                        <button
                          type="button"
                          className={done ? 'sta-osc-badge sta-osc-badge--done' : 'sta-osc-badge sta-osc-badge--wait'}
                          style={{ cursor: clickable ? 'pointer' : 'default', border: 'none' }}
                          disabled={!clickable}
                          title={done ? `Ościeżnica odebrana na Marklowickiej (${recv})` : 'Oznacz odbiór ościeżnicy na Marklowickiej'}
                          onClick={() => { if (clickable && onToggleOscReceived) void onToggleOscReceived(order) }}
                        >
                          {done ? (<>ODB ✓ <span className="sta-osc-badge-initials">{recv}</span></>) : 'ODB —'}
                        </button>
                      )
                    })()
                  ) : (
                    ' '
                  )}
                </td>
              )}
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
                      void applyReleaseDateUpdate(rowOrderId, new Date().toISOString().split('T')[0])
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
                      setReleaseClearTarget({ orderId: rowOrderId })
                    }}
                  >
                    {String(order.release_date).trim()}
                  </button>
                )}
              </td>
              <td
                className="col-order-text"
                title={orderCellTooltip(order.sta_sheet)}
                onClick={activeTab === 'Disting' && String(order.sta_sheet ?? '').trim() ? (e) => e.stopPropagation() : undefined}
              >
                {(() => {
                  const staVal = String(order.sta_sheet ?? '').trim()
                  if (!staVal) return '—'
                  if (activeTab === 'Disting') {
                    return (
                      <button
                        type="button"
                        className="disting-sheet-link"
                        title={`Przejdź do zamówienia STA (${staVal})`}
                        onClick={(e) => handleDistingStaSheetNavigate(staVal, e)}
                      >
                        {staVal}
                      </button>
                    )
                  }
                  return staVal
                })()}
              </td>
              <td
                className="col-order-text"
                title={orderCellTooltip(order.disting_sheet)}
                onClick={activeTab === 'STA' && String(order.disting_sheet ?? '').trim() ? (e) => e.stopPropagation() : undefined}
              >
                {(() => {
                  const distingVal = String(order.disting_sheet ?? '').trim()
                  if (!distingVal) return '—'
                  if (activeTab === 'STA') {
                    return (
                      <button
                        type="button"
                        className="disting-sheet-link"
                        title={`Przejdź do zamówienia Disting (${distingVal})`}
                        onClick={(e) => handleStaDistingSheetNavigate(distingVal, e)}
                      >
                        {distingVal}
                      </button>
                    )
                  }
                  return distingVal
                })()}
              </td>
              <td className="col-notes" title={orderCellTooltip(order.notes)}>
                {order.notes}
              </td>
              <td className="col-order-text" title={orderCellTooltip(order.client_order_number)}>
                {order.client_order_number}
              </td>
              <td className="col-order-text" title={orderCellTooltip(order.defects)}>
                {order.defects}
              </td>
              <td className="col-order-text" title={orderCellTooltip(order.entered_by)}>
                {order.entered_by}
              </td>
              {canSeePrices && (
                <td className="col-order-text" title={orderCellTooltip(order.configurator_value)}>
                  {order.configurator_value}
                </td>
              )}
              <td className="col-order-text" title={orderCellTooltip(order.info)}>
                {order.info}
              </td>
              <td className="col-order-text" title={orderCellTooltip(order.airtable_id)}>
                {order.airtable_id}
              </td>
              <td className="col-order-text" title={orderCellTooltip(order.label)}>
                {order.label}
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
