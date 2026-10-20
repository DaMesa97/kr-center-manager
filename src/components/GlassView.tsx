import { useMemo, useState, type MutableRefObject, type RefObject } from 'react'
import type { GlassAllowance, Order } from '../types'
import { calcGlassDim, getGlassAllowance, parseGlassDim } from '../utils'
import { generateGlassOrderPdf, type GlassOrderLine } from '../utils/glassOrderPdfGenerator'
import { appAlert, appConfirm } from '../lib/appDialogs'
import DataTable, { type DataTableColumn } from './DataTable'

// Pozycje szyb (naświetle / dostawka A / B) dla jednego zamówienia
function glassLinesFor(
  order: Order,
  activeTab: string,
  glassAllowances: GlassAllowance[],
): GlassOrderLine[] {
  const tlAllowance = getGlassAllowance(glassAllowances, activeTab, 'top_light')
  const spAllowance = getGlassAllowance(glassAllowances, activeTab, 'side_panel')
  const qty = Math.max(1, Number(order.quantity) || 1)
  const base = { orderNumber: String(order.order_number ?? ''), company: String(order.company ?? ''), qty }
  const lines: GlassOrderLine[] = []

  const dim = (raw: unknown, aw: { w: number; h: number }): string => {
    const [w, h] = parseGlassDim(raw)
    return w && h ? calcGlassDim(w, h, aw.w, aw.h) : ''
  }

  const tl = dim(order.top_light, tlAllowance)
  if (tl) lines.push({ ...base, element: 'Naświetle', glazing: String(order.top_light_glazing ?? '').trim(), glassDim: tl })
  const spA = dim(sidePanelARaw(order), spAllowance)
  if (spA) lines.push({ ...base, element: 'Dostawka A', glazing: String(order.side_panel_a_glazing || order.side_panel_glazing || '').trim(), glassDim: spA })
  const spB = dim(order.side_panel_b, spAllowance)
  if (spB) lines.push({ ...base, element: 'Dostawka B', glazing: String(order.side_panel_b_glazing ?? '').trim(), glassDim: spB })
  return lines
}

// Dostawka A: side_panel_a, a gdy nie ma w nim wymiaru — stare pole side_panel
function sidePanelARaw(order: Order): string {
  const a = String(order.side_panel_a ?? '')
  const [w, h] = parseGlassDim(a)
  return w && h ? a : String(order.side_panel ?? '')
}

type GlassRow = {
  order: Order
  tlTotal: string
  tlGlass: string
  spATotal: string
  spAGlass: string
  spBTotal: string
  spBGlass: string
}

type GlassViewProps = {
  orders: Order[]
  activeTab: string
  glassAllowances: GlassAllowance[]
  onSendGlassOrder: (order: Order) => void | Promise<void>
  onGlassReceived: (orderId: number) => void | Promise<void>
  tableWrapperRef: RefObject<HTMLDivElement>
}

export default function GlassView({
  orders,
  activeTab,
  glassAllowances,
  onSendGlassOrder,
  onGlassReceived,
  tableWrapperRef,
}: GlassViewProps) {
  // Guard przeciw podwójnej wysyłce zamówienia szyby (double-click)
  const [sendingIds, setSendingIds] = useState<Set<number>>(new Set())

  const handleSend = async (order: Order) => {
    if (order.id === undefined || sendingIds.has(order.id)) return
    // Wysyłka idzie od razu do szklarza (Make) i nie da się jej cofnąć —
    // pojedynczy klik bez potwierdzenia bywał przypadkowy
    const ok = await appConfirm(
      `Wysłać zamówienie szyb dla zlecenia ${order.order_number} (${order.company ?? ''}) do szklarza?`,
      { title: 'Zamówienie szyby', confirmLabel: 'Wyślij zamówienie' },
    )
    if (!ok) return
    setSendingIds((prev) => new Set(prev).add(order.id!))
    try {
      await onSendGlassOrder(order)
    } finally {
      setSendingIds((prev) => {
        const next = new Set(prev)
        next.delete(order.id!)
        return next
      })
    }
  }

  // "Zamów szyby (PDF)": wszystkie pozycje BEZ daty zamówienia → jeden PDF
  // dla szklarza (pogrupowany po rodzaju szkła), potem opcjonalny stempel daty
  const [generating, setGenerating] = useState(false)
  const pendingOrders = orders.filter(
    (o) => !o.glass_order_date && glassLinesFor(o, activeTab, glassAllowances).length > 0,
  )

  const handleGenerateGlassOrder = async () => {
    if (pendingOrders.length === 0) {
      void appAlert('Wszystkie szyby z tej listy są już zamówione — nie ma nic do wygenerowania.')
      return
    }
    setGenerating(true)
    try {
      const lines = pendingOrders.flatMap((o) => glassLinesFor(o, activeTab, glassAllowances))
      generateGlassOrderPdf(lines)
      const ok = await appConfirm(
        `PDF wygenerowany (${lines.length} pozycji z ${pendingOrders.length} zamówień). Oznaczyć te zamówienia jako "szyba zamówiona" z dzisiejszą datą?`,
        { title: 'Zamówienie szyb', confirmLabel: 'Tak, oznacz jako zamówione' },
      )
      if (ok) {
        for (const o of pendingOrders) {
          await onSendGlassOrder(o)
        }
      }
    } finally {
      setGenerating(false)
    }
  }

  // Wiersze z policzonymi wymiarami całkowitymi i wymiarami szyb
  const glassRows = useMemo<GlassRow[]>(() => {
    const tlAllowance = getGlassAllowance(glassAllowances, activeTab, 'top_light')
    const spAllowance = getGlassAllowance(glassAllowances, activeTab, 'side_panel')
    return orders
      .map((order) => {
        const [tlW, tlH] = parseGlassDim(order.top_light)
        const [spAW, spAH] = parseGlassDim(sidePanelARaw(order))
        const [spBW, spBH] = parseGlassDim(order.side_panel_b)
        return {
          order,
          tlTotal: tlW && tlH ? `${tlW}×${tlH}` : '',
          tlGlass: tlW && tlH ? calcGlassDim(tlW, tlH, tlAllowance.w, tlAllowance.h) : '',
          spATotal: spAW && spAH ? `${spAW}×${spAH}` : '',
          spAGlass: spAW && spAH ? calcGlassDim(spAW, spAH, spAllowance.w, spAllowance.h) : '',
          spBTotal: spBW && spBH ? `${spBW}×${spBH}` : '',
          spBGlass: spBW && spBH ? calcGlassDim(spBW, spBH, spAllowance.w, spAllowance.h) : '',
        }
      })
      // tylko zamówienia z prawdziwym wymiarem szyby ("NIE", samo "2080" itp. pomijamy)
      .filter((r) => r.tlTotal || r.spATotal || r.spBTotal)
  }, [orders, activeTab, glassAllowances])

  // Zwykła kolumna tekstowa (nagłówek z klasą col-order-text, td bez klas)
  const textCol = (
    key: string,
    label: string,
    get: (r: GlassRow) => string | number | null | undefined,
    thExtra?: string,
  ): DataTableColumn<GlassRow> => ({
    key,
    label,
    thClassName: thExtra ? `col-order-text ${thExtra}` : 'col-order-text',
    render: (r) => get(r),
    sortValue: get,
  })

  const columns: DataTableColumn<GlassRow>[] = [
    {
      key: 'order_number',
      label: 'NR. ZLECENIA',
      className: 'sticky-col sticky-1 col-order-number',
      render: (r) => r.order.order_number,
      sortValue: (r) => r.order.order_number,
    },
    {
      key: 'company',
      label: 'FIRMA',
      className: 'sticky-col sticky-2 col-company',
      render: (r) => r.order.company,
      sortValue: (r) => r.order.company,
    },
    textCol('order_date', 'DATA', (r) => r.order.order_date, 'col-order-date'),
    textCol('quantity', 'ILOŚĆ', (r) => r.order.quantity),
    textCol('system', 'SYSTEM', (r) => r.order.system),
    textCol('model', 'MODEL', (r) => r.order.model),
    textCol('wing_color', 'KOLOR SKRZYDŁA', (r) => r.order.wing_color, 'col-wing-color'),
    { ...textCol('frame_color', 'KOLOR OŚCIEŻNICY', (r) => r.order.frame_color, 'col-frame-color'), stackUnder: 'wing_color' },
    textCol('width', 'SZEROKOŚĆ', (r) => r.order.width),
    textCol('direction', 'KIERUNEK', (r) => r.order.direction),
    { ...textCol('opening', 'OTWIERANIE', (r) => r.order.opening), stackUnder: 'direction' },
    { ...textCol('height', 'WYSOKOŚĆ', (r) => r.order.height), stackUnder: 'width' },
    textCol('glazing', 'SZKLENIE', (r) => r.order.glazing),
    textCol('tl_glazing', 'SZKLENIE NAŚWIETLA', (r) => r.order.top_light_glazing),
    { ...textCol('tl_total', 'WYMIAR CAŁKOWITY NAŚWIETLA', (r) => r.tlTotal), stackUnder: 'tl_glazing' },
    { ...textCol('tl_glass', 'WYMIAR SZYBY NAŚWIETLA', (r) => r.tlGlass), stackUnder: 'tl_glazing' },
    textCol('spa_glazing', 'SZKLENIE DOSTAWKI A', (r) => r.order.side_panel_a_glazing || r.order.side_panel_glazing),
    { ...textCol('spa_total', 'WYMIAR CAŁKOWITY DOSTAWKI A', (r) => r.spATotal), stackUnder: 'spa_glazing' },
    { ...textCol('spa_glass', 'WYMIAR SZYBY DOSTAWKI A', (r) => r.spAGlass), stackUnder: 'spa_glazing' },
    textCol('spb_glazing', 'SZKLENIE DOSTAWKI B', (r) => r.order.side_panel_b_glazing),
    { ...textCol('spb_total', 'WYMIAR CAŁKOWITY DOSTAWKI B', (r) => r.spBTotal), stackUnder: 'spb_glazing' },
    { ...textCol('spb_glass', 'WYMIAR SZYBY DOSTAWKI B', (r) => r.spBGlass), stackUnder: 'spb_glazing' },
    {
      key: 'glass_order_date',
      label: 'DATA ZAM. SZYBY',
      thClassName: 'col-order-text',
      sortValue: (r) => r.order.glass_order_date,
      render: ({ order }) =>
        order.glass_order_date ? (
          <span className="release-date-value">{order.glass_order_date}</span>
        ) : (
          <button
            type="button"
            className="release-checkbox-btn"
            onClick={() => void handleSend(order)}
            disabled={order.id !== undefined && sendingIds.has(order.id)}
            title="Wyślij zamówienie szyby"
          >
            {order.id !== undefined && sendingIds.has(order.id) ? '…' : '□'}
          </button>
        ),
    },
    {
      key: 'glass_received_date',
      label: 'ODEBRANO',
      thClassName: 'col-order-text',
      sortValue: (r) => r.order.glass_received_date,
      render: ({ order }) =>
        order.glass_received_date ? (
          <span className="release-date-value">{order.glass_received_date}</span>
        ) : (
          <button
            type="button"
            className="release-checkbox-btn"
            onClick={(e) => {
              e.stopPropagation()
              void onGlassReceived(order.id!)
            }}
            title="Oznacz jako odebrane"
          >
            □
          </button>
        ),
    },
  ]

  return (
    <div className="glass-view">
      <div style={{ margin: '0 0 10px', display: 'flex', gap: 10, alignItems: 'center' }}>
        <button
          type="button"
          className="btn btn-sm btn-success"
          disabled={generating || pendingOrders.length === 0}
          onClick={() => void handleGenerateGlassOrder()}
          title="Generuje PDF zamówienia u szklarza ze wszystkich pozycji bez daty zamówienia (pogrupowany po rodzaju szkła)"
        >
          🧾 {generating ? 'Generuję…' : `Zamów szyby (PDF) — ${pendingOrders.length} zam.`}
        </button>
        <span style={{ fontSize: 12, color: 'var(--color-text-muted, #64748b)' }}>
          zbiera wszystkie pozycje bez „Daty zam. szyby"
        </span>
      </div>
      <DataTable
        rows={glassRows}
        rowKey={(r, i) => r.order.id ?? `i-${i}`}
        columns={columns}
        className="glass-table"
        wrapperClassName="orders-table-wrapper"
        tableWrapperRef={tableWrapperRef as MutableRefObject<HTMLDivElement | null>}
        emptyText="Brak zamówień z naświetlami lub dostawkami"
      />
    </div>
  )
}
