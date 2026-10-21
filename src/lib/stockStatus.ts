// Status półki w widoku Stanów (czysta logika — testowana w __tests__/stockStatus.test.ts).
//  minus         — stan fizyczny < 0 (błąd ewidencji)
//  overreserved  — rezerwacje > stan (dostępne < 0): pod zlecenia już brakuje — krytyczne
//  low           — stan poniżej minimum
//  ok

export type StockStatus = 'ok' | 'low' | 'overreserved' | 'minus'

// ranga do sortowania: minus (najgorszy) → nadrezerwacja → niski → OK
export function stockStatusRank(s: StockStatus): number {
  return s === 'minus' ? 0 : s === 'overreserved' ? 1 : s === 'low' ? 2 : 3
}

export function stockStatusLabel(s: StockStatus): string {
  if (s === 'ok') return 'OK'
  if (s === 'low') return 'Niski'
  if (s === 'overreserved') return 'Nadrezerwacja'
  return 'Minus'
}

export function stockStatusColor(s: StockStatus): string {
  return s === 'ok' ? '#2e7d32' : s === 'low' ? '#f9a825' : '#c62828'
}

/**
 * @param quantity    stan fizyczny
 * @param reserved    zarezerwowane pod zlecenia
 * @param min         minimalny stan (null = brak progu)
 * @param minAvailable najniższe "dostępne" per magazyn (widok zbiorczy: nadrezerwacja
 *                     w jednym magazynie nie znika, bo w drugim leży zapas). Domyślnie
 *                     quantity − reserved.
 */
export function computeStockStatus(
  quantity: number,
  reserved: number | null | undefined,
  min: number | null | undefined,
  minAvailable?: number,
): StockStatus {
  if (quantity < 0) return 'minus'
  const available = minAvailable ?? quantity - Number(reserved ?? 0)
  if (available < 0) return 'overreserved'
  if (min == null) return 'ok'
  if (quantity >= min) return 'ok'
  return 'low'
}
