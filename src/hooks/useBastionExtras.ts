import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import { fetchAllPages } from '../lib/fetchPaged'
import { mapBastionExtraRow, type BastionExtra, type BastionExtraForm } from '../lib/bastionExtras'
import type { ToastVariant } from '../types'

type Toast = (message: string, variant: ToastVariant) => void

/** Bastion „Reszta": odczyt z tabeli, zapis przez RPC bastion_extra_* (baza pilnuje uprawnień). */
export function useBastionExtras(pushToast: Toast, active: boolean) {
  const [extras, setExtras] = useState<BastionExtra[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const loadedRef = useRef(false)

  const reload = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true)
      const { data, error } = await fetchAllPages<Record<string, unknown>>((from, to) =>
        supabase.from('bastion_extras').select('*').order('extra_no', { ascending: false }).range(from, to),
      )
      setLoading(false)
      if (error) {
        pushToast(`Błąd pobierania Reszty: ${error.message}`, 'error')
        return
      }
      loadedRef.current = true
      setExtras(data.map(mapBastionExtraRow))
    },
    [pushToast],
  )

  useEffect(() => {
    if (!active) return
    void reload({ silent: loadedRef.current })
  }, [active, reload])

  useEffect(() => {
    if (!active) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const bump = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void reload({ silent: true }), 400)
    }
    const channel = supabase
      .channel('bastion-extras')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bastion_extras' }, bump)
      .subscribe()
    return () => {
      if (timer) clearTimeout(timer)
      void supabase.removeChannel(channel)
    }
  }, [active, reload])

  const run = useCallback(
    async (label: string, call: () => PromiseLike<{ error: { message: string } | null }>, okMsg?: string) => {
      setBusy(true)
      const { error } = await call()
      setBusy(false)
      if (error) {
        pushToast(`${label}: ${error.message}`, 'error')
        return false
      }
      if (okMsg) pushToast(okMsg, 'success')
      await reload({ silent: true })
      return true
    },
    [pushToast, reload],
  )

  const create = useCallback(
    async (form: BastionExtraForm) => {
      setBusy(true)
      const { data, error } = await supabase.rpc('bastion_extra_create', { p: form })
      setBusy(false)
      if (error) {
        pushToast(`Nie dodano pozycji: ${error.message}`, 'error')
        return null
      }
      await reload({ silent: true })
      return Number(data)
    },
    [pushToast, reload],
  )

  const update = useCallback(
    (id: number, form: BastionExtraForm) => run('Nie zapisano pozycji', () => supabase.rpc('bastion_extra_update', { p_id: id, p: form }), 'Zapisano'),
    [run],
  )

  const setStage = useCallback(
    (id: number, stageKey: string, value: string) =>
      run('Nie zapisano etapu', () => supabase.rpc('bastion_extra_set_stage', { p_id: id, p_stage_key: stageKey, p_value: value })),
    [run],
  )

  const setLabel = useCallback(
    (id: number, label: string) => run('Nie zapisano naklejki', () => supabase.rpc('bastion_extra_set_flags', { p_id: id, p_label: label })),
    [run],
  )

  const setReleased = useCallback(
    (id: number, date: string | null) =>
      run('Nie zapisano realizacji', () =>
        supabase.rpc('bastion_extra_set_flags', date ? { p_id: id, p_released_at: date } : { p_id: id, p_clear_released: true }),
      ),
    [run],
  )

  const setCancelled = useCallback(
    (id: number, cancelled: boolean) =>
      run(cancelled ? 'Nie anulowano' : 'Nie przywrócono', () => supabase.rpc('bastion_extra_set_flags', { p_id: id, p_cancelled: cancelled }), cancelled ? 'Anulowano' : 'Przywrócono'),
    [run],
  )

  return { extras, loading, busy, reload, create, update, setStage, setLabel, setReleased, setCancelled }
}
