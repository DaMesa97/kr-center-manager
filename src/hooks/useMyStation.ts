import { useCallback, useState } from 'react'
import { supabase } from '../supabaseClient'
import { isReleaseDateEmpty, parseProductionStages } from '../utils'
import type { CurrentUser, Order, Profile, WorkerStage } from '../types'
import type { ToastVariant } from '../types'

type UseMyStationParams = {
  pushToast: (msg: string, variant: ToastVariant) => void
  currentUser: CurrentUser | null
}

export function useMyStation({ pushToast, currentUser }: UseMyStationParams) {
  const [myStationOrders, setMyStationOrders] = useState<Order[]>([])
  const [myStationLoading, setMyStationLoading] = useState(false)
  const [workerStagesForCurrent, setWorkerStagesForCurrent] = useState<WorkerStage[]>([])
  const [workerStagesModal, setWorkerStagesModal] = useState<{
    open: boolean
    worker: Profile | null
  }>({ open: false, worker: null })

  const fetchMyWorkerStages = useCallback(async () => {
    const currentUserId = currentUser?.id
    if (!currentUserId) return
    const { data, error } = await supabase
      .from('worker_stages')
      .select('*')
      .eq('worker_id', currentUserId)
    if (error) {
      console.error(error)
      return
    }
    setWorkerStagesForCurrent((data ?? []) as WorkerStage[])
  }, [currentUser?.id])

  const fetchMyStationOrders = useCallback(async () => {
    setMyStationLoading(true)
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .order('order_number', { ascending: false })
      .limit(2000)
    setMyStationLoading(false)
    if (error) {
      pushToast(`Błąd: ${error.message}`, 'error')
      return
    }

    const filtered = (data ?? []).filter((o: Order) => {
      const extra = o.extra_fields as Record<string, unknown> | null
      if (extra?.cancelled === true) return false
      if (o.release_date && !isReleaseDateEmpty(o.release_date)) return false
      return true
    }) as Order[]

    setMyStationOrders(filtered)
  }, [pushToast])

  const handleStageComplete = useCallback(
    async (order: Order, stageKey: string, category: string) => {
      const actualKey = stageKey.startsWith('titan_') ? stageKey.replace('titan_', '') : stageKey

      const current = parseProductionStages(order.production_stages, category)
      const updated = { ...current, [actualKey]: 'T' }

      const { error } = await supabase
        .from('orders')
        .update({ production_stages: updated })
        .eq('id', order.id!)

      if (error) {
        pushToast(`Błąd: ${error.message}`, 'error')
        return
      }

      setMyStationOrders((prev) =>
        prev.map((o) => (o.id === order.id ? { ...o, production_stages: updated } : o)),
      )

      pushToast('Etap oznaczony jako zrobiony', 'success')
    },
    [pushToast],
  )

  return {
    myStationOrders,
    setMyStationOrders,
    myStationLoading,
    setMyStationLoading,
    workerStagesForCurrent,
    setWorkerStagesForCurrent,
    workerStagesModal,
    setWorkerStagesModal,
    fetchMyWorkerStages,
    fetchMyStationOrders,
    handleStageComplete,
  }
}
