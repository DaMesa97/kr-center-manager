// =====================================================================
// Legenda kolorów wierszy nad tabelami zleceń (#84, Mariusz 6.11.2026):
// kolumna PILNE zniknęła — pilne widać po tle wiersza, uwagi po żółtym tle.
// Te same klasy/kolory co w App.css (.orders-table-row--*).
//
// Pozycje „pilne" i „uwagi" są przełącznikami (Tymek 7.11): klik gasi dane
// podświetlenie na TYM komputerze (localStorage), tabela zostaje biała.
// Działa przez klasę na <html> (hl-off-priority / hl-off-notes), więc obejmuje
// każdą tabelę zleceń bez przekazywania ustawienia przez propsy.
// =====================================================================
import { memo, useCallback, useEffect, useState } from 'react'

type ToggleKey = 'priority' | 'notes' | 'problem'
const STORAGE_KEY = 'kr-row-highlights-off'
const TOGGLABLE: ToggleKey[] = ['priority', 'notes', 'problem']

const readOff = (): Set<ToggleKey> => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    return new Set(Array.isArray(arr) ? arr.filter((k): k is ToggleKey => TOGGLABLE.includes(k as ToggleKey)) : [])
  } catch {
    return new Set()
  }
}

const applyOff = (off: Set<ToggleKey>) => {
  const root = document.documentElement
  for (const k of TOGGLABLE) root.classList.toggle(`hl-off-${k}`, off.has(k))
}

// Przy starcie aplikacji (import modułu) — żeby Wysyłka/Moje stanowisko też
// respektowały ustawienie, zanim ktoś wejdzie w zakładkę ze zleceniami.
if (typeof document !== 'undefined') applyOff(readOff())

const ITEMS: { cls: string; label: string; title: string; toggle?: ToggleKey }[] = [
  { cls: 'priority', label: 'pilne', toggle: 'priority', title: 'Zlecenie oznaczone jako PILNE (⚡ w kolumnie Akcje) — zawsze na górze listy' },
  { cls: 'notes', label: 'uwagi', toggle: 'notes', title: 'Zlecenie ma wpis w kolumnie UWAGI — przeczytaj przed produkcją' },
  { cls: 'problem', label: 'problem / ⚠️', toggle: 'problem', title: 'Zlecenie oznaczone jako PROBLEM (pomarańczowe ⚠ za numerem — powód, kto i kiedy; ustawia hala z Mojego stanowiska albo kierownik z menu ⋯) oraz żółte ⚠️ „wymaga weryfikacji" po imporcie z Excela/bota. Wyłączenie chowa je tylko na tym komputerze — zlecenia i zakładka Weryfikacja bez zmian' },
  { cls: 'released', label: 'wydane', title: 'Zlecenie z datą wydania (widoczne po włączeniu „pokaż zrealizowane")' },
  { cls: 'cancelled', label: 'anulowane', title: 'Zlecenie anulowane (widoczne po włączeniu „pokaż anulowane")' },
]

function OrdersRowLegend() {
  const [off, setOff] = useState<Set<ToggleKey>>(() => readOff())

  useEffect(() => {
    applyOff(off)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...off]))
    } catch {
      /* prywatne okno / brak storage — ustawienie działa do odświeżenia */
    }
  }, [off])

  const toggle = useCallback((k: ToggleKey) => {
    setOff((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }, [])

  return (
    <div className="orders-row-legend" aria-label="Legenda kolorów wierszy">
      {ITEMS.map((it) =>
        it.toggle ? (
          <button
            key={it.cls}
            type="button"
            className={`orders-row-legend-item orders-row-legend-item--toggle${off.has(it.toggle) ? ' orders-row-legend-item--off' : ''}`}
            aria-pressed={!off.has(it.toggle)}
            onClick={() => toggle(it.toggle!)}
            title={`${it.title}. Klik ${off.has(it.toggle) ? 'włącza' : 'wyłącza'} to podświetlenie na tym komputerze.`}
          >
            <span className={`orders-row-legend-swatch orders-row-legend-swatch--${it.cls}`} aria-hidden="true" />
            {it.label}
            {off.has(it.toggle) && <span className="orders-row-legend-offmark"> (wył.)</span>}
          </button>
        ) : (
          <span key={it.cls} className="orders-row-legend-item" title={it.title}>
            <span className={`orders-row-legend-swatch orders-row-legend-swatch--${it.cls}`} aria-hidden="true" />
            {it.label}
          </span>
        ),
      )}
    </div>
  )
}

export default memo(OrdersRowLegend)
