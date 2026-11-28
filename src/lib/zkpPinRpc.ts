// D53: ustawianie PIN-u podpisu etapu ZKP (sam pracownik albo administrator) — wywołania bazy.
import { supabase } from '../supabaseClient'
import { zkpPinRpcErrorText } from './zkpPin'

export type ZkpPinStatus = { r_profile_id: string; r_has_pin: boolean; r_set_at: string | null; r_locked: boolean }

/** Kto ma PIN: administrator — wszyscy, pozostali — tylko siebie. null + komunikat przy błędzie. */
export async function fetchZkpPinStatus(): Promise<{ rows: ZkpPinStatus[] | null; error: string | null }> {
  const { data, error } = await supabase.rpc('zkp_pin_status')
  if (error) return { rows: null, error: zkpPinRpcErrorText(error) }
  return { rows: (data ?? []) as ZkpPinStatus[], error: null }
}

/**
 * Ustawia PIN. Pracownik zmieniający własny istniejący PIN podaje obecny (currentPin).
 * ok=false + error — komunikat (w tym „obecny PIN błędny”).
 */
export async function setZkpPin(profileId: string, newPin: string, currentPin?: string | null): Promise<{ ok: boolean; error: string | null }> {
  const { data, error } = await supabase.rpc('zkp_set_pin', {
    p_profile_id: profileId,
    p_new_pin: newPin,
    p_current_pin: currentPin ?? null,
  })
  if (error) return { ok: false, error: zkpPinRpcErrorText(error) }
  if (data === false) return { ok: false, error: 'Obecny PIN jest błędny (5 błędów = blokada na 15 minut)' }
  return { ok: true, error: null }
}

/** Administrator usuwa PIN (np. pracownik zapomniał) — potem ustawia nowy. */
export async function clearZkpPin(profileId: string): Promise<string | null> {
  const { error } = await supabase.rpc('zkp_clear_pin', { p_profile_id: profileId })
  return error ? zkpPinRpcErrorText(error) : null
}
