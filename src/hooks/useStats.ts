import { useCallback, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import type { Complaint, Order, StatsSubTab } from '../types'
import { isMrProfilOrder } from '../lib/optimaRo'
import { normalizujPodsumowanie, podsumujZlecenia, type PodsumowanieZlecen } from '../lib/statsZlecenia'

type UseStatsParams = {
  touchSession: () => void
}

const PAGE = 1000

/**
 * Kolumny zleceń potrzebne Statystykom (wykresy kategorii, karta firmy, nazwy firm, partner pary, stan RO z Optimy).
 * Runda 6 (wydajność): dotąd `select *` całej tabeli — 67 MB (ok. 110 kolumn, większość pusta). Test
 * `statsKolumny.test.ts` pilnuje, żeby każde pole zlecenia używane w kodzie Statystyk było na tej liście.
 * D47: używane już tylko w ścieżce zapasowej (baza bez funkcji stat_zlecenia_*).
 */
export const STATS_ORDER_COLUMNS = [
  'id', 'category', 'order_number', 'company', 'model', 'system', 'wing_color', 'quantity',
  'order_date', 'release_date', 'created_at', 'source', 'source_metadata', 'extra_fields', 'linked_order_id',
] as const

async function fetchAllRows(table: 'orders' | 'complaints'): Promise<{ data: unknown[] | null; error: { message: string } | null }> {
  const rows: unknown[] = []
  // runda 6 (wydajność): porcje po `id` (kursor) zamiast OFFSET — przy OFFSET każda porcja to pełny skan i sort tabeli
  let ostatnieId = 0
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select(table === 'orders' ? STATS_ORDER_COLUMNS.join(', ') : '*')
      .gt('id', ostatnieId)
      .order('id', { ascending: true })
      .limit(PAGE)
    if (error) return { data: null, error }
    const porcja = (data ?? []) as unknown as Array<{ id: number }>
    rows.push(...porcja)
    if (porcja.length < PAGE) return { data: rows, error: null }
    ostatnieId = Number(porcja[porcja.length - 1].id)
  }
}

/** Zlecenia wybranych pisowni firmy (Statystyki → Firmy). */
export type PobierzZleceniaFirm = (nazwy: string[]) => Promise<{ data: Order[]; error: string | null }>

export function useStats({ touchSession }: UseStatsParams) {
  const [activeStatsSubTab, setActiveStatsSubTab] = useState<StatsSubTab>('STA')
  /** D47: gotowe zestawienia zleceń (z bazy albo — na starej bazie — policzone tu ze zleceń) */
  const [statsSummary, setStatsSummary] = useState<PodsumowanieZlecen | null>(null)
  const [statsComplaints, setStatsComplaints] = useState<Complaint[]>([])
  const [statsLoading, setStatsLoading] = useState(false)
  /** testy 27.11 (runda 3): błąd pobierania był pokazywany jako „Brak zrealizowanych zamówień” */
  const [statsError, setStatsError] = useState<string | null>(null)
  /** ścieżka zapasowa (PGRST202): zlecenia trzymane w pamięci dla karty firmy; null = liczy baza */
  const zleceniaLokalne = useRef<Order[] | null>(null)

  const fetchStatsData = useCallback(async () => {
    touchSession()
    setStatsLoading(true)
    // D47 (28.11): zestawienia zleceń liczy baza (rpc stat_zlecenia_podsumowanie, ok. 250 kB) zamiast ładowania tabeli
    // zleceń (ok. 7 MB w 24 porcjach). Pozycje drzwi wewnętrznych liczy baza od Etapu 25 (rpc stat_wew_*).
    const [podsRes, complaintsRes] = await Promise.all([
      supabase.rpc('stat_zlecenia_podsumowanie'),
      fetchAllRows('complaints'),
    ])
    let blad: { message?: string } | null = complaintsRes.error
    if (podsRes.error?.code === 'PGRST202') {
      // stara baza (migracja D47 niewgrana): jak dotąd — zlecenia porcjami, liczenie w przeglądarce
      const ordersRes = await fetchAllRows('orders')
      if (ordersRes.error) {
        console.error(ordersRes.error)
        blad = ordersRes.error
      } else {
        // D10 (28.11): statystyki KR Center — bez zleceń z RO bazy MR Profil (te mają filtr firmy w Drzwi wewnętrzne)
        const lista = ((ordersRes.data || []) as Order[]).filter((o) => !isMrProfilOrder(o))
        zleceniaLokalne.current = lista
        setStatsSummary(podsumujZlecenia(lista))
      }
    } else if (podsRes.error) {
      console.error(podsRes.error)
      blad = podsRes.error
    } else {
      zleceniaLokalne.current = null
      setStatsSummary(normalizujPodsumowanie(podsRes.data))
    }
    setStatsLoading(false)
    setStatsError(blad ? blad.message ?? String(blad) : null)
    if (complaintsRes.error) {
      console.error(complaintsRes.error)
    } else {
      setStatsComplaints((complaintsRes.data || []) as Complaint[])
    }
  }, [touchSession])

  const pobierzZleceniaFirm = useCallback<PobierzZleceniaFirm>(async (nazwy) => {
    const lokalne = zleceniaLokalne.current
    if (lokalne) {
      const zbior = new Set(nazwy)
      return { data: lokalne.filter((o) => zbior.has(String(o.company ?? '').trim())), error: null }
    }
    const { data, error } = await supabase.rpc('stat_zlecenia_firm', { p_nazwy: nazwy })
    if (error) return { data: [], error: error.message }
    return { data: (Array.isArray(data) ? data : []) as Order[], error: null }
  }, [])

  return {
    activeStatsSubTab,
    setActiveStatsSubTab,
    statsSummary,
    statsError,
    statsComplaints,
    setStatsComplaints,
    statsLoading,
    setStatsLoading,
    fetchStatsData,
    pobierzZleceniaFirm,
  }
}
