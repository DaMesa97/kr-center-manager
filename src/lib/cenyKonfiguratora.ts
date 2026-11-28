// D12 (28.11.2026): ceny z konfiguratora nie są dostępne dla hali i magazynu. Po migracji
// 20261128031400 kolumny orders.configurator_value / complaints.configurator_value są puste, a cena siedzi
// w tabeli ceny_konfiguratora (RLS: tylko kierownicy). Przed migracją tabeli nie ma — wtedy zostaje wartość
// z kolumny (aplikacja działa przed i po wgraniu).
import { supabase } from '../supabaseClient'

export type CenaTabela = 'orders' | 'complaints'

/** Pusta wartość ceny (null, undefined, pusty napis). */
export function isEmptyPrice(v: unknown): boolean {
  return v == null || String(v).trim() === ''
}

/** Wartość do pokazania: kolumna wiersza, a gdy pusta — cena z tabeli poufnej. */
export function shownConfiguratorValue(own: unknown, hidden: string | null | undefined): string | null {
  if (!isEmptyPrice(own)) return String(own)
  return isEmptyPrice(hidden) ? null : String(hidden)
}

/**
 * Cena z ceny_konfiguratora (tylko kierownik dostanie wiersz). Brak tabeli (przed migracją),
 * brak uprawnień albo brak wiersza → null, bez komunikatu.
 */
export async function fetchHiddenConfiguratorValue(tabela: CenaTabela, id: number): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('ceny_konfiguratora')
      .select('configurator_value')
      .eq('tabela', tabela)
      .eq('rekord_id', id)
      .maybeSingle()
    if (error || !data) return null
    const v = (data as { configurator_value?: unknown }).configurator_value
    return isEmptyPrice(v) ? null : String(v)
  } catch {
    return null
  }
}
