// Pulpit (28.11, makieta właściciela): status synchronizacji i formaty — czyste funkcje, testowalne bez Supabase.

export type StatusSync = { nazwa: string; ok: boolean; opis: string; kiedy: string }

const GODZ = { hour: '2-digit', minute: '2-digit' } as const

/** „dziś 14:05”, „wczoraj 20:00”, „pt 20:00”, „12.11 08:15” — krótko, do listy synchronizacji */
export function kiedyKrotko(iso: string | null | undefined, teraz: Date = new Date()): string {
  if (!iso) return 'brak'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'brak'
  const godz = d.toLocaleTimeString('pl-PL', GODZ)
  const dzien = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const roznica = Math.round((dzien(teraz) - dzien(d)) / 86400000)
  if (roznica === 0) return `dziś ${godz}`
  if (roznica === 1) return `wczoraj ${godz}`
  if (roznica > 1 && roznica < 7) return `${d.toLocaleDateString('pl-PL', { weekday: 'short' }).replace('.', '')} ${godz}`
  return `${d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' })} ${godz}`
}

/** Import RO z Optimy: błąd, gdy ostatni przebieg zgłosił błędy albo nie było go dłużej niż `maxMinut` */
export function statusImportuRo(
  stan: { last_run_at: string | null; last_result: { bledy?: unknown[] } | null } | null,
  teraz: Date = new Date(),
  maxMinut = 120,
): StatusSync {
  const nazwa = 'Optima — import RO'
  if (!stan?.last_run_at) return { nazwa, ok: false, opis: 'brak przebiegów', kiedy: 'brak' }
  const bledy = Array.isArray(stan.last_result?.bledy) ? stan.last_result!.bledy!.length : 0
  const minut = (teraz.getTime() - new Date(stan.last_run_at).getTime()) / 60000
  if (bledy > 0) return { nazwa, ok: false, opis: `ostatni przebieg: ${bledy} ${bledy === 1 ? 'błąd' : 'błędów'}`, kiedy: kiedyKrotko(stan.last_run_at, teraz) }
  if (minut > maxMinut) return { nazwa, ok: false, opis: 'brak przebiegu od ponad 2 godzin', kiedy: kiedyKrotko(stan.last_run_at, teraz) }
  return { nazwa, ok: true, opis: 'ostatni przebieg', kiedy: kiedyKrotko(stan.last_run_at, teraz) }
}

/** Synchronizacja wydań i etapów z Excela (Make) */
export function statusExcela(sync: { lastSyncAt: string | null; stale: boolean } | undefined, teraz: Date = new Date()): StatusSync {
  const nazwa = 'Excel — wydania i etapy (Make)'
  if (!sync?.lastSyncAt) return { nazwa, ok: false, opis: 'brak przebiegów', kiedy: 'brak' }
  return sync.stale
    ? { nazwa, ok: false, opis: 'ostatni przebieg starszy niż doba', kiedy: kiedyKrotko(sync.lastSyncAt, teraz) }
    : { nazwa, ok: true, opis: 'ostatni przebieg', kiedy: kiedyKrotko(sync.lastSyncAt, teraz) }
}

/** Wysyłka zamówień do Optimy (RO z konfiguratora): błąd, gdy są zamówienia nieprzyjęte przez ERP */
export function statusWysylkiErp(bledy: number): StatusSync {
  const nazwa = 'Optima — wysyłka zamówień'
  return bledy > 0
    ? { nazwa, ok: false, opis: `${bledy} ${bledy === 1 ? 'zamówienie nieprzyjęte' : 'zamówień nieprzyjętych'}`, kiedy: '' }
    : { nazwa, ok: true, opis: 'bez błędów', kiedy: '' }
}

/** Udział w procentach, zaokrąglony; null przy dzieleniu przez zero */
export function procent(czesc: number, calosc: number): number | null {
  if (!calosc) return null
  return Math.round((czesc * 100) / calosc)
}
