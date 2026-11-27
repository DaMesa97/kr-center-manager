// Licznik alertów magazynu w menu (get_stock_alerts_summary).
//
// 26.11.2026: ta funkcja była najcięższym zapytaniem bazy — 3,5 tys. wywołań po ~0,5 s
// w 6,5 godziny, bo każdy kierownik z otwartą aplikacją wołał ją co 5 minut ORAZ po każdej
// serii zdarzeń realtime magazynu (każde wydanie etapu = seria UPDATE stanów). Stąd:
//  - jedna odpowiedź jest ważna ALERTS_BADGE_TTL_MS (badge może być o kilkanaście sekund w tyle),
//  - równoległe wywołania dzielą jedno zapytanie (in-flight),
//  - w bazie funkcja oddaje wynik z pamięci (tabela stock_alerts_summary_cache) przez 60 s dla całej
//    firmy; `fresh` (po własnym PZ / MM) = p_fresh: true, liczy od nowa (migracja wydajnosc_2026_11_26).

export const ALERTS_BADGE_TTL_MS = 15_000

type SummaryRow = { r_total_needs_attention?: unknown }

/** Liczba „wymaga uwagi” z odpowiedzi RPC (tablica albo pojedynczy wiersz); null = brak danych. */
export function parseAlertsSummary(data: unknown): number | null {
  const arr = Array.isArray(data) ? data : data != null ? [data] : []
  const row = arr[0] as SummaryRow | undefined
  if (!row) return null
  const n = Number(row.r_total_needs_attention ?? 0)
  return Number.isFinite(n) ? n : 0
}

let cached: { at: number; value: number } | null = null
let inFlight: Promise<number | null> | null = null
/** Numer najnowszego zapytania — spóźniona odpowiedź starszego (np. zwykłe sprzed PZ) nie nadpisuje świeżej. */
let seq = 0

/**
 * Zwraca licznik z pamięci, jeśli ostatni odczyt jest młodszy niż TTL; w przeciwnym razie woła `load`
 * (jedno zapytanie na raz — kolejne wywołania w trakcie dostają tę samą obietnicę).
 */
export function alertsBadgeThrottled(
  load: (fresh: boolean) => Promise<number | null>,
  opts: { fresh?: boolean; now?: number } = {},
): Promise<number | null> {
  const now = opts.now ?? Date.now()
  const fresh = opts.fresh === true
  if (!fresh && cached && now - cached.at < ALERTS_BADGE_TTL_MS) return Promise.resolve(cached.value)
  if (!fresh && inFlight) return inFlight
  const moje = ++seq
  const p = load(fresh)
    .then((value) => {
      if (moje === seq && value != null) cached = { at: Date.now(), value }
      // starsza odpowiedź: zwracamy wartość wołającemu, ale pamięć zostaje przy nowszej
      return moje === seq || !cached ? value : cached.value
    })
    .finally(() => {
      if (inFlight === p) inFlight = null
    })
  inFlight = p
  return p
}

/** Tylko testy. */
export function resetAlertsBadgeForTests(): void {
  cached = null
  inFlight = null
  seq = 0
}
