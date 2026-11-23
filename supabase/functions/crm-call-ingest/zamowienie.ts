// Mail „Nowe zamówienie NNN” ze sklepu podrzwi.pl (WooCommerce, przychodzi przez kontakt@ z adresem klienta w Reply-To).
// Zasada właściciela (2026-11-15): zamówienia sklepowe obsługuje Baselinker (potwierdzenie, płatność, wysyłka), więc CRM
// nic z nimi nie robi – chyba że klient dopisał adnotację (uwagi do zamówienia), która nie zgadza się z zamówionym towarem
// albo wymaga decyzji handlowca; wtedy zadanie „oddzwoń” przed realizacją. Bez adnotacji: zero AI, zero zadań.

import { SLOWNIK } from './prompt.ts'

export type Zamowienie = {
  numer: string
  /** nowe = „Nowe zamówienie” (jedyne, które czytamy dalej); anulowane / nieudane / inne = powiadomienie o statusie, tylko do historii */
  rodzaj: 'nowe' | 'anulowane' | 'nieudane' | 'inne'
  klient: string | null
  pozycje: string
  razem: string | null
  adnotacja: string | null
  telefon: string | null
}

export type AnalizaZamowienia = { nietypowe: boolean; powod: string; adnotacja_krotko: string }

export const SCHEMA_ZAMOWIENIE = {
  type: 'object',
  properties: {
    nietypowe: { type: 'boolean', description: 'true = adnotacja klienta wymaga reakcji handlowca przed realizacją zamówienia' },
    powod: { type: 'string', description: 'Jedno–dwa zdania dla handlowca: co w adnotacji nie zgadza się z zamówieniem albo czego klient chce (pusty, gdy nietypowe = false)' },
    adnotacja_krotko: { type: 'string', description: 'Adnotacja klienta w kilku słowach' },
  },
  required: ['nietypowe', 'powod', 'adnotacja_krotko'],
  additionalProperties: false,
} as const

/** Rozpoznaje powiadomienie WooCommerce o zamówieniu (nowe, anulowane, nieudane…) po temacie i treści; null = to nie jest takie powiadomienie. */
export function rozpoznajZamowienie(temat: string | null, tresc: string | null): Zamowienie | null {
  const tt = temat ?? ''
  const m = /zam[oó]wieni[ea][:\s#]*(\d+)/i.exec(tt) ?? /zam[oó]wienie[:\s#]*(\d+)/i.exec(tt)
  if (!m) return null
  const t = (tresc ?? '').replace(/\r/g, '')
  // podpis maila administracyjnego sklepu: link do edycji zamówienia w wp-admin albo zdanie z „Nowego zamówienia”
  if (!/wp-admin\/admin\.php\?page=wc-orders/i.test(t) && !/Otrzyma[łl]e[śs] nast[ęe]puj[ąa]ce zam[óo]wienie/i.test(t)) return null
  const rodzaj: Zamowienie['rodzaj'] = /nowe zam[oó]wienie/i.test(tt) || /Otrzyma[łl]e[śs] nast[ęe]puj[ąa]ce zam[óo]wienie/i.test(t) ? 'nowe'
    : /anulowan/i.test(tt + ' ' + t.slice(0, 300)) ? 'anulowane'
    : /nieudane|failed/i.test(tt + ' ' + t.slice(0, 300)) ? 'nieudane' : 'inne'
  const klient = (/zam[óo]wienie od ([^:\n]+):/i.exec(t)?.[1] ?? /nale[żz][ąa]ce do:\s*([^\n]+?)\s+zosta[łl]o/i.exec(t)?.[1])?.trim() || null
  const pozycje = wytnij(t, /Produkt\s*\n\s*Ilo[śs][ćc]\s*\n\s*Cena/i, /\n\s*Kwota:/i) ?? ''
  const razem = /Razem:\s*\n?\s*([^\n]+)/i.exec(t)?.[1]?.trim() || null
  const adnotacja = wytnij(t, /\n\s*(Adnotacj[ae]|Uwagi(?: klienta)?|Notatka(?: klienta)?|Customer note)[^:\n]*:/i, /\n\s*(Adres rozliczeniowy|Adres do wysy[łl]ki|PixelYourSite|Billing address)/i)
  const rozlicz = wytnij(t, /Adres rozliczeniowy/i, /Adres do wysy[łl]ki|PixelYourSite/i) ?? ''
  const telefon = /\+?\d[\d\s-]{7,}\d/.exec(rozlicz)?.[0]?.trim() ?? null
  return { numer: m[1], rodzaj, klient, pozycje: pozycje.replace(/\n{3,}/g, '\n\n').slice(0, 6000), razem, adnotacja: adnotacja?.trim() || null, telefon }
}

function wytnij(t: string, od: RegExp, do_: RegExp): string | null {
  const a = od.exec(t)
  if (!a) return null
  const reszta = t.slice(a.index + a[0].length)
  const b = do_.exec(reszta)
  return (b ? reszta.slice(0, b.index) : reszta).trim()
}

export function systemAnalizyZamowienia(): string {
  return 'Jesteś asystentem sprzedaży Po Drzwi (sklep podrzwi.pl: drzwi wewnętrzne, zewnętrzne, Bastion/Titan). Dostajesz zamówienie złożone '
    + 'w sklepie internetowym (pozycje z opcjami, które klient wybrał) oraz adnotację, którą klient dopisał przy składaniu zamówienia. '
    + 'Zamówienia realizuje automatycznie system Baselinker (potwierdzenie, płatność, wysyłka) i handlowiec normalnie ich nie ogląda. '
    + 'Twoje JEDYNE zadanie: ocenić, czy adnotacja wymaga reakcji handlowca PRZED realizacją. Odpowiadasz wyłącznie JSON-em wg schematu.\n\n'
    + 'Nietypowe (nietypowe = true), gdy adnotacja: (a) przeczy wybranym opcjom pozycji albo wskazuje parametr, którego nie ma wśród opcji '
    + 'zamówionych produktów (np. „opaska 6 cm”, a zamówione ościeżnice regulowane mają tylko opaskę 8 cm; inny kolor, rozmiar, kierunek, '
    + 'zamek, wysokość niż w pozycjach), (b) prosi o coś, czego nie ma w zamówieniu (dodatkowy produkt, montaż, usługa, inny termin, rabat), '
    + '(c) zadaje pytanie albo prosi o kontakt/telefon, (d) podaje informację, która może uniemożliwić realizację (wymiary otworu niepasujące '
    + 'do zamówionego rozmiaru, nietypowe miejsce dostawy, odbiór osobisty mimo kuriera). '
    + 'Zwykłe (nietypowe = false): prośby czysto logistyczne, które wykona magazyn lub kurier bez decyzji handlowca („proszę dzwonić przed '
    + 'dostawą”, „zostawić u sąsiada”, „dostawa po 15”, „faktura na firmę” z podanym NIP), podziękowania, powtórzenie tego, co już jest '
    + 'w pozycjach. Gdy nie masz pewności – nietypowe = true (lepiej, żeby handlowiec rzucił okiem). '
    + '`powod` pisz po polsku, konkretnie, z nazwą pozycji, której dotyczy.\n\n' + SLOWNIK
}

export function userAnalizyZamowienia(z: Zamowienie): string {
  return `Zamówienie nr ${z.numer}${z.klient ? ` od ${z.klient}` : ''}${z.razem ? `, razem ${z.razem}` : ''}.\n\n`
    + `Zamówione pozycje (z opcjami wybranymi przez klienta):\n${z.pozycje || '(nie udało się odczytać pozycji)'}\n\n`
    + `Adnotacja klienta do zamówienia:\n„${z.adnotacja ?? ''}”`
}
