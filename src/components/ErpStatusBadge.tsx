import type { ErpFields } from '../lib/erpStatus'
import { erpTooltip, isErpError, isErpOk } from '../lib/erpStatus'

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
 * czerwona „Błąd ERP" (NIEPOMYŚLNY, treść błędu w tooltipie), nic gdy null.
 * Tylko odczyt — status pisze Make, poprawki w Airtable / „Ponów wysyłkę".
 */
export default function ErpStatusBadge({ order, inline = false }: Props) {
  const mod = inline ? ' erp-badge--inline' : ''
  if (isErpOk(order)) {
    const ro = shortRoNumber(order.erp_ro_number)
    return (
      <span className={`erp-badge erp-badge--ok${mod}`} title={erpTooltip(order)}>
        <span className="erp-badge-tag">RO</span>
        {ro || '✓'}
      </span>
    )
  }
  if (isErpError(order)) {
    return (
      <span className={`erp-badge erp-badge--err${mod}`} title={erpTooltip(order)}>
        <span className="erp-badge-tag">RO</span>
        błąd
      </span>
    )
  }
  return null
}
