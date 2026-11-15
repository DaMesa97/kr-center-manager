// =====================================================================
// Termin zadania w dni robocze (zasada właściciela, 15.11.2026): w bazie trigger
// BEFORE `leady_termin_roboczy` przepuszcza każdy nowy `nastepny_krok` przez
// crm.termin_roboczy(data): sobota/niedziela i dni z crm.dni_wolne (święta państwowe,
// dni firmowe — brief pkt 25) → następny dzień roboczy, a „dziś” zapisane o 17:00 lub
// później czasu polskiego → jutro (i dalej, jeśli jutro wolne). Terminy w przeszłości
// nie są ruszane. Tu tylko ODWZOROWANIE reguły na podpowiedź w UI — zapis i tak robi
// baza, a aplikacja po zapisie przeładowuje leada, więc pokazuje to, co baza zapisała.
// =====================================================================

/** godzina, po której „dziś” staje się „jutro” (czas lokalny użytkownika = polski) */
export const CRM_TERMIN_KONIEC_DNIA = 17

const DNI = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota']

const pad = (n: number) => String(n).padStart(2, '0')
/** lokalna data jako RRRR-MM-DD (bez przesunięcia strefy jak w toISOString) */
export const isoLocal = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

const addDays = (d: Date, n: number): Date => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  x.setDate(x.getDate() + n)
  return x
}

const NONE: ReadonlySet<string> = new Set()

const wolny = (d: Date, dniWolne: ReadonlySet<string>): boolean => d.getDay() === 0 || d.getDay() === 6 || dniWolne.has(isoLocal(d))

/**
 * Jak baza zapisze termin: `dzien` = chciana data (lokalna), `now` = chwila zapisu,
 * `dniWolne` = daty RRRR-MM-DD z crm.dni_wolne. Zwraca datę roboczą, `przesuniety`
 * gdy różni się od chcianej, i `powod` do podpowiedzi.
 */
export function terminRoboczy(dzien: Date, now: Date = new Date(), dniWolne: ReadonlySet<string> = NONE): { data: Date; przesuniety: boolean; powod: string | null } {
  const chciany = new Date(dzien.getFullYear(), dzien.getMonth(), dzien.getDate())
  let d = chciany
  let powod: string | null = null
  const dzis = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  // terminy w przeszłości baza zostawia bez zmian
  if (d.getTime() < dzis.getTime()) return { data: d, przesuniety: false, powod: null }
  if (d.getTime() === dzis.getTime() && now.getHours() >= CRM_TERMIN_KONIEC_DNIA) {
    d = addDays(d, 1)
    powod = `po ${CRM_TERMIN_KONIEC_DNIA}:00 termin „dziś” zapisuje się na jutro`
  }
  let guard = 0
  while (wolny(d, dniWolne) && guard++ < 60) {
    if (!powod) powod = d.getDay() === 0 || d.getDay() === 6 ? 'weekend przesuwa się na następny dzień roboczy' : 'dzień wolny przesuwa się na następny dzień roboczy'
    d = addDays(d, 1)
  }
  return { data: d, przesuniety: d.getTime() !== chciany.getTime(), powod }
}

const format = (r: { data: Date; przesuniety: boolean; powod: string | null }): string | null =>
  r.przesuniety ? `→ ${DNI[r.data.getDay()]} ${pad(r.data.getDate())}.${pad(r.data.getMonth() + 1)} (${r.powod})` : null

/** Podpowiedź pod „za ile dni”: „→ poniedziałek 23.11 (weekend przesuwa się…)” albo null, gdy nic się nie przesuwa. */
export function terminHint(zaDni: number, now: Date = new Date(), dniWolne: ReadonlySet<string> = NONE): string | null {
  return format(terminRoboczy(addDays(now, zaDni), now, dniWolne))
}

/** To samo dla pola daty RRRR-MM-DD (CrmNowyKlient). */
export function terminHintForIso(iso: string | null | undefined, now: Date = new Date(), dniWolne: ReadonlySet<string> = NONE): string | null {
  if (!iso) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  if (Number.isNaN(d.getTime())) return null
  return format(terminRoboczy(d, now, dniWolne))
}
