import type { ErpFields } from '../lib/erpStatus'
import { erpStatusLabel, fmtErpDate, hasErpInfo, isErpError, isErpOk } from '../lib/erpStatus'

type Props = { order: ErpFields | null | undefined }

/**
 * Sekcja „Optima" w oknie zlecenia: numer RO, status, błąd, data. Tylko odczyt
 * (kolumny erp_* pisze Make; poprawki robi się w Airtable → „Ponów wysyłkę").
 * Nie pokazuje się, gdy zlecenie nie ma żadnej informacji z Optimy.
 */
export default function OrderErpSection({ order }: Props) {
  if (!order || !hasErpInfo(order)) return null
  const ok = isErpOk(order)
  const err = isErpError(order)
  return (
    <section className={`bot-origin-section erp-section ${err ? 'erp-section--err' : ok ? 'erp-section--ok' : ''}`}>
      <h3>🧾 Optima (RO)</h3>
      <div className="bot-origin-grid">
        <div>
          <strong>Status:</strong>{' '}
          <span className={`erp-badge ${err ? 'erp-badge--err' : ok ? 'erp-badge--ok' : 'erp-badge--none'}`}>
            {err ? 'Błąd ERP' : ok ? 'RO założone' : 'brak'}
          </span>{' '}
          <span className="muted">{erpStatusLabel(order)}</span>
        </div>
        <div>
          <strong>Numer RO:</strong> {String(order.erp_ro_number ?? '').trim() || '—'}
        </div>
        <div>
          <strong>Aktualizacja:</strong> {fmtErpDate(order.erp_updated_at)}
        </div>
        {err && (
          <div className="erp-section-error">
            <strong>Błąd:</strong> {String(order.erp_error ?? '').trim() || 'Make nie podał treści błędu'}
            <div className="muted erp-section-hint">
              Poprawka po stronie Airtable: interfejs „Błędy automatyzacji (Optima)" → „Ponów wysyłkę". Aplikacja tych pól nie edytuje.
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
