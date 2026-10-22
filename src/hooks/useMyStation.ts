import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import { mirrorStageKey } from '../lib/stageMirror'
import { markLocalStageWrite } from '../lib/stageWrites'
import { clearStageLocally, stationUndoMessage, undoStationTask } from '../lib/stationUndo'
import { ALL_STATION_CATEGORIES, fetchStationOrders } from '../lib/stationFetch'
import { parseProductionStages } from '../utils'
import type { Complaint, CurrentUser, Order, Profile, WorkerStage } from '../types'
import type { ToastVariant } from '../types'
import {
  mergeStationOrderEvent,
  stationEventNeedsRefetch,
  type MyTask,
} from '../lib/stationLogic'

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
  const [myStationComplaints, setMyStationComplaints] = useState<Complaint[]>([])
  const [myStationLoading, setMyStationLoading] = useState(false)
  const [workerStagesForCurrent, setWorkerStagesForCurrent] = useState<WorkerStage[]>([])
  // Kafelki "kto zrobił": wszystkie przypisania etapów + profile (stanowisko
  // to często jeden komputer i kilka osób — patrz workersForTask)
  const [allWorkerStages, setAllWorkerStages] = useState<WorkerStage[]>([])
  const [stationProfiles, setStationProfiles] = useState<
    Array<{ id: string; initials: string | null; full_name: string | null }>
  >([])
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

  // Kategorie, z których zalogowany ma zadania — realtime decyduje po nich,
  // czy zmienione zlecenie dotyczy tego stanowiska
  const scopeRef = useRef<Set<string>>(new Set())
  const ordersRef = useRef<Order[]>([])
  useEffect(() => {
    ordersRef.current = myStationOrders
  }, [myStationOrders])
  const userIdRef = useRef(currentUser?.id)
  userIdRef.current = currentUser?.id

  const fetchStationComplaints = useCallback(async () => {
    // Reklamacje jako zadania stanowisk — otwarte (nieanulowane, niezrealizowane)
    const { data, error } = await supabase.from('complaints').select('*').is('release_date', null)
    if (error) {
      console.error('station complaints fetch:', error)
      return
    }
    setMyStationComplaints(
      ((data ?? []) as Complaint[]).filter((c) => {
        const extra = (c as { extra_fields?: Record<string, unknown> | null }).extra_fields
        return extra?.cancelled !== true
      }),
    )
  }, [])

  const fetchMyStationOrders = useCallback(async (opts?: { silent?: boolean }) => {
    // silent = ciche odświeżenie (realtime/online) — bez zwijania tabeli spinnerem
    if (!opts?.silent) setMyStationLoading(true)
    const userId = userIdRef.current

    // Przypisania etapów wszystkich pracowników i profile (kafelki "kto zrobił")
    const [allWsRes, profilesRes] = await Promise.all([
      supabase.from('worker_stages').select('*'),
      supabase.from('profiles').select('id, initials, full_name'),
    ])
    if (!profilesRes.error) {
      setStationProfiles(
        (profilesRes.data ?? []) as Array<{ id: string; initials: string | null; full_name: string | null }>,
      )
    }
    // Tylko kategorie, w których zalogowany ma etapy — wcześniej każde
    // stanowisko ciągnęło WSZYSTKIE otwarte zlecenia (~5,8 tys. wierszy)
    // przy każdej zmianie dowolnego zlecenia. null = nie wiadomo (błąd) → wszystko.
    let categories: string[] | null = null
    if (!allWsRes.error) {
      const allWs = (allWsRes.data ?? []) as WorkerStage[]
      setAllWorkerStages(allWs)
      if (userId) {
        const mine = allWs.filter((ws) => ws.worker_id === userId)
        setWorkerStagesForCurrent(mine)
        categories = [...new Set(mine.map((ws) => ws.category))]
      }
    }
    if (!userId) categories = []
    scopeRef.current = new Set(categories ?? ALL_STATION_CATEGORIES)

    const { data: stationOrders, error: fetchError } = await fetchStationOrders(categories)
    if (fetchError) {
      setMyStationLoading(false)
      pushToast(`Błąd: ${fetchError.message}`, 'error')
      return
    }
    setMyStationOrders(stationOrders)
    await fetchStationComplaints()
    // Spinner schodzi dopiero po KOMPLECIE (zamówienia + reklamacje + kafelki) —
    // wcześniej klik "Zrobione" w oknie race'a widział pustą listę osób
    setMyStationLoading(false)
    // currentUser?.id w deps: po wczytaniu profilu zakładka pobiera się od nowa
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushToast, fetchStationComplaints, currentUser?.id])

  /**
   * Zdarzenie realtime z tabeli orders — scalane lokalnie zamiast pełnego
   * refetchu. Zwraca true, gdy potrzebny jest pełny refetch (nowe zlecenie
   * łączone, którego partnera nie mamy).
   */
  const applyStationOrderEvent = useCallback(
    (eventType: string, row: Partial<Order> | null, oldRow: { id?: number } | null): boolean => {
      const ev = { eventType, row, oldRow }
      const needsFull = stationEventNeedsRefetch(ordersRef.current, ev, scopeRef.current)
      setMyStationOrders((prev) => mergeStationOrderEvent(prev, ev, scopeRef.current))
      return needsFull
    },
    [],
  )

  const handleStageComplete = useCallback(
    async (
      order: Order,
      stageKey: string,
      category: string,
      opts?: { force?: boolean; markInitials?: string },
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

      // Zapisujemy INICJAŁY pracownika (spójnie z resztą apki), nie 'T'.
      // markInitials = osoba wybrana kafelkiem (wspólny komputer stanowiska);
      // bez wyboru — inicjały zalogowanego. RPC dokleja JEDEN klucz po
      // stronie bazy (jsonb ||) — zapis całego obiektu kasował etapy innych.
      const mark = (opts?.markInitials ?? currentUser?.initials ?? '').trim() || 'T'
      markLocalStageWrite(order.id, actualKey)
      const { error } = await supabase.rpc('update_order_stage', {
        p_order_id: order.id!,
        p_stage_key: actualKey,
        p_stage_value: mark,
      })

      if (error) {
        pushToast(`Błąd: ${error.message}`, 'error')
        return { status: 'error' }
      }

      // Mirror u partnera (Disting Plus / Titan) — tabela zamówień robi to samo
      const mirrorKey = mirrorStageKey(order.category, actualKey)
      if (mirrorKey && order.linked_order_id != null) {
        markLocalStageWrite(order.linked_order_id, mirrorKey)
        const { error: mErr } = await supabase.rpc('update_order_stage', {
          p_order_id: order.linked_order_id,
          p_stage_key: mirrorKey,
          p_stage_value: mark,
        })
        if (mErr) pushToast(`Błąd synchronizacji etapu powiązanego: ${mErr.message}`, 'error')
      }

      setMyStationOrders((prev) =>
        prev.map((o) => {
          if (o.id === order.id) {
            const current = parseProductionStages(o.production_stages, category)
            return { ...o, production_stages: { ...current, [actualKey]: mark } }
          }
          if (mirrorKey && o.id === order.linked_order_id) {
            const current = parseProductionStages(o.production_stages, o.category)
            return { ...o, production_stages: { ...current, [mirrorKey]: mark } }
          }
          return o
        }),
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

  // Oznaczenie etapu REKLAMACJI ze stanowiska: update_complaint_stage (jeden
  // klucz) + mirror pary Disting Plus. Bez magazynu — komponenty napraw
  // rozlicza kierownik (Zniszczenia / ręczne WZ).
  const handleComplaintStageComplete = useCallback(
    async (task: MyTask, markInitials?: string): Promise<StageCompleteResult> => {
      const complaintId = task.complaintId
      if (complaintId == null) return { status: 'error' }
      const mark = (markInitials ?? currentUser?.initials ?? '').trim() || 'T'

      const { error } = await supabase.rpc('update_complaint_stage', {
        p_complaint_id: complaintId,
        p_stage_key: task.actualStageKey,
        p_stage_value: mark,
      })
      if (error) {
        pushToast(`Błąd: ${error.message}`, 'error')
        return { status: 'error' }
      }

      const mirrorKey = mirrorStageKey(task.category, task.actualStageKey)
      if (mirrorKey && task.linkedComplaintId != null) {
        const { error: mErr } = await supabase.rpc('update_complaint_stage', {
          p_complaint_id: task.linkedComplaintId,
          p_stage_key: mirrorKey,
          p_stage_value: mark,
        })
        if (mErr) console.error('complaint mirror stage error:', mErr)
      }

      setMyStationComplaints((prev) =>
        prev.map((c) => {
          if (c.id === complaintId) {
            const cur = parseProductionStages(c.production_stages, task.category)
            return { ...c, production_stages: { ...cur, [task.actualStageKey]: mark } }
          }
          if (mirrorKey && c.id === task.linkedComplaintId) {
            const cur = parseProductionStages(c.production_stages, c.category)
            return { ...c, production_stages: { ...cur, [mirrorKey]: mark } }
          }
          return c
        }),
      )
      pushToast('Etap reklamacji oznaczony jako zrobiony', 'success')
      return { status: 'ok' }
    },
    [pushToast, currentUser?.initials],
  )

  // „Cofnij” tuż po pomyłce na stanowisku — wspólna logika z mobile (lib/stationUndo)
  const handleStageUndo = useCallback(
    async (task: MyTask): Promise<boolean> => {
      const res = await undoStationTask(task)
      if (!res.ok) {
        pushToast(`Nie cofnięto etapu: ${res.error}`, 'error')
        return false
      }
      const parse = (st: unknown, cat: string | null | undefined) => parseProductionStages(st, cat ?? task.category)
      if (task.isComplaint) {
        setMyStationComplaints((prev) =>
          clearStageLocally(prev, task.complaintId, task.actualStageKey, task.linkedComplaintId, res.mirrorKey, parse),
        )
      } else {
        setMyStationOrders((prev) =>
          clearStageLocally(prev, task.order.id, task.actualStageKey, task.order.linked_order_id, res.mirrorKey, parse),
        )
      }
      pushToast(stationUndoMessage(res, task.isComplaint === true), res.mirrorError ? 'error' : 'success')
      return true
    },
    [pushToast],
  )

  return {
    handleStageUndo,
    myStationOrders,
    setMyStationOrders,
    myStationComplaints,
    setMyStationComplaints,
    handleComplaintStageComplete,
    allWorkerStages,
    stationProfiles,
    myStationLoading,
    setMyStationLoading,
    workerStagesForCurrent,
    setWorkerStagesForCurrent,
    workerStagesModal,
    setWorkerStagesModal,
    fetchMyWorkerStages,
    fetchMyStationOrders,
    fetchStationComplaints,
    applyStationOrderEvent,
    handleStageComplete,
  }
}
