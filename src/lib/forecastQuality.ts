// D7 (b), 28.11: prognoza przy mniej niż 3 pełnych miesiącach historii nie spada do zera, tylko liczy
// średnią ORIENTACYJNĄ (tempo zużycia z całej dotychczasowej historii) z flagą insufficient_data.
// Ekrany Alerty i Prognozy pokazują przy takiej liczbie „orientacyjnie”.
// Przed wgraniem migracji 20261127232800 baza przy „za mało danych” daje średnią 0 — wtedy zostaje „brak danych”.

export type ForecastQuality = 'full' | 'indicative' | 'none'

export const ORIENTACYJNIE_TITLE =
  'Mniej niż 3 pełne miesiące historii — średnia orientacyjna z dotychczasowego zużycia, prognoza mało pewna'

export function forecastQuality(insufficientData: boolean, baselineMonthly: number): ForecastQuality {
  if (!insufficientData) return 'full'
  return Number.isFinite(baselineMonthly) && baselineMonthly > 0 ? 'indicative' : 'none'
}

export function forecastDataLabel(q: ForecastQuality): string {
  if (q === 'full') return 'Dane: wystarczająca historia'
  if (q === 'indicative') return 'Dane: orientacyjnie (mniej niż 3 pełne miesiące)'
  return 'Dane: za mało historii'
}
