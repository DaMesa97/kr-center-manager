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
import { isKitPart } from './optimaRo'

export type OrderPick = {
  order_id: number
  line_key: string
  picked_at: string
  picked_by: string | null
  picked_initials: string | null
  /** 27.11 (testy): ilość | kod z chwili odhaczenia — po zmianie w Optimie linia wraca jako nieodhaczona (null = stare, liczy się) */
  line_sig?: string | null
}

/** order_id → (line_key → odznaczenie) */
export type PicksByOrder = Map<number, Map<string, OrderPick>>

export function pickKey(it: Pick<InternalDoorItem, 'id' | 'optima_element_id'> & Partial<Pick<InternalDoorItem, 'notes' | 'component_id' | 'optima_code'>>): string {
  if (it.optima_element_id == null) return `item:${it.id}`
  // część kompletu (np. SYSTEM PRZESUWNY pod skrzydłem przesuwnym) ma ten sam optima_element_id co skrzydło — własny klucz,
  // stały między importami (id pozycji się zmieniają): element + komponent części
  if (isKitPart(it)) return `optima:${it.optima_element_id}:${it.component_id ?? it.optima_code ?? 'czesc'}`
  return `optima:${it.optima_element_id}`
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

type PickItem = Pick<InternalDoorItem, 'id' | 'optima_element_id'> &
  Partial<Pick<InternalDoorItem, 'notes' | 'component_id' | 'optima_code' | 'quantity'>>

/** Podpis linii: ilość | kod Optimy (albo komponent). Zmiana ilości / rozmiaru / koloru w Optimie zmienia podpis. */
export function pickSig(it: Partial<Pick<InternalDoorItem, 'quantity' | 'optima_code' | 'component_id'>>): string {
  return `${Number(it.quantity) || 0}|${it.optima_code ?? it.component_id ?? ''}`
}

/** Linia odhaczona i nic się w niej nie zmieniło od odhaczenia (stare odhaczenia bez podpisu — liczą się). */
export function isPicked(picks: Map<string, OrderPick> | undefined, it: PickItem): boolean {
  const p = picks?.get(pickKey(it))
  if (!p) return false
  return p.line_sig == null || it.quantity === undefined || p.line_sig === pickSig(it)
}

/** Linia odhaczona, ale zlecenie zmieniło się potem w Optimie (ilość / kod) — do ponownego sprawdzenia. */
export function pickChanged(picks: Map<string, OrderPick> | undefined, it: PickItem): boolean {
  const p = picks?.get(pickKey(it))
  return !!p && p.line_sig != null && it.quantity !== undefined && p.line_sig !== pickSig(it)
}

/** Mapa klucz linii → podpis (do zapisu odhaczenia). */
export function sigsOf(items: PickItem[]): Map<string, string> {
  return new Map(items.map((it) => [pickKey(it), pickSig(it)]))
}

/** Ile pozycji zlecenia przygotowano. Odznaczenia linii, których już nie ma (zmiana RO) albo które się zmieniły, się nie liczą. */
export function pickProgress(items: PickItem[], picks: Map<string, OrderPick> | undefined): { done: number; total: number; complete: boolean } {
  const total = items.length
  const done = picks ? items.filter((it) => isPicked(picks, it)).length : 0
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
      .select('order_id, line_key, picked_at, picked_by, picked_initials, line_sig')
      .in('order_id', ids.slice(i, i + CHUNK))
    if (error) throw new Error(error.message)
    out.push(...((data ?? []) as OrderPick[]))
  }
  return out
}

/** Odznacz / cofnij kilka linii jednego zlecenia naraz. */
export async function savePicks(orderId: number, lineKeys: string[], picked: boolean, initials: string, sigs?: Map<string, string>): Promise<void> {
  if (lineKeys.length === 0) return
  if (picked) {
    // z update (nie ignoreDuplicates): ponowne odhaczenie zmienionej linii zapisuje nowy podpis
    const { error } = await supabase
      .from('order_item_picks')
      .upsert(
        // recenzent (2. seria): ponowne odhaczenie zmienionej linii = nowa osoba i godzina (picked_by z bazy: auth.uid())
        lineKeys.map((line_key) => ({ order_id: orderId, line_key, picked_initials: initials || null, line_sig: sigs?.get(line_key) ?? null, picked_at: new Date().toISOString() })),
        { onConflict: 'order_id,line_key' },
      )
    if (error) throw new Error(error.message)
  } else {
    const { error } = await supabase.from('order_item_picks').delete().eq('order_id', orderId).in('line_key', lineKeys)
    if (error) throw new Error(error.message)
  }
}
