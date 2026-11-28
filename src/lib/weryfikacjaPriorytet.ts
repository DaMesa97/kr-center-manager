// D35 (28.11), część (a): Weryfikacja — priorytety i ukrywanie starych pozycji, żeby ważne nie ginęły.

export type PriorytetWeryfikacji = 'wysoki' | 'normalny' | 'niski'

const RANGA: Record<PriorytetWeryfikacji, number> = { wysoki: 0, normalny: 1, niski: 2 }

export const ETYKIETA_PRIORYTETU: Record<PriorytetWeryfikacji, string> = {
  wysoki: 'Pilne',
  normalny: 'Zwykłe',
  niski: 'Informacja',
}

/** Domyślnie chowamy pozycje starsze niż tyle dni (do pokazania jednym kliknięciem). */
export const DNI_DO_UKRYCIA = 14

const WYSOKI = [/duplikat/i, /dubel/i, /identyczny payload/i, /różni się od zlecenia z bota/i, /tej samej firmy/i]
const NISKI = [/^Numer .+ z arkusza był już zajęty/i]

/**
 * Priorytet pozycji Weryfikacji po treści ostrzeżeń:
 *  - wysoki — możliwy dubel (bot / Excel), kolizja numeru z tą samą firmą;
 *  - niski — wyłącznie kolizja numeru arkusza (stary format, zanim reguła D35 zdjęła te pozycje z Weryfikacji);
 *  - normalny — reszta (np. brak numeru zamówienia klienta, brak ostrzeżeń).
 */
export function priorytetWeryfikacji(warnings: ReadonlyArray<unknown> | null | undefined): PriorytetWeryfikacji {
  const teksty = (warnings ?? []).map((w) => (typeof w === 'string' ? w : JSON.stringify(w ?? '')))
  if (teksty.some((t) => WYSOKI.some((r) => r.test(t)))) return 'wysoki'
  if (teksty.length > 0 && teksty.every((t) => NISKI.some((r) => r.test(t)))) return 'niski'
  return 'normalny'
}

type Pozycja = { warnings?: ReadonlyArray<unknown> | null; bot_received_at?: string | null }

function czas(v: string | null | undefined): number {
  const t = v ? new Date(v).getTime() : NaN
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t
}

/** Kolejność: priorytet (pilne na górze), w obrębie priorytetu najstarsze najpierw (FIFO). */
export function sortujWeryfikacje<T extends Pozycja>(lista: readonly T[]): T[] {
  return [...lista].sort(
    (a, b) =>
      RANGA[priorytetWeryfikacji(a.warnings)] - RANGA[priorytetWeryfikacji(b.warnings)] ||
      czas(a.bot_received_at) - czas(b.bot_received_at),
  )
}

/**
 * Podział na aktualne i stare (przyjęte ponad `dni` dni temu). Pilnych nie chowamy nigdy.
 * Brak daty = aktualne.
 */
export function podzielWeryfikacje<T extends Pozycja>(
  lista: readonly T[],
  teraz: number = Date.now(),
  dni: number = DNI_DO_UKRYCIA,
): { aktualne: T[]; stare: T[] } {
  const granica = teraz - dni * 24 * 3600 * 1000
  const aktualne: T[] = []
  const stare: T[] = []
  for (const p of lista) {
    const t = czas(p.bot_received_at)
    if (priorytetWeryfikacji(p.warnings) !== 'wysoki' && Number.isFinite(t) && t < granica) stare.push(p)
    else aktualne.push(p)
  }
  return { aktualne, stare }
}
