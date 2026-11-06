// =====================================================================
// Legenda kolorów wierszy nad tabelami zleceń (#84, Mariusz 6.11.2026):
// kolumna PILNE zniknęła — pilne widać po tle wiersza, uwagi po żółtym tle.
// Te same klasy/kolory co w App.css (.orders-table-row--*).
// =====================================================================
import { memo } from 'react'

const ITEMS: { cls: string; label: string; title: string }[] = [
  { cls: 'priority', label: 'pilne', title: 'Zlecenie oznaczone jako PILNE (⚡ w kolumnie Akcje) — zawsze na górze listy' },
  { cls: 'notes', label: 'uwagi', title: 'Zlecenie ma wpis w kolumnie UWAGI — przeczytaj przed produkcją' },
  { cls: 'released', label: 'wydane', title: 'Zlecenie z datą wydania (widoczne po włączeniu „pokaż zrealizowane")' },
  { cls: 'cancelled', label: 'anulowane', title: 'Zlecenie anulowane (widoczne po włączeniu „pokaż anulowane")' },
]

function OrdersRowLegend() {
  return (
    <div className="orders-row-legend" aria-label="Legenda kolorów wierszy">
      {ITEMS.map((it) => (
        <span key={it.cls} className="orders-row-legend-item" title={it.title}>
          <span className={`orders-row-legend-swatch orders-row-legend-swatch--${it.cls}`} aria-hidden="true" />
          {it.label}
        </span>
      ))}
    </div>
  )
}

export default memo(OrdersRowLegend)
