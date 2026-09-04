import type { StockPreviewSummary } from '../lib/stockPreview'
import { formatEtaShort } from '../lib/stockPreview'

/**
 * Żółty baner ostrzegawczy w formularzu zamówienia (tryb tworzenia).
 * Pokazuje braki magazynowe / brakujące receptury — NIGDY nie blokuje
 * zapisu (rezerwacja może zejść na minus, to sygnał planistyczny).
 */
function StockWarningBanner({ summary, loading }: { summary: StockPreviewSummary | null; loading: boolean }) {
  if (loading || !summary || !summary.hasWarnings) return null

  return (
    <div
      style={{
        margin: '8px 16px 0',
        padding: '10px 14px',
        background: '#fef9c3',
        border: '1px solid #eab308',
        borderRadius: 8,
        fontSize: 13,
        color: '#713f12',
      }}
    >
      {summary.noRecipe ? (
        <div>
          ⚠️ <strong>Brak pasujących receptur</strong> — zamówienie zapisze się bez rezerwacji magazynowej.
        </div>
      ) : (
        <>
          {summary.shortages.length > 0 && (
            <div>
              ⚠️ <strong>Braki magazynowe</strong> (zamówienie i tak można zapisać — rezerwacja zejdzie na minus):
              <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                {summary.shortages.map((s) => (
                  <li key={`${s.r_component_id}-${s.r_part}`}>
                    {s.r_component_name}
                    {s.r_component_code &&
                    !(s.r_component_name ?? '').toUpperCase().includes(s.r_component_code.toUpperCase())
                      ? ` (${s.r_component_code})`
                      : ''}{' '}
                    — brakuje{' '}
                    <strong>{s.r_shortage}</strong>
                    {s.r_incoming_qty > 0 && (
                      <>
                        {' '}
                        · w drodze {s.r_incoming_qty}
                        {s.r_earliest_eta ? ` (ETA ${formatEtaShort(s.r_earliest_eta)})` : ''}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {summary.missingParts.length > 0 && (
            <div style={{ marginTop: summary.shortages.length > 0 ? 6 : 0 }}>
              ⚠️ Brak receptury dla: <strong>{summary.missingParts.join(', ')}</strong>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default StockWarningBanner
