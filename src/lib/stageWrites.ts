// =====================================================================
// Rejestr świeżych LOKALNYCH zapisów etapów (optimistic update w locie).
//
// Po co: merge realtime w App.tsx chronił lokalnie wypełniony etap przed
// nadpisaniem pustą wartością z serwera (race: klik → lokalny zapis →
// zanim RPC się zapisze, przychodzi broadcast cudzej zmiany ze starym
// stanem etapów). Ale chronił BEZWARUNKOWO — przez co celowe COFNIĘCIE
// etapu przez kierownika nigdy nie docierało do innych stanowisk (lokalna
// niepusta wartość zawsze wygrywała aż do pełnego refetchu).
//
// Teraz: ochrona działa tylko przez chwilę po własnym kliknięciu
// (TTL poniżej) — dokładnie na okno race'a. Po TTL serwer jest źródłem
// prawdy, więc cofnięcia się propagują.
// =====================================================================

const TTL_MS = 15_000

// klucz: `${orderId}:${stageKey}` → timestamp zapisu
const recent = new Map<string, number>()

export function markLocalStageWrite(orderId: number | null | undefined, stageKey: string): void {
  if (orderId == null) return
  recent.set(`${orderId}:${stageKey}`, Date.now())
  // leniwe sprzątanie — mapa nie rośnie bez końca przy długiej sesji
  if (recent.size > 500) {
    const cutoff = Date.now() - TTL_MS
    for (const [k, t] of recent) if (t < cutoff) recent.delete(k)
  }
}

export function hasRecentLocalStageWrite(orderId: number | null | undefined, stageKey: string): boolean {
  if (orderId == null) return false
  const t = recent.get(`${orderId}:${stageKey}`)
  return t != null && Date.now() - t < TTL_MS
}

/**
 * Etapy z realtime scalone z lokalnymi: lokalnie wypełniony etap wygrywa
 * z pustą wartością z serwera TYLKO w oknie TTL po własnym kliknięciu.
 */
export function mergeIncomingStages(
  orderId: number | null | undefined,
  local: unknown,
  remote: unknown,
): Record<string, string> {
  const localStages = (local ?? {}) as Record<string, string>
  const merged: Record<string, string> = { ...((remote ?? {}) as Record<string, string>) }
  for (const [k, v] of Object.entries(localStages)) {
    if (v?.trim() && !merged[k]?.trim() && hasRecentLocalStageWrite(orderId, k)) merged[k] = v
  }
  return merged
}
