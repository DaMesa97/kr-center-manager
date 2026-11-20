/**
 * Korespondencja z klientem na karcie klienta (v2, 20.11): maile jako wątek — od najstarszego,
 * ostatni rozwinięty, bez cytowanej historii (każda odpowiedź ma ją w sobie i wątek puchnie).
 */

type MailWatku = { id: string; kierunek: string | null; data: string | null; created_at?: string | null }

/** Linie, od których zaczyna się cytowana poprzednia wiadomość (Gmail, Outlook, Thunderbird, Apple Mail, PL/EN). */
const CYTAT_START: RegExp[] = [
  /^\s*(W dniu|Dnia)\s.{4,160}(napisał|napisała|napisał\(a\)|pisze)\s*:?\s*$/i,
  /^\s*On\s.{4,160}\swrote:\s*$/i,
  /^\s*-{2,}\s*(Original Message|Wiadomość oryginalna|Oryginalna wiadomość|Forwarded message|Wiadomość przekazana)\s*-{2,}/i,
  /^\s*_{10,}\s*$/,
]
const NAGLOWEK_OD = /^\s*\**(Od|From)\s*:\**\s.+/i
const NAGLOWEK_DALEJ = /^\s*\**(Wysłano|Wysłane|Sent|Data|Date|Do|To|Temat|Subject)\s*:/i

/** Treść maila bez cytowanej historii i bez pustych linii na końcu. Gdy całość to cytat — zwraca oryginał. */
export function bezCytatu(tresc: string | null | undefined): string {
  if (!tresc) return ''
  const linie = tresc.replace(/\r\n/g, '\n').split('\n')
  let koniec = linie.length
  for (let i = 0; i < linie.length; i++) {
    const l = linie[i]
    if (CYTAT_START.some((re) => re.test(l))) { koniec = i; break }
    // blok nagłówków Outlooka: „Od: …” i w kolejnych 4 liniach „Wysłano:/Temat:/Do:”
    if (NAGLOWEK_OD.test(l) && linie.slice(i + 1, i + 5).some((n) => NAGLOWEK_DALEJ.test(n))) { koniec = i; break }
    // dwie kolejne linie cytatu „> …” (pojedynczy „>” bywa w treści)
    if (/^\s*>/.test(l) && /^\s*>/.test(linie[i + 1] ?? '')) { koniec = i; break }
  }
  const wynik = linie.slice(0, koniec).join('\n').replace(/\n{3,}/g, '\n\n').trim()
  return wynik || tresc.trim()
}

/** Krótki podgląd do zwiniętego maila: pierwsze zdania treści bez cytatu, max `n` znaków. */
export function zajawka(tresc: string | null | undefined, n = 160): string {
  const t = bezCytatu(tresc).replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t
}

const czas = (m: MailWatku) => m.data ?? m.created_at ?? ''

/** Maile od najstarszego do najnowszego. */
export function watek<T extends MailWatku>(maile: T[]): T[] {
  return [...maile].sort((a, b) => czas(a).localeCompare(czas(b)))
}

/** Klient czeka na odpowiedź, gdy ostatni mail w wątku jest od niego. Zwraca ten mail albo null. */
export function czekaNaOdpowiedz<T extends MailWatku>(maile: T[]): T | null {
  const w = watek(maile)
  const ost = w[w.length - 1]
  return ost && ost.kierunek === 'przychodzacy' ? ost : null
}
