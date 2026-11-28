// D43 (decyzja właściciela 28.11.2026): wydanego zlecenia nie anulujemy z menu,
// a anulowanie pary (Disting Plus) / zestawu Titan pomija nogi, które są już wydane.
// Obrona w bazie: trigger trg_orders_block_cancel_released (migracja 20261128031000).

export type ReleaseInfo = { id?: number | null; release_date?: string | null }

/** Zlecenie jest wydane, gdy ma niepustą datę wydania. */
export function isOrderReleased(o: ReleaseInfo | null | undefined): boolean {
  if (!o) return false
  const v = o.release_date
  return v != null && String(v).trim() !== ''
}

/** Komunikat dla próby anulowania wydanego zlecenia. */
export const RELEASED_CANCEL_MSG = 'Zlecenie jest wydane — nie można go anulować.'

/**
 * Dzieli nogi pary / zestawu na te do anulowania i pominięte (wydane).
 * Wiersze bez id są pomijane.
 */
export function splitCancellableLegs(rows: ReleaseInfo[]): { cancel: number[]; skippedReleased: number[] } {
  const cancel: number[] = []
  const skippedReleased: number[] = []
  for (const r of rows) {
    if (r.id == null) continue
    const id = Number(r.id)
    if (!Number.isFinite(id)) continue
    if (isOrderReleased(r)) skippedReleased.push(id)
    else cancel.push(id)
  }
  return { cancel, skippedReleased }
}
