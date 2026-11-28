// Runda 10 (28.11): oznaczenie sztuki aluminium z liczbą sztuk widzianą przy kliknięciu.
// Baza (migracja 20261128020000) odmawia (P0409), gdy stan się zmienił — np. ponowienie po
// zgubionej odpowiedzi nie odliczy drugiej sztuki. Baza bez tej migracji nie zna parametru
// (PGRST202) — wtedy wywołanie jak dotąd, bez ochrony.
import { supabase } from '../supabaseClient'
import type { AluPositionStages } from '../types'

/** Ile sztuk etap ma wg danych na ekranie — bez obcinania do ilości pozycji (tak liczy baza). */
export function aluDoneSeen(stages: AluPositionStages | null | undefined, stageKey: string): number | null {
  const d = Number(stages?.[stageKey]?.done ?? 0)
  return Number.isFinite(d) ? d : null
}

export async function rpcMarkAluStage(positionId: number, stageKey: string, initials: string, expectedDone: number | null) {
  const base = { p_position_id: positionId, p_stage_key: stageKey, p_initials: initials }
  if (expectedDone == null) return supabase.rpc('mark_alu_position_stage', base)
  const res = await supabase.rpc('mark_alu_position_stage', { ...base, p_expected_done: expectedDone })
  if (res.error?.code === 'PGRST202') return supabase.rpc('mark_alu_position_stage', base)
  return res
}

/** Cofnięcie sztuki z tą samą ochroną (migracja 20261128022000; bez niej — jak dotąd). */
export async function rpcUndoAluStage(positionId: number, stageKey: string, expectedDone: number | null) {
  const base = { p_position_id: positionId, p_stage_key: stageKey }
  if (expectedDone == null) return supabase.rpc('undo_alu_position_stage', base)
  const res = await supabase.rpc('undo_alu_position_stage', { ...base, p_expected_done: expectedDone })
  if (res.error?.code === 'PGRST202') return supabase.rpc('undo_alu_position_stage', base)
  return res
}
