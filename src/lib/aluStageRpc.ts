// Runda 10 (28.11): oznaczenie sztuki aluminium z liczbą sztuk widzianą przy kliknięciu.
// Baza (migracja 20261128020000) odmawia (P0409), gdy stan się zmienił — np. ponowienie po
// zgubionej odpowiedzi nie odliczy drugiej sztuki. Baza bez tej migracji nie zna parametru
// (PGRST202) — wtedy wywołanie jak dotąd, bez ochrony.
import { supabase } from '../supabaseClient'
import { appPrompt } from './appDialogs'
import type { AluPositionStages } from '../types'
import { ALU_PIN_WRONG_CODE, aluMarkWithPin, aluPinErrorFromData, type AluMarkResult } from './aluStation'

/** Ile sztuk etap ma wg danych na ekranie — bez obcinania do ilości pozycji (tak liczy baza). */
export function aluDoneSeen(stages: AluPositionStages | null | undefined, stageKey: string): number | null {
  const d = Number(stages?.[stageKey]?.done ?? 0)
  return Number.isFinite(d) ? d : null
}

/**
 * Oznaczenie sztuki. D53: opcjonalny PIN osoby podpisującej (migracja 20261128035300). Baza bez nowszych
 * parametrów odpowiada PGRST202 — wtedy ponowienie bez p_pin, a potem bez p_expected_done.
 * Błędny PIN baza zwraca jako dane {_zkp_pin_error} (licznik prób musi się zapisać) — tu zamieniany na błąd P0401.
 */
export async function rpcMarkAluStage(
  positionId: number,
  stageKey: string,
  initials: string,
  expectedDone: number | null,
  pin: string | null = null,
): Promise<AluMarkResult> {
  const base: Record<string, unknown> = { p_position_id: positionId, p_stage_key: stageKey, p_initials: initials }
  const attempts: Record<string, unknown>[] = []
  if (expectedDone != null && pin) attempts.push({ ...base, p_expected_done: expectedDone, p_pin: pin })
  if (expectedDone == null && pin) attempts.push({ ...base, p_pin: pin })
  if (expectedDone != null) attempts.push({ ...base, p_expected_done: expectedDone })
  attempts.push(base)
  let res = await supabase.rpc('mark_alu_position_stage', attempts[0])
  for (let i = 1; i < attempts.length && res.error?.code === 'PGRST202'; i++) {
    res = await supabase.rpc('mark_alu_position_stage', attempts[i])
  }
  const pinError = res.error ? null : aluPinErrorFromData(res.data)
  if (pinError) return { data: null, error: { code: ALU_PIN_WRONG_CODE, message: pinError } }
  return { data: res.data, error: res.error }
}

/** D53: okienko PIN na komputerze (pole maskowane). null = anulowano. */
export function appPinPrompt(message: string): Promise<string | null> {
  return appPrompt(message, { title: 'Podpis etapu ZKP — PIN', confirmLabel: 'Podpisz', inputType: 'password' })
}

/** D53: oznaczenie z okienkiem PIN, gdy etap ZKP tego wymaga (askPin — okienko danego ekranu). */
export function rpcMarkAluStageSigned(
  positionId: number,
  stageKey: string,
  initials: string,
  expectedDone: number | null,
  askPin: (message: string) => Promise<string | null>,
): Promise<AluMarkResult> {
  return aluMarkWithPin((pin) => rpcMarkAluStage(positionId, stageKey, initials, expectedDone, pin), askPin)
}

/** Cofnięcie sztuki z tą samą ochroną (migracja 20261128022000; bez niej — jak dotąd). */
export async function rpcUndoAluStage(positionId: number, stageKey: string, expectedDone: number | null) {
  const base = { p_position_id: positionId, p_stage_key: stageKey }
  if (expectedDone == null) return supabase.rpc('undo_alu_position_stage', base)
  const res = await supabase.rpc('undo_alu_position_stage', { ...base, p_expected_done: expectedDone })
  if (res.error?.code === 'PGRST202') return supabase.rpc('undo_alu_position_stage', base)
  return res
}

// D54: tekst błędu (czysta funkcja w aluStation — testowalna bez klienta Supabase)
export { ALU_ZKP_BLOCK_CODE, aluMarkErrorText } from './aluStation'
