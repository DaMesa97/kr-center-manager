// Ścieżki plików PDF w buckecie crm-dokumenty (bez importów — testowane w vitest: src/__tests__/crmDokumentySciezki.test.ts).
// testy 27.11 (runda 3): każda wygenerowana umowa ma własny plik (znacznik czasu w nazwie).
// D23 (28.11.2026, decyzja właściciela — TAK, opcja a): druga umowa z tej samej oferty zostaje jak jest (ten sam numer
// tylko z umowy-projektu), a protokół odbioru też dostaje własny plik — wcześniej `protokol-<numer>.pdf` z upsertem:
// protokół drugiej umowy o tym samym numerze (albo ponowne generowanie) nadpisywał PDF poprzedniego, a starsze wiersze
// crm.dokumenty wskazywały nowy plik.

/** Znacznik czasu do nazwy pliku: 20261128-143015-123 (UTC). */
export function znacznikCzasu(d: Date = new Date()): string {
  return d.toISOString().replace(/[-:]/g, '').replace('T', '-').replace('.', '-').replace('Z', '')
}

const numerDoPliku = (numer: string | null | undefined) => String(numer ?? '').replace(/\//g, '-')

export function sciezkaUmowy(leadId: string, numer: string, znacznik: string = znacznikCzasu()): string {
  return `${leadId}/umowa-${numerDoPliku(numer)}-${znacznik}.pdf`
}

/** D23: protokół odbioru — każdy wygenerowany ma własny plik (nie nadpisuje poprzedniego). */
export function sciezkaProtokolu(leadId: string, numerUmowy: string | null | undefined, znacznik: string = znacznikCzasu()): string {
  return `${leadId}/protokol-${numerDoPliku(numerUmowy)}-${znacznik}.pdf`
}

/** Nadpisywanie pliku w buckecie: tylko karta pomiarowa (blankiet, nazwa z datą pomiaru); umowa i protokół — nigdy. */
export function nadpisujPlik(rodzaj: string): boolean {
  return rodzaj === 'karta_pomiarowa'
}
