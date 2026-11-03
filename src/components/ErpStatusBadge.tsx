import type { ErpFields } from '../lib/erpStatus'
import { erpTooltip, isErpError, isErpOk } from '../lib/erpStatus'

type Props = { order: ErpFields }

/**
 * Plakietka „RO" przy numerze zlecenia: zielona z numerem RO (POMYŚLNY),
 * czerwona „Błąd ERP" (NIEPOMYŚLNY, treść błędu w tooltipie), nic gdy null.
 * Tylko odczyt — status pisze Make, poprawki w Airtable.
 */
export default function ErpStatusBadge({ order }: Props) {
  if (isErpOk(order)) {
    const ro = String(order.erp_ro_number ?? '').trim()
    return (
      <span className="erp-badge erp-badge--ok" title={erpTooltip(order)}>
        {ro ? `RO ${ro.replace(/^ZLEC\//i, '')}` : 'RO ✓'}
      </span>
    )
  }
  if (isErpError(order)) {
    return (
      <span className="erp-badge erp-badge--err" title={erpTooltip(order)}>
        Błąd ERP
      </span>
    )
  }
  return null
}
