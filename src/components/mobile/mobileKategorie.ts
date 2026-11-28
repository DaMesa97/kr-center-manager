import { isCategoryScoped } from '../../lib/permissions'

// Kolory i krótkie etykiety kategorii w widokach na telefonie (noc 28.11: wydzielone z 4 identycznych kopii).
export const CAT_COLORS: Record<string, string> = {
  STA: '#005faf', Disting: '#4f46e5', ST: '#1d6d45',
  Techniczne: '#854d0e', Bastion: '#b3261e', DrzwiWewnetrzne: '#0369a1', Aluminium: '#475569',
}

export const CAT_LABEL: Record<string, string> = {
  STA: 'STA', Disting: 'Disting', ST: 'ST', Techniczne: 'Techn.', Bastion: 'Bastion', DrzwiWewnetrzne: 'Wewn.', Aluminium: 'Alu',
}

/** Kolejność kategorii w zakładce Zlecenia na telefonie. */
export const MOBILE_CATEGORIES = ['STA', 'Disting', 'ST', 'Techniczne', 'Bastion', 'DrzwiWewnetrzne', 'Aluminium'] as const

/**
 * D62 (28.11): kategorie widoczne na telefonie — jak zakładki na komputerze (utils.ts): role zawężone
 * (kierownik działu, pracownik produkcji) tylko swoje z profilu, pozostałe wszystkie.
 */
export function kategorieNaTelefon(role: string | null | undefined, categories: string[] | null | undefined): string[] {
  if (!isCategoryScoped(role)) return [...MOBILE_CATEGORIES]
  const moje = new Set(categories ?? [])
  return MOBILE_CATEGORIES.filter((c) => moje.has(c))
}

/** null = bez filtra (wszystkie kategorie), tablica = tylko te kategorie. */
export function filtrKategoriiNaTelefon(role: string | null | undefined, categories: string[] | null | undefined): string[] | null {
  return isCategoryScoped(role) ? kategorieNaTelefon(role, categories) : null
}
