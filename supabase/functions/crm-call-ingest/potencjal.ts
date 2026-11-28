// Czy z analizy AI założyć klienta (lead) w CRM — reguła właściciela z 28.11:
// „takie zapytanie nie powinno się w ogóle zapisywać jako Klienci — musimy umieć odróżnić coś, w czym jest potencjał
// sprzedażowy, od śmieci”. Wspólna dla rozmów (index.ts) i maili (mail.ts); czysta funkcja (testy w src/__tests__).
//
//   istniejacy      — kontakt już ma klienta: jak dotąd (historia klienta, zadanie, oferta), potencjał bez znaczenia
//   nowy            — nowy klient: reklamacja albo zapytanie/klient z potencjałem 'tak' / 'niepewny' (albo bez pola)
//   bez_potencjalu  — nowy kontakt, zapytanie/klient z potencjałem 'nie': rozmowa / mail bez klienta (lista „Bez klienta”)
//   bez_leada       — sprawa niesprzedażowa (status, dostawca, spam, inne) albo brak numeru: jak dotąd, bez klienta
//
// Nieodebrane połączenia z nieznanego numeru (index.ts, case 'nieodebrana') NIE przechodzą tędy — od 28.11 też nie zakładają klienta (właściciel).

export type Potencjal = 'tak' | 'nie' | 'niepewny'
export type DecyzjaLeada = 'istniejacy' | 'nowy' | 'bez_potencjalu' | 'bez_leada'

export const PREFIKS_BEZ_POTENCJALU = 'Bez potencjału:'

/** Potencjał z analizy; brak pola (starsze analizy) albo wartość spoza listy = 'niepewny' (klient powstaje jak dotąd). */
export function potencjalZAnalizy(a: { potencjal?: unknown } | null | undefined): Potencjal {
  const p = typeof a?.potencjal === 'string' ? a.potencjal.trim().toLowerCase() : ''
  return p === 'tak' || p === 'nie' || p === 'niepewny' ? p : 'niepewny'
}

/**
 * @param a analiza AI (typ, potencjal)
 * @param maLeada kontakt już jest w bazie (lead po numerze / adresie / numerze z podpisu maila)
 * @param maKontakt jest z czego założyć klienta (numer telefonu przy rozmowie; przy mailu zawsze adres)
 */
export function decyzjaLeada(a: { typ?: unknown; potencjal?: unknown }, maLeada: boolean, maKontakt = true): DecyzjaLeada {
  const typ = String(a.typ ?? '')
  if (typ !== 'zapytanie' && typ !== 'klient' && typ !== 'reklamacja') return 'bez_leada'
  if (maLeada) return 'istniejacy'
  if (!maKontakt) return 'bez_leada'
  if (typ === 'reklamacja') return 'nowy'
  return potencjalZAnalizy(a) === 'nie' ? 'bez_potencjalu' : 'nowy'
}

/** Podsumowanie rozmowy / maila bez klienta z dopiskiem „Bez potencjału: <powód>” (bez dublowania przy ponowieniu). */
export function podsumowanieBezPotencjalu(podsumowanie: string | null | undefined, powod: string | null | undefined): string {
  const p = (podsumowanie ?? '').trim()
  if (p.includes(PREFIKS_BEZ_POTENCJALU)) return p
  const pw = (powod ?? '').trim().replace(/\.+$/, '') || 'brak chęci zakupu'
  const dopisek = `${PREFIKS_BEZ_POTENCJALU} ${pw}.`
  if (!p) return dopisek
  return `${/[.!?…]$/.test(p) ? p : p + '.'} ${dopisek}`
}
