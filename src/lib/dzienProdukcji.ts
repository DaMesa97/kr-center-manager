import { PRODUCTION_DAYS } from '../constants'

// D27 (28.11): dzień produkcji w formularzu zlecenia — lista do wyboru zamiast pola tylko z kartoteki firmy,
// z podpowiedzią „z kartoteki firmy: …”.

/** Wartości dnia produkcji spotykane w bazie poza dniami tygodnia (535 zleceń, 1 firma). */
export const DZIEN_ODBIOR_OSOBISTY = 'ODBIÓR OSOBISTY'

/** Normalizacja wartości z kartoteki: '#N/A', puste, spacje → ''. */
export function oczyscDzienProdukcji(v: string | null | undefined): string {
  const s = String(v ?? '').trim()
  if (!s || s.toUpperCase() === '#N/A') return ''
  return s
}

/** Opcje listy: dni tygodnia + odbiór osobisty; nietypowa obecna wartość zostaje na liście (nie ginie przy edycji). */
export function opcjeDniaProdukcji(obecny: string | null | undefined): string[] {
  const opcje: string[] = [...PRODUCTION_DAYS, DZIEN_ODBIOR_OSOBISTY]
  const v = oczyscDzienProdukcji(obecny)
  if (v && !opcje.includes(v)) opcje.push(v)
  return opcje
}

/** Dzień produkcji z kartoteki firmy (dopasowanie nazwy bez wielkości liter i spacji na brzegach) albo ''. */
export function dzienZKartotekiFirmy(
  firma: string | null | undefined,
  firmy: ReadonlyArray<{ name?: string | null; production_day?: string | null }> | null | undefined,
): string {
  const klucz = String(firma ?? '').trim().toLowerCase()
  if (!klucz) return ''
  const f = (firmy ?? []).find((c) => String(c.name ?? '').trim().toLowerCase() === klucz)
  return oczyscDzienProdukcji(f?.production_day)
}
