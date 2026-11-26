// =====================================================================
// Drzwi wewnętrzne: pozycje zlecenia przygotowane przez magazyn do pakowania
// (tabela order_item_picks, migrate/order_item_picks.sql).
//
// Klucz linii, a nie id pozycji: import z Optimy kasuje i wstawia pozycje na
// nowo przy każdej zmianie RO, więc id się zmieniają — optima_element_id
// (id linii w Optimie) zostaje. Pozycje ręczne: id pozycji.
// =====================================================================
import { supabase } from '../supabaseClient'
import type { InternalDoorItem } from '../types'

export type OrderPick = {
  order_id: number
  line_key: string
  picked_at: string
  picked_by: string | null
  picked_initials: string | null
}

/** order_id → (line_key → odznaczenie) */
export type PicksByOrder = Map<number, Map<string, OrderPick>>

export function pickKey(it: Pick<InternalDoorItem, 'id' | 'optima_element_id'>): string {
  return it.optima_element_id != null ? `optima:${it.optima_element_id}` : `item:${it.id}`
}

export function groupPicks(rows: OrderPick[]): PicksByOrder {
  const out: PicksByOrder = new Map()
  for (const r of rows) {
    const m = out.get(r.order_id) ?? new Map<string, OrderPick>()
    m.set(r.line_key, r)
    out.set(r.order_id, m)
  }
  return out
}

/** Ile pozycji zlecenia przygotowano. Odznaczenia linii, których już nie ma (zmiana RO), się nie liczą. */
export function pickProgress(
  items: Array<Pick<InternalDoorItem, 'id' | 'optima_element_id'>>,
  picks: Map<string, OrderPick> | undefined,
): { done: number; total: number; complete: boolean } {
  const total = items.length
  const done = picks ? items.filter((it) => picks.has(pickKey(it))).length : 0
  return { done, total, complete: total > 0 && done === total }
}

/** Kto odznacza (jak current_user_can_pick w bazie): kierownicy, magazynier, pracownik działu magazyn. */
export function canPick(user: { role: string; department?: string | null }, isManager: boolean): boolean {
  return isManager || user.role === 'magazynier' || (user.role === 'worker' && user.department === 'magazyn')
}

const CHUNK = 150

export async function fetchPicks(orderIds: number[]): Promise<OrderPick[]> {
  const ids = [...new Set(orderIds)]
  const out: OrderPick[] = []
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await supabase
      .from('order_item_picks')
      .select('order_id, line_key, picked_at, picked_by, picked_initials')
      .in('order_id', ids.slice(i, i + CHUNK))
    if (error) throw new Error(error.message)
    out.push(...((data ?? []) as OrderPick[]))
  }
  return out
}

/** Odznacz / cofnij kilka linii jednego zlecenia naraz. */
export async function savePicks(orderId: number, lineKeys: string[], picked: boolean, initials: string): Promise<void> {
  if (lineKeys.length === 0) return
  if (picked) {
    const { error } = await supabase
      .from('order_item_picks')
      .upsert(
        lineKeys.map((line_key) => ({ order_id: orderId, line_key, picked_initials: initials || null })),
        { onConflict: 'order_id,line_key', ignoreDuplicates: true },
      )
    if (error) throw new Error(error.message)
  } else {
    const { error } = await supabase.from('order_item_picks').delete().eq('order_id', orderId).in('line_key', lineKeys)
    if (error) throw new Error(error.message)
  }
}
