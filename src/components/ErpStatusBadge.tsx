import { createPortal } from 'react-dom'
import type { ErpFields } from '../lib/erpStatus'
import { erpStatusLabel, erpTooltip, isErpError, isErpOk } from '../lib/erpStatus'
import { useClickTooltip } from '../lib/useClickTooltip'

type Props = {
  order: ErpFields
  /** w jednej linii z numerem (Wysyłka); domyślnie osobna linijka pod numerem jak „ZREALIZOWANE" */
  inline?: boolean
}

/** Numer RO bez przedrostka dokumentu: ZLEC/231/11/2026 → 231/11/2026 */
export const shortRoNumber = (ro: string | null | undefined): string =>
  String(ro ?? '')
    .trim()
    .replace(/^[A-ZĄĆĘŁŃÓŚŹŻ]+\//i, '')

/**
 * Plakietka „RO" przy numerze zlecenia: zielona z numerem RO (POMYŚLNY),
 * czerwona „błąd" (NIEPOMYŚLNY), nic gdy null.
 * Szczegóły (status, pełny numer, treść błędu, data) w dymku otwieranym
 * KLIKIEM — tak samo jak dymek niedoboru magazynowego obok (#82: spójność,
 * bez czekania na natywny tooltip).
 * Tylko odczyt — status pisze Make, poprawki w Airtable / „Ponów wysyłkę".
 */
export default function ErpStatusBadge({ order, inline = false }: Props) {
  const { open, pos, triggerRef, tooltipRef, toggle, close } = useClickTooltip<HTMLSpanElement>()
  const ok = isErpOk(order)
  const err = isErpError(order)
  if (!ok && !err) return null

  const mod = inline ? ' erp-badge--inline' : ''
  const ro = shortRoNumber(order.erp_ro_number)
  // pierwsza linia = tytuł, reszta = szczegóły
  const [, ...details] = erpTooltip(order).split('\n')

  return (
    <>
      <span
        ref={triggerRef}
        className={`erp-badge ${ok ? 'erp-badge--ok' : 'erp-badge--err'}${mod}`}
        title="Kliknij, żeby zobaczyć szczegóły"
        onClick={toggle}
      >
        <span className="erp-badge-tag">RO</span>
        {ok ? ro || '✓' : 'błąd'}
      </span>
      {open &&
        createPortal(
          <div
            ref={tooltipRef}
            className={`stock-badge-tooltip stock-badge-tooltip--click erp-tooltip${err ? ' erp-tooltip--err' : ''}`}
            style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 10000 }}
            onClick={(e) => e.stopPropagation()}
            data-no-esc-close
          >
            <button
              type="button"
              className="stock-badge-tooltip-close"
              aria-label="Zamknij"
              title="Zamknij"
              onClick={(e) => {
                e.stopPropagation()
                close()
              }}
            >
              ×
            </button>
            <div className="stock-badge-tooltip-title erp-tooltip-title">Optima: {erpStatusLabel(order)}</div>
            <ul className="stock-badge-tooltip-list">
              {details.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </div>,
          document.body,
        )}
    </>
  )
}
