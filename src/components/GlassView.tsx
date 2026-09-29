import { useState, type RefObject } from 'react'
import type { GlassAllowance, Order } from '../types'
import { calcGlassDim, getGlassAllowance } from '../utils'
import { generateGlassOrderPdf, type GlassOrderLine } from '../utils/glassOrderPdfGenerator'
import { appAlert, appConfirm } from '../lib/appDialogs'

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
    const [w, h] = String(raw ?? '').split('×').map((v) => parseInt(v) || 0)
    return w && h ? calcGlassDim(w, h, aw.w, aw.h) : ''
  }

  const tl = dim(order.top_light, tlAllowance)
  if (tl) lines.push({ ...base, element: 'Naświetle', glazing: String(order.top_light_glazing ?? '').trim(), glassDim: tl })
  const spA = dim(order.side_panel_a || order.side_panel, spAllowance)
  if (spA) lines.push({ ...base, element: 'Dostawka A', glazing: String(order.side_panel_a_glazing || order.side_panel_glazing || '').trim(), glassDim: spA })
  const spB = dim(order.side_panel_b, spAllowance)
  if (spB) lines.push({ ...base, element: 'Dostawka B', glazing: String(order.side_panel_b_glazing ?? '').trim(), glassDim: spB })
  return lines
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
    (o) =>
      (o.top_light || o.side_panel_a || o.side_panel || o.side_panel_b) &&
      !o.glass_order_date &&
      glassLinesFor(o, activeTab, glassAllowances).length > 0,
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
      <div className="table-wrapper orders-table-wrapper" ref={tableWrapperRef}>
        <table className="orders-table glass-table">
          <thead>
            <tr>
              <th className="sticky-col sticky-1 col-order-number">NR. ZLECENIA</th>
              <th className="sticky-col sticky-2 col-company">FIRMA</th>
              <th className="col-order-text col-order-date">DATA</th>
              <th className="col-order-text">ILOŚĆ</th>
              <th className="col-order-text">SYSTEM</th>
              <th className="col-order-text">MODEL</th>
              <th className="col-order-text col-wing-color">KOLOR SKRZYDŁA</th>
              <th className="col-order-text col-frame-color">KOLOR OŚCIEŻNICY</th>
              <th className="col-order-text">SZEROKOŚĆ</th>
              <th className="col-order-text">KIERUNEK</th>
              <th className="col-order-text">OTWIERANIE</th>
              <th className="col-order-text">WYSOKOŚĆ</th>
              <th className="col-order-text">SZKLENIE</th>
              <th className="col-order-text">SZKLENIE NAŚWIETLA</th>
              <th className="col-order-text">WYMIAR CAŁKOWITY NAŚWIETLA</th>
              <th className="col-order-text">WYMIAR SZYBY NAŚWIETLA</th>
              <th className="col-order-text">SZKLENIE DOSTAWKI A</th>
              <th className="col-order-text">WYMIAR CAŁKOWITY DOSTAWKI A</th>
              <th className="col-order-text">WYMIAR SZYBY DOSTAWKI A</th>
              <th className="col-order-text">SZKLENIE DOSTAWKI B</th>
              <th className="col-order-text">WYMIAR CAŁKOWITY DOSTAWKI B</th>
              <th className="col-order-text">WYMIAR SZYBY DOSTAWKI B</th>
              <th className="col-order-text">DATA ZAM. SZYBY</th>
              <th className="col-order-text">ODEBRANO</th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              const glassOrders = orders.filter(
                (o) => o.top_light || o.side_panel_a || o.side_panel || o.side_panel_b,
              )

              if (glassOrders.length === 0) {
                return (
                  <tr>
                    <td colSpan={24} style={{ textAlign: 'center', padding: '2rem', color: '#888' }}>
                      Brak zamówień z naświetlami lub dostawkami
                    </td>
                  </tr>
                )
              }

              return glassOrders.map((order) => {
                const tlAllowance = getGlassAllowance(glassAllowances, activeTab, 'top_light')
                const spAllowance = getGlassAllowance(glassAllowances, activeTab, 'side_panel')

                const tlParts = String(order.top_light ?? '').split('×')
                const tlW = parseInt(tlParts[0] ?? '0') || 0
                const tlH = parseInt(tlParts[1] ?? '0') || 0
                const tlTotal = tlW && tlH ? `${tlW}×${tlH}` : ''
                const tlGlass = tlW && tlH ? calcGlassDim(tlW, tlH, tlAllowance.w, tlAllowance.h) : ''

                const spA = String(order.side_panel_a || order.side_panel || '').split('×')
                const spAW = parseInt(spA[0] ?? '0') || 0
                const spAH = parseInt(spA[1] ?? '0') || 0
                const spATotal = spAW && spAH ? `${spAW}×${spAH}` : ''
                const spAGlass =
                  spAW && spAH ? calcGlassDim(spAW, spAH, spAllowance.w, spAllowance.h) : ''

                const spB = String(order.side_panel_b ?? '').split('×')
                const spBW = parseInt(spB[0] ?? '0') || 0
                const spBH = parseInt(spB[1] ?? '0') || 0
                const spBTotal = spBW && spBH ? `${spBW}×${spBH}` : ''
                const spBGlass =
                  spBW && spBH ? calcGlassDim(spBW, spBH, spAllowance.w, spAllowance.h) : ''

                return (
                  <tr key={order.id}>
                    <td className="sticky-col sticky-1 col-order-number">{order.order_number}</td>
                    <td className="sticky-col sticky-2 col-company">{order.company}</td>
                    <td>{order.order_date}</td>
                    <td>{order.quantity}</td>
                    <td>{order.system}</td>
                    <td>{order.model}</td>
                    <td>{order.wing_color}</td>
                    <td>{order.frame_color}</td>
                    <td>{order.width}</td>
                    <td>{order.direction}</td>
                    <td>{order.opening}</td>
                    <td>{order.height}</td>
                    <td>{order.glazing}</td>
                    <td>{order.top_light_glazing}</td>
                    <td>{tlTotal}</td>
                    <td>{tlGlass}</td>
                    <td>{order.side_panel_a_glazing || order.side_panel_glazing}</td>
                    <td>{spATotal}</td>
                    <td>{spAGlass}</td>
                    <td>{order.side_panel_b_glazing}</td>
                    <td>{spBTotal}</td>
                    <td>{spBGlass}</td>
                    <td>
                      {order.glass_order_date ? (
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
                      )}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {order.glass_received_date ? (
                        <span className="release-date-value">{order.glass_received_date}</span>
                      ) : (
                        <button
                          type="button"
                          className="release-checkbox-btn"
                          onClick={() => void onGlassReceived(order.id!)}
                          title="Oznacz jako odebrane"
                        >
                          □
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })
            })()}
          </tbody>
        </table>
      </div>
    </div>
  )
}
