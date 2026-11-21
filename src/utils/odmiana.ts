/**
 * Polska odmiana po liczebniku: 1 zadanie, 2–4 zadania (ale 12–14 zadań), 5+ zadań, 22 zadania.
 * odmiana(22, 'zadanie', 'zadania', 'zadań') → 'zadania'
 */
export function odmiana(n: number, jeden: string, kilka: string, wiele: string): string {
  const a = Math.abs(Math.trunc(n))
  if (a === 1) return jeden
  const j = a % 10
  const d = a % 100
  return j >= 2 && j <= 4 && (d < 12 || d > 14) ? kilka : wiele
}

/** „22 zadania” */
export const ileOdm = (n: number, jeden: string, kilka: string, wiele: string): string => `${n} ${odmiana(n, jeden, kilka, wiele)}`
