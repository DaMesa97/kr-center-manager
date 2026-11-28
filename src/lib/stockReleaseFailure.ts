// D41 (28.11): nieudane zdjęcie z magazynu przy etapie / wydaniu nie blokuje hali — etap (data wydania) się
// zapisuje, a zlecenie trafia do Weryfikacji, sekcja „Magazyn do sprawdzenia” (tabela stock_release_failures,
// migracja 20261128030100). Baza bez migracji → zgłoszenie się nie uda i komunikat każe zgłosić kierownikowi.
// Czysta logika (bez supabase) — testowana w src/__tests__/stockReleaseFailure.test.ts.

export type ReleaseFailureKind = 'etap' | 'wydanie' | 'drzwi_wew'

/** Treść błędu RPC / wyjątku do zapisania (krótko, bez stosu). */
export function releaseErrorText(err: unknown): string {
  if (err == null) return 'nieznany błąd'
  if (typeof err === 'string') return err.slice(0, 300)
  if (typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    const m = (err as { message: string }).message.trim()
    return (m || 'nieznany błąd').slice(0, 300)
  }
  return String(err).slice(0, 300)
}

/**
 * Komunikat po udanym zapisie etapu / wydania, gdy zdjęcie z magazynu się nie udało.
 * zgloszone = wpis trafił do Weryfikacji.
 */
export function releaseFailureMessage(zgloszone: boolean, co: 'etap' | 'wydanie', blad?: string | null): string {
  const zapisano = co === 'etap' ? 'Etap zapisany' : 'Wydanie zapisane'
  const powod = blad ? ` (${blad})` : ''
  return zgloszone
    ? `${zapisano}, magazyn do sprawdzenia w Weryfikacji${powod}`
    : `${zapisano}, ale zdjęcie z magazynu NIE poszło — zgłoś kierownikowi${powod}`
}

/** Opis wpisu na liście w Weryfikacji. */
export function releaseFailureWhat(kind: ReleaseFailureKind | string, stageLabel: string | null): string {
  if (kind === 'wydanie') return 'wydanie końcowe (reszta rezerwacji)'
  if (kind === 'drzwi_wew') return 'wydanie drzwi wewnętrznych'
  return `etap: ${stageLabel ?? '—'}`
}
