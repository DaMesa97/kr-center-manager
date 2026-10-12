import { memo, useMemo, type MutableRefObject } from 'react'
import { BASTION_STAGE_DEFS, BASTION_TITAN_STAGE_DEFS } from '../constants'
import DataTable, { type DataTableColumn } from './DataTable'
import ProductionStageCell from './ProductionStageCell'
import {
  actionsCol,
  companyCol,
  isCancelledOwn,
  orderCtxDeps,
  orderDateCol,
  orderField,
  orderNumberCol,
  withOrderStacking,
  orderRowClassName,
  productionDayCol,
  quantityCol,
  releaseCol,
  rushCol,
  textCol,
  useStickyCol1Width,
  type OrderTableCtx,
} from './orderTableColumns'
import type { ConfigOptionRecord, Order } from '../types'
import { bastionFrameOptionForOrder, isReleaseDateEmpty, parseOrderExtraFields, parseProductionStages } from '../utils'

// Titan w Bastionie: mapowanie etapów OKU/MONT/PAK na 3 sąsiednie kolumny tabeli.
// Pozostałe kolumny Bastiona są dla Titana zablokowane.
const TITAN_BASTION_COL_MAP: Record<string, string> = {
  okuwanie_skrzydla: 'tit_oku',
  oscieznica_cnc: 'tit_mon',
  oscieznica_skrecanie: 'tit_pak',
}

type BastionOrdersTableViewProps = OrderTableCtx & {
  filteredOrders: Order[]
  linkedOrders?: Order[]
  canSeePrices?: boolean
  productionStageUpdating: string | null
  tableWrapperRef: MutableRefObject<HTMLDivElement | null>
  onOpenEditOrderModal: (order: Order) => void
  onMarkProductionStageWithProfileInitials: (orderId: number, stageKey: string) => void | Promise<void>
  onSetStageRevertTarget: (target: { orderId: number; stageKey: string }) => void
  bastionFrameOptions: ConfigOptionRecord[]
  canEditSalesChanges: boolean
  onUpdateSalesChanges: (orderId: number, value: string) => void | Promise<void>
  onUpdateProductionPriority: (orderId: number, value: string) => void | Promise<void>
  onLabelToggle: (orderId: number, current: string) => void | Promise<void>
}

const titanGroupOf = (o: Order) => {
  const g = Number((o.extra_fields as Record<string, unknown> | null)?.titan_group)
  return Number.isFinite(g) && g > 0 ? g : null
}

/** Pole edytowane w komórce: zapis na blur (Enter = blur), tylko gdy wartość się zmieniła. */
function inlineInput(value: string, onCommit: (v: string) => void, disabled?: boolean) {
  return (
    <input
      type="text"
      className="inline-edit-input"
      defaultValue={value}
      disabled={disabled}
      onBlur={(e) => {
        if (e.target.value !== value) onCommit(e.target.value)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
    />
  )
}

// memo: tabela re-renderuje się tylko gdy zmienią się jej propsy (nie każdy toast/stan App)
function BastionOrdersTableView({
  filteredOrders,
  linkedOrders = [],
  canSeePrices = true,
  productionStageUpdating,
  tableWrapperRef,
  onOpenEditOrderModal,
  onMarkProductionStageWithProfileInitials,
  onSetStageRevertTarget,
  bastionFrameOptions,
  canEditSalesChanges,
  onUpdateSalesChanges,
  onUpdateProductionPriority,
  onLabelToggle,
  ...ctx
}: BastionOrdersTableViewProps) {
  const { isManager, pushToast } = ctx
  useStickyCol1Width(tableWrapperRef, [filteredOrders, isManager])

  // etapy parsowane raz na wiersz, nie w każdej komórce
  const stagesByOrder = useMemo(
    () => new Map(filteredOrders.map((o) => [o, parseProductionStages(o.production_stages, 'Bastion')])),
    [filteredOrders],
  )

  const columns = useMemo<DataTableColumn<Order>[]>(() => {
    const stagesOf = (o: Order) => stagesByOrder.get(o) ?? parseProductionStages(o.production_stages, 'Bastion')
    const f = (key: string) => (o: Order) => orderField(o, key)

    // Titan: status dojazdu rodzeństwa (ościeżnica z ST, skrzydło ze STA) po wydaniu
    const titanArrival = (o: Order) => {
      const g = titanGroupOf(o)
      if (g === null) return null
      const staBase = linkedOrders.find((x) => x.id === g)
      const stSib = linkedOrders.find((x) => x.category === 'ST' && x.linked_order_id === g)
      return {
        skr: !!staBase && !isReleaseDateEmpty(staBase.release_date),
        osc: !!stSib && !isReleaseDateEmpty(stSib.release_date),
      }
    }

    const stageCell = (o: Order, stageKey: string) => {
      const id = o.id
      const rowBusy = id !== undefined && productionStageUpdating === String(id)
      return (
        <ProductionStageCell
          value={stagesOf(o)[stageKey] ?? ''}
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
    }

    const stageCols = BASTION_STAGE_DEFS.map((def): DataTableColumn<Order> => {
      const titKey = TITAN_BASTION_COL_MAP[def.key]
      const titDef = titKey ? BASTION_TITAN_STAGE_DEFS.find((d) => d.key === titKey) : undefined
      // klucz etapu w tej kolumnie dla danego wiersza (null = Titan, kolumna nie dotyczy)
      const keyFor = (o: Order) => (titanGroupOf(o) === null ? def.key : (titKey ?? null))
      return {
        key: `stage-${def.key}`,
        label: def.header,
        title: def.title,
        thClassName: 'production-stage-th col-stage',
        tdClassName: 'production-stage-td col-stage',
        stopRowClick: true,
        tdTitle: (o) => {
          if (titanGroupOf(o) !== null) return titDef?.title
          return String(stagesOf(o)[def.key] ?? '').trim() || undefined
        },
        sortValue: (o) => {
          const k = keyFor(o)
          return k ? String(stagesOf(o)[k] ?? '').trim() || null : null
        },
        render: (o) => {
          if (titanGroupOf(o) === null) return stageCell(o, def.key)
          if (!titKey) {
            return (
              <span className="production-stage-readonly production-stage-readonly--linked-empty" title="Nie dotyczy Titana">
                —
              </span>
            )
          }
          return (
            <div className="bastion-titan-step">
              <span className="bastion-titan-step-label">{titDef?.header}</span>
              {stageCell(o, titKey)}
            </div>
          )
        },
      }
    })

    const salesChangesCol: DataTableColumn<Order> = canEditSalesChanges
      ? {
          key: 'sales_changes',
          label: 'ZMIANY-SPRZEDAŻ',
          className: 'col-order-text',
          stopRowClick: true,
          sortValue: f('bastion_sales_changes'),
          render: (o) => {
            const id = o.id
            return inlineInput(
              orderField(o, 'bastion_sales_changes'),
              (v) => {
                if (id !== undefined) void onUpdateSalesChanges(id, v)
              },
              id === undefined,
            )
          },
        }
      : textCol('sales_changes', 'ZMIANY-SPRZEDAŻ', f('bastion_sales_changes'))

    const cols: DataTableColumn<Order>[] = [
      orderNumberCol(ctx, {
        tdClassName: 'order-num-td',
        afterNumber: (o) => {
          const arr = titanArrival(o)
          if (!arr) return null
          return (
            <span
              className="titan-arrival"
              title={`Titan — ościeżnica (ST): ${arr.osc ? 'dojechała' : 'czeka'}; skrzydło (STA): ${arr.skr ? 'dojechało' : 'czeka'}`}
            >
              <span className={`titan-arrival-chip ${arr.osc ? 'titan-arrival-chip--ok' : 'titan-arrival-chip--wait'}`}>
                OŚC {arr.osc ? '✓' : '…'}
              </span>
              <span className={`titan-arrival-chip ${arr.skr ? 'titan-arrival-chip--ok' : 'titan-arrival-chip--wait'}`}>
                SKRZ {arr.skr ? '✓' : '…'}
              </span>
            </span>
          )
        },
      }),
      companyCol(),
      orderDateCol(),
      productionDayCol(),
      quantityCol(),
      rushCol(ctx),
      textCol('collection', 'KOLEKCJA', f('bastion_collection')),
      textCol('system', 'SYSTEM', (o) => o.system),
      textCol('model', 'MODEL', (o) => o.model, { className: 'col-order-text col-order-model' }),
      textCol('wing_color', 'KOLOR SKRZYDŁA', (o) => o.wing_color, { className: 'col-order-text col-wing-color' }),
      textCol('frame_color', 'KOLOR OŚCIEŻNICY', (o) => o.frame_color, { className: 'col-order-text col-frame-color' }),
      textCol('threshold_color', 'KOLOR PROGU', (o) => o.threshold_color),
      textCol('width', 'SZEROKOŚĆ', (o) => o.width),
      textCol('direction', 'KIERUNEK', (o) => o.direction),
      textCol('opening', 'OTWIERANIE', (o) => o.opening),
      textCol('height', 'WYSOKOŚĆ', (o) => o.height),
      textCol('glazing', 'SZKLENIE', (o) => o.glazing),
      textCol('peephole', 'WIZJER', (o) => o.peephole),
      textCol('hardware', 'OKUCIA', (o) => o.hardware),
      textCol('intarsja', 'INTARSJA', (o) => o.intarsja ?? '', { title: 'INTARSJA (Titan)' }),
      textCol('frame_type', 'OŚCIEŻNICA', f('bastion_frame_type')),
      textCol('frame_range', 'ZAKRES', f('bastion_frame_range')),
      // PRÓG = kolor progu (osobna kolumna w arkuszu Bastiona)
      textCol('threshold', 'PRÓG', (o) => o.threshold_color),
      textCol('side_panel_k', 'PANEL BOCZNY KLAMK.', f('bastion_side_panel_k')),
      textCol('side_panel_p', 'PANEL BOCZNY PRZECIWKL.', f('bastion_side_panel_p')),
      textCol('top_panel', 'PANEL GÓRNY', f('bastion_top_panel')),
      textCol('notes', 'UWAGI', (o) => o.notes, { className: 'col-notes' }),
      salesChangesCol,
      textCol('rush_date', 'PILNE/TERMIN WYKONANIA', f('bastion_rush_date')),
      textCol('day_of_week', 'DZIEŃ TYGODNIA', f('bastion_day_of_week')),
      {
        key: 'promo',
        label: 'PROMO',
        className: 'col-order-text',
        sortValue: (o) => ((o as Record<string, unknown>).bastion_is_promo ? 0 : 1),
        render: (o) =>
          (o as Record<string, unknown>).bastion_is_promo ? <span className="released-badge order-badge">PROMO</span> : '—',
      },
      {
        key: 'production_priority',
        label: 'KOLEJNOŚĆ PRODUKCJI OŚCIEŻNIC REG.',
        className: 'col-order-text',
        stopRowClick: true,
        sortValue: f('bastion_production_priority'),
        render: (o) => {
          const priority = orderField(o, 'bastion_production_priority')
          const frameOption = bastionFrameOptionForOrder(orderField(o, 'bastion_frame_type'), bastionFrameOptions)
          const id = o.id
          if (!frameOption?.add_to_batch || !isManager || id === undefined) {
            return <span className="col-order-text">{priority || '—'}</span>
          }
          return inlineInput(priority, (v) => void onUpdateProductionPriority(id, v))
        },
      },
      ...stageCols,
      textCol('label_qty', 'ILOŚĆ ETYKIET', f('bastion_label_qty')),
      {
        key: 'label',
        label: 'NAKLEJKA',
        className: 'col-order-text',
        stopRowClick: true,
        tdTitle: (o) => String(o.label ?? '').trim() || undefined,
        sortValue: (o) => String(o.label ?? '').trim() || null,
        render: (o) => {
          const labelValue = String(o.label ?? '').trim()
          const id = o.id
          const disabled = !isManager || id === undefined || isCancelledOwn(o)
          const toggle = () => {
            if (!isManager || id === undefined) return
            void onLabelToggle(id, labelValue)
          }
          return labelValue ? (
            <button
              type="button"
              className="release-date-value"
              disabled={disabled}
              title={isManager ? 'Kliknij, aby odznaczyć naklejkę' : labelValue}
              onClick={toggle}
            >
              {/^\d{4}-\d{2}-\d{2}$/.test(labelValue) ? labelValue : '✓'}
            </button>
          ) : (
            <button
              type="button"
              className="release-checkbox-btn"
              disabled={disabled}
              role="checkbox"
              aria-checked={false}
              aria-label="Oznacz naklejkę"
              title={isManager ? 'Oznacz naklejkę' : 'Naklejka'}
              onClick={toggle}
            />
          )
        },
      },
      textCol('notes_2', 'UWAGI 2', f('bastion_notes_2')),
      releaseCol(ctx, { label: 'ZREALIZOWANE', noun: 'realizację', thClassName: 'release-date-th' }),
      textCol('client_order_number', 'NUMER ZAMÓWIENIA KLIENTA', (o) => o.client_order_number),
    ]
    if (canSeePrices) cols.push(textCol('configurator_value', 'WARTOŚĆ KONFIGURATOR', (o) => o.configurator_value))
    cols.push(
      textCol('entered_by', 'WPISAŁ', (o) => o.entered_by),
      textCol('airtable_id', 'AIRTABLE ID', (o) => o.airtable_id),
    )
    if (isManager) cols.push(actionsCol(ctx))
    return withOrderStacking(cols)
    // ctx to nowy obiekt przy każdym renderze — zależności pole po polu przez orderCtxDeps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stagesByOrder, linkedOrders, canSeePrices, productionStageUpdating, onMarkProductionStageWithProfileInitials, onSetStageRevertTarget, bastionFrameOptions, canEditSalesChanges, onUpdateSalesChanges, onUpdateProductionPriority, onLabelToggle, ...orderCtxDeps(ctx)])

  return (
    <DataTable
      rows={filteredOrders}
      rowKey={(order) => order.id ?? order.airtable_id ?? order.order_number}
      columns={columns}
      wrapperClassName="orders-table-wrapper"
      tableWrapperRef={tableWrapperRef}
      emptyText="Brak zamówień spełniających kryteria wyszukiwania."
      rowClassName={(order) =>
        orderRowClassName(order, isManager, {
          extra: [parseOrderExtraFields(order.extra_fields).cancelled && 'orders-table-row--cancelled'],
        })
      }
      onRowClick={isManager ? (order) => onOpenEditOrderModal(order) : undefined}
    />
  )
}

export default memo(BastionOrdersTableView)
