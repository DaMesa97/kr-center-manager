import { memo, useMemo, type MouseEvent, type MutableRefObject } from 'react'
import ProductionStageCell from './ProductionStageCell'
import DataTable, { type DataTableColumn } from './DataTable'
import {
  actionsCol,
  companyCol,
  orderCtxDeps,
  orderDateCol,
  orderNumberCol,
  withOrderStacking,
  orderRowClassName,
  productionDayCol,
  quantityCol,
  releaseCol,
  rushCol,
  textCol,
  useStickyCol1Width,
  isCancelledOwn,
  type OrderTableCtx,
} from './orderTableColumns'
import type { Order, StageDef, StStageLayoutMode } from '../types'
import { isReleaseDateEmpty, isStTitanOrder, parseOrderExtraFields, parseProductionStages, stStageCellKind } from '../utils'

type StOrdersTableViewProps = OrderTableCtx & {
  filteredOrders: Order[]
  stOrdersStageLayout: { mode: StStageLayoutMode; defs: StageDef[] }
  tableWrapperRef: MutableRefObject<HTMLDivElement | null>
  canSeePrices?: boolean
  productionStageUpdating: string | null
  onOpenEditOrderModal: (order: Order) => void
  onMarkProductionStageWithProfileInitials: (orderId: number, stageKey: string) => void | Promise<void>
  onSetStageRevertTarget: (target: { orderId: number; stageKey: string }) => void
  onHandleStTitanStaSheetNavigate: (staRef: string, event: MouseEvent<HTMLButtonElement>) => void
}

// ST anulowane po stronie STA (partner) — badge przy numerze + wyszarzony wiersz
const partnerCancelled = (o: Order) => o.category === 'ST' && !!parseOrderExtraFields(o.extra_fields).sta_cancelled

// memo: tabela re-renderuje się tylko gdy zmienią się jej propsy (nie każdy toast/stan App)
function StOrdersTableView({
  filteredOrders,
  stOrdersStageLayout,
  tableWrapperRef,
  canSeePrices = true,
  productionStageUpdating,
  onOpenEditOrderModal,
  onMarkProductionStageWithProfileInitials,
  onSetStageRevertTarget,
  onHandleStTitanStaSheetNavigate,
  ...ctx
}: StOrdersTableViewProps) {
  const { isManager, pushToast } = ctx
  useStickyCol1Width(tableWrapperRef, [filteredOrders, stOrdersStageLayout, isManager])

  // etapy parsowane raz na wiersz, nie w każdej komórce
  const stagesByOrder = useMemo(
    () => new Map(filteredOrders.map((o) => [o, parseProductionStages(o.production_stages, 'ST')])),
    [filteredOrders],
  )

  const columns = useMemo<DataTableColumn<Order>[]>(() => {
    const stagesOf = (o: Order) => stagesByOrder.get(o) ?? parseProductionStages(o.production_stages, 'ST')
    const { mode, defs } = stOrdersStageLayout

    const stageCols = defs.map((def): DataTableColumn<Order> => {
      const kindOf = (o: Order) => stStageCellKind(def, isStTitanOrder(o), mode)
      return {
        key: `stage-${def.key}`,
        label: def.header,
        title: def.title,
        thClassName: 'production-stage-th col-stage',
        tdClassName: (o) =>
          kindOf(o).kind === 'skr_badge'
            ? 'production-stage-td sta-osc-pack-td col-osc-pack'
            : 'production-stage-td col-stage',
        tdTitle: (o) => {
          const kind = kindOf(o)
          const e5 = String(stagesOf(o).sta_e5 ?? '').trim()
          if (kind.kind === 'skr_badge')
            return e5 ? 'Skrzydło spakowane w STA (E5)' : 'Oczekiwanie na pakowanie skrzydła w STA (E5)'
          if (kind.kind === 'e2_sta') return e5 || 'Status z arkusza STA (E5)'
          return undefined
        },
        stopRowClick: true,
        sortValue: (o) => {
          const kind = kindOf(o)
          if (kind.kind === 'none') return null
          const v = kind.kind === 'click' ? stagesOf(o)[kind.stageKey] : stagesOf(o).sta_e5
          return String(v ?? '').trim() || null
        },
        render: (o) => {
          const kind = kindOf(o)
          const rowStages = stagesOf(o)
          if (kind.kind === 'none') return '—'
          if (kind.kind === 'skr_badge') {
            const skrInitials = String(rowStages.sta_e5 ?? '').trim()
            return (
              <span className={skrInitials ? 'st-skr-pack-badge st-skr-pack-badge--done' : 'st-skr-pack-badge st-skr-pack-badge--wait'}>
                {skrInitials ? (
                  <>
                    SKR ✓ <span className="sta-osc-badge-initials">{skrInitials}</span>
                  </>
                ) : (
                  'SKR —'
                )}
              </span>
            )
          }
          if (kind.kind === 'e2_sta') {
            const e2Val = String(rowStages.sta_e5 ?? '').trim()
            return (
              <span
                className={[
                  'production-stage-readonly',
                  e2Val ? 'production-stage-readonly--linked-done' : 'production-stage-readonly--linked-empty',
                ].join(' ')}
                title="E2 — skrzydło odebrane (STA E5)"
              >
                {e2Val || '—'}
              </span>
            )
          }
          const { stageKey } = kind
          const id = o.id
          const rowBusy = id !== undefined && productionStageUpdating === String(id)
          return (
            <ProductionStageCell
              value={rowStages[stageKey] ?? ''}
              disabled={rowBusy || isCancelledOwn(o) || id === undefined}
              onPickEmpty={() => {
                if (id === undefined) {
                  pushToast('Brak identyfikatora zamówienia', 'error')
                  return
                }
                void onMarkProductionStageWithProfileInitials(id, stageKey)
              }}
              onPickFilled={() => {
                if (id === undefined) {
                  pushToast('Brak identyfikatora zamówienia', 'error')
                  return
                }
                onSetStageRevertTarget({ orderId: id, stageKey })
              }}
            />
          )
        },
      }
    })

    const cols: DataTableColumn<Order>[] = [
      orderNumberCol(ctx, { partnerBadge: (o) => (partnerCancelled(o) ? 'ANULOWANO W STA' : null) }),
      companyCol(),
      orderDateCol(),
      productionDayCol(),
      quantityCol(),
      textCol('sequence', 'KOLEJNOŚĆ', (o) => o.sequence, { cellTooltip: false }),
      rushCol(ctx),
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
      ...stageCols,
      releaseCol(ctx),
      textCol('info', 'INFO', (o) => o.info),
      textCol('notes', 'UWAGI', (o) => o.notes),
      textCol('client_order_number', 'NUMER ZAMÓWIENIA KLIENTA', (o) => o.client_order_number),
      textCol('entered_by', 'WPISAŁ', (o) => o.entered_by),
    ]
    if (canSeePrices) cols.push(textCol('configurator_value', 'WARTOŚĆ KONFIGURATOR', (o) => o.configurator_value))
    cols.push(
      textCol('airtable_id', 'AIRTABLE ID', (o) => o.airtable_id),
      {
        key: 'sta_ref',
        label: 'NR W ARKUSZU STA',
        title: 'NR W ARKUSZU STA',
        className: 'col-order-text',
        stopRowClick: true,
        sortValue: (o) => o.sta_ref?.trim() || null,
        render: (o) =>
          o.sta_ref?.trim() ? (
            <button
              type="button"
              className="disting-sheet-link"
              onClick={(e) => onHandleStTitanStaSheetNavigate(o.sta_ref!.trim(), e)}
            >
              {o.sta_ref.trim()}
            </button>
          ) : (
            '—'
          ),
      },
      textCol('label', 'NAKLEJKA', (o) => o.label, { cellTooltip: false }),
    )
    if (isManager) cols.push(actionsCol(ctx))
    return withOrderStacking(cols)
    // ctx to nowy obiekt przy każdym renderze — zależności pole po polu przez orderCtxDeps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stagesByOrder, stOrdersStageLayout, canSeePrices, productionStageUpdating, onMarkProductionStageWithProfileInitials, onSetStageRevertTarget, onHandleStTitanStaSheetNavigate, ...orderCtxDeps(ctx)])

  return (
    <DataTable
      rows={filteredOrders}
      rowKey={(order) => order.id ?? order.order_number}
      columns={columns}
      className="orders-table--st-stages"
      wrapperClassName="orders-table-wrapper"
      tableWrapperRef={tableWrapperRef}
      emptyText="Brak zamówień spełniających kryteria wyszukiwania."
      rowClassName={(order) => {
        const partner = partnerCancelled(order)
        return orderRowClassName(order, isManager, {
          releasedHighlight: !isReleaseDateEmpty(order.release_date) && !partner,
          extra: [partner && 'orders-table-row--partner-cancelled', partner && 'orders-table-row--cancelled'],
        })
      }}
      onRowClick={isManager ? (order) => onOpenEditOrderModal(order) : undefined}
    />
  )
}

export default memo(StOrdersTableView)
