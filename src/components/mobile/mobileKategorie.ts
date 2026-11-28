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
 * D62 (28.11): kategorie widoczne na telefonie.
 *  - role zawężone (kierownik działu, pracownik produkcji) — tylko swoje z profilu (pusty profil = nic, jak na komputerze);
 *  - pozostałe role (magazynier, obsługa klienta, kierownicy, admin) — odpowiedź właściciela 28.11: gdy profil ma
 *    kategorie, też tylko one; gdy pusty — wszystkie (jak dotąd).
 */
export function kategorieNaTelefon(role: string | null | undefined, categories: string[] | null | undefined): string[] {
  const moje = new Set(categories ?? [])
  const zProfilu = MOBILE_CATEGORIES.filter((c) => moje.has(c))
  if (isCategoryScoped(role)) return zProfilu
  return zProfilu.length > 0 ? zProfilu : [...MOBILE_CATEGORIES]
}

/** null = bez filtra (wszystkie kategorie), tablica = tylko te kategorie. */
export function filtrKategoriiNaTelefon(role: string | null | undefined, categories: string[] | null | undefined): string[] | null {
  const k = kategorieNaTelefon(role, categories)
  return !isCategoryScoped(role) && k.length === MOBILE_CATEGORIES.length ? null : k
}
