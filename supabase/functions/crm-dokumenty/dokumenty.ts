// Dokumenty klienta Po Drzwi rysowane pdf-lib 1:1 wg szablonów wtyczki dokumenty-po-drzwi (karta-pomiarowa.html, umowa.html,
// protokol-odbioru.html; treść umowy wg najnowszej wersji użytej w praktyce — umowa 71/10/2026 z dodatkowymi ustępami §3.4 i §6).
//   * karta pomiarowa — A4 POZIOMO, 2 strony: zamawiający, tabela otworów (10 wierszy, wysokość dopasowana do strony),
//     zakres prac (checkboxy), stopka; strona 2: kratka 5 mm na rysunek, ustalenia, podpisy, RODO. Blankiet do wypełnienia długopisem.
//   * umowa — A4 pionowo, §1–§7 (+§3a przy VAT 8%), pola kwot (brutto / zaliczka / po odbiorze), podpisy, stopka,
//     potem Załącznik nr 1 = PDF oferty (i plik konfiguracji producenta, jeśli jest PDF-em), każda strona ostemplowana.
//   * protokół odbioru — A4 pionowo, do umowy: metryka, potwierdzenie, rozliczenie (do zapłaty po odbiorze), uwagi, podpisy.
// Teksty stałe (RODO, paragrafy) są tu w kodzie — zmiana treści = zmiana kodu, świadomie (to dokumenty prawne, nie konfiguracja).

import { Rysownik, mm, px, K, zawijaj, fmt, type Logo, type Segment, type Czcionki } from './rysuj.ts'

export type Firma = Record<string, string | null>

export type KartaDane = {
  data_pomiaru: string; godzina: string
  klient_nazwa: string; telefon: string; email: string
  adres_pomiaru: string; pietro: string; wykonal: string
  otwory: { rodzaj: string; pomieszczenie: string }[]
}
export type UmowaDane = {
  numer: string; data_zawarcia: string; miejsce_zawarcia: string
  klient_nazwa: string; klient_adres: string; adres_montazu: string; email: string; telefon: string
  /** 27.11: klient-firma — nazwa firmy i NIP z karty klienta (crm.leady.firma_nazwa / nip) */
  klient_firma?: string | null; klient_nip?: string | null
  przedmiot: string; zakres_prac: string
  termin_tygodnie: number | null; termin_data: string | null
  brutto: number; stawka_vat: string; zaliczka: number; pozostalo: number; zaliczka_proc: number
  gwarancja_miesiace: number; vat8: boolean
  numer_oferty: string; oferta_opis: string          // np. „konfiguracja KR Center z dnia 21.10.2026”
}
export type ProtokolDane = {
  numer_umowy: string; data_umowy: string; data_odbioru: string | null
  adres_montazu: string; klient_nazwa: string; klient_adres: string; telefon: string
  klient_firma?: string | null; klient_nip?: string | null
  brutto: number; zaliczka: number; pozostalo: number
}

const zl = (x: number) => `${fmt(x)} zł`
export function tygodnieSlownie(n: number): string {
  const r10 = n % 10, r100 = n % 100
  if (n === 1) return '1 tydzień'
  if (r10 >= 2 && r10 <= 4 && !(r100 >= 12 && r100 <= 14)) return `${n} tygodnie`
  return `${n} tygodni`
}
export function miesiaceSlownie(n: number): string {
  const r10 = n % 10, r100 = n % 100
  if (n === 1) return '1 miesiąc'
  if (r10 >= 2 && r10 <= 4 && !(r100 >= 12 && r100 <= 14)) return `${n} miesiące`
  return `${n} miesięcy`
}
function salonBezPrefiksu(f: Firma) { return (f.firma_salon ?? '').replace(/^Showroom:\s*/i, '') }
/** Stopka jak w szablonach: firma, siedziba · showroom · tel · www · NIP · REGON · KRS (· kapitał). */
export function stopkaFirmy(f: Firma, zKapitalem = false): string {
  const cz = [
    `${f.firma_nazwa ?? 'Po Drzwi Sp. z o.o.'}, ${f.firma_adres ?? ''}`,
    salonBezPrefiksu(f) ? `showroom: ${salonBezPrefiksu(f)}` : '',
    f.firma_tel ? `tel. ${f.firma_tel}` : '', f.firma_www ?? '',
    f.firma_nip ? `NIP ${f.firma_nip}` : '', f.firma_regon ? `REGON ${f.firma_regon}` : '', f.firma_krs ? `KRS ${f.firma_krs}` : '',
    zKapitalem && f.firma_kapital ? `kapitał zakładowy ${f.firma_kapital}` : '',
  ].filter(Boolean)
  return cz.join(' · ')
}

// ====================================================================================== KARTA POMIAROWA
export async function kartaPomiarowa(d: KartaDane, cz: Czcionki, logo: Logo, firma: Firma): Promise<Uint8Array> {
  const r = await Rysownik.utworz(cz, logo, { poziom: true, marginesy: { g: mm(10), d: mm(8), l: mm(10), p: mm(10) } })
  const naglowek = (sub: Segment[]) => r.naglowek({ tytul: ['KARTA POMIAROWA'], sub, logoH: mm(11), tytulSize: 15, tytulLs: px(2.2), subSize: 9, subColor: K.g33, subLs: px(0.3) })
  const lbl = (s: string) => r.etykieta(s, r.ML, { size: 8.5, gora: px(12), dol: px(5) })

  // ---- strona 1
  naglowek([{ t: 'nr ............................  ·  data pomiaru ', f: r.R }, { t: `${d.data_pomiaru || '......................'}${d.godzina ? `, godz. ${d.godzina}` : ''}`, f: r.SB }])
  lbl('Zamawiający')
  r.y -= px(9) - px(5)
  const kolW = r.W / 2, lblW = mm(38)
  const metaKol = (x: number, w: number, wiersze: [string, string][], yTop: number): number => {
    let yy = yTop
    for (const [k, v] of wiersze) {
      const h = 18.5                                    // jak w oryginale z wkhtmltopdf (~6,5 mm na wiersz)
      const yl = yy - h + 2.5                            // linia pod wartością
      r.linia(x + lblW, yl, w - lblW, 0.75, K.g88)
      r.tx(k.toUpperCase(), x, yl + 3, 8, r.R, K.g44, px(0.8))
      r.tx(v ?? '', x + lblW + 2, yl + 3.5, 11.5, r.M)
      yy -= h
    }
    return yy
  }
  const yL = metaKol(r.ML, kolW - mm(4), [['Imię i nazwisko', d.klient_nazwa], ['Telefon', d.telefon], ['E-mail', d.email]], r.y)
  const yR = metaKol(r.ML + kolW + mm(4), kolW - mm(4), [['Adres pomiaru', d.adres_pomiaru], ['Piętro / winda', d.pietro], ['Pomiar wykonał', d.wykonal]], r.y)
  r.y = Math.min(yL, yR)

  lbl('Otwory')
  // kolumny tabeli otworów
  const kol: { w: number; t: string; u?: string }[] = [
    { w: mm(8), t: 'Lp' }, { w: mm(24), t: 'Rodzaj', u: 'wewn. / zewn. / wejściowe' }, { w: mm(34), t: 'Pomieszczenie' },
    { w: mm(44), t: 'Rozmiar i kierunek', u: 'szer. × wys. otworu, mm · L / P · do / na zewn.' },
    { w: mm(22), t: 'Grubość muru', u: 'mm — nie cm' }, { w: mm(38), t: 'Ościeżnica', u: 'reg. / prosta / stała · przylgowa / bezprzylgowa' },
    { w: 0, t: 'Uwagi — zamek, próg i różnica poziomów, opaska, podcięcie i kratka, ocieplenie, doświetla, stan otworu, przeszkody przy ościeżu' },
  ]
  kol[6].w = r.W - kol.slice(0, 6).reduce((s, k) => s + k.w, 0)
  const lhT = 7.6 * 1.3, lhU = 6.6 * 1.3
  const naglowki = kol.map((k) => ({ t: zawijaj(r.M, 7.6, k.t.toUpperCase(), k.w - px(8)), u: k.u ? zawijaj(r.R, 6.6, k.u, k.w - px(8)) : [] }))
  const headH = Math.max(...naglowki.map((n) => n.t.length * lhT + n.u.length * lhU)) + 2 * px(6)
  // wysokość wiersza dopasowana tak, by strona 1 mieściła 10 wierszy + zakres prac + stopkę
  const n = Math.max(10, d.otwory.length)
  const resztaH = (px(12) + 8.5 * 1.5 + px(5)) + px(4) + 3 * (10 * 1.45 + px(8)) + (px(10) + px(6) + 2 * 7.6 * 1.5) + 4
  const rowH = Math.max(mm(8), Math.min(mm(12), (r.y - r.MB - headH - resztaH) / n))
  // nagłówek tabeli
  r.prostokat(r.ML, r.y - headH, r.W, headH, { wypelnienie: K.ink })
  let x = r.ML
  kol.forEach((k, i) => {
    const h = naglowki[i].t.length * lhT + naglowki[i].u.length * lhU
    let yy = r.y - (headH - h) / 2
    for (const l of naglowki[i].t) { r.txC(l, x + k.w / 2, r.baza(yy, 7.6, lhT), 7.6, r.M, K.bialy, px(0.3)); yy -= lhT }
    for (const l of naglowki[i].u) { r.txC(l, x + k.w / 2, r.baza(yy, 6.6, lhU), 6.6, r.R, K.gd6, px(0.3)); yy -= lhU }
    x += k.w
  })
  r.y -= headH
  for (let i = 0; i < n; i++) {
    const o = d.otwory[i] ?? { rodzaj: '', pomieszczenie: '' }
    const top = r.y, bot = r.y - rowH
    r.prostokat(r.ML, bot, kol[0].w, rowH, { wypelnienie: i % 2 ? K.gf6 : K.gfa })
    let xx = r.ML
    kol.forEach((k) => { r.prostokat(xx, bot, k.w, rowH, { ramka: K.g9a, grubosc: 0.75 }); xx += k.w })
    r.txC(String(i + 1), r.ML + kol[0].w / 2, r.baza(top - (rowH - 9.5 * 1.45) / 2, 9.5, 9.5 * 1.45), 9.5, r.M, K.g55)
    const wpis = (tekst: string, kolIdx: number) => {
      if (!tekst) return
      const x0 = r.ML + kol.slice(0, kolIdx).reduce((s, k) => s + k.w, 0)
      let yy = top - px(2)
      for (const l of zawijaj(r.M, 10, tekst, kol[kolIdx].w - px(6))) { r.tx(l, x0 + px(3), r.baza(yy, 10, 14), 10, r.M); yy -= 14 }
    }
    wpis(o.rodzaj, 1); wpis(o.pomieszczenie, 2)
    r.y = bot
  }

  lbl('Zakres prac — każda pozycja musi być rozstrzygnięta')
  r.y -= px(4) - px(5)
  const zak = [['Montaż surowy', 'Demontaż starej stolarki', 'Utylizacja starej stolarki'],
    ['Obróbka tynkarska po montażu', 'Przygotowanie / przeróbka otworu', 'Progi, listwy, ćwierćwałki'],
    ['Dostawa i wniesienie', 'Klamki i szyldy w komplecie', 'Lokal mieszkalny']]
  const top0 = r.y
  const kw = r.W / 3
  zak.forEach((kolumna, i) => {
    let yy = top0
    const x0 = r.ML + i * kw + (i ? mm(8) : 0)
    for (const t of kolumna) {
      yy -= r.checkbox(x0, yy, mm(4.2), t, 10, r.R, { grubosc: 1, dopisek: t === 'Lokal mieszkalny' ? '(dot. stawki VAT)' : undefined, dopisekSize: 8.5 })
    }
    r.y = Math.min(r.y, yy)
  })
  r.stopka(`${stopkaFirmy(firma)}   |   strona 1 z 2`, { size: 7.6, color: K.g44, gora: px(10), lh: 7.6 * 1.5, font: r.R, pad: px(6) })

  // ---- strona 2
  r.nowaStrona()
  naglowek([{ t: 'rysunek, ustalenia i podpisy  ·  strona 2 z 2', f: r.R }])
  lbl('Rysunek pomocniczy')
  r.y -= px(5) - px(5)
  {
    const h = mm(72), top = r.y, bot = r.y - h
    for (let gx = r.ML + mm(5); gx < r.ML + r.W - 0.5; gx += mm(5)) r.liniaPion(gx, bot, top, 0.75, K.gd9)
    for (let gy = top - mm(5); gy > bot + 0.5; gy -= mm(5)) r.linia(r.ML, gy, r.W, 0.75, K.gd9)
    r.prostokat(r.ML, bot, r.W, h, { ramka: K.g88, grubosc: 0.75 })
    r.y = bot
  }
  lbl('Inne ustalenia dokonane na miejscu pomiaru')
  for (let i = 0; i < 3; i++) { r.y -= mm(5) + mm(6); r.linia(r.ML, r.y, r.W, 0.75, K.g88) }
  r.y -= mm(14)
  {
    const w = (r.W - mm(20)) / 2
    r.linia(r.ML, r.y, w, 0.75, K.ink); r.linia(r.ML + w + mm(20), r.y, w, 0.75, K.ink)
    const b = r.baza(r.y - px(5), 8.5, 8.5 * 1.45)
    r.tx('PODPIS ZAMAWIAJĄCEGO', r.ML, b, 8.5, r.R, K.g33, px(0.8))
    r.tx('PODPIS OSOBY WYKONUJĄCEJ POMIAR', r.ML + w + mm(20), b, 8.5, r.R, K.g33, px(0.8))
    r.y -= px(5) + 8.5 * 1.45
  }
  r.y -= px(10)
  r.linia(r.ML, r.y, r.W, 0.75, K.ge0)
  r.y -= px(6)
  r.akapitSeg([
    { t: 'Informacja o przetwarzaniu danych osobowych. ', f: r.SB, c: K.g44 },
    { t: `Administratorem danych jest ${firma.firma_nazwa ?? 'Po Drzwi Sp. z o.o.'}, ${firma.firma_adres ?? ''}, KRS ${firma.firma_krs ?? ''}, NIP ${firma.firma_nip ?? ''}, e-mail ${firma.firma_email ?? ''}, tel. ${firma.firma_tel ?? ''}. `
      + 'Dane podane w niniejszej karcie przetwarzamy w celu przygotowania oferty i wykonania umowy (art. 6 ust. 1 lit. b RODO) oraz w celu wypełnienia obowiązków podatkowych i rachunkowych (art. 6 ust. 1 lit. c RODO). Podanie danych jest dobrowolne, ale niezbędne do przygotowania oferty. '
      + 'Dane przechowujemy przez czas wykonania umowy, a następnie przez okres przedawnienia roszczeń oraz okres wymagany przepisami podatkowymi. Odbiorcami danych mogą być producenci stolarki, firmy montażowe, biuro rachunkowe i dostawcy usług IT — wyłącznie w zakresie niezbędnym do realizacji zamówienia. '
      + 'Przysługuje Państwu prawo dostępu do danych, ich sprostowania, usunięcia, ograniczenia przetwarzania, przenoszenia oraz wniesienia sprzeciwu, a także prawo wniesienia skargi do Prezesa Urzędu Ochrony Danych Osobowych.' },
  ], r.ML, r.W, 7.6, r.R, K.g44, 7.6 * 1.5)
  return await r.zapisz()
}

// ====================================================================================== UMOWA
export async function umowa(d: UmowaDane, cz: Czcionki, logo: Logo, firma: Firma, zalaczniki: { bajty: Uint8Array; stempel: string }[]): Promise<Uint8Array> {
  const r = await Rysownik.utworz(cz, logo, { marginesy: { g: mm(14), d: mm(11), l: mm(15), p: mm(15) } })
  const S = 8.8, LH = S * 1.6
  r.naglowek({ tytul: ['UMOWA O WYKONANIE', 'USŁUGI WYMIANY DRZWI'], sub: [{ t: `nr ${d.numer}`, f: r.SB }], logoH: mm(12), tytulSize: 11.5, tytulLs: px(2), subSize: 9.5, subLs: px(0.6) })
  r.y -= px(13)
  r.akapitSeg([{ t: 'Zawarta w dniu ' }, { t: d.data_zawarcia, f: r.SB }, { t: ` w ${d.miejsce_zawarcia}`, c: K.g6b }, { t: ', pomiędzy:' }], r.ML, r.W, S, r.L, K.ink, LH)

  /** Ramka strony (.party): treść rysowana funkcją, potem obramowanie wg zmierzonej wysokości. */
  const ramka = (tresc: () => void) => {
    r.y -= px(9)
    const top = r.y
    r.y -= px(9)
    tresc()
    r.y -= px(9)
    r.prostokat(r.ML, r.y, r.W, top - r.y, { ramka: K.ge2, grubosc: 0.75 })
    r.prostokat(r.ML, r.y, px(3), top - r.y, { wypelnienie: K.ink })
  }
  const xT = r.ML + px(12), wT = r.W - px(24)
  const rola = (s: string) => { r.tx(s.toUpperCase(), xT, r.baza(r.y, 6.9, 6.9 * 1.6), 6.9, r.M, K.g8a, px(1.6)); r.y -= 6.9 * 1.6 + px(5) }
  const nazwaPelna = firma.firma_nazwa_pelna ?? 'PO DRZWI Spółka z ograniczoną odpowiedzialnością'
  ramka(() => {
    rola('Wykonawca')
    r.akapitSeg([{ t: nazwaPelna, f: r.SB }, { t: ` z siedzibą w ${firma.firma_siedziba_miejscownik ?? 'Żorach'}, ${(firma.firma_adres ?? '').replace(/^al\./i, 'Aleja')}, wpisana do KRS pod numerem ${firma.firma_krs ?? ''}, NIP ${firma.firma_nip ?? ''}, REGON ${firma.firma_regon ?? ''} — zwana dalej „Wykonawcą”,` }], xT, wT, S, r.L, K.ink, LH)
  })
  ramka(() => {
    rola('Zamawiający')
    const kW = mm(34)
    const wiersz = (k: string, v: string, f = r.L) => {
      r.y -= px(2)
      r.tx(k.toUpperCase(), xT, r.baza(r.y - px(3.5), 6.9, 6.9 * 1.6), 6.9, r.L, K.g8a, px(1.1))
      r.akapit(v || '—', xT + kW, wT - kW, S, f, K.ink, LH)
      r.y -= px(2)
    }
    wiersz('Imię i nazwisko', d.klient_nazwa, r.SB)
    if (d.klient_firma) wiersz('Firma', d.klient_firma, r.SB)
    if (d.klient_nip) wiersz('NIP', d.klient_nip)
    wiersz('Adres', d.klient_adres)
    wiersz('Adres montażu', d.adres_montazu)
    wiersz('E-mail', d.email)
    wiersz('Telefon', d.telefon)
    r.y -= px(5)
    r.akapit('— zwany/a dalej „Zamawiającym”.', xT, wT, S, r.L, K.ink, LH)
  })

  const h2 = (s: string) => r.h2(s, r.ML, r.W)
  const p = (s: string) => r.akapit(s, r.ML, r.W, S, r.L, K.ink, LH, px(6))
  const pSeg = (s: Segment[]) => r.akapitSeg(s, r.ML, r.W, S, r.L, K.ink, LH, px(6))

  h2('§1. Przedmiot umowy')
  r.lista([
    [{ t: 'Przedmiotem niniejszej umowy jest wykonanie usługi polegającej na montażu stolarki drzwiowej: ' }, { t: d.przedmiot.replace(/\.?$/, '.') }],
    `Zakres prac obejmuje: ${d.zakres_prac.replace(/\.?$/, '.')}`,
    'Szczegółową konfigurację zamówionej stolarki określa oferta stanowiąca Załącznik nr 1 do niniejszej umowy.',
  ], r.ML, r.W, S, r.L, { lh: LH })

  h2('§2. Termin realizacji')
  p('Z uwagi na to, że stolarka jest produkowana na indywidualne zamówienie, dokładny termin montażu zostanie ustalony po otrzymaniu przez Wykonawcę informacji o gotowości towaru do wysyłki od producenta.')
  pSeg(d.termin_data
    ? [{ t: 'Wykonawca zobowiązuje się do wykonania montażu w terminie do dnia ' }, { t: d.termin_data, f: r.SB }, { t: ' — zgodnie z indywidualnymi ustaleniami stron.' }]
    : [{ t: 'Wykonawca zobowiązuje się do wykonania montażu w terminie ' }, { t: tygodnieSlownie(d.termin_tygodnie ?? 8), f: r.SB }, { t: ' od dnia zaksięgowania zaliczki, o której mowa w §3 ust. 2 lit. a.' }])
  p('Dokładny termin montażu zostanie ustalony z Zamawiającym w sposób dogodny dla obu stron, nie później niż w terminie 2 tygodni od momentu, gdy towar będzie gotowy do montażu.')
  p('W przypadku wystąpienia opóźnień wynikających z przyczyn niezależnych od Wykonawcy (np. opóźnienia u producenta) Wykonawca poinformuje Zamawiającego o nowym możliwym terminie realizacji.')

  h2('§2a. Komunikacja i zgody')
  p('Zamawiający wyraża zgodę na przesyłanie przez Wykonawcę na podany adres e-mail dokumentów związanych z realizacją niniejszej umowy, w tym potwierdzeń, faktur, protokołów oraz innych dokumentów sprzedażowych.')
  p('Zamawiający wyraża zgodę na przesłanie przez Wykonawcę jednorazowej wiadomości e-mail z prośbą o wystawienie opinii na temat jakości wykonanej usługi, po zakończeniu realizacji umowy.')

  h2('§3. Wynagrodzenie')
  r.lista([
    [{ t: 'Wynagrodzenie za wykonanie prac ustala się na kwotę ' }, { t: zl(d.brutto), f: r.SB }, { t: ` brutto, w tym ${d.stawka_vat} VAT.` }],
    'Płatność następuje w dwóch transzach:',
  ], r.ML, r.W, S, r.L, { lh: LH })
  r.lista([
    [{ t: 'przed rozpoczęciem prac tytułem zaliczki — ' }, { t: zl(d.zaliczka), f: r.SB }, { t: ',' }],
    [{ t: 'po podpisaniu protokołu odbioru — ' }, { t: zl(d.pozostalo), f: r.SB }, { t: '.' }],
  ], r.ML + px(16), r.W - px(16), S, r.L, { litery: true, lh: LH })
  r.lista([
    'Płatność może zostać dokonana gotówką, przelewem bankowym, kartą płatniczą lub za pośrednictwem płatności online — zgodnie z indywidualnymi ustaleniami stron.',
    'Wynagrodzenie określone w ust. 1 jest kwotą ostateczną i wiążącą strony. Obejmuje dostawę i montaż stolarki zgodnie z Załącznikiem nr 1 oraz prace wskazane w §1 ust. 2. Ceny i kwoty wskazane w Załączniku nr 1 mają charakter wyłącznie informacyjny i nie stanowią podstawy rozliczenia.',
  ], r.ML, r.W, S, r.L, { lh: LH, start: 2 })
  // pola kwot
  {
    const bw = (r.W - 2 * mm(4)) / 3, bh = 2 * px(7) + 6.6 * 1.5 + px(2) + 12 * 1.3 + 7.2 * 1.5
    r.y -= px(7) - px(4)
    r.miejsce(bh)
    const top = r.y
    const pola: [string, string, string, boolean][] = [
      ['Wynagrodzenie brutto', zl(d.brutto), `w tym ${d.stawka_vat} VAT`, true],
      ['Zaliczka przed rozpoczęciem', zl(d.zaliczka), `${d.zaliczka_proc}% wynagrodzenia brutto`, false],
      ['Po odbiorze', zl(d.pozostalo), 'płatne po podpisaniu protokołu', false],
    ]
    pola.forEach(([lab, val, sub, main], i) => {
      const x = r.ML + i * (bw + mm(4))
      r.prostokat(x, top - bh, bw, bh, main ? { wypelnienie: K.ink } : { ramka: K.ge2, grubosc: 0.75 })
      let yy = top - px(7)
      r.tx(lab.toUpperCase(), x + px(10), r.baza(yy, 6.6, 6.6 * 1.5), 6.6, r.L, main ? K.gb9 : K.g8a, px(1.3)); yy -= 6.6 * 1.5 + px(2)
      r.tx(val, x + px(10), r.baza(yy, 12, 12 * 1.3), 12, r.SB, main ? K.bialy : K.ink, px(0.2)); yy -= 12 * 1.3
      r.tx(sub, x + px(10), r.baza(yy, 7.2, 7.2 * 1.5), 7.2, r.L, main ? K.gc9 : K.g6b)
    })
    r.y = top - bh
  }
  if (d.vat8) {
    h2('§3a. Oświadczenie Zamawiającego do stawki VAT 8%')
    r.y -= px(6) - px(5)
    const top = r.y, stronaOsw = r.page
    const xO = r.ML + px(12), wO = r.W - px(24)
    r.y -= px(9)
    r.akapit('Zamawiający oświadcza, że:', xO, wO, 8.2, r.L, K.ink, 8.2 * 1.6, px(4))
    r.lista([
      'obiekt, w którym wykonywane są prace, jest budynkiem mieszkalnym jednorodzinnym lub lokalem mieszkalnym objętym społecznym programem mieszkaniowym,',
      'powierzchnia użytkowa lokalu mieszkalnego nie przekracza 150 m², a budynku mieszkalnego jednorodzinnego — 300 m²,',
      'prace objęte niniejszą umową stanowią dostawę wraz z montażem wykonywaną w ramach budowy, remontu, modernizacji, termomodernizacji lub przebudowy tego obiektu.',
    ], xO, wO, 8.2, r.L, { litery: true, lh: 8.2 * 1.6 })
    r.akapit('Oświadczenie składane jest na potrzeby zastosowania obniżonej stawki podatku VAT zgodnie z art. 41 ust. 12–12c ustawy o podatku od towarów i usług. W przypadku gdy oświadczenie okaże się niezgodne ze stanem faktycznym, Zamawiający pokryje różnicę podatku wraz z należnymi odsetkami.', xO, wO, 8.2, r.L, K.ink, 8.2 * 1.6)
    r.y -= px(9)
    if (r.page === stronaOsw) r.prostokat(r.ML, r.y, r.W, top - r.y, { ramka: K.gdc, grubosc: 0.75 })
  }

  h2('§4. Odbiór prac')
  r.lista(['Po zakończeniu prac strony podpiszą protokół odbioru.',
    'Wykonawca nie jest zobowiązany do odbioru zdemontowanych, starych drzwi oraz innych odpadów budowlanych.'], r.ML, r.W, S, r.L, { lh: LH })

  h2('§5. Gwarancja i rękojmia')
  r.lista([
    [{ t: 'Wykonawca udziela ' }, { t: miesiaceSlownie(d.gwarancja_miesiace), f: r.SB }, { t: ' gwarancji na wykonane przez siebie prace montażowe.' }],
    'W przypadku ujawnienia wad montażowych Wykonawca zobowiązuje się do ich usunięcia w terminie 14 dni roboczych od dnia otrzymania zgłoszenia.',
    'Jeżeli wada dotyczy samego produktu (drzwi, ościeżnicy, okuć itp.), Wykonawca zgłosi reklamację do producenta w imieniu Zamawiającego.',
    'Termin usunięcia wady zależnej od producenta może być uzależniony od jego decyzji, czasu reakcji oraz dostępności części zamiennych. Wykonawca nie ponosi odpowiedzialności za opóźnienia wynikające z tych okoliczności.',
    'Wykonawca zobowiązuje się do niezwłocznego złożenia reklamacji oraz informowania Zamawiającego o jej przebiegu i postępach.',
  ], r.ML, r.W, S, r.L, { lh: LH })

  h2('§6. Załączniki i dokumenty stanowiące integralną część umowy')
  r.lista(['Integralną część niniejszej umowy stanowią następujące dokumenty:'], r.ML, r.W, S, r.L, { lh: LH })
  r.lista([`Załącznik nr 1 — Oferta Wykonawcy nr ${d.numer_oferty}${d.oferta_opis ? ` (${d.oferta_opis})` : ''} zaakceptowana przez Zamawiającego, zawierająca specyfikację techniczną (konfigurację) zamówionej stolarki.`],
    r.ML + px(16), r.W - px(16), S, r.L, { litery: true, lh: LH })
  r.lista([
    'Strony zgodnie oświadczają, że oferta, o której mowa w ust. 1 lit. a, stanowi szczegółową konfigurację zamówionej stolarki.',
    'Zamawiający potwierdza, że zapoznał się z treścią oferty oraz pozostałych załączników, akceptuje ich treść i że na ich podstawie zostanie wykonany przedmiot umowy.',
    'W przypadku rozbieżności pomiędzy treścią niniejszej umowy a treścią załączników pierwszeństwo mają postanowienia załączników w zakresie parametrów technicznych produktu. Wysokość wynagrodzenia określa wyłącznie §3.',
    'Zamawiający ponosi odpowiedzialność za prawidłowość danych zawartych w zaakceptowanej ofercie, w szczególności w zakresie wyboru modelu, wymiarów, strony otwierania, kolorystyki oraz wyposażenia. Po akceptacji oferty zmiany konfiguracji mogą być niemożliwe lub mogą wiązać się z dodatkowymi kosztami.',
  ], r.ML, r.W, S, r.L, { lh: LH, start: 1 })

  h2('§7. Postanowienia końcowe')
  r.lista(['W sprawach nieuregulowanych mają zastosowanie przepisy Kodeksu cywilnego.', 'Wszelkie zmiany umowy wymagają formy pisemnej.',
    'Umowę sporządzono w dwóch jednobrzmiących egzemplarzach, po jednym dla każdej ze stron.'], r.ML, r.W, S, r.L, { lh: LH })

  podpisy(r, mm(24), mm(24), ['Podpis Zamawiającego', 'Podpis Wykonawcy'])
  r.y -= mm(12)
  r.stopka(stopkaFirmy(firma, true), { size: 6.9, gora: px(14) })

  for (const z of zalaczniki) await r.dolaczPdf(z.bajty, z.stempel)
  return await r.zapisz()
}

/** Dwie linie na podpis z podpisami pod nimi (umowa/protokół). */
function podpisy(r: Rysownik, gora: number, odstep: number, etykiety: [string, string]) {
  r.y -= gora
  r.miejsce(px(5) + 6.9 * 1.6 + 10)
  const w = (r.W - odstep) / 2
  r.linia(r.ML, r.y, w, 0.75, K.ink); r.linia(r.ML + w + odstep, r.y, w, 0.75, K.ink)
  const b = r.baza(r.y - px(5), 6.9, 6.9 * 1.6)
  r.txC(etykiety[0].toUpperCase(), r.ML + w / 2, b, 6.9, r.L, K.g6b, px(1.2))
  r.txC(etykiety[1].toUpperCase(), r.ML + w + odstep + w / 2, b, 6.9, r.L, K.g6b, px(1.2))
  r.y -= px(5) + 6.9 * 1.6
}

// ====================================================================================== PROTOKÓŁ ODBIORU
export async function protokolOdbioru(d: ProtokolDane, cz: Czcionki, logo: Logo, firma: Firma): Promise<Uint8Array> {
  const r = await Rysownik.utworz(cz, logo, { marginesy: { g: mm(14), d: mm(11), l: mm(15), p: mm(15) } })
  const S = 8.8, LH = S * 1.6
  r.naglowek({ tytul: ['PROTOKÓŁ ODBIORU', 'PRAC MONTAŻOWYCH'], sub: [{ t: `do umowy nr ${d.numer_umowy}`, f: r.SB }], logoH: mm(12), tytulSize: 11.5, tytulLs: px(2), subSize: 9.5, subLs: px(0.6) })
  r.y -= px(10)
  const kolW = r.W / 2, kW = mm(32)
  const kolumna = (x: number, w: number, wiersze: [string, string, boolean?][], yTop: number): number => {
    let yy = yTop
    for (const [k, v, bold] of wiersze) {
      yy -= px(2.5)
      r.tx(k.toUpperCase(), x, r.baza(yy - px(3.5), 6.9, 6.9 * 1.6), 6.9, r.L, K.g8a, px(1.1))
      const linie = (v || '—').split('\n')
      let h = 0
      for (const l of linie) { r.tx(l, x + kW, r.baza(yy - h, S, LH), S, bold ? r.SB : r.L); h += LH }
      yy -= h + px(2.5)
    }
    return yy
  }
  const yL = kolumna(r.ML, kolW - mm(4), [['Data odbioru', d.data_odbioru ?? '.......................................', true], ['Miejsce montażu', d.adres_montazu], ['Umowa nr', `${d.numer_umowy} z dnia ${d.data_umowy}`]], r.y)
  const yR = kolumna(r.ML + kolW + mm(4), kolW - mm(4), [['Zamawiający', d.klient_nazwa, true], ...(d.klient_firma ? [['Firma', d.klient_firma, true] as [string, string, boolean]] : []), ...(d.klient_nip ? [['NIP', d.klient_nip] as [string, string]] : []), ['Adres', d.klient_adres], ['Telefon', d.telefon]], r.y)
  r.y = Math.min(yL, yR)

  const lbl = (s: string) => r.etykieta(s, r.ML, { size: 6.9, gora: px(16), dol: px(6) })
  lbl('Potwierdzenie odbioru')
  r.lista([
    'Dokonano odbioru jakościowego stolarki oraz prac budowlano-montażowych.',
    'Zamawiający został poinformowany o zasadach konserwacji oraz prawidłowego użytkowania zamontowanej stolarki.',
    'Poniżej podpisani potwierdzają, że prace zostały wykonane zgodnie z umową i podlegają gwarancji zgodnie z jej zapisami.',
  ], r.ML, r.W, S, r.L, { lh: LH })

  lbl('Rozliczenie')
  {
    const bw = (r.W - 2 * mm(4)) / 3, bh = 2 * px(7) + 6.6 * 1.5 + px(2) + 12 * 1.3
    r.y -= px(7) - px(6)
    const top = r.y
    const pola: [string, string, boolean][] = [['Wynagrodzenie brutto', zl(d.brutto), false], ['Zaliczka zapłacona', zl(d.zaliczka), false], ['Do zapłaty po odbiorze', zl(d.pozostalo), true]]
    pola.forEach(([lab, val, main], i) => {
      const x = r.ML + i * (bw + mm(4))
      r.prostokat(x, top - bh, bw, bh, main ? { wypelnienie: K.ink } : { ramka: K.ge2, grubosc: 0.75 })
      let yy = top - px(7)
      r.tx(lab.toUpperCase(), x + px(10), r.baza(yy, 6.6, 6.6 * 1.5), 6.6, r.L, main ? K.gb9 : K.g8a, px(1.3)); yy -= 6.6 * 1.5 + px(2)
      r.tx(val, x + px(10), r.baza(yy, 12, 12 * 1.3), 12, r.SB, main ? K.bialy : K.ink, px(0.2))
    })
    r.y = top - bh
  }

  lbl('Uwagi Zamawiającego')
  r.y -= r.checkbox(r.ML, r.y, mm(3.6), 'Brak uwag', 8.4, r.L, { grubosc: 0.85 })
  r.y -= r.checkbox(r.ML, r.y, mm(3.6), 'Uwagi zgłoszono — opisać poniżej:', 8.4, r.L, { grubosc: 0.85 })
  for (let i = 0; i < 4; i++) { r.y -= mm(6) + mm(7); r.linia(r.ML, r.y, r.W, 0.75, K.gc9) }

  podpisy(r, mm(22), mm(24), ['Podpis Zamawiającego', 'Podpis Wykonawcy'])
  r.y -= mm(12)
  r.stopka(stopkaFirmy(firma), { size: 6.9, gora: px(14) })
  return await r.zapisz()
}
