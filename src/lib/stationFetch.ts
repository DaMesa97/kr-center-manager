// Pobranie zleceń dla stanowiska (desktop „Moje stanowisko” i mobile) — jedna logika.
// Tylko OTWARTE zlecenia z kategorii, w których pracownik ma etapy, + partnerzy
// zleceń łączonych z innych kategorii (Titan STA↔ST, Disting Plus): od nich
// zależą blokady etapów. categories = null → wszystkie kategorie (np. błąd
// odczytu przypisań — lepiej pokazać za dużo niż nic).
import { supabase } from '../supabaseClient'
import { isReleaseDateEmpty } from '../utils'
import type { Order } from '../types'

export const ALL_STATION_CATEGORIES = ['STA', 'Disting', 'ST', 'Bastion', 'Techniczne']

export async function fetchStationOrders(
  categories: string[] | null,
): Promise<{ data: Order[]; error: { message: string } | null }> {
  if (categories && categories.length === 0) return { data: [], error: null }
  const all: Order[] = []
  // Paginacja — PostgREST oddaje max 1000 wierszy na zapytanie
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from('orders').select('*').is('release_date', null)
    if (categories) q = q.in('category', categories)
    const { data, error } = await q.order('id', { ascending: false }).range(from, from + PAGE - 1)
    if (error) return { data: all, error }
    all.push(...((data ?? []) as Order[]))
    if (!data || data.length < PAGE) break
  }
  if (categories) {
    const have = new Set(all.map((o) => o.id))
    const missing = [
      ...new Set(all.map((o) => o.linked_order_id).filter((id): id is number => id != null && !have.has(id))),
    ]
    for (let i = 0; i < missing.length; i += 200) {
      const { data, error } = await supabase.from('orders').select('*').in('id', missing.slice(i, i + 200))
      if (error) return { data: all, error }
      all.push(...((data ?? []) as Order[]))
    }
  }
  const scope = new Set(categories ?? ALL_STATION_CATEGORIES)
  return {
    data: all.filter((o) => {
      const extra = o.extra_fields as Record<string, unknown> | null
      if (extra?.cancelled === true) return false
      // partner spoza naszych kategorii zostaje także po wydaniu (blokady etapów)
      if (scope.has(o.category ?? '') && !isReleaseDateEmpty(o.release_date)) return false
      return true
    }),
    error: null,
  }
}
