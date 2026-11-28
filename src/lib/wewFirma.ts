// =====================================================================
// D10 (28.11.2026): filtr firmy w statystykach drzwi wewnętrznych.
// Funkcje stat_wew_* (migracja 20261128036102) mają parametr p_firma: 'KR' (domyślnie — KR Center bez zleceń
// z RO bazy MR Profil), 'MR' (tylko MR Profil, stan z magazynu MR_WEW), 'all' (obie firmy).
// Na bazie bez tej migracji wywołanie z p_firma kończy się PGRST202 — wtedy ponawiamy bez parametru.
// =====================================================================
export type FirmaStat = 'KR' | 'MR' | 'all'

export const FIRMA_LABELS: Record<FirmaStat, string> = {
  KR: 'KR Center',
  MR: 'MR Profil',
  all: 'Obie firmy',
}

/** Argumenty rpc z p_firma albo bez (zFirma = false: baza bez migracji 036102) */
export function firmaArgs<T extends Record<string, unknown>>(args: T, firma: FirmaStat, zFirma: boolean): T & { p_firma?: FirmaStat } {
  return zFirma ? { ...args, p_firma: firma } : args
}
