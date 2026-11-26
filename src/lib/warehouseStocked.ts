// =====================================================================
// warehouse_components.is_stocked — „trzymamy na magazynie” vs „kartoteka
// w tle” (towar na zamówienie, bez stanu). Kartoteki z importu Optimy mają
// false (trigger trg_wc_optima_import_not_stocked), jest ich ~2,5 tys. i
// przybywa — aplikacja ładuje na co dzień tylko is_stocked = true, a „w tle”
// przegląda stronami z serwera.
// =====================================================================
import { supabase } from '../supabaseClient'
import type { WarehouseComponent } from '../types'
import { canPick } from './orderPicks'

/** Brak pola (stary wiersz / test) = trzymamy na magazynie — jak DEFAULT w bazie. */
export function isStocked(c: Pick<WarehouseComponent, 'is_stocked'> | null | undefined): boolean {
  return c?.is_stocked !== false
}

/** Kto przestawia TAK/NIE (jak set_components_stocked w bazie): kierownicy, magazynier, pracownik działu magazyn. */
export function canSetStocked(user: { role: string; department?: string | null }, isManager: boolean): boolean {
  return canPick(user, isManager)
}

/** Ustaw is_stocked wielu komponentom naraz (rpc set_components_stocked). Zwraca liczbę zmienionych. */
export async function setComponentsStocked(ids: number[], stocked: boolean): Promise<number> {
  if (ids.length === 0) return 0
  const { data, error } = await supabase.rpc('set_components_stocked', { p_ids: ids, p_stocked: stocked })
  if (error) throw new Error(error.message)
  return Number(data ?? 0)
}

export const BACKGROUND_PAGE = 100

const fold = (s: string) => s.replace(/[%_,()]/g, ' ').trim()

/** Słowa wyszukiwania → filtr PostgREST: każde słowo w kodzie albo nazwie (ilike). */
function applyTerms<Q extends { or: (f: string) => Q }>(q: Q, query: string): Q {
  let out = q
  for (const t of fold(query).split(/\s+/).filter(Boolean).slice(0, 5)) {
    out = out.or(`code.ilike.%${t}%,name.ilike.%${t}%`)
  }
  return out
}

/** Kartoteki w tle (is_stocked = false) stronami — bez ładowania tysięcy wierszy. */
export async function fetchBackgroundComponents(opts: { query: string; category: string; page: number }): Promise<{ rows: WarehouseComponent[]; total: number }> {
  const from = opts.page * BACKGROUND_PAGE
  let q = supabase
    .from('warehouse_components')
    .select('*', { count: 'exact' })
    .eq('is_active', true)
    .eq('is_stocked', false)
  if (opts.category) q = q.eq('product_category', opts.category)
  q = applyTerms(q, opts.query)
  const { data, error, count } = await q.order('name').order('id').range(from, from + BACKGROUND_PAGE - 1)
  if (error) throw new Error(error.message)
  return { rows: (data ?? []) as WarehouseComponent[], total: count ?? 0 }
}

/** Komponenty drzwi wewnętrznych (także w tle) do wyszukiwarki „Powiąż z komponentem”. */
export async function searchDoorComponentsRemote(query: string, limit = 60): Promise<WarehouseComponent[]> {
  if (!fold(query)) return []
  let q = supabase.from('warehouse_components').select('*').eq('is_active', true).like('product_category', 'door_%')
  q = applyTerms(q, query)
  const { data, error } = await q.order('name').limit(limit)
  if (error) throw new Error(error.message)
  return ((data ?? []) as WarehouseComponent[]).filter((c) => !/bastion/i.test(`${c.name} ${c.code ?? ''}`))
}
