import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../supabaseClient'
import { BASTION_STAGE_DEFS, STA_DISTING_STAGE_DEFS, ST_STAGE_DEFS, ST_TITAN_STAGE_DEFS } from '../constants'
import type { Profile, WorkerStage } from '../types'

type Props = {
  open: boolean
  worker: Profile | null
  onClose: () => void
  onSaved: () => void
}

type WorkerStageKey = {
  category: string
  stage_key: string
}

const CATEGORY_DEFS: Array<{
  category: string
  label: string
  defs: Array<{ key: string; header: string; title?: string }>
  suffix?: string
}> = [
  { category: 'STA', label: 'STA', defs: STA_DISTING_STAGE_DEFS },
  { category: 'Disting', label: 'Disting', defs: STA_DISTING_STAGE_DEFS },
  { category: 'ST', label: 'ST (standard)', defs: ST_STAGE_DEFS },
  { category: 'ST', label: 'ST (Titan)', defs: ST_TITAN_STAGE_DEFS, suffix: 'titan_' },
  { category: 'Techniczne', label: 'Techniczne', defs: [] },
  { category: 'Bastion', label: 'Bastion', defs: BASTION_STAGE_DEFS },
]

const keyFor = (category: string, stageKey: string) => `${category}||${stageKey}`

export default function WorkerStagesModal({ open, worker, onClose, onSaved }: Props) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [initialSelected, setInitialSelected] = useState<Set<string>>(new Set())

  const workerName = worker?.full_name ?? ''

  useEffect(() => {
    if (!open || !worker) return
    let mounted = true

    const load = async () => {
      setLoading(true)
      const { data, error } = await supabase
        .from('worker_stages')
        .select('id, worker_id, category, stage_key, created_at, created_by')
        .eq('worker_id', worker.id)

      if (!mounted) return
      setLoading(false)
      if (error) return

      const rows = (data ?? []) as WorkerStage[]
      const keys = new Set(rows.map((r) => keyFor(r.category, r.stage_key)))
      setSelected(new Set(keys))
      setInitialSelected(new Set(keys))
    }

    void load()
    return () => {
      mounted = false
    }
  }, [open, worker])

  const isChecked = useCallback(
    (category: string, stageKey: string) => selected.has(keyFor(category, stageKey)),
    [selected],
  )

  const toggle = useCallback((category: string, stageKey: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      const k = keyFor(category, stageKey)
      if (checked) next.add(k)
      else next.delete(k)
      return next
    })
  }, [])

  const diff = useMemo(() => {
    const toAdd: WorkerStageKey[] = []
    const toRemove: WorkerStageKey[] = []

    for (const k of selected) {
      if (!initialSelected.has(k)) {
        const [category, stage_key] = k.split('||')
        toAdd.push({ category, stage_key })
      }
    }
    for (const k of initialSelected) {
      if (!selected.has(k)) {
        const [category, stage_key] = k.split('||')
        toRemove.push({ category, stage_key })
      }
    }
    return { toAdd, toRemove }
  }, [selected, initialSelected])

  const onSave = useCallback(async () => {
    if (!worker) return
    setSaving(true)
    try {
      await Promise.all([
        ...diff.toAdd.map((row) =>
          supabase.from('worker_stages').insert({
            worker_id: worker.id,
            category: row.category,
            stage_key: row.stage_key,
          }),
        ),
        ...diff.toRemove.map((row) =>
          supabase
            .from('worker_stages')
            .delete()
            .eq('worker_id', worker.id)
            .eq('category', row.category)
            .eq('stage_key', row.stage_key),
        ),
      ])
      setInitialSelected(new Set(selected))
      onSaved()
      onClose()
    } finally {
      setSaving(false)
    }
  }, [diff.toAdd, diff.toRemove, onClose, onSaved, selected, worker])

  if (!open || !worker) return null

  return createPortal(
    <div className="modal-overlay" onClick={() => !saving && onClose()}>
      <div className="worker-stages-modal" onClick={(e) => e.stopPropagation()}>
        <div className="worker-stages-modal__header">
          <h2>Etapy produkcji — {workerName}</h2>
          <button type="button" className="btn btn-icon btn-ghost" onClick={onClose} disabled={saving}>
            X
          </button>
        </div>

        <div className="worker-stages-modal__body">
          {loading ? (
            <p className="no-results">Ładowanie przypisań…</p>
          ) : (
            CATEGORY_DEFS.map((section) => (
              <section key={section.label} className="worker-stages-section">
                <h3>{section.label}</h3>
                {section.defs.length === 0 ? (
                  <p className="worker-stages-empty">Brak etapów do przypisania.</p>
                ) : (
                  <div className="worker-stages-list">
                    {section.defs.map((def) => {
                      const stageKey = section.suffix ? `${section.suffix}${def.key}` : def.key
                      return (
                        <label key={`${section.label}-${def.key}`} className="worker-stage-item">
                          <input
                            type="checkbox"
                            checked={isChecked(section.category, stageKey)}
                            onChange={(e) => toggle(section.category, stageKey, e.target.checked)}
                            disabled={saving}
                          />
                          <span>
                            {def.header} — {def.title}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                )}
              </section>
            ))
          )}
        </div>

        <div className="worker-stages-modal__footer">
          <button type="button" className="btn btn-sm btn-primary" onClick={onClose} disabled={saving}>
            Anuluj
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void onSave()} disabled={saving}>
            {saving ? 'Zapisywanie…' : 'Zapisz'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
