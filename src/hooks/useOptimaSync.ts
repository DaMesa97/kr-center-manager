import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchOptimaSyncState, runOptimaImportNow, type OptimaBaza, type OptimaSyncState } from '../lib/optimaRo'
import type { ToastVariant } from '../types'

/**
 * Stan importu RO z Optimy (optima_ro_sync_state) + „Synchronizuj teraz".
 * Import działa asynchronicznie — wynik pojawia się po 1–2 min, więc po
 * uruchomieniu odpytujemy stan co 20 s przez ~3 min (do zmiany last_run_at).
 */
export function useOptimaSync(pushToast: (message: string, variant: ToastVariant) => void, onImported?: () => void) {
  const [states, setStates] = useState<OptimaSyncState[]>([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const onImportedRef = useRef(onImported)
  onImportedRef.current = onImported

  const load = useCallback(async (): Promise<OptimaSyncState[] | null> => {
    try {
      const rows = await fetchOptimaSyncState()
      setStates(rows)
      return rows
    } catch (e) {
      console.error('[optima] stan synchronizacji', e)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [load])

  const runNow = useCallback(
    async (baza: OptimaBaza | null = null) => {
      if (running) return
      setRunning(true)
      const before = new Map(states.map((s) => [s.baza, s.last_run_at]))
      try {
        await runOptimaImportNow(baza)
        pushToast('Synchronizacja z Optimą uruchomiona — wynik za 1–2 minuty', 'info')
      } catch (e) {
        console.error('[optima] optima_ro_import_now', e)
        pushToast(`Nie uruchomiono synchronizacji: ${e instanceof Error ? e.message : String(e)}`, 'error')
        setRunning(false)
        return
      }
      let ticks = 0
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = setInterval(async () => {
        ticks += 1
        const rows = await load()
        const done = rows?.some((s) => (baza ? s.baza === baza : true) && s.last_run_at !== before.get(s.baza))
        if (done || ticks >= 9) {
          if (pollRef.current) clearInterval(pollRef.current)
          pollRef.current = null
          setRunning(false)
          if (done) {
            pushToast('Synchronizacja z Optimą zakończona', 'success')
            onImportedRef.current?.()
          }
        }
      }, 20_000)
    },
    [running, states, load, pushToast],
  )

  return { states, loading, running, reload: load, runNow }
}
