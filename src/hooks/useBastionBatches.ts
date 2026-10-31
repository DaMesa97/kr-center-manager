import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import { batchNoByOrderId, mapBastionBatchRow, type BastionBatch } from '../lib/bastionBatches'
import type { ToastVariant } from '../types'

type Toast = (message: string, variant: ToastVariant) => void

/**
 * Partie ościeżnic Bastion: odczyt z widoku bastion_batches_overview,
 * zapis przez RPC (baza pilnuje: kierownik tworzy/edytuje skład, etapy odhacza
 * kierownik albo pracownik z etapami Bastion; zamykanie automatyczne).
 */
export function useBastionBatches(pushToast: Toast, active: boolean) {
  const [batches, setBatches] = useState<BastionBatch[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const loadedRef = useRef(false)

  const reload = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true)
    const { data, error } = await supabase
      .from('bastion_batches_overview')
      .select('*')
      .order('status', { ascending: false }) // open przed closed
      .order('batch_no', { ascending: false })
      .limit(500)
    setLoading(false)
    if (error) {
      pushToast(`Błąd pobierania partii: ${error.message}`, 'error')
      return
    }
    loadedRef.current = true
    setBatches(((data ?? []) as Record<string, unknown>[]).map(mapBastionBatchRow))
  }, [pushToast])

  useEffect(() => {
    if (!active) return
    void reload({ silent: loadedRef.current })
  }, [active, reload])

  // realtime: zmiana partii / pozycji u kogoś innego → ciche odświeżenie (debounce)
  useEffect(() => {
    if (!active) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const bump = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void reload({ silent: true }), 400)
    }
    const channel = supabase
      .channel('bastion-batches')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bastion_batches' }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bastion_batch_items' }, bump)
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

  const createBatch = useCallback(
    async (orderIds: number[], notes?: string) => {
      setBusy(true)
      const { data, error } = await supabase.rpc('bastion_create_batch', {
        p_order_ids: orderIds,
        p_notes: notes?.trim() || null,
      })
      setBusy(false)
      if (error) {
        pushToast(`Nie utworzono partii: ${error.message}`, 'error')
        return null
      }
      await reload({ silent: true })
      return Number(data)
    },
    [pushToast, reload],
  )

  const addOrders = useCallback(
    (batchId: number, orderIds: number[]) =>
      run('Nie dodano zleceń do partii', () => supabase.rpc('bastion_batch_add_orders', { p_batch_id: batchId, p_order_ids: orderIds }), 'Dodano do partii'),
    [run],
  )

  const removeOrder = useCallback(
    (batchId: number, orderId: number) =>
      run('Nie usunięto zlecenia z partii', () => supabase.rpc('bastion_batch_remove_order', { p_batch_id: batchId, p_order_id: orderId })),
    [run],
  )

  const deleteBatch = useCallback(
    (batchId: number) => run('Nie usunięto partii', () => supabase.rpc('bastion_delete_batch', { p_batch_id: batchId }), 'Partia usunięta'),
    [run],
  )

  const setStage = useCallback(
    (batchId: number, stageKey: string, value: string) =>
      run('Nie zapisano etapu partii', () => supabase.rpc('bastion_batch_set_stage', { p_batch_id: batchId, p_stage_key: stageKey, p_value: value })),
    [run],
  )

  const setNotes = useCallback(
    (batchId: number, notes: string) =>
      run('Nie zapisano notatki partii', () => supabase.rpc('bastion_batch_set_notes', { p_batch_id: batchId, p_notes: notes })),
    [run],
  )

  const batchNoById = useMemo(() => batchNoByOrderId(batches), [batches])

  return { batches, loading, busy, reload, createBatch, addOrders, removeOrder, deleteBatch, setStage, setNotes, batchNoById }
}
