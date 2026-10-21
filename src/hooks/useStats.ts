import { useCallback, useState } from 'react'
import { supabase } from '../supabaseClient'
import type { Complaint, Order, StatsSubTab } from '../types'
import type { ToastVariant } from '../types'

type UseStatsParams = {
  pushToast: (msg: string, variant: ToastVariant) => void
  touchSession: () => void
  fetchInternalDoorItemsForVisibleOrders: (orders: Order[]) => Promise<void>
}

const PAGE = 1000

async function fetchAllRows(table: 'orders' | 'complaints'): Promise<{ data: unknown[] | null; error: { message: string } | null }> {
  const rows: unknown[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) return { data: null, error }
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) return { data: rows, error: null }
  }
}

export function useStats({ touchSession, fetchInternalDoorItemsForVisibleOrders }: UseStatsParams) {
  const [activeStatsSubTab, setActiveStatsSubTab] = useState<StatsSubTab>('STA')
  const [statsOrders, setStatsOrders] = useState<Order[]>([])
  const [statsComplaints, setStatsComplaints] = useState<Complaint[]>([])
  const [statsLoading, setStatsLoading] = useState(false)
  const [statsInternalDoorItemsLoading, setStatsInternalDoorItemsLoading] = useState(false)

  const fetchStatsData = useCallback(async () => {
    touchSession()
    setStatsLoading(true)
    // PostgREST ucina wynik do 1000 wierszy (max_rows) — .limit(50000) dawało
    // 1000 najnowszych, czyli statystyki z ostatnich ~3 tygodni. Porcjami po 1000.
    const [ordersRes, complaintsRes] = await Promise.all([fetchAllRows('orders'), fetchAllRows('complaints')])
    setStatsLoading(false)
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
    const loadedOrders = (ordersRes.data || []) as Order[]
    const internalDoorOrders = loadedOrders.filter((o) => o.category === 'DrzwiWewnetrzne')
    setStatsInternalDoorItemsLoading(true)
    try {
      await fetchInternalDoorItemsForVisibleOrders(internalDoorOrders)
    } finally {
      setStatsInternalDoorItemsLoading(false)
    }
  }, [fetchInternalDoorItemsForVisibleOrders, touchSession])

  return {
    activeStatsSubTab,
    setActiveStatsSubTab,
    statsOrders,
    setStatsOrders,
    statsComplaints,
    setStatsComplaints,
    statsLoading,
    setStatsLoading,
    statsInternalDoorItemsLoading,
    setStatsInternalDoorItemsLoading,
    fetchStatsData,
  }
}
