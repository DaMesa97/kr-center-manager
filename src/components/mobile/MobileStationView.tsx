import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Check, RefreshCw, Zap } from 'lucide-react'
import { supabase } from '../../supabaseClient'
import { isReleaseDateEmpty, isRushOrderSequence, parseProductionStages } from '../../utils'
import { buildTasks, fieldsForStage, type MyTask } from '../../lib/stationLogic'
import type { Order, WorkerStage } from '../../types'

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
  const [loading, setLoading] = useState(true)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [confirmTask, setConfirmTask] = useState<MyTask | null>(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const mountedRef = useRef(true)

  const flash = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  const load = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    const [stagesRes, ordersRes] = await Promise.all([
      supabase.from('worker_stages').select('*').eq('worker_id', userId),
      supabase.from('orders').select('*').order('order_number', { ascending: false }).limit(2000),
    ])
    if (!mountedRef.current) return
    setLoading(false)
    if (stagesRes.error || ordersRes.error) {
      flash('Błąd ładowania zadań')
      return
    }
    setWorkerStages((stagesRes.data ?? []) as WorkerStage[])
    const filtered = (ordersRes.data ?? []).filter((o: Order) => {
      const extra = o.extra_fields as Record<string, unknown> | null
      if (extra?.cancelled === true) return false
      if (o.release_date && !isReleaseDateEmpty(o.release_date)) return false
      return true
    }) as Order[]
    setOrders(filtered)
  }, [userId])

  useEffect(() => {
    mountedRef.current = true
    void load()
    // Realtime — gdy inny pracownik zmieni etap, odśwież lokalnie (świeżość na hali)
    const channel = supabase
      .channel(`mobile-station:${userId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders' },
        (payload) => {
          const updated = payload.new as Order
          setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)))
        },
      )
      .subscribe()
    return () => {
      mountedRef.current = false
      void supabase.removeChannel(channel)
    }
  }, [load, userId])

  const tasks = useMemo(() => buildTasks(orders, workerStages), [orders, workerStages])
  const readyCount = tasks.filter((t) => t.readyToWork).length

  const completeStage = async (task: MyTask) => {
    const actualKey = task.actualStageKey
    const current = parseProductionStages(task.order.production_stages, task.category)
    // Guard: ktoś inny mógł już oznaczyć ten etap (realtime/odświeżenie)
    if (current[actualKey] === 'T') {
      flash('Ten etap jest już oznaczony')
      setConfirmTask(null)
      return
    }
    setSaving(true)
    try {
      const updated = { ...current, [actualKey]: 'T' }
      const { error } = await supabase
        .from('orders')
        .update({ production_stages: updated })
        .eq('id', task.order.id!)
      if (!mountedRef.current) return
      if (error) { flash(`Błąd: ${error.message}`); return }
      setOrders((prev) =>
        prev.map((o) => (o.id === task.order.id ? { ...o, production_stages: updated } : o)),
      )
      flash('Etap oznaczony ✓')
      setConfirmTask(null)
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
        <div className="mstation-list">
          {tasks.map((task) => {
            const key = `${task.order.id}-${task.stageKey}`
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
      )}

      {confirmTask && (
        <div className="mstation-confirm-overlay" onClick={() => !saving && setConfirmTask(null)}>
          <div className="mstation-confirm" onClick={(e) => e.stopPropagation()}>
            <div className="mstation-confirm-title">Oznaczyć etap jako zrobiony?</div>
            <div className="mstation-confirm-body">
              Zlecenie {confirmTask.order.order_number}<br />
              {confirmTask.stageHeader} — {confirmTask.stageTitle}
            </div>
            <div className="mstation-confirm-actions">
              <button type="button" className="mstation-confirm-cancel" onClick={() => setConfirmTask(null)} disabled={saving}>
                Anuluj
              </button>
              <button type="button" className="mstation-confirm-ok" onClick={() => void completeStage(confirmTask)} disabled={saving}>
                {saving ? 'Zapisywanie…' : 'Tak, zrobione'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="mpack-toast">{toast}</div>}
    </div>
  )
}
