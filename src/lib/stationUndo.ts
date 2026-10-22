// „Cofnij” tuż po pomyłce na stanowisku (desktop i mobile — jedna logika).
// Zlecenie: revert_order_stage = zwrot wydanego towaru (ZWR) + wyczyszczenie
// etapu w jednej transakcji, potem lustro u partnera (Disting Plus / Titan).
// Reklamacja: tylko wyczyszczenie etapu (bez magazynu) + lustro pary.
import { supabase } from '../supabaseClient'
import { mirrorStageKey } from './stageMirror'
import type { MyTask } from './stationLogic'

export type StationUndoResult =
  | { ok: true; returned: number; mirrorKey: string | null; mirrorError?: string }
  | { ok: false; error: string }

export async function undoStationTask(task: MyTask): Promise<StationUndoResult> {
  const key = task.actualStageKey
  const mirrorKey = mirrorStageKey(task.category, key) ?? null

  if (task.isComplaint) {
    if (task.complaintId == null) return { ok: false, error: 'Brak identyfikatora reklamacji' }
    const { error } = await supabase.rpc('update_complaint_stage', {
      p_complaint_id: task.complaintId,
      p_stage_key: key,
      p_stage_value: '',
    })
    if (error) return { ok: false, error: error.message }
    let mirrorError: string | undefined
    if (mirrorKey && task.linkedComplaintId != null) {
      const { error: mErr } = await supabase.rpc('update_complaint_stage', {
        p_complaint_id: task.linkedComplaintId,
        p_stage_key: mirrorKey,
        p_stage_value: '',
      })
      if (mErr) mirrorError = mErr.message
    }
    return { ok: true, returned: 0, mirrorKey, mirrorError }
  }

  const orderId = task.order.id
  if (orderId == null) return { ok: false, error: 'Brak identyfikatora zlecenia' }
  const { data, error } = await supabase.rpc('revert_order_stage', { p_order_id: orderId, p_stage_key: key })
  if (error) return { ok: false, error: error.message }
  let mirrorError: string | undefined
  if (mirrorKey && task.order.linked_order_id != null) {
    const { error: mErr } = await supabase.rpc('update_order_stage', {
      p_order_id: task.order.linked_order_id,
      p_stage_key: mirrorKey,
      p_stage_value: '',
    })
    if (mErr) mirrorError = mErr.message
  }
  return { ok: true, returned: ((data ?? []) as unknown[]).length, mirrorKey, mirrorError }
}

/** Komunikat po cofnięciu (wspólny dla desktopu i mobile). */
export function stationUndoMessage(res: Extract<StationUndoResult, { ok: true }>, isComplaint: boolean): string {
  const base = isComplaint ? 'Cofnięto etap reklamacji' : 'Cofnięto etap'
  const zwr = res.returned > 0 ? ` — zwrócono na magazyn ${res.returned} pozycji (ZWR)` : ''
  const mirror = res.mirrorError ? ` · UWAGA: nie cofnięto u powiązanego (${res.mirrorError})` : ''
  return base + zwr + mirror
}

/** Lokalna podmiana etapu (i lustra u partnera) po cofnięciu. */
export function clearStageLocally<T extends { id?: number | null; production_stages?: unknown; category?: string | null }>(
  rows: T[],
  targetId: number | null | undefined,
  key: string,
  partnerId: number | null | undefined,
  mirrorKey: string | null,
  parse: (stages: unknown, category: string | null | undefined) => Record<string, string>,
): T[] {
  return rows.map((r) => {
    if (r.id != null && r.id === targetId) {
      return { ...r, production_stages: { ...parse(r.production_stages, r.category), [key]: '' } }
    }
    if (mirrorKey && partnerId != null && r.id === partnerId) {
      return { ...r, production_stages: { ...parse(r.production_stages, r.category), [mirrorKey]: '' } }
    }
    return r
  })
}
