// =====================================================================
// D66 (28.11.2026): limit czasu zapisów z telefonu.
// Przy zerwanym WiFi zapytanie do bazy potrafi wisieć kilka minut, a przycisk
// stoi na „Zapisywanie…”. Po limicie przestajemy czekać i mówimy wprost, że zapis
// MÓGŁ dojść do bazy (żądanie poszło — nie wiemy, czy wróciła odpowiedź), więc
// trzeba odświeżyć i sprawdzić, zanim kliknie się drugi raz.
// Samo żądanie nie jest przerywane — tylko przestajemy na nie czekać.
// =====================================================================

/** Zwykły zapis do bazy (etap, wydanie, odhaczenie). */
export const LIMIT_ZAPISU_MS = 30_000
/** Wysyłanie zdjęcia (plik + wpis w bazie) — wolne łącze na hali. */
export const LIMIT_ZDJECIA_MS = 120_000

export const KOMUNIKAT_LIMITU_CZASU =
  'Brak odpowiedzi serwera (słaby internet?). Zapis mógł się udać — odśwież i sprawdź, zanim spróbujesz ponownie.'

export class LimitCzasuError extends Error {
  readonly limitMs: number
  constructor(limitMs: number, komunikat: string = KOMUNIKAT_LIMITU_CZASU) {
    super(komunikat)
    this.name = 'LimitCzasuError'
    this.limitMs = limitMs
  }
}

export function czyLimitCzasu(e: unknown): e is LimitCzasuError {
  return e instanceof LimitCzasuError
}

/**
 * Czeka na `praca` (Promise albo zapytanie Supabase — „thenable”) najwyżej `ms`.
 * Po limicie odrzuca LimitCzasuError; wynik / błąd po czasie jest ignorowany.
 */
export function zLimitemCzasu<T>(praca: PromiseLike<T>, ms: number = LIMIT_ZAPISU_MS, komunikat?: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let skonczone = false
    const timer = setTimeout(() => {
      if (skonczone) return
      skonczone = true
      reject(new LimitCzasuError(ms, komunikat))
    }, ms)
    Promise.resolve(praca).then(
      (wynik) => {
        if (skonczone) return
        skonczone = true
        clearTimeout(timer)
        resolve(wynik)
      },
      (blad: unknown) => {
        if (skonczone) return
        skonczone = true
        clearTimeout(timer)
        reject(blad)
      },
    )
  })
}

/** Tekst do pokazania pracownikowi z dowolnego wyjątku (limit czasu → stały komunikat). */
export function komunikatWyjatku(e: unknown, przedrostek = 'Błąd'): string {
  if (czyLimitCzasu(e)) return e.message
  return `${przedrostek}: ${e instanceof Error ? e.message : String(e)}`
}
