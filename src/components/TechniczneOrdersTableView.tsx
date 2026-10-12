import { memo, useMemo, type MutableRefObject } from 'react'
import DataTable, { type DataTableColumn } from './DataTable'
import {
  actionsCol,
  companyCol,
  orderDateCol,
  orderField,
  orderCtxDeps,
  orderNumberCol,
  orderRowClassName,
  productionDayCol,
  quantityCol,
  releaseCol,
  rushCol,
  textCol,
  useStickyCol1Width,
  type OrderTableCtx,
} from './orderTableColumns'
import type { Order } from '../types'

type TechniczneOrdersTableViewProps = OrderTableCtx & {
  filteredOrders: Order[]
  tableWrapperRef: MutableRefObject<HTMLDivElement | null>
  canSeePrices?: boolean
  onOpenEditOrderModal: (order: Order) => void
}

// memo: tabela re-renderuje się tylko gdy zmienią się jej propsy (nie każdy toast/stan App)
function TechniczneOrdersTableView({
  filteredOrders,
  tableWrapperRef,
  canSeePrices = true,
  onOpenEditOrderModal,
  ...ctx
}: TechniczneOrdersTableViewProps) {
  const { isManager } = ctx
  useStickyCol1Width(tableWrapperRef, [filteredOrders, isManager])

  const columns = useMemo<DataTableColumn<Order>[]>(() => {
    const cols: DataTableColumn<Order>[] = [
      orderNumberCol(ctx),
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
      textCol('wentylacja', 'WENTYLACJA', (o) => orderField(o, 'wentylacja')),
      releaseCol(ctx),
      textCol('info', 'INFO', (o) => o.info),
      textCol('notes', 'UWAGI', (o) => o.notes),
      textCol('client_order_number', 'NUMER ZAMÓWIENIA KLIENTA', (o) => o.client_order_number),
      textCol('entered_by', 'WPISAŁ', (o) => o.entered_by),
    ]
    if (canSeePrices) cols.push(textCol('configurator_value', 'WARTOŚĆ KONFIGURATOR', (o) => o.configurator_value))
    cols.push(
      textCol('airtable_id', 'AIRTABLE ID', (o) => o.airtable_id),
      textCol('label', 'NAKLEJKA', (o) => o.label, { cellTooltip: false }),
    )
    if (isManager) cols.push(actionsCol(ctx))
    return cols
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSeePrices, ...orderCtxDeps(ctx)])

  return (
    <DataTable
      rows={filteredOrders}
      rowKey={(order) => order.id ?? order.order_number}
      columns={columns}
      wrapperClassName="orders-table-wrapper"
      tableWrapperRef={tableWrapperRef}
      emptyText="Brak zamówień spełniających kryteria wyszukiwania."
      rowClassName={(order) => orderRowClassName(order, isManager)}
      onRowClick={isManager ? (order) => onOpenEditOrderModal(order) : undefined}
    />
  )
}

export default memo(TechniczneOrdersTableView)
