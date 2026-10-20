import { memo, useMemo, type MouseEvent, type MutableRefObject } from 'react'
import ProductionStageCell from './ProductionStageCell'
import DataTable, { type DataTableColumn } from './DataTable'
import {
  actionsCol,
  companyCol,
  isCancelledOwn,
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
  type OrderTableCtx,
} from './orderTableColumns'
import type { Order, StageDef } from '../types'
import {
  distingPlusMirrorTitle,
  isE22StageLockedNoAddons,
  isReleaseDateEmpty,
  isStaTitanLinked,
  orderCellTooltip,
  parseOrderExtraFields,
  parseProductionStages,
  staDistingPlusMirrorStorageKey,
  staDistingPlusMirrorTitle,
} from '../utils'

type StaDistingOrdersTableViewProps = OrderTableCtx & {
  activeTab: string
  filteredOrders: Order[]
  tableWrapperRef: MutableRefObject<HTMLDivElement | null>
  orderStageColumnDefs: StageDef[]
  canSeePrices?: boolean
  productionStageUpdating: string | null
  orders: Order[]
  linkedOrders: Order[]
  onOpenEditOrderModal: (order: Order) => void
  onMarkProductionStageWithProfileInitials: (orderId: number, stageKey: string) => void | Promise<void>
  onSetStageRevertTarget: (target: { orderId: number; stageKey: string }) => void
  onToggleOscReceived?: (order: Order) => void | Promise<void>
  handleDistingStaSheetNavigate: (staVal: string, event: MouseEvent<HTMLButtonElement>) => void
  handleStaDistingSheetNavigate: (distingVal: string, event: MouseEvent<HTMLButtonElement>) => void
}

const WYKONAWCA_COLORS: Record<string, string> = { Center: '#9b1c1c', Profil: '#16a34a', WZ: '#0369a1' }

// Etapy zablokowane dla STA Titana — STA robi TYLKO skrzydło (E3 frezowanie, E5 pakowanie)
const TITAN_BLOCKED: Record<string, string> = {
  e1: 'Ościeżnica — realizowana w ST',
  e2_1: 'Dostawka — nie dotyczy Titana',
  e4: 'Okuwanie skrzydła — realizowane na Bastionie',
}

/** Anulowanie po stronie partnera → napis badge’a (null = brak). */
function partnerCancelLabel(o: Order): string | null {
  const ex = parseOrderExtraFields(o.extra_fields)
  if (o.category === 'STA' && ex.disting_cancelled) return 'ANULOWANO W DISTING'
  if (o.category === 'Disting' && ex.sta_cancelled) return 'ANULOWANO W STA'
  if (o.category === 'STA' && ex.sta_cancelled) return 'ANULOWANO W ST'
  return null
}

// Naświetle/dostawki: bez wymiaru = „NIE”
const topLightOf = (o: Order) => {
  const raw = String(o.top_light ?? '')
  return raw.includes('×') && raw.split('×')[1]?.trim() ? raw : 'NIE'
}
const sidePanelAOf = (o: Order) => {
  const raw = String(o.side_panel_a || o.side_panel || '')
  return raw.split('×')[0]?.trim() !== '' ? raw : 'NIE'
}
const sidePanelBOf = (o: Order) => {
  const raw = String(o.side_panel_b ?? '')
  return raw.split('×')[0]?.trim() !== '' ? raw : 'NIE'
}

/**
 * Co pokazać w komórce etapu: klikalny etap albo podgląd tylko do odczytu
 * (lustro z partnera Disting Plus, zablokowany Titan, E2.2 bez dostawek).
 */
type StageCellInfo =
  | { kind: 'click'; value: string }
  | { kind: 'readonly'; value: string; tdTitle: string | undefined; spanTitle: string }

function stageCellInfo(o: Order, def: StageDef, rowStages: Record<string, string>, titanLinked: boolean): StageCellInfo {
  const linkedPlus = o.linked_order_id != null && !titanLinked
  if (titanLinked && TITAN_BLOCKED[def.key]) {
    return {
      kind: 'readonly',
      value: String(rowStages[def.key] ?? '').trim(),
      tdTitle: undefined,
      spanTitle: TITAN_BLOCKED[def.key],
    }
  }
  const staMirrorKey = o.category === 'STA' && linkedPlus ? staDistingPlusMirrorStorageKey(def.key) : null
  if (staMirrorKey) {
    const raw = staMirrorKey === 'dist_e2_1' ? (rowStages.dist_e2_1 ?? rowStages.dist_e2 ?? '') : (rowStages[staMirrorKey] ?? '')
    const v = String(raw).trim()
    return { kind: 'readonly', value: v, tdTitle: v || staDistingPlusMirrorTitle(def.key), spanTitle: staDistingPlusMirrorTitle(def.key) }
  }
  if (o.category === 'Disting' && linkedPlus && (def.key === 'e3' || def.key === 'e4')) {
    const v = String(rowStages[def.key === 'e3' ? 'sta_e3' : 'sta_e4'] ?? '').trim()
    return { kind: 'readonly', value: v, tdTitle: v || distingPlusMirrorTitle(def.key), spanTitle: distingPlusMirrorTitle(def.key) }
  }
  if (def.key === 'e2_2' && (o.category === 'STA' || o.category === 'Disting') && isE22StageLockedNoAddons(o)) {
    const v = String(rowStages.e2_2 ?? '').trim()
    return {
      kind: 'readonly',
      value: v,
      tdTitle: v || 'Brak dostawki i naświetla — etap zablokowany',
      spanTitle: 'Brak dostawki i naświetla',
    }
  }
  return { kind: 'click', value: rowStages[def.key] ?? '' }
}

// memo: tabela re-renderuje się tylko gdy zmienią się jej propsy (nie każdy toast/stan App)
function StaDistingOrdersTableView({
  activeTab,
  filteredOrders,
  tableWrapperRef,
  orderStageColumnDefs,
  canSeePrices = true,
  productionStageUpdating,
  orders,
  linkedOrders,
  onOpenEditOrderModal,
  onMarkProductionStageWithProfileInitials,
  onSetStageRevertTarget,
  onToggleOscReceived,
  handleDistingStaSheetNavigate,
  handleStaDistingSheetNavigate,
  ...ctx
}: StaDistingOrdersTableViewProps) {
  const { isManager, pushToast } = ctx

  // per wiersz raz: etapy + czy to STA Titana (szukanie po wszystkich zamówieniach jest drogie)
  const rowInfo = useMemo(() => {
    const all = [...orders, ...linkedOrders]
    return new Map(
      filteredOrders.map((o) => [
        o,
        { stages: parseProductionStages(o.production_stages, o.category), titanLinked: isStaTitanLinked(o, all) },
      ]),
    )
  }, [filteredOrders, orders, linkedOrders])

  const columns = useMemo<DataTableColumn<Order>[]>(() => {
    const infoOf = (o: Order) =>
      rowInfo.get(o) ?? {
        stages: parseProductionStages(o.production_stages, o.category),
        titanLinked: isStaTitanLinked(o, [...orders, ...linkedOrders]),
      }
    // Disting Plus powiązany z partnerem (nie Titan) — pokazujemy OŚC/ODBIÓR
    const linkedPlus = (o: Order) => o.linked_order_id != null && !infoOf(o).titanLinked

    const stageCols = orderStageColumnDefs.map((def): DataTableColumn<Order> => {
      const cell = (o: Order) => stageCellInfo(o, def, infoOf(o).stages, infoOf(o).titanLinked)
      return {
        key: `stage-${def.key}`,
        label: def.header,
        title: def.title ?? def.header,
        thClassName: 'production-stage-th col-stage',
        tdClassName: 'production-stage-td col-stage',
        stopRowClick: true,
        tdTitle: (o) => {
          const c = cell(o)
          return c.kind === 'readonly' ? c.tdTitle : c.value.trim() || undefined
        },
        sortValue: (o) => cell(o).value.trim() || null,
        render: (o) => {
          const c = cell(o)
          if (c.kind === 'readonly') {
            return (
              <span
                className={[
                  'production-stage-readonly',
                  c.value ? 'production-stage-readonly--linked-done' : 'production-stage-readonly--linked-empty',
                ].join(' ')}
                title={c.spanTitle}
              >
                {c.value || '—'}
              </span>
            )
          }
          const id = o.id
          const rowBusy = id !== undefined && productionStageUpdating === String(id)
          return (
            <ProductionStageCell
              value={c.value}
              disabled={rowBusy || isCancelledOwn(o) || id === undefined}
              onPickEmpty={() => {
                if (id === undefined) {
                  pushToast('Brak identyfikatora zamówienia', 'error')
                  return
                }
                void onMarkProductionStageWithProfileInitials(id, def.key)
              }}
              onPickFilled={() => {
                if (id === undefined) {
                  pushToast('Brak identyfikatora zamówienia', 'error')
                  return
                }
                onSetStageRevertTarget({ orderId: id, stageKey: def.key })
              }}
            />
          )
        },
      }
    })

    // STA: pakowanie ościeżnicy w Disting (E5) + odbiór na Marklowickiej — tylko DISTING PLUS
    const staOscCols: DataTableColumn<Order>[] =
      activeTab !== 'STA'
        ? []
        : [
            {
              key: 'osc_pack',
              label: 'OŚC.',
              title: 'Pakowanie ościeżnicy (Disting E5) — tylko DISTING PLUS',
              thClassName: 'production-stage-th sta-osc-pack-th col-osc-pack',
              tdClassName: 'production-stage-td sta-osc-pack-td col-osc-pack',
              stopRowClick: true,
              tdTitle: (o) => (linkedPlus(o) ? orderCellTooltip(infoOf(o).stages.dist_e5) : undefined),
              sortValue: (o) => (linkedPlus(o) ? String(infoOf(o).stages.dist_e5 ?? '').trim() || null : null),
              render: (o) => {
                if (!linkedPlus(o)) return ' '
                const oscInitials = String(infoOf(o).stages.dist_e5 ?? '').trim()
                return (
                  <span
                    className={oscInitials ? 'sta-osc-badge sta-osc-badge--done' : 'sta-osc-badge sta-osc-badge--wait'}
                    title={oscInitials ? 'Ościeżnica spakowana do transportu' : 'Oczekiwanie na pakowanie ościeżnicy w Disting (E5)'}
                  >
                    {oscInitials ? (
                      <>
                        OŚC ✓ <span className="sta-osc-badge-initials">{oscInitials}</span>
                      </>
                    ) : (
                      'OŚC —'
                    )}
                  </span>
                )
              },
            },
            {
              key: 'osc_received',
              label: 'ODBIÓR',
              title: 'Ościeżnica odebrana na Marklowickiej (ręcznie, kierownik) — DISTING PLUS',
              thClassName: 'production-stage-th sta-osc-pack-th col-osc-pack',
              tdClassName: 'production-stage-td sta-osc-pack-td col-osc-pack',
              stopRowClick: true,
              sortValue: (o) =>
                linkedPlus(o)
                  ? String((o.extra_fields as Record<string, unknown> | null)?.osc_received ?? '').trim() || null
                  : null,
              render: (o) => {
                if (!linkedPlus(o)) return ' '
                const recv = String((o.extra_fields as Record<string, unknown> | null)?.osc_received ?? '').trim()
                const clickable = isManager && !!onToggleOscReceived && o.id !== undefined
                return (
                  <button
                    type="button"
                    className={recv ? 'sta-osc-badge sta-osc-badge--done' : 'sta-osc-badge sta-osc-badge--wait'}
                    style={{ cursor: clickable ? 'pointer' : 'default', border: 'none' }}
                    disabled={!clickable}
                    title={recv ? `Ościeżnica odebrana na Marklowickiej (${recv})` : 'Oznacz odbiór ościeżnicy na Marklowickiej'}
                    onClick={() => {
                      if (clickable && onToggleOscReceived) void onToggleOscReceived(o)
                    }}
                  >
                    {recv ? (
                      <>
                        ODB ✓ <span className="sta-osc-badge-initials">{recv}</span>
                      </>
                    ) : (
                      'ODB —'
                    )}
                  </button>
                )
              },
            },
          ]

    // NR. W ARKUSZU STA/DISTING: w „drugiej” zakładce to link do partnera
    const sheetCol = (
      key: 'sta_sheet' | 'disting_sheet',
      label: string,
      linkTab: string,
      linkTitle: (v: string) => string,
      navigate: (v: string, e: MouseEvent<HTMLButtonElement>) => void,
    ): DataTableColumn<Order> => ({
      ...textCol(key, label, (o) => o[key]),
      render: (o) => {
        const v = String(o[key] ?? '').trim()
        if (!v) return '—'
        if (activeTab !== linkTab) return v
        return (
          <button
            type="button"
            className="disting-sheet-link"
            title={linkTitle(v)}
            onClick={(e) => {
              e.stopPropagation()
              navigate(v, e)
            }}
          >
            {v}
          </button>
        )
      },
    })

    const cols: DataTableColumn<Order>[] = [
      orderNumberCol(ctx, {
        tdClassName: 'order-num-td',
        partnerBadge: partnerCancelLabel,
        releasedLabel: (o) => (o.category === 'Disting' && o.linked_order_id != null ? 'WYSŁANE DO STA' : 'ZREALIZOWANE'),
        afterNumber: (o) => {
          const wyk = (o.extra_fields as Record<string, unknown> | null)?.wykonawca as string | undefined
          // Slot o stałej szerokości też dla wierszy BEZ wykonawcy — komentarze
          // i status magazynu stoją w jednej kolumience zamiast falować
          return (
            <span className="wykonawca-slot">
              {wyk ? (
                <span className="wykonawca-badge" style={{ background: WYKONAWCA_COLORS[wyk] ?? '#475569' }}>
                  {wyk}
                </span>
              ) : null}
            </span>
          )
        },
      }),
      companyCol(),
      orderDateCol(),
      productionDayCol(),
      quantityCol(),
      rushCol(ctx),
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
      textCol('decorative_panel', 'PANEL DEKORACYJNY', (o) => o.decorative_panel),
      textCol('intarsja', 'INTARSJA', (o) => o.intarsja ?? '', { title: 'INTARSJA (Titan)' }),
      textCol('hardware', 'OKUCIA', (o) => o.hardware),
      textCol('handle', 'POCHWYT', (o) => o.handle),
      textCol('electric_strike', 'ZACZEP', (o) => o.electric_strike || o.zaczep),
      textCol('peephole', 'WIZJER', (o) => o.peephole),
      textCol('top_light', 'NAŚWIETLE GÓRNE', topLightOf),
      textCol('top_light_glazing', 'SZKLENIE NAŚWIETLE GÓRNE', (o) =>
        topLightOf(o) === 'NIE' ? 'NIE' : String(o.top_light_glazing ?? ''),
      ),
      textCol('side_panel_a', 'DOSTAWKA A', sidePanelAOf, { title: 'DOSTAWKA BOCZNA A' }),
      textCol('side_panel_b', 'DOSTAWKA B', sidePanelBOf, { title: 'DOSTAWKA BOCZNA B' }),
      textCol(
        'side_panel_a_glazing',
        'SZKLENIE A',
        (o) => (sidePanelAOf(o) === 'NIE' ? 'NIE' : String(o.side_panel_a_glazing || o.side_panel_glazing || '')),
        { title: 'SZKLENIE DOSTAWKI A' },
      ),
      textCol(
        'side_panel_b_glazing',
        'SZKLENIE B',
        (o) => (sidePanelBOf(o) === 'NIE' ? 'NIE' : String(o.side_panel_b_glazing ?? '')),
        { title: 'SZKLENIE DOSTAWKI B' },
      ),
      textCol('extension', 'POSZERZENIE', (o) => o.extension),
      ...stageCols,
      ...staOscCols,
      releaseCol(ctx, { thClassName: 'release-date-th' }),
      sheetCol('sta_sheet', 'NR. W ARKUSZU STA', 'Disting', (v) => `Przejdź do zamówienia STA (${v})`, handleDistingStaSheetNavigate),
      sheetCol('disting_sheet', 'NR. W ARKUSZU DISTING', 'STA', (v) => `Przejdź do zamówienia Disting (${v})`, handleStaDistingSheetNavigate),
      textCol('notes', 'UWAGI', (o) => o.notes, { className: 'col-notes' }),
      textCol('client_order_number', 'NUMER ZAMÓWIENIA KLIENTA', (o) => o.client_order_number),
      textCol('defects', 'BRAKI', (o) => o.defects),
      textCol('entered_by', 'WPISAŁ', (o) => o.entered_by),
    ]
    if (canSeePrices) cols.push(textCol('configurator_value', 'WARTOŚĆ KONFIGURATOR', (o) => o.configurator_value))
    cols.push(
      textCol('info', 'INFO', (o) => o.info),
      textCol('airtable_id', 'AIRTABLE ID', (o) => o.airtable_id),
      textCol('label', 'ETYKIETA', (o) => o.label),
    )
    if (isManager) cols.push({ ...actionsCol(ctx), title: 'Akcje' })
    return withOrderStacking(cols)
    // ctx to nowy obiekt przy każdym renderze — zależności pole po polu przez orderCtxDeps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowInfo, activeTab, orderStageColumnDefs, orders, linkedOrders, canSeePrices, productionStageUpdating, onMarkProductionStageWithProfileInitials, onSetStageRevertTarget, onToggleOscReceived, handleDistingStaSheetNavigate, handleStaDistingSheetNavigate, ...orderCtxDeps(ctx)])

  return (
    <DataTable
      rows={filteredOrders}
      rowKey={(order) => order.id ?? order.airtable_id ?? order.order_number}
      columns={columns}
      wrapperClassName="orders-table-wrapper"
      tableWrapperRef={tableWrapperRef}
      emptyText="Brak zamówień spełniających kryteria wyszukiwania."
      rowClassName={(order) => {
        const partner = partnerCancelLabel(order) !== null
        return orderRowClassName(order, isManager, {
          releasedHighlight: !isReleaseDateEmpty(order.release_date) && !partner,
          extra: [partner && 'orders-table-row--partner-cancelled', partner && 'orders-table-row--cancelled'],
        })
      }}
      onRowClick={isManager ? (order) => onOpenEditOrderModal(order) : undefined}
    />
  )
}

export default memo(StaDistingOrdersTableView)
