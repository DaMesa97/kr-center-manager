import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Check, RefreshCw, Zap } from 'lucide-react'
import { supabase } from '../../supabaseClient'
import { humanizeErrorText } from '../../lib/friendlyError'
import { mirrorStageKey } from '../../lib/stageMirror'
import { isRushOrderSequence, orderRouteMark, parseProductionStages } from '../../utils'
import {
  buildComplaintTasks,
  buildTasks,
  fieldsForStage,
  isTaskShownByDefault,
  mergeStationOrderEvent,
  sortTasks,
  stationEventNeedsRefetch,
  workersForTask,
  type MyTask,
  type StationWorker,
} from '../../lib/stationLogic'
import { ALL_STATION_CATEGORIES, fetchAluPositionsByOrder, fetchStationOrders } from '../../lib/stationFetch'
import { clearStageLocally, stationUndoMessage, undoStationTask } from '../../lib/stationUndo'
import {
  aluDetailFields,
  aluTaskKey,
  applyAluPositionStages,
  buildAluTasks,
  mergeAluPositionEvent,
} from '../../lib/aluStation'
import { aluStageDone } from '../../lib/alu'
import { ALU_CATEGORY } from '../../constants'
import type { AluPosition, AluPositionStages, Complaint, Order, WorkerStage } from '../../types'

type ShortageRow = {
  r_component_name: string
  r_quantity: number
  r_status: 'released' | 'insufficient'
  r_shortage: number
}

type Props = {
  userId: string
}

const CAT_COLORS: Record<string, string> = {
  STA: '#005faf', Disting: '#4f46e5', ST: '#1d6d45',
  Techniczne: '#854d0e', Bastion: '#b3261e', DrzwiWewnetrzne: '#0369a1',
  Aluminium: '#475569',
}
// Skrót kategorii na plakietce karty (plakietka ma ~52 px)
const catShort = (category: string): string =>
  category === 'DrzwiWewnetrzne' ? 'Wewn.' : category === ALU_CATEGORY ? 'Alu' : category

/** Podpis pozycji alu na karcie i w dialogach: „poz. 2 · Drzwi 1-skrzydłowe” */
const aluPosLabel = (task: MyTask): string => {
  const a = task.alu
  if (!a) return ''
  return `poz. ${a.posNo} · ${a.position.description || a.position.system}`
}

export default function MobileStationView({ userId }: Props) {
  const [workerStages, setWorkerStages] = useState<WorkerStage[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  // Aluminium: etapy żyją na POZYCJACH zlecenia (per sztuka) — klucz = order_id
  const [aluPositions, setAluPositions] = useState<Record<number, AluPosition[]>>({})
  const [complaints, setComplaints] = useState<Complaint[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [confirmTask, setConfirmTask] = useState<MyTask | null>(null)
  const [shortageConfirm, setShortageConfirm] = useState<{
    task: MyTask
    shortages: ShortageRow[]
    markInitials?: string
  } | null>(null)
  // Kafelki "kto zrobił" — wspólny telefon stanowiska, kilka osób
  const [allWorkerStages, setAllWorkerStages] = useState<WorkerStage[]>([])
  const [stationProfiles, setStationProfiles] = useState<
    Array<{ id: string; initials: string | null; full_name: string | null }>
  >([])
  const [lastWorkerId, setLastWorkerId] = useState<string | null>(() => {
    try {
      return localStorage.getItem('stationLastWorkerId')
    } catch {
      return null
    }
  })
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [myInitials, setMyInitials] = useState('')
  const mountedRef = useRef(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  // kategorie z etapami pracownika — realtime decyduje po nich, czy zlecenie jest „nasze”
  const scopeRef = useRef<Set<string>>(new Set(ALL_STATION_CATEGORIES))
  const ordersRef = useRef<Order[]>([])
  useEffect(() => {
    ordersRef.current = orders
  }, [orders])
  // „Cofnij” po pomyłce — pasek przez 60 s po oznaczeniu
  const [lastDone, setLastDone] = useState<{ task: MyTask; initials: string } | null>(null)
  const [undoing, setUndoing] = useState(false)
  useEffect(() => {
    if (!lastDone) return
    const t = setTimeout(() => setLastDone(null), 60_000)
    return () => clearTimeout(t)
  }, [lastDone])

  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flash = (msg: string, sticky = false) => {
    // kasuj POPRZEDNI timer — stary timeout gasił nowy toast po ułamku
    // sekundy, a ostrzeżenia znikały pod toastem sukcesu
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    setToast(humanizeErrorText(msg)) // techniczne błędy bazy/sieci po ludzku
    flashTimerRef.current = sticky ? null : setTimeout(() => setToast(null), 2500)
  }

  const load = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    const [stagesRes, profileRes, complaintsRes, allWsRes, profilesRes] = await Promise.all([
      supabase.from('worker_stages').select('*').eq('worker_id', userId),
      supabase.from('profiles').select('initials').eq('id', userId).single(),
      supabase.from('complaints').select('*').is('release_date', null),
      supabase.from('worker_stages').select('*'),
      supabase.from('profiles').select('id, initials, full_name'),
    ])
    // Tylko kategorie z etapami pracownika (+ partnerzy zleceń łączonych) —
    // wcześniej telefon ciągnął WSZYSTKIE otwarte zlecenia (~5,8 tys.)
    const categories = stagesRes.error
      ? null
      : [...new Set(((stagesRes.data ?? []) as WorkerStage[]).map((w) => w.category))]
    const ordersRes = await fetchStationOrders(categories)
    // Aluminium: pozycje otwartych zleceń alu (etapy per pozycja/sztuka) —
    // wspólny fetch z desktopem; błąd nie blokuje reszty stanowiska
    let aluByOrder: Record<number, AluPosition[]> = {}
    let aluError: string | null = null
    if (!ordersRes.error) {
      const aluIds = ordersRes.data
        .filter((o) => o.category === ALU_CATEGORY && o.id != null)
        .map((o) => o.id as number)
      const aluRes = await fetchAluPositionsByOrder(aluIds)
      aluByOrder = aluRes.data
      aluError = aluRes.error?.message ?? null
    }
    if (!mountedRef.current) return
    setLoading(false)
    if (stagesRes.error || ordersRes.error) {
      // NIE pokazuj pustej listy jak „Brak zadań 🎉” — to wygląda na koniec pracy
      setLoadError(
        typeof navigator !== 'undefined' && navigator.onLine === false
          ? 'Brak internetu — nie pobrano zadań.'
          : 'Nie udało się pobrać zadań.',
      )
      return
    }
    setLoadError(null)
    scopeRef.current = new Set(categories ?? ALL_STATION_CATEGORIES)
    if (!profileRes.error) {
      setMyInitials(String((profileRes.data as { initials?: string } | null)?.initials ?? '').trim())
    }
    setWorkerStages((stagesRes.data ?? []) as WorkerStage[])
    if (!allWsRes.error) setAllWorkerStages((allWsRes.data ?? []) as WorkerStage[])
    if (!profilesRes.error) {
      setStationProfiles(
        (profilesRes.data ?? []) as Array<{ id: string; initials: string | null; full_name: string | null }>,
      )
    }
    setOrders(ordersRes.data)
    setAluPositions(aluByOrder)
    if (aluError) flash(`Nie wczytano pozycji aluminium: ${aluError}`, true)
    if (!complaintsRes.error) {
      const openComplaints = ((complaintsRes.data ?? []) as Complaint[]).filter((c) => {
        const extra = (c as { extra_fields?: Record<string, unknown> | null }).extra_fields
        return extra?.cancelled !== true
      })
      setComplaints(openComplaints)
    }
  }, [userId])

  useEffect(() => {
    mountedRef.current = true
    void load()
    // Realtime — gdy inny pracownik zmieni etap, odśwież lokalnie (świeżość na hali).
    // INSERT/DELETE i reklamacje → pełny przeładunek z debounce (nowe zlecenia
    // i anulowania wcześniej nie docierały wcale).
    let reloadTimer: ReturnType<typeof setTimeout> | null = null
    const scheduleReload = () => {
      if (reloadTimer) clearTimeout(reloadTimer)
      reloadTimer = setTimeout(() => void load(), 1500)
    }
    let dropped = false
    const channel = supabase
      .channel(`mobile-station:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        (payload) => {
          // scalanie lokalne jak na desktopie (lib/stationLogic) — wydane/anulowane
          // znikają, nowe z naszych kategorii dochodzą; pełny przeładunek tylko,
          // gdy brakuje partnera zlecenia łączonego
          const ev = {
            eventType: payload.eventType,
            row: payload.new as Partial<Order> | null,
            oldRow: payload.old as { id?: number } | null,
          }
          if (stationEventNeedsRefetch(ordersRef.current, ev, scopeRef.current)) scheduleReload()
          // nowe zlecenie alu — pozycje trzeba dociągnąć (realtime pozycji
          // ignoruje zlecenia, których nie ma jeszcze w mapie)
          if (
            payload.eventType === 'INSERT' &&
            ev.row?.category === ALU_CATEGORY &&
            scopeRef.current.has(ALU_CATEGORY)
          ) {
            scheduleReload()
          }
          setOrders((prev) => mergeStationOrderEvent(prev, ev, scopeRef.current))
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_alu_positions' },
        (payload) => {
          // sztuki odklikane na innym telefonie/komputerze — scal lokalnie
          setAluPositions((prev) =>
            mergeAluPositionEvent(
              prev,
              payload.eventType,
              payload.new as Partial<AluPosition> | null,
              payload.old as { id?: number; order_id?: number } | null,
            ),
          )
        },
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'complaints' }, () => scheduleReload())
      .subscribe((status) => {
        // telefon usypia → websocket pada → zdarzenia z przerwy przepadają;
        // po ponownym SUBSCRIBED przeładuj
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') dropped = true
        else if (status === 'SUBSCRIBED' && dropped) {
          dropped = false
          void load()
        }
      })
    const onWake = () => {
      if (document.visibilityState === 'visible') void load()
    }
    window.addEventListener('online', onWake)
    document.addEventListener('visibilitychange', onWake)
    return () => {
      mountedRef.current = false
      if (reloadTimer) clearTimeout(reloadTimer)
      window.removeEventListener('online', onWake)
      document.removeEventListener('visibilitychange', onWake)
      void supabase.removeChannel(channel)
    }
  }, [load, userId])

  const tasks = useMemo(
    () => [
      ...sortTasks([...buildTasks(orders, workerStages), ...buildComplaintTasks(complaints, workerStages)]),
      // aluminium osobno: własna kolejność (termin → zlecenie → pozycja → etap)
      ...buildAluTasks(orders, aluPositions, workerStages),
    ],
    [orders, complaints, workerStages, aluPositions],
  )
  const readyCount = tasks.filter((t) => t.readyToWork).length

  // Czekające na wcześniejszy etap domyślnie schowane (wybór zapamiętany na telefonie)
  const [showWaiting, setShowWaiting] = useState<boolean>(() => {
    try {
      return localStorage.getItem('stationShowWaiting') === '1'
    } catch {
      return false
    }
  })
  const toggleShowWaiting = () => {
    const next = !showWaiting
    setShowWaiting(next)
    try {
      localStorage.setItem('stationShowWaiting', next ? '1' : '0')
    } catch {
      /* ignore */
    }
  }
  const shownTasks = useMemo(
    () => (showWaiting ? tasks : tasks.filter(isTaskShownByDefault)),
    [tasks, showWaiting],
  )
  const hiddenCount = tasks.length - shownTasks.length

  // Grupowanie po etapie — kilka etapów (np. E3 i E5) wymieszanych na jednej
  // liście to prosta droga do oznaczenia złego. Sekcje + chipy filtra.
  const groups = useMemo(() => {
    const catOrder = ['STA', 'Disting', 'ST', 'Techniczne', 'Bastion', 'DrzwiWewnetrzne', ALU_CATEGORY]
    const multiCat = new Set(shownTasks.map((t) => t.category)).size > 1
    const map = new Map<string, { label: string; category: string; header: string; tasks: MyTask[] }>()
    for (const t of shownTasks) {
      const key = `${t.category}|${t.stageKey}`
      const g = map.get(key) ?? {
        label: `${multiCat ? `${t.category} · ` : ''}${t.stageHeader} — ${t.stageTitle}`,
        category: t.category,
        header: t.stageHeader,
        tasks: [],
      }
      g.tasks.push(t)
      map.set(key, g)
    }
    return Array.from(map.entries())
      .map(([key, g]) => ({ key, ...g }))
      .sort(
        (a, b) =>
          catOrder.indexOf(a.category) - catOrder.indexOf(b.category) ||
          a.header.localeCompare(b.header, 'pl', { numeric: true }),
      )
  }, [shownTasks])
  const [stageFilter, setStageFilter] = useState<string>(() => {
    try {
      return localStorage.getItem('stationStageFilter') ?? 'all'
    } catch {
      return 'all'
    }
  })
  const setStageFilterPersist = (v: string) => {
    setStageFilter(v)
    try {
      localStorage.setItem('stationStageFilter', v)
    } catch {
      /* ignore */
    }
  }
  const activeFilter = stageFilter !== 'all' && groups.some((g) => g.key === stageFilter) ? stageFilter : 'all'
  const visibleGroups = activeFilter === 'all' ? groups : groups.filter((g) => g.key === activeFilter)

  const rememberWorker = (w: StationWorker | null) => {
    if (!w) return
    setLastWorkerId(w.id)
    try {
      localStorage.setItem('stationLastWorkerId', w.id)
    } catch {
      /* ignore */
    }
  }

  // Aluminium: jedno kliknięcie = jedna sztuka pozycji. Bez magazynu (alu nie ma
  // rezerwacji) i bez mirroru — RPC pilnuje przepływu sztukowego i zwraca nowe
  // production_stages pozycji, które scalamy lokalnie.
  const completeAluPiece = async (task: MyTask, markInitials?: string) => {
    const info = task.alu
    if (!info) return
    // Guard: ktoś inny mógł w międzyczasie odkliknąć resztę sztuk (realtime) —
    // patrz na AKTUALNĄ pozycję, nie na migawkę z karty
    const livePos = (aluPositions[task.order.id ?? -1] ?? []).find((p) => p.id === info.positionId)
    const liveDone = livePos ? aluStageDone(livePos.production_stages, task.stageKey, info.quantity) : info.done
    if (liveDone >= info.quantity) {
      flash('Ten etap jest już oznaczony dla wszystkich sztuk')
      setConfirmTask(null)
      return
    }
    setSaving(true)
    try {
      const mark = (markInitials ?? myInitials).trim() || 'T'
      const { data, error } = await supabase.rpc('mark_alu_position_stage', {
        p_position_id: info.positionId,
        p_stage_key: task.stageKey,
        p_initials: mark,
      })
      if (!mountedRef.current) return
      if (error) {
        flash(`Nie oznaczono sztuki: ${error.message}`, true)
        return
      }
      const stages = (data ?? {}) as AluPositionStages
      setAluPositions((prev) => applyAluPositionStages(prev, info.positionId, stages))
      const doneNow = aluStageDone(stages, task.stageKey, info.quantity)
      flash(
        doneNow >= info.quantity
          ? `${task.stageHeader}: pozycja ${info.posNo} gotowa (${doneNow}/${info.quantity} szt.) ✓`
          : `${task.stageHeader}: sztuka ${doneNow}/${info.quantity} pozycji ${info.posNo} ✓`,
      )
      setLastDone({ task, initials: mark })
      setConfirmTask(null)
    } finally {
      if (mountedRef.current) setSaving(false)
    }
  }

  const completeStage = async (task: MyTask, opts?: { force?: boolean; markInitials?: string }) => {
    if (task.alu) {
      await completeAluPiece(task, opts?.markInitials)
      return
    }
    const actualKey = task.actualStageKey
    const current = parseProductionStages(task.order.production_stages, task.category)
    // Guard: ktoś inny mógł już oznaczyć ten etap (realtime/odświeżenie) —
    // "zrobione" = jakakolwiek niepusta wartość (inicjały), nie tylko 'T'
    if (String(current[actualKey] ?? '').trim() !== '') {
      flash('Ten etap jest już oznaczony')
      setConfirmTask(null)
      return
    }

    // Reklamacja: bez magazynu — komponenty napraw rozlicza kierownik
    // (Zniszczenia / ręczne WZ). Tylko oznaczenie etapu + mirror pary.
    if (task.isComplaint) {
      if (task.complaintId == null) return
      setSaving(true)
      try {
        const mark = (opts?.markInitials ?? myInitials).trim() || 'T'
        const { error } = await supabase.rpc('update_complaint_stage', {
          p_complaint_id: task.complaintId,
          p_stage_key: actualKey,
          p_stage_value: mark,
        })
        if (!mountedRef.current) return
        if (error) { flash(`Błąd: ${error.message}`); return }

        const mirrorKey = mirrorStageKey(task.category, actualKey)
        if (mirrorKey && task.linkedComplaintId != null) {
          const { error: mErr } = await supabase.rpc('update_complaint_stage', {
            p_complaint_id: task.linkedComplaintId,
            p_stage_key: mirrorKey,
            p_stage_value: mark,
          })
          if (mErr) console.error('complaint mirror stage error:', mErr)
        }

        setComplaints((prev) =>
          prev.map((c) => {
            if (c.id === task.complaintId) {
              const cur = parseProductionStages(c.production_stages, task.category)
              return { ...c, production_stages: { ...cur, [actualKey]: mark } }
            }
            if (mirrorKey && c.id === task.linkedComplaintId) {
              const cur = parseProductionStages(c.production_stages, c.category)
              return { ...c, production_stages: { ...cur, [mirrorKey]: mark } }
            }
            return c
          }),
        )
        flash('Etap reklamacji oznaczony ✓')
        setLastDone({ task, initials: mark })
        setConfirmTask(null)
      } finally {
        if (mountedRef.current) setSaving(false)
      }
      return
    }

    setSaving(true)
    try {
      // 1) Wydanie z magazynu (WZ) jak na desktopie — braki pokazujemy do
      // decyzji, błąd RPC nie blokuje oznaczenia (produkcja > magazyn)
      try {
        const { data: relData, error: relError } = await supabase.rpc('release_stock_for_stage', {
          p_order_id: task.order.id!,
          p_stage_key: actualKey,
          p_force: opts?.force === true,
        })
        if (!mountedRef.current) return
        if (relError) {
          console.error('release_stock_for_stage error:', relError)
          flash('Ostrzeżenie: wydanie z magazynu nie powiodło się')
        } else {
          const rows = (relData ?? []) as ShortageRow[]
          const shortages = rows.filter((r) => r.r_status === 'insufficient')
          if (shortages.length > 0) {
            setShortageConfirm({ task, shortages, markInitials: opts?.markInitials })
            setConfirmTask(null)
            return
          }
        }
      } catch (err) {
        console.error('release_stock_for_stage error:', err)
      }

      // 2) Oznaczenie etapu: RPC dokleja JEDEN klucz po stronie bazy —
      // zapis całego obiektu kasował etapy innych stanowisk. Inicjały: osoba
      // z kafelka (wspólny telefon stanowiska) albo zalogowany.
      const mark = (opts?.markInitials ?? myInitials).trim() || 'T'
      const { error } = await supabase.rpc('update_order_stage', {
        p_order_id: task.order.id!,
        p_stage_key: actualKey,
        p_stage_value: mark,
      })
      if (!mountedRef.current) return
      if (error) { flash(`Błąd: ${error.message}`); return }

      // 3) Mirror u partnera (Disting Plus / Titan) — jak tabela i Moje stanowisko
      const mirrorKey = mirrorStageKey(task.order.category, actualKey)
      if (mirrorKey && task.order.linked_order_id != null) {
        const { error: mErr } = await supabase.rpc('update_order_stage', {
          p_order_id: task.order.linked_order_id,
          p_stage_key: mirrorKey,
          p_stage_value: mark,
        })
        if (mErr) flash(`UWAGA: etap partnera NIE zsynchronizowany (${mErr.message})`, true)
      }

      setOrders((prev) =>
        prev.map((o) => {
          if (o.id === task.order.id) {
            const cur = parseProductionStages(o.production_stages, task.category)
            return { ...o, production_stages: { ...cur, [actualKey]: mark } }
          }
          if (mirrorKey && o.id === task.order.linked_order_id) {
            const cur = parseProductionStages(o.production_stages, o.category)
            return { ...o, production_stages: { ...cur, [mirrorKey]: mark } }
          }
          return o
        }),
      )
      flash('Etap oznaczony ✓')
      setLastDone({ task, initials: mark })
      setConfirmTask(null)
      setShortageConfirm(null)
    } finally {
      if (mountedRef.current) setSaving(false)
    }
  }

  const undoLast = async () => {
    if (!lastDone || undoing) return
    const task = lastDone.task
    setUndoing(true)
    try {
      if (task.alu) {
        // cofnięcie JEDNEJ sztuki — baza odmówi, gdy następny etap już ją „zużył”
        const info = task.alu
        const { data, error } = await supabase.rpc('undo_alu_position_stage', {
          p_position_id: info.positionId,
          p_stage_key: task.stageKey,
        })
        if (!mountedRef.current) return
        if (error) {
          flash(`Nie cofnięto sztuki: ${error.message}`, true)
          return
        }
        setAluPositions((prev) => applyAluPositionStages(prev, info.positionId, (data ?? {}) as AluPositionStages))
        setLastDone(null)
        flash(`Cofnięto sztukę: ${task.stageHeader}, pozycja ${info.posNo}`)
        return
      }
      const res = await undoStationTask(task)
      if (!mountedRef.current) return
      if (!res.ok) {
        flash(`Nie cofnięto: ${res.error}`, true)
        return
      }
      const parse = (st: unknown, cat: string | null | undefined) => parseProductionStages(st, cat ?? task.category)
      if (task.isComplaint) {
        setComplaints((prev) =>
          clearStageLocally(prev, task.complaintId, task.actualStageKey, task.linkedComplaintId, res.mirrorKey, parse),
        )
      } else {
        setOrders((prev) =>
          clearStageLocally(prev, task.order.id, task.actualStageKey, task.order.linked_order_id, res.mirrorKey, parse),
        )
      }
      setLastDone(null)
      flash(stationUndoMessage(res, task.isComplaint === true), !!res.mirrorError)
    } finally {
      if (mountedRef.current) setUndoing(false)
    }
  }

  if (loading) {
    return (
      <div className="mstation-boot">
        <div className="mlogin-spinner" />
      </div>
    )
  }

  return (
    <div className="mstation">
      <div className="mstation-summary">
        <span>Do zrobienia: <strong>{tasks.length}</strong></span>
        <span className="mstation-ready">Gotowe: <strong>{readyCount}</strong></span>
        <button type="button" className="mstation-refresh" onClick={() => void load()}>
          <RefreshCw size={16} />
        </button>
      </div>

      {lastDone && (
        <div className="mstation-undo-bar" role="status">
          <span>
            Oznaczono {lastDone.task.stageHeader} ·{' '}
            {lastDone.task.isComplaint ? lastDone.task.complaintNumber : lastDone.task.order.order_number}
            {lastDone.task.alu && ` poz. ${lastDone.task.alu.posNo} (sztuka)`} ({lastDone.initials})
          </span>
          <button type="button" className="mstation-undo-btn" disabled={undoing} onClick={() => void undoLast()}>
            {undoing ? 'Cofam…' : 'Cofnij'}
          </button>
        </div>
      )}

      {loadError && (
        <div className="mstation-load-error" role="alert">
          {loadError}
          <button type="button" onClick={() => void load()}>
            Spróbuj ponownie
          </button>
        </div>
      )}

      {tasks.length > 0 && (hiddenCount > 0 || showWaiting) && readyCount < tasks.length && (
        <button type="button" className="mstation-waiting-toggle" onClick={toggleShowWaiting}>
          {showWaiting ? 'Ukryj czekające' : `⏳ Pokaż czekające (${hiddenCount})`}
        </button>
      )}

      {tasks.length === 0 ? (
        loadError ? null : <div className="mpack-info">Brak zadań dla Twoich etapów 🎉</div>
      ) : shownTasks.length === 0 ? (
        <div className="mpack-info">Nic gotowego do pracy (czekające na wcześniejsze etapy: {hiddenCount}).</div>
      ) : (
        <>
          {groups.length > 1 && (
            <div className="mstation-stage-chips">
              <button
                type="button"
                className={`mstation-stage-chip ${activeFilter === 'all' ? 'mstation-stage-chip--active' : ''}`}
                onClick={() => setStageFilterPersist('all')}
              >
                Wszystkie ({shownTasks.length})
              </button>
              {groups.map((g) => (
                <button
                  key={g.key}
                  type="button"
                  className={`mstation-stage-chip ${activeFilter === g.key ? 'mstation-stage-chip--active' : ''}`}
                  onClick={() => setStageFilterPersist(g.key)}
                >
                  {g.header} ({g.tasks.length})
                </button>
              ))}
            </div>
          )}
          <div className="mstation-list">
            {visibleGroups.map((group) => (
              <div key={group.key}>
                {activeFilter === 'all' && groups.length > 1 && (
                  <div className="mstation-group-head">
                    {group.label}
                    <span className="mstation-group-counts">
                      {group.tasks.filter((t) => t.readyToWork).length}/{group.tasks.length}
                    </span>
                  </div>
                )}
                {group.tasks.map((task) => {
            // Reklamacje mają własną numerację id — prefiks chroni przed kolizją kluczy z zamówieniami;
            // alu: klucz = pozycja + etap (jedno zlecenie ma wiele pozycji na tym samym etapie)
            const key = task.alu
              ? aluTaskKey(task)
              : `${task.isComplaint ? 'r' : ''}${task.order.id}-${task.stageKey}`
            const expanded = expandedKey === key
            const urgent = isRushOrderSequence(task.order.sequence)
            const details = !expanded
              ? []
              : task.alu
                ? aluDetailFields(task.alu.position, task.order, task.stageKey)
                : fieldsForStage(task.order, task.category, task.actualStageKey)
            return (
              <div key={key} className={`mstation-card ${task.readyToWork ? '' : 'mstation-card--waiting'}`}>
                <button
                  type="button"
                  className="mstation-card-head"
                  onClick={() => setExpandedKey(expanded ? null : key)}
                >
                  <span className="mpack-cat" style={{ background: CAT_COLORS[task.category] ?? '#475569' }}>
                    {catShort(task.category)}
                  </span>
                  <span className="mstation-card-main">
                    <span className="mstation-card-nr">
                      {urgent && <Zap size={13} className="mstation-urgent" />}
                      {orderRouteMark(task.order) && (
                        <span className={`route-mark-chip route-mark-chip--${orderRouteMark(task.order).toLowerCase()}`}>
                          {orderRouteMark(task.order)}
                        </span>
                      )}
                      {task.order.order_number} · {task.order.company}
                      {task.isComplaint && (
                        <span className="mstation-rekl-badge" title={`Zadanie z reklamacji ${task.complaintNumber ?? ''}`}>
                          REKLAMACJA
                        </span>
                      )}
                    </span>
                    {task.alu && (
                      <span className="mstation-card-alu">
                        <span className="mstation-card-alu-pos">{aluPosLabel(task)}</span>
                        <span className="mstation-card-alu-count">
                          {task.alu.done}/{task.alu.quantity} szt. z tym etapem
                        </span>
                      </span>
                    )}
                    <span className="mstation-card-stage">
                      {task.stageHeader} — {task.stageTitle}
                    </span>
                  </span>
                  {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                </button>

                {expanded && (
                  <div className="mstation-card-body">
                    {details.length > 0 && (
                      <div className="mstation-details">
                        {details.map((f) => (
                          <div key={f.label} className="mstation-detail">
                            <span className="mstation-detail-label">{f.label}</span>
                            <span className="mstation-detail-value">{f.value}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {task.readyToWork ? (
                      <button
                        type="button"
                        className="mstation-done-btn"
                        onClick={() => setConfirmTask(task)}
                      >
                        <Check size={20} />{' '}
                        {task.alu
                          ? `Sztuka ${Math.min(task.alu.done + 1, task.alu.quantity)}/${task.alu.quantity}`
                          : 'Oznacz jako zrobione'}
                      </button>
                    ) : (
                      <div className="mstation-waiting-note">⏳ Czeka na poprzedni etap</div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
              </div>
            ))}
          </div>
        </>
      )}

      {confirmTask && (() => {
        const workers = workersForTask(confirmTask, allWorkerStages, stationProfiles)
        return (
          <div className="mstation-confirm-overlay" onClick={() => !saving && setConfirmTask(null)}>
            <div className="mstation-confirm" onClick={(e) => e.stopPropagation()}>
              <div className="mstation-confirm-title">
                {confirmTask.alu
                  ? `Oznaczyć sztukę ${Math.min(confirmTask.alu.done + 1, confirmTask.alu.quantity)}/${confirmTask.alu.quantity}?`
                  : 'Oznaczyć etap jako zrobiony?'}
              </div>
              <div className="mstation-confirm-body">
                {confirmTask.isComplaint
                  ? `REKLAMACJA ${confirmTask.complaintNumber ?? ''} (zlecenie ${confirmTask.order.order_number})`
                  : `Zlecenie ${confirmTask.order.order_number}`}
                {confirmTask.alu && (
                  <>
                    <br />
                    {aluPosLabel(confirmTask)}
                  </>
                )}
                <br />
                {confirmTask.stageHeader} — {confirmTask.stageTitle}
              </div>
              {workers.length > 0 && (
                <>
                  <div className="mstation-worker-hint">Kto zrobił? Kliknij swój kafelek:</div>
                  <div className="mstation-worker-tiles">
                    {workers.map((w) => (
                      <button
                        key={w.id}
                        type="button"
                        className={`mstation-worker-tile ${w.id === lastWorkerId ? 'mstation-worker-tile--last' : ''}`}
                        disabled={saving}
                        onClick={() => {
                          rememberWorker(w)
                          void completeStage(confirmTask, { markInitials: w.initials })
                        }}
                      >
                        <span className="mstation-worker-tile-initials">{w.initials}</span>
                        {w.fullName && <span className="mstation-worker-tile-name">{w.fullName}</span>}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <div className="mstation-confirm-actions">
                <button type="button" className="mstation-confirm-cancel" onClick={() => setConfirmTask(null)} disabled={saving}>
                  Anuluj
                </button>
                {workers.length === 0 && (
                  <button type="button" className="mstation-confirm-ok" onClick={() => void completeStage(confirmTask)} disabled={saving}>
                    {saving ? 'Zapisywanie…' : 'Tak, zrobione'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {shortageConfirm && (
        <div className="mstation-confirm-overlay" onClick={() => !saving && setShortageConfirm(null)}>
          <div className="mstation-confirm" onClick={(e) => e.stopPropagation()}>
            <div className="mstation-confirm-title">Brak na magazynie</div>
            <div className="mstation-confirm-body">
              Zlecenie {shortageConfirm.task.order.order_number}
              <br />
              {shortageConfirm.shortages.slice(0, 4).map((s) => (
                <span key={s.r_component_name}>
                  {s.r_component_name}: brakuje {s.r_shortage}
                  <br />
                </span>
              ))}
              {shortageConfirm.shortages.length > 4 && <span>…i {shortageConfirm.shortages.length - 4} więcej</span>}
              Wydać mimo braku (stan zejdzie na minus) i oznaczyć etap?
            </div>
            <div className="mstation-confirm-actions">
              <button
                type="button"
                className="mstation-confirm-cancel"
                onClick={() => setShortageConfirm(null)}
                disabled={saving}
              >
                Anuluj
              </button>
              <button
                type="button"
                className="mstation-confirm-ok"
                onClick={() => void completeStage(shortageConfirm.task, { force: true, markInitials: shortageConfirm.markInitials })}
                disabled={saving}
              >
                {saving ? 'Zapisywanie…' : 'Wydaj mimo braku'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="mpack-toast">{toast}</div>}
    </div>
  )
}
