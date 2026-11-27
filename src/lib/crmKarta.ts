/**
 * Karta klienta v3 (makieta „CRM karta klienta — makieta”, 27.11.2026): etapy sprawy nad paskiem „Co teraz”.
 * Zapytanie → Oferta → Decyzja → Zamówienie → Umowa i pomiar → Montaż — liczone z tego, co już jest w CRM
 * (status klienta, oferty, dokumenty), bez nowych pól w bazie.
 */

export const ETAPY_KLIENTA = ['Zapytanie', 'Oferta', 'Decyzja', 'Zamówienie', 'Umowa i pomiar', 'Montaż'] as const

export type EtapKlienta = { nazwa: string; stan: 'done' | 'on' | 'todo' | 'stop' | 'skip'; opis?: string }

type OfertaMin = { status: string; rodzaj?: string | null }

/** Zamówił bez oferty z montażem (zamówienie w sklepie, kurier / odbiór) — umowy, pomiaru ani montażu nie ma. */
export function zamowilBezMontazu(status: string | null | undefined, oferty: OfertaMin[]): boolean {
  return status === 'wygrany' && !oferty.some((o) => o.rodzaj === 'oficjalna' || o.rodzaj == null)
}
type DokumentMin = { rodzaj: string; status: string }

/**
 * Bieżący etap: 0 zapytanie, 1 oferta (liczy się / do wysłania), 2 decyzja (oferta wysłana), 4 umowa i pomiar (zamówił),
 * 5 montaż (umowa podpisana), 6 = wszystko zrobione (protokół podpisany). Przegrany zatrzymuje się na „Decyzji” (stop).
 */
export function etapyKlienta(status: string | null | undefined, oferty: OfertaMin[], dokumenty: DokumentMin[]): EtapKlienta[] {
  const podpisany = (rodzaj: string) => dokumenty.some((d) => d.rodzaj === rodzaj && d.status === 'podpisana')
  // 27.11 (testy agentów): zamówienie ze sklepu bez oferty z montażem — etapy, których nie było, są „pominięte”, nie „zrobione”,
  // a umowa / pomiar / montaż nie dotyczą (wcześniej karta kazała przygotować umowę na montaż kurierowi)
  if (zamowilBezMontazu(status, oferty) && !podpisany('umowa')) {
    const wyslana = oferty.some((o) => o.status === 'wyslana' || o.status === 'zaakceptowana' || o.status === 'odrzucona')
    return [
      { nazwa: ETAPY_KLIENTA[0], stan: 'done' },
      { nazwa: ETAPY_KLIENTA[1], stan: oferty.length ? 'done' : 'skip' },
      { nazwa: ETAPY_KLIENTA[2], stan: wyslana ? 'done' : 'skip' },
      { nazwa: ETAPY_KLIENTA[3], stan: 'on', opis: 'w realizacji' },
      { nazwa: ETAPY_KLIENTA[4], stan: 'skip', opis: 'nie dotyczy' },
      { nazwa: ETAPY_KLIENTA[5], stan: 'skip', opis: 'nie dotyczy' },
    ]
  }
  let biezacy: number
  let stop = false
  if (status === 'wygrany') {
    biezacy = podpisany('protokol') ? 6 : podpisany('umowa') ? 5 : 4
  } else if (status === 'przegrany') {
    biezacy = 2
    stop = true
  } else if (oferty.some((o) => o.status === 'wyslana' || o.status === 'zaakceptowana' || o.status === 'odrzucona')) {
    biezacy = 2
  } else if (oferty.length > 0 || status === 'oferta') {
    biezacy = 1
  } else {
    biezacy = 0
  }
  return ETAPY_KLIENTA.map((nazwa, i) => {
    if (stop && i === biezacy) return { nazwa: 'Nie zamówił', stan: 'stop' as const }
    if (i < biezacy) return { nazwa, stan: 'done' as const }
    if (i === biezacy && !stop) return { nazwa, stan: 'on' as const }
    return { nazwa, stan: 'todo' as const }
  })
}
