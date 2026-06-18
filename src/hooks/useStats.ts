import { useCallback, useState } from 'react'
import { supabase } from '../supabaseClient'
import type { Complaint, Order, StatsSubTab } from '../types'
import type { ToastVariant } from '../types'

type UseStatsParams = {
  pushToast: (msg: string, variant: ToastVariant) => void
  touchSession: () => void
  fetchInternalDoorItemsForVisibleOrders: (orders: Order[]) => Promise<void>
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
    const [ordersRes, complaintsRes] = await Promise.all([
      supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(50000),
      supabase.from('complaints').select('*').order('created_at', { ascending: false }).limit(50000),
    ])
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
