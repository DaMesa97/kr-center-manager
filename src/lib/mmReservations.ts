// D16 (28.11): MM towaru zarezerwowanego — pytanie „przenieść też rezerwacje N zleceń?”.
// Baza (migracja 20261128030300): podglad_rezerwacji_mm mówi, które rezerwacje po przesunięciu nie zmieściłyby
// się w stanie źródła; create_mm_document(..., p_move_reservations) przenosi je razem z towarem.
// Bez migracji podgląd zwraca błąd → nie pytamy, MM jak dotąd.

export type MmReservationPreview = { component_id: number; orders: number; reservations: number; quantity: number }

export function parseMmReservationPreview(data: unknown): MmReservationPreview[] {
  if (!Array.isArray(data)) return []
  return data
    .map((r) => {
      const o = r as Record<string, unknown>
      return {
        component_id: Number(o.r_component_id),
        orders: Number(o.r_orders ?? 0),
        reservations: Number(o.r_reservations ?? 0),
        quantity: Number(o.r_quantity ?? 0),
      }
    })
    .filter((r) => Number.isFinite(r.component_id) && r.reservations > 0 && r.quantity > 0)
}

/** Treść pytania; N = suma zleceń po pozycjach (to samo zlecenie przy dwóch pozycjach liczy się dwa razy). */
export function mmReservationPrompt(rows: MmReservationPreview[], nameOf: (componentId: number) => string): string {
  const orders = rows.reduce((s, r) => s + r.orders, 0)
  const lines = rows.map((r) => `• ${nameOf(r.component_id)}: ${r.quantity} szt. dla ${r.orders} ${r.orders === 1 ? 'zlecenia' : 'zleceń'}`)
  return (
    `Część przesuwanego towaru jest zarezerwowana pod zlecenia na magazynie źródłowym — po przesunięciu zabrakłoby go tam:\n` +
    `${lines.join('\n')}\n\n` +
    `Przenieść też rezerwacje ${orders} ${orders === 1 ? 'zlecenia' : 'zleceń'} na magazyn docelowy? ` +
    `(„Anuluj” = przesunięcie bez rezerwacji, jak dotąd — zostaną na magazynie źródłowym.)`
  )
}

/** Ile rezerwacji schodzi ze źródła na pozycję (do miękkiej kontroli wolnego stanu). */
export function movedReservationsBy(rows: MmReservationPreview[]): Map<number, number> {
  const m = new Map<number, number>()
  for (const r of rows) m.set(r.component_id, (m.get(r.component_id) ?? 0) + r.quantity)
  return m
}
