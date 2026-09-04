import { useCallback, useState } from 'react'
import { supabase } from '../supabaseClient'
import { isReleaseDateEmpty, parseProductionStages } from '../utils'
import type { CurrentUser, Order, Profile, WorkerStage } from '../types'
import type { ToastVariant } from '../types'

type UseMyStationParams = {
  pushToast: (msg: string, variant: ToastVariant) => void
  currentUser: CurrentUser | null
}

export type StockReleaseRow = {
  r_component_id: number
  r_component_name: string
  r_component_code: string
  r_quantity: number
  r_warehouse_code: string
  r_status: 'released' | 'insufficient'
  r_shortage: number
}

export type StageCompleteResult =
  | { status: 'ok' }
  | { status: 'error' }
  | { status: 'shortage'; shortages: StockReleaseRow[] }

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
    // Paginacja — przy >2000 zamówień stary limit ucinał część i etapy "znikały".
    // Pobieramy partiami po id (numerycznie, stabilnie).
    const all: Order[] = []
    let from = 0
    const PAGE = 1000
    let fetchError: { message: string } | null = null
    while (true) {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .order('id', { ascending: false })
        .range(from, from + PAGE - 1)
      if (error) { fetchError = error; break }
      if (!data || data.length === 0) break
      all.push(...(data as Order[]))
      if (data.length < PAGE) break
      from += PAGE
    }
    setMyStationLoading(false)
    if (fetchError) {
      pushToast(`Błąd: ${fetchError.message}`, 'error')
      return
    }

    const filtered = all.filter((o: Order) => {
      const extra = o.extra_fields as Record<string, unknown> | null
      if (extra?.cancelled === true) return false
      if (o.release_date && !isReleaseDateEmpty(o.release_date)) return false
      return true
    })

    setMyStationOrders(filtered)
  }, [pushToast])

  const handleStageComplete = useCallback(
    async (
      order: Order,
      stageKey: string,
      category: string,
      opts?: { force?: boolean },
    ): Promise<StageCompleteResult> => {
      const actualKey = stageKey.startsWith('titan_') ? stageKey.replace('titan_', '') : stageKey

      // NAJPIERW fizyczne wydanie z magazynu (WZ) dla rezerwacji tego etapu.
      // Braki → zwracamy listę (UI pokaże dialog z "Wydaj mimo braku").
      // Błąd RPC NIE blokuje oznaczenia — produkcja jest ważniejsza niż magazyn.
      let releasedCount = 0
      let forcedCount = 0
      try {
        const { data, error: relError } = await supabase.rpc('release_stock_for_stage', {
          p_order_id: order.id!,
          p_stage_key: actualKey,
          p_force: opts?.force === true,
        })
        if (relError) {
          console.error('release_stock_for_stage error:', relError)
          pushToast(`Ostrzeżenie: wydanie z magazynu nie powiodło się: ${relError.message}`, 'error')
        } else {
          const rows = (data ?? []) as StockReleaseRow[]
          const shortages = rows.filter((r) => r.r_status === 'insufficient')
          if (shortages.length > 0) {
            return { status: 'shortage', shortages }
          }
          releasedCount = rows.filter((r) => r.r_status === 'released').length
          forcedCount = rows.filter((r) => r.r_status === 'released' && r.r_shortage > 0).length
        }
      } catch (err) {
        console.error('release_stock_for_stage error:', err)
        pushToast('Ostrzeżenie: wydanie z magazynu nie powiodło się', 'error')
      }

      const current = parseProductionStages(order.production_stages, category)
      // Zapisujemy INICJAŁY pracownika (spójnie z resztą apki), nie 'T'
      const mark = (currentUser?.initials ?? '').trim() || 'T'
      const updated = { ...current, [actualKey]: mark }

      const { error } = await supabase
        .from('orders')
        .update({ production_stages: updated })
        .eq('id', order.id!)

      if (error) {
        pushToast(`Błąd: ${error.message}`, 'error')
        return { status: 'error' }
      }

      setMyStationOrders((prev) =>
        prev.map((o) => (o.id === order.id ? { ...o, production_stages: updated } : o)),
      )

      if (forcedCount > 0) {
        pushToast(
          `Etap oznaczony — wydano ${releasedCount} pozycji, w tym ${forcedCount} MIMO BRAKU (stan zszedł na minus)`,
          'info',
        )
      } else if (releasedCount > 0) {
        pushToast(`Etap oznaczony — wydano z magazynu ${releasedCount} pozycji`, 'success')
      } else {
        pushToast('Etap oznaczony jako zrobiony', 'success')
      }
      return { status: 'ok' }
    },
    [pushToast, currentUser?.initials],
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
