import { useCallback, useState } from 'react'
import { supabase } from '../supabaseClient'
import type { Complaint, Order, StatsSubTab } from '../types'
import type { ToastVariant } from '../types'

type UseStatsParams = {
  pushToast: (msg: string, variant: ToastVariant) => void
  touchSession: () => void
}

const PAGE = 1000

/**
 * Kolumny zleceń potrzebne Statystykom (wykresy kategorii, karta firmy, nazwy firm, partner pary, stan RO z Optimy).
 * Runda 6 (wydajność): dotąd `select *` całej tabeli — 67 MB (ok. 110 kolumn, większość pusta). Test
 * `statsKolumny.test.ts` pilnuje, żeby każde pole zlecenia używane w kodzie Statystyk było na tej liście.
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

export function useStats({ touchSession }: UseStatsParams) {
  const [activeStatsSubTab, setActiveStatsSubTab] = useState<StatsSubTab>('STA')
  const [statsOrders, setStatsOrders] = useState<Order[]>([])
  const [statsComplaints, setStatsComplaints] = useState<Complaint[]>([])
  const [statsLoading, setStatsLoading] = useState(false)
  /** testy 27.11 (runda 3): błąd pobierania był pokazywany jako „Brak zrealizowanych zamówień” */
  const [statsError, setStatsError] = useState<string | null>(null)

  const fetchStatsData = useCallback(async () => {
    touchSession()
    setStatsLoading(true)
    // PostgREST ucina wynik do 1000 wierszy (max_rows) — .limit(50000) dawało
    // 1000 najnowszych, czyli statystyki z ostatnich ~3 tygodni. Porcjami po 1000.
    // Pozycje drzwi wewnętrznych (50 tys. wierszy) nie są już ładowane do przeglądarki —
    // Statystyki → Drzwi wewnętrzne liczą się w bazie (rpc stat_wew_*, Etap 25).
    const [ordersRes, complaintsRes] = await Promise.all([fetchAllRows('orders'), fetchAllRows('complaints')])
    setStatsLoading(false)
    const blad = ordersRes.error ?? complaintsRes.error
    setStatsError(blad ? (blad as { message?: string }).message ?? String(blad) : null)
    if (ordersRes.error) {
      console.error(ordersRes.error)
    } else {
      setStatsOrders((ordersRes.data || []) as Order[])
    }
    if (complaintsRes.error) {
      console.error(complaintsRes.error)
    } else {
      setStatsComplaints((complaintsRes.data || []) as Complaint[])
    }
  }, [touchSession])

  return {
    activeStatsSubTab,
    setActiveStatsSubTab,
    statsOrders,
    setStatsOrders,
    statsError,
    statsComplaints,
    setStatsComplaints,
    statsLoading,
    setStatsLoading,
    fetchStatsData,
  }
}
