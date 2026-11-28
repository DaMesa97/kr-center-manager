// =====================================================================
// D10 (28.11.2026): nieudane RO z Optimy (tabela optima_ro_failures, migracja 20261128036100).
// Import optima-ro-import zapisuje tu RO, którego nie zdołał zapisać, i sam ponawia (do 5 prób);
// Weryfikacja pokazuje otwarte wpisy z „Ponów” (rpc optima_ro_blad_ponow) i „Pomiń” (optima_ro_blad_pomin).
// Przed wgraniem migracji tabeli nie ma — sekcja się nie pokazuje (fetch zwraca null).
// =====================================================================
import { supabase } from '../supabaseClient'
import { OPTIMA_BAZA_LABEL, type OptimaBaza } from './optimaRo'

export type OptimaRoFailure = {
  id: number
  baza: OptimaBaza
  document_id: number
  full_number: string | null
  error: string | null
  attempts: number
  first_failed_at: string
  last_failed_at: string
  retry_requested_at: string | null
}

/** Automatyczne ponowienia w imporcie (MAX_PROB_AUTO w optima-ro-import) — po nich tylko „Ponów” ręcznie */
export const OPTIMA_RO_MAX_AUTO = 5

/** Brak tabeli / funkcji (migracja niewgrana) — nie pokazujemy sekcji zamiast błędu */
export function isMissingRelation(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  return error.code === '42P01' || error.code === 'PGRST205' || error.code === 'PGRST202' || /does not exist|could not find/i.test(error.message ?? '')
}

/** Numer RO tak, jak w aplikacji: MR Profil z przedrostkiem „MR/” (jak order_number z importu) */
export function failureLabel(f: Pick<OptimaRoFailure, 'baza' | 'full_number' | 'document_id'>): string {
  const n = (f.full_number ?? '').trim() || `dokument #${f.document_id}`
  return f.baza === 'MR' && !/^MR\//i.test(n) ? `MR/${n}` : n
}

export function failureStatus(f: Pick<OptimaRoFailure, 'attempts' | 'retry_requested_at'>): string {
  if (f.retry_requested_at) return 'czeka na ponowienie'
  if (f.attempts >= OPTIMA_RO_MAX_AUTO) return `${f.attempts} prób — import już sam nie ponawia, kliknij „Ponów”`
  return `${f.attempts}/${OPTIMA_RO_MAX_AUTO} prób — import ponowi przy następnym przebiegu`
}

export const bazaLabel = (b: OptimaBaza): string => OPTIMA_BAZA_LABEL[b] ?? b

/** null = tabela niedostępna (migracja niewgrana albo brak uprawnień) */
export async function fetchOptimaRoFailures(): Promise<OptimaRoFailure[] | null> {
  const { data, error } = await supabase
    .from('optima_ro_failures')
    .select('id, baza, document_id, full_number, error, attempts, first_failed_at, last_failed_at, retry_requested_at')
    .is('resolved_at', null)
    .order('last_failed_at', { ascending: false })
    .limit(500)
  if (error) {
    if (!isMissingRelation(error)) console.warn('[nieudane RO]', error.message)
    return null
  }
  return (data ?? []) as OptimaRoFailure[]
}

export async function retryOptimaRoFailure(id: number): Promise<string | null> {
  const { error } = await supabase.rpc('optima_ro_blad_ponow', { p_id: id })
  return error ? error.message : null
}

export async function skipOptimaRoFailure(id: number): Promise<string | null> {
  const { error } = await supabase.rpc('optima_ro_blad_pomin', { p_id: id })
  return error ? error.message : null
}
