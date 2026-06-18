import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import OrderPhotos from './OrderPhotos'
import type { GlassAllowance, Order, ToastVariant } from '../types'
import { CATEGORY_LABELS } from '../constants'
import {
  calcGlassIssueDim,
  countCompletedStages,
  isRushOrderSequence,
  isOrderReadyToInvoice,
  isReleaseDateEmpty,
} from '../utils'

const PART_LABELS: Record<string, string> = {
  wing: 'Skrzydło',
  frame: 'Ościeżnica',
  hardware: 'Okucia bazowe',
  fittings: 'Okucia wykończeniowe',
  handle: 'Pochwyt',
  peephole: 'Wizjer',
  electric_strike: 'Elektrozaczep',
  glazing: 'Szklenie',
  decorative_panel: 'Panel dekoracyjny',
  other: 'Inne',
  top_light_glass: 'Szyba naświetla',
  side_panel_a_glass: 'Szyba dostawki A',
  side_panel_b_glass: 'Szyba dostawki B',
}
const partLabel = (p: string) => PART_LABELS[p] ?? p

type Props = {
  open: boolean
  order: Order | null
  companyInfo: { production_day: string; route_day: string } | null
  glassAllowances: GlassAllowance[]
  currentUserId?: string
  currentUserInitials?: string
  pushToast?: (msg: string, variant: ToastVariant) => void
  onClose: () => void
}

function ShippingDetailsModal({ open, order, companyInfo, glassAllowances, currentUserId, currentUserInitials, pushToast, onClose }: Props) {
  // Zamknij przez Esc
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open || !order) return null

  const { completed, total, percent, stages } = countCompletedStages(order)
  const isUrgent = isRushOrderSequence(order.sequence)
  const isReady = isOrderReadyToInvoice(order)
  const released = !isReleaseDateEmpty(order.release_date)
  const issues = order.stock_issues ?? []
  const onlyGlass = issues.length > 0 && issues.every((i) => i.type === 'glass_not_received')
  const onlyMissing = issues.length > 0 && issues.every((i) => i.type === 'missing_recipe')

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="shipping-details-modal" onClick={(e) => e.stopPropagation()}>
        <div className="shipping-details-header">
          <h2>
            Zamówienie nr {order.order_number}
            {isUrgent && <span className="shipping-details-urgent-badge">PILNE</span>}
            {isReady && <span className="shipping-details-ready-badge">GOTOWE DO FAKTUROWANIA</span>}
          </h2>
          <button className="btn btn-icon btn-ghost" onClick={onClose}>
            X
          </button>
        </div>

        <div className="shipping-details-body">
          {/* Sekcja: Dane podstawowe */}
          <section className="shipping-details-section">
            <h3>Dane podstawowe</h3>
            <div className="shipping-details-grid">
              <div>
                <strong>Kategoria:</strong>{' '}
                {CATEGORY_LABELS[order.category as keyof typeof CATEGORY_LABELS] ?? order.category}
              </div>
              <div>
                <strong>Firma:</strong> {order.company}
              </div>
              <div>
                <strong>Ilość sztuk:</strong> {order.quantity}
              </div>
              <div>
                <strong>Nr zamówienia klienta:</strong> {order.client_order_number || '—'}
              </div>
              <div>
                <strong>System:</strong> {order.system || '—'}
              </div>
              <div>
                <strong>Model:</strong> {order.model || '—'}
              </div>
            </div>
          </section>

          {/* Sekcja: Logistyka */}
          <section className="shipping-details-section">
            <h3>Logistyka</h3>
            <div className="shipping-details-grid">
              <div>
                <strong>Dzień produkcji:</strong>{' '}
                {order.production_day || companyInfo?.production_day || '—'}
              </div>
              <div>
                <strong>Dzień trasy:</strong> {companyInfo?.route_day || '—'}
              </div>
            </div>
          </section>

          {/* Sekcja: Daty */}
          <section className="shipping-details-section">
            <h3>Daty</h3>
            <div className="shipping-details-grid">
              <div>
                <strong>Data zamówienia:</strong> {order.order_date || '—'}
              </div>
              <div>
                <strong>Data wydania:</strong> {released ? String(order.release_date) : '—'}
              </div>
              <div>
                <strong>Zamówienie szkła:</strong> {order.glass_order_date || '—'}
              </div>
              <div>
                <strong>Otrzymanie szkła:</strong> {order.glass_received_date || '—'}
              </div>
            </div>
          </section>

          {/* Sekcja: Etapy produkcji */}
          {total > 0 && (
            <section className="shipping-details-section">
              <h3>
                Etapy produkcji ({completed}/{total} — {percent}%)
              </h3>
              <div className="shipping-progress-bar" style={{ width: '100%', marginBottom: 12 }}>
                <div
                  className="shipping-progress-bar-fill"
                  style={{
                    width: `${percent}%`,
                    background: percent === 100 ? '#10b981' : '#3b82f6',
                  }}
                />
              </div>
              <ul className="shipping-details-stages">
                {stages.map((stage) => (
                  <li
                    key={stage.key}
                    className={stage.done ? 'shipping-details-stage--done' : 'shipping-details-stage--todo'}
                  >
                    <span className="shipping-details-stage-icon">{stage.done ? '✓' : '○'}</span>
                    <strong>{stage.header}</strong> — {stage.title}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Sekcja: Braki magazynowe */}
          {order.stock_status && order.stock_status !== 'ok' && (
            <section className="shipping-details-section shipping-details-section--warning">
              <h3>⚠ {onlyGlass ? 'Brak szkła' : onlyMissing ? 'Brak pasujących receptur' : 'Braki i problemy'}</h3>

              <ul className="shipping-details-issues-list">
                {issues.map((i, idx) => {
                  if (i.type === 'missing_recipe') {
                    return (
                      <li key={idx}>
                        <strong>Brak receptury</strong>
                        <div className="shipping-details-issue-detail">część: {partLabel(i.part)}</div>
                      </li>
                    )
                  }
                  if (i.type === 'glass_not_received') {
                    const dim = calcGlassIssueDim(i, order.category ?? '', glassAllowances)
                    return (
                      <li key={idx}>
                        <strong>{partLabel(i.part)}</strong>
                        <div className="shipping-details-issue-detail">
                          szyba nie została odebrana
                          {i.glazing && ` · szklenie: ${i.glazing}`}
                          {dim && (
                            <>
                              <br />
                              wymiar: {dim.rawDim} · szyba: {dim.glassDim}
                            </>
                          )}
                        </div>
                      </li>
                    )
                  }
                  return (
                    <li key={idx}>
                      <strong>{i.component_name ?? '—'}</strong>
                      <div className="shipping-details-issue-detail">
                        {i.component_code && `${i.component_code} · `}
                        brakuje {i.shortage ?? 0} szt · magazyn: {i.warehouse ?? '—'} · część:{' '}
                        {partLabel(i.part)}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          {/* Sekcja: Uwagi */}
          {order.notes && (
            <section className="shipping-details-section">
              <h3>Uwagi</h3>
              <p style={{ whiteSpace: 'pre-wrap' }}>{order.notes}</p>
            </section>
          )}

          {/* Sekcja: Foto-dokumentacja */}
          {order.id !== undefined && (
            <section className="shipping-details-section">
              <h3>Foto-dokumentacja</h3>
              <OrderPhotos
                orderId={order.id}
                currentUserId={currentUserId ?? ''}
                currentUserInitials={currentUserInitials ?? ''}
                pushToast={pushToast}
              />
            </section>
          )}
        </div>

        <div className="shipping-details-footer">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Zamknij
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default ShippingDetailsModal
