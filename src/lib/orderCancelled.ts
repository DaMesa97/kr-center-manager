// D50 (właściciel 28.11: TAK, opcja a): jedno znaczenie „zlecenie anulowane” w całym kodzie —
// extra_fields.cancelled === true (tylko wartość logiczna true; tak zapisuje aplikacja i baza: 352 × true, 1 × false).
// Wcześniej część kodu przyjmowała też tekst 'true' (useExcelSync, shipments), a parseOrderExtraFields — Boolean(),
// więc 'false' albo 1 dawały „anulowane”. Moduł neutralny (bez zależności) — dawniej funkcja siedziała w module Optimy.

/** Anulowane wg samego extra_fields (obiekt albo cokolwiek z bazy). */
export function isExtraCancelled(extra: unknown): boolean {
  return typeof extra === 'object' && extra !== null && !Array.isArray(extra) && (extra as Record<string, unknown>).cancelled === true
}

/** Zlecenie anulowane: extra_fields.cancelled === true. */
export function isOrderCancelled(o: { extra_fields?: unknown } | null | undefined): boolean {
  return isExtraCancelled(o?.extra_fields)
}
