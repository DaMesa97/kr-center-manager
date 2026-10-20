import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Check, RefreshCw, Zap } from 'lucide-react'
import { supabase } from '../../supabaseClient'
import { mirrorStageKey } from '../../lib/stageMirror'
import { isReleaseDateEmpty, isRushOrderSequence, parseProductionStages } from '../../utils'
import {
  buildComplaintTasks,
  buildTasks,
  fieldsForStage,
  sortTasks,
  workersForTask,
  type MyTask,
  type StationWorker,
} from '../../lib/stationLogic'
import type { Complaint, Order, WorkerStage } from '../../types'

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
}

export default function MobileStationView({ userId }: Props) {
  const [workerStages, setWorkerStages] = useState<WorkerStage[]>([])
  const [orders, setOrders] = useState<Order[]>([])
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

  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flash = (msg: string, sticky = false) => {
    // kasuj POPRZEDNI timer — stary timeout gasił nowy toast po ułamku
    // sekundy, a ostrzeżenia znikały pod toastem sukcesu
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    setToast(msg)
    flashTimerRef.current = sticky ? null : setTimeout(() => setToast(null), 2500)
  }

  const load = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    // Tylko OTWARTE + paginacja — PostgREST ucina do 1000 wierszy, a stary
    // limit liczył też wydane: starsze otwarte zlecenia wypadały z listy zadań
    const fetchAllOpenOrders = async (): Promise<{ data: Order[]; error: { message: string } | null }> => {
      const all: Order[] = []
      let from = 0
      const PAGE = 1000
      while (true) {
        const { data, error } = await supabase
          .from('orders')
          .select('*')
          .is('release_date', null)
          .order('id', { ascending: false })
          .range(from, from + PAGE - 1)
        if (error) return { data: all, error }
        if (!data || data.length === 0) break
        all.push(...(data as Order[]))
        if (data.length < PAGE) break
        from += PAGE
      }
      return { data: all, error: null }
    }
    const [stagesRes, ordersRes, profileRes, complaintsRes, allWsRes, profilesRes] = await Promise.all([
      supabase.from('worker_stages').select('*').eq('worker_id', userId),
      fetchAllOpenOrders(),
      supabase.from('profiles').select('initials').eq('id', userId).single(),
      supabase.from('complaints').select('*').is('release_date', null),
      supabase.from('worker_stages').select('*'),
      supabase.from('profiles').select('id, initials, full_name'),
    ])
    if (!mountedRef.current) return
    setLoading(false)
    if (stagesRes.error || ordersRes.error) {
      flash('Błąd ładowania zadań')
      return
    }
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
    const filtered = (ordersRes.data ?? []).filter((o: Order) => {
      const extra = o.extra_fields as Record<string, unknown> | null
      if (extra?.cancelled === true) return false
      if (o.release_date && !isReleaseDateEmpty(o.release_date)) return false
      return true
    }) as Order[]
    setOrders(filtered)
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
          if (payload.eventType === 'UPDATE') {
            const updated = payload.new as Order
            const extra = updated.extra_fields as Record<string, unknown> | null
            if (extra?.cancelled === true || (updated.release_date && !isReleaseDateEmpty(updated.release_date))) {
              // anulowane/wydane w międzyczasie — zdejmij z listy zadań
              setOrders((prev) => prev.filter((o) => o.id !== updated.id))
            } else {
              setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)))
            }
          } else {
            scheduleReload()
          }
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
    () => sortTasks([...buildTasks(orders, workerStages), ...buildComplaintTasks(complaints, workerStages)]),
    [orders, complaints, workerStages],
  )
  const readyCount = tasks.filter((t) => t.readyToWork).length

  // Grupowanie po etapie — kilka etapów (np. E3 i E5) wymieszanych na jednej
  // liście to prosta droga do oznaczenia złego. Sekcje + chipy filtra.
  const groups = useMemo(() => {
    const catOrder = ['STA', 'Disting', 'ST', 'Techniczne', 'Bastion', 'DrzwiWewnetrzne']
    const multiCat = new Set(tasks.map((t) => t.category)).size > 1
    const map = new Map<string, { label: string; category: string; header: string; tasks: MyTask[] }>()
    for (const t of tasks) {
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
  }, [tasks])
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

  const completeStage = async (task: MyTask, opts?: { force?: boolean; markInitials?: string }) => {
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
      setConfirmTask(null)
      setShortageConfirm(null)
    } finally {
      if (mountedRef.current) setSaving(false)
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

      {tasks.length === 0 ? (
        <div className="mpack-info">Brak zadań dla Twoich etapów 🎉</div>
      ) : (
        <>
          {groups.length > 1 && (
            <div className="mstation-stage-chips">
              <button
                type="button"
                className={`mstation-stage-chip ${activeFilter === 'all' ? 'mstation-stage-chip--active' : ''}`}
                onClick={() => setStageFilterPersist('all')}
              >
                Wszystkie ({tasks.length})
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
            // Reklamacje mają własną numerację id — prefiks chroni przed kolizją kluczy z zamówieniami
            const key = `${task.isComplaint ? 'r' : ''}${task.order.id}-${task.stageKey}`
            const expanded = expandedKey === key
            const urgent = isRushOrderSequence(task.order.sequence)
            const details = expanded ? fieldsForStage(task.order, task.category, task.actualStageKey) : []
            return (
              <div key={key} className={`mstation-card ${task.readyToWork ? '' : 'mstation-card--waiting'}`}>
                <button
                  type="button"
                  className="mstation-card-head"
                  onClick={() => setExpandedKey(expanded ? null : key)}
                >
                  <span className="mpack-cat" style={{ background: CAT_COLORS[task.category] ?? '#475569' }}>
                    {task.category === 'DrzwiWewnetrzne' ? 'Wewn.' : task.category}
                  </span>
                  <span className="mstation-card-main">
                    <span className="mstation-card-nr">
                      {urgent && <Zap size={13} className="mstation-urgent" />}
                      {task.order.order_number} · {task.order.company}
                      {task.isComplaint && (
                        <span className="mstation-rekl-badge" title={`Zadanie z reklamacji ${task.complaintNumber ?? ''}`}>
                          REKLAMACJA
                        </span>
                      )}
                    </span>
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
                        <Check size={20} /> Oznacz jako zrobione
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
              <div className="mstation-confirm-title">Oznaczyć etap jako zrobiony?</div>
              <div className="mstation-confirm-body">
                {confirmTask.isComplaint
                  ? `REKLAMACJA ${confirmTask.complaintNumber ?? ''} (zlecenie ${confirmTask.order.order_number})`
                  : `Zlecenie ${confirmTask.order.order_number}`}
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
