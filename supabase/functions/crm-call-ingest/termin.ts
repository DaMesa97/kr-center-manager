// Termin zadania i dopasowanie klienta liczone razem z bazą (jedno źródło prawdy):
//  * terminZBazy: dzień roboczy jak terminAkcji(), ale przepuszczony przez crm.termin_roboczy(), które zna też święta
//    (crm.dni_wolne) – dzięki temu opis zadania i zdarzenie pokazują tę samą datę, która wyląduje w leady.nastepny_krok;
//  * znajdzLeadaZBazy: crm.znajdz_leada(email, telefon) – telefon → e-mail → kontakty przejęte przy scalaniu → domena firmowa.
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { terminAkcji } from './normalizacja.ts'

export async function terminZBazy(db: SupabaseClient, akcja: string): Promise<string> {
  const t = terminAkcji(akcja)
  try {
    const { data } = await db.rpc('termin_roboczy', { p_data: t })
    return typeof data === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data) ? data : t
  } catch {
    return t
  }
}

export type Dopasowanie = { id: string; powod: 'telefon' | 'email' | 'inne_kontakty' | 'domena' } | null

export async function znajdzLeadaZBazy(db: SupabaseClient, email: string | null, telefon: string | null): Promise<Dopasowanie> {
  if (!email && !telefon) return null
  const { data, error } = await db.rpc('znajdz_leada', { p_email: email, p_telefon: telefon })
  if (error) { console.error('znajdz_leada:', error.message); return null }
  const w = Array.isArray(data) ? data[0] : data
  return w?.id ? { id: w.id, powod: w.powod } : null
}
