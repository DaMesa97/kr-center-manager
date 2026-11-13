// =====================================================================
// Szara plakietka „ark. N" obok numeru zlecenia (#119, Tymek 13.11.2026):
// numer tego zlecenia w arkuszu Excel, gdy różni się od numeru w aplikacji.
// Wiążący dla hali jest numer z aplikacji — plakietka jest informacją, żeby biuro
// (arkusz) i hala (aplikacja) mówiły o tym samym zleceniu. Źródło numeru:
// getSheetNumber (synchronizacja z Excela albo numer z chwili importu).
// =====================================================================
import { memo } from 'react'
import type { Order } from '../types'
import { getSheetNumber, sheetNumberTitle } from '../utils/botOrder'

function SheetNumberBadge({ order }: { order: Order }) {
  const info = getSheetNumber(order)
  if (!info) return null
  return (
    <span
      className={`sheet-no-badge${info.fromImport ? ' sheet-no-badge--import' : ''}`}
      title={sheetNumberTitle(order, info)}
      aria-label={`Numer w arkuszu Excel: ${info.number}`}
    >
      ark. {info.number}
    </span>
  )
}

export default memo(SheetNumberBadge)
