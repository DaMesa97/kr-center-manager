// Podsumowanie przeliczenia rezerwacji po zmianie receptury (useWarehouse.runRebuildNow).
// D15 (28.11): zlecenia w produkcji (coś już zeszło) baza z migracją 20261128030400 przelicza tylko
// w niezrobionych etapach (partial); stara baza je pomija (skipped).
export type RebuildTotals = { rebuilt: number; partial: number; skipped: number; failed: number; failedOrders: string[] }

export function rebuildSummary(category: string, t: RebuildTotals): { text: string; variant: 'success' | 'info' | 'error' } {
  const parts = [`Przeliczono rezerwacje ${t.rebuilt} zleceń ${category}`]
  if (t.partial > 0) parts.push(`w tym ${t.partial} w produkcji — tylko niezrobione etapy`)
  if (t.skipped > 0) parts.push(`${t.skipped} pominięto (już coś wydano z magazynu — skoryguj ręcznie)`)
  if (t.failed > 0) parts.push(`${t.failed} z błędem: ${t.failedOrders.slice(0, 3).join('; ')}`)
  return { text: parts.join(' · '), variant: t.failed > 0 ? 'error' : t.skipped > 0 ? 'info' : 'success' }
}
