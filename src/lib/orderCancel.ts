// D43 (decyzja właściciela 28.11.2026): wydanego zlecenia nie anulujemy z menu,
// a anulowanie pary (Disting Plus) / zestawu Titan pomija nogi, które są już wydane.
// Obrona w bazie: trigger trg_orders_block_cancel_released (migracja 20261128031000).

import { isOrderCancelled } from './optimaRo'

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

type TitanLeg = ReleaseInfo & { category?: string | null; extra_fields?: unknown }

/**
 * D28 (28.11): anulowanie nogi Bastion zestawu Titan — czy pytać o anulowanie całego zestawu.
 * Tak, gdy bazowe STA i jego para ST istnieją, STA nie jest anulowane ani wydane.
 * W przeciwnym razie (np. STA w archiwum) anulujemy tylko nogę Bastion, jak dotąd.
 */
export function mozeAnulowacCalyZestawTitan(baza: TitanLeg | null | undefined, partner: TitanLeg | null | undefined): boolean {
  if (!baza || baza.category !== 'STA') return false
  if (isOrderCancelled(baza as { extra_fields?: unknown }) || isOrderReleased(baza)) return false
  return partner?.category === 'ST'
}

type WynikRpc = { error: { message: string } | null }

/**
 * D51 (28.11): kolejność anulowania ze zwrotem towaru — najpierw oznaczenie zlecenia jako anulowane, potem zwrot
 * (jak w zakładce zleceń). Odwrotnie (okno drzwi wewnętrznych) błąd drugiego kroku zostawiał zlecenie aktywne
 * z towarem już zwróconym na magazyn. Teraz: błąd oznaczenia = nic się nie zmieniło; błąd zwrotu = zlecenie
 * anulowane, zwrot do zrobienia ręcznie (komunikat).
 */
export async function anulujPotemZwroc(
  oznacz: () => PromiseLike<WynikRpc>,
  zwroc: () => PromiseLike<WynikRpc>,
): Promise<{ ok: false; blad: string } | { ok: true; bladZwrotu: string | null }> {
  const { error: e1 } = await oznacz()
  if (e1) return { ok: false, blad: e1.message }
  const { error: e2 } = await zwroc()
  return { ok: true, bladZwrotu: e2 ? e2.message : null }
}
