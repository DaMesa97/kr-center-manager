// =====================================================================
// Zamawianie — status SKU i sugerowana ilość. Jedno miejsce dla dashboardu
// (ReorderDashboardView); progi min/target przychodzą z bazy (smart ROP albo
// ręczne), tu tylko arytmetyka.
//
// Pozycja zapasu = stan fizyczny + towar w drodze (otwarte ZD). Dzięki temu po
// wygenerowaniu zamówienia SKU nie świeci dalej „PILNE" i nie zamawia się go
// drugi raz. Rezerwacje pod zlecenia NIE są odejmowane: obejmują cały portfel
// otwartych zleceń (miesiące produkcji), a próg smart dotyczy horyzontu czasu
// dostawy — pokazujemy je informacyjnie.
// =====================================================================

export type ReorderStatus = 'no_threshold' | 'critical' | 'observe' | 'ok'

export type ReorderInput = {
  /** stan fizyczny (suma magazynów) */
  stock: number
  /** w drodze — niedostarczone pozycje wysłanych ZD */
  incoming: number
  min: number | null
  target: number | null
  unitsPerPallet: number | null
}

export type ReorderResult = {
  position: number
  status: ReorderStatus
  suggested: number | null
}

/** Zaokrąglenie w górę do pełnych palet, gdy SKU jeździ paletami. */
export function roundToPallets(qty: number, unitsPerPallet: number | null): number {
  if (unitsPerPallet != null && unitsPerPallet > 0) return Math.ceil(qty / unitsPerPallet) * unitsPerPallet
  return qty
}

export function computeReorder({ stock, incoming, min, target, unitsPerPallet }: ReorderInput): ReorderResult {
  const position = stock + Math.max(0, incoming)
  if (min == null) return { position, status: 'no_threshold', suggested: null }

  let status: ReorderStatus = 'ok'
  if (position <= min) status = 'critical'
  else if (position <= min * 1.5) status = 'observe'

  let suggested: number | null = null
  if (status === 'critical' || status === 'observe') {
    // bez targetu: uzupełnij do 4× min (jak dotąd)
    const rawQty = Math.max((target ?? min * 4) - position, 1)
    suggested = Math.max(roundToPallets(rawQty, unitsPerPallet), 1)
  } else if (target != null) {
    // OK: podpowiedź „z wyprzedzeniem" tylko, gdy do targetu czegoś brakuje
    const rawQty = target - position
    if (rawQty > 0) suggested = roundToPallets(rawQty, unitsPerPallet)
  }
  return { position, status, suggested }
}
