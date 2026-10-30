import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces'
import { ZKP_GRID, ZKP_PRODUCER, zkpBox as box, zkpFmt as fmt, zkpH2 as h2, zkpPdfBase as base, zkpTh as th } from './zkpPrint'
import {
  ZKP_EVACUATION_LABELS,
  ZKP_OPENING_LABELS,
  ZKP_PRODUCT_TYPE_LABELS,
  type ZkpProductCard,
  type ZkpRange,
} from './zkpCard'
import {
  ZKP_PROTOCOL_CHECK_SECTIONS,
  fireClassLabel,
  smokeLabel,
  type ZkpDeclaration,
  type ZkpTestProtocol,
} from './zkpProtocol'

// Wydruki etapu D+E ZKP: protokół badań 6.17.5 (układ wzoru A–G), deklaracja
// KDWU (strona 2 zał. 6.9) / DWU (strona 3), tabliczka znamionowa 6.26 i
// etykieta B / CE 6.8 na konstrukcję.

const PRODUCER_FULL = 'MR Profil Iwona Maroszek, ul. Bukowa 1, 44-300 Wodzisław Śląski, NIP 651-131-57-65; zakład produkcyjny: ul. Marklowicka 17, 44-300 Wodzisław Śląski'

const res = (r: string | null | undefined) =>
  r === 'OK' ? 'OK' : r === 'NOK' ? { text: 'NOK', style: 'nok' } : r === 'nd' ? 'n/d' : { text: '—', color: '#94a3b8' }

// ── Protokół 6.17.5 ──────────────────────────────────────────────────────
export type ProtocolPrintInput = {
  protocol: ZkpTestProtocol
  card: ZkpProductCard
  range: ZkpRange | null
  constructionNo: string
  orderNumber: string
  company: string
  printedAt: Date
}

export function buildProtocolDefinition(inp: ProtocolPrintInput): TDocumentDefinitions {
  const { protocol: p, card: c, range: k } = inp
  const pick = <T extends string>(labels: Record<T, string>, value: T | null) =>
    (Object.keys(labels) as T[]).map((x) => `${box(x === value)} ${labels[x]}`).join('   ')
  const checkRows = (keys: 'B' | 'D' | 'E' | 'F') => {
    const sec = ZKP_PROTOCOL_CHECK_SECTIONS.find((s) => s.key === keys)!
    return sec.checks.map((ch) => [ch.label, res(p.checks[ch.key])])
  }
  const sectionE = ZKP_PROTOCOL_CHECK_SECTIONS.find((s) => s.key === 'E')!

  const content: Content[] = [
    { text: `Protokół badań wyrobu gotowego nr ${p.protocol_no}`, style: 'h1' },
    {
      text: 'Kontrola odbiorcza każdej konstrukcji (ZKP pkt 5.7). Kryteria wyłącznie z kolumny tabeli K dla zakresu raportu z karty wyrobu; szczeliny mierzone suwmiarką (SR, zał. 6.14).',
      style: 'small', margin: [0, 0, 0, 6],
    },
    h2('A. Identyfikacja'),
    {
      table: {
        widths: [170, '*'],
        body: [
          ['Nr protokołu / nr konstrukcji', `${p.protocol_no} / ${inp.constructionNo}${p.attempt > 1 ? `  (protokół nr ${p.attempt} — po naprawie)` : ''}`],
          ['Nr zlecenia, klient, obiekt', `${inp.orderNumber}, ${inp.company || '—'}`],
          ['Typ; skrzydła; otwieranie', `${pick(ZKP_PRODUCT_TYPE_LABELS, c.product_type)};  skrzydła: ${box(c.leaves === 1)} 1 ${box(c.leaves === 2)} 2;  ${pick(ZKP_OPENING_LABELS, c.opening)}`],
          ['Zakres raportu', ['EI30', 'EI30S', 'EI60', 'EI60S', 'S'].map((r) => `${box(c.range_code === r)} ${r}`).join('  ') + (k ? `  (${k.report})` : '')],
          ['Ewakuacja', pick(ZKP_EVACUATION_LABELS, c.evacuation)],
          ['Data produkcji / data kontroli', `${p.produced_on ?? '—'} / ${p.inspected_on}`],
          ['Przyrządy użyte (nr z zał. 6.14)', p.instruments || '—'],
        ],
      },
      layout: ZKP_GRID,
    },
    h2('B. Przegląd dokumentacji'),
    { table: { headerRows: 1, widths: ['*', 40], body: [[th('Sprawdzenie'), th('Wynik')], ...checkRows('B')] }, layout: ZKP_GRID },
    h2('C. Pomiary'),
    {
      table: {
        headerRows: 1,
        widths: [120, 70, 100, '*', 34],
        body: [
          [th('Pomiar'), th('Nominal [mm]'), th('Zmierzono [mm]'), th('Kryterium'), th('Wynik')],
          ...p.eval.map((e) => [e.label, e.nominal, e.measured, e.criterion, res(e.result)]),
        ],
      },
      layout: ZKP_GRID,
    },
    h2('D. Oględziny'),
    { table: { headerRows: 1, widths: ['*', 40], body: [[th('Sprawdzenie'), th('Wynik')], ...checkRows('D')] }, layout: ZKP_GRID },
    h2('E. Sprawdzenia funkcjonalne'),
    {
      table: {
        headerRows: 1,
        widths: ['*', 110, 130, 34],
        body: [
          [th('Sprawdzenie'), th('Kryterium'), th('Źródło / konfiguracja'), th('Wynik')],
          ...sectionE.checks.map((ch) => [ch.label, ch.criterion ?? '', ch.source ?? '', res(p.checks[ch.key])]),
        ],
      },
      layout: ZKP_GRID,
    },
    h2('F. Oznakowanie'),
    { table: { headerRows: 1, widths: ['*', 40], body: [[th('Sprawdzenie'), th('Wynik')], ...checkRows('F')] }, layout: ZKP_GRID },
    h2('G. Decyzja'),
    {
      text: `Ocena zgodności z raportem klasyfikacyjnym i ZKP: ${box(p.assessment === 'zgodny')} ZGODNY  ${box(p.assessment === 'niezgodny')} NIEZGODNY${p.nonconformity_ref ? ` (rejestr 6.20 nr ${p.nonconformity_ref})` : ''}      Decyzja: ${box(p.decision === 'zwolniony')} ZWOLNIONY  ${box(p.decision === 'wstrzymany')} WSTRZYMANY`,
      margin: [0, 0, 0, 4],
    },
    { text: 'Jedno NOK w częściach B–F = WSTRZYMANY. Zwolnienie po naprawie wymaga nowego, kompletnego protokołu.', style: 'small' },
    p.notes ? { text: `Uwagi: ${p.notes}`, margin: [0, 4, 0, 0] } : '',
    {
      columns: [
        { text: `Kontrolę wykonał (KO): ${p.inspector_initials || '…………'}   data: ${p.inspected_on}   (zapis elektroniczny${p.saved_by_name ? `, konto: ${p.saved_by_name}` : ''})` },
        { text: `Zwolnił (Pełnomocnik ZKP / Zastępca): ${p.closed_by_name || '…………'}   data: ${p.closed_at ? fmt(p.closed_at) : '…………'}`, alignment: 'right' },
      ],
      margin: [0, 12, 0, 0],
    },
  ]
  return base('Załącznik 6.17.5 – Protokół badań wyrobów gotowych ALURON AS 75EI', false, content, inp.printedAt)
}

// ── Deklaracja KDWU / DWU (zał. 6.9, strony 2 i 3) ───────────────────────
export type DeclarationPrintInput = {
  declaration: ZkpDeclaration
  orderNumber: string
  constructionNos: string[]
  printedAt: Date
}

export function buildDeclarationDefinition(inp: DeclarationPrintInput): TDocumentDefinitions {
  const d = inp.declaration
  const kdwu = d.kind === 'KDWU'
  const leavesTxt = d.leaves === 2 ? 'dwuskrzydłowe' : 'jednoskrzydłowe'
  const evac = d.evacuation !== 'nie'
  const cons = inp.constructionNos.join(', ')
  const height = d.height_mm != null ? `${d.height_mm} mm ± ${d.height_tol_mm} mm` : 'NPD'
  const rows = (body: Array<[string, string]>) => ({
    table: { widths: [28, '*'], body: body.map(([a, b]) => [{ text: a, bold: true }, b]) },
    layout: ZKP_GRID,
  })
  const props = (body: Array<[string, string, string]>) => ({
    table: { headerRows: 1, widths: ['*', 150, 150], body: [[th('Zasadnicze charakterystyki'), th(kdwu ? 'Deklarowane właściwości użytkowe' : 'Właściwości użytkowe'), th(kdwu ? 'Uwagi' : 'Zharmonizowana specyfikacja techniczna')], ...body] },
    layout: ZKP_GRID,
  })

  const content: Content[] = kdwu
    ? [
        { text: 'KRAJOWA DEKLARACJA WŁAŚCIWOŚCI UŻYTKOWYCH', style: 'h1', alignment: 'center' },
        { text: `Nr ${d.number}`, bold: true, fontSize: 12, alignment: 'center', margin: [0, 0, 0, 2] },
        { text: 'wg załącznika nr 2 do rozporządzenia Ministra Infrastruktury i Budownictwa z dnia 17 listopada 2016 r. w sprawie sposobu deklarowania właściwości użytkowych wyrobów budowlanych oraz sposobu znakowania ich znakiem budowlanym', style: 'small', alignment: 'center', margin: [0, 0, 0, 10] },
        rows([
          ['1', `Kod identyfikacyjny wyrobu budowlanego: ${d.type_code}`],
          ['2', `Nazwa wyrobu budowlanego: drzwi wewnętrzne przeciwpożarowe i/lub dymoszczelne systemu ALURON AS 75EI, ${leavesTxt}; nr zlecenia / konstrukcji: ${inp.orderNumber} / ${cons}`],
          ['3', `Zamierzone zastosowanie: zamknięcie otworów w ścianach wewnętrznych budynków, w których wymagana jest odporność ogniowa i/lub dymoszczelność${evac ? ' oraz drzwi na drogach ewakuacyjnych' : ''}; w konstrukcjach mocujących: ${d.mounting_text || '………………'} (wg raportu klasyfikacyjnego pkt 2.2.2.8 / 2.2.3.8)`],
          ['4', `Producent: ${PRODUCER_FULL}`],
          ['5', 'Upoważniony przedstawiciel: nie dotyczy'],
          ['6', 'Krajowy system oceny i weryfikacji stałości właściwości użytkowych: 1 (odporność ogniowa, dymoszczelność, samozamykalność; zdolność do zwolnienia – drzwi na drogach ewakuacyjnych)'],
          ['7', `Krajowa specyfikacja techniczna: PN-EN 16034:2014-11; PN-EN 14351-2:2018-12. Jednostka certyfikująca: CERTBUD Sp. z o.o., numer akredytacji AC 158. Numer krajowego certyfikatu stałości właściwości użytkowych: ${d.certificate_no || '………………'}. Odpowiednia dokumentacja techniczna: ${d.odt || 'ODT/MRP/1'}`],
        ]),
        h2('8. Deklarowane właściwości użytkowe'),
        props([
          ['Odporność ogniowa', d.fire_class, `PN-EN 16034:2014-11; raport ${d.range_code.startsWith('EI60') ? '1131/ALURON/2020/K-2/8' : d.range_code === 'S' ? '3060_1556/K/2' : '1131/ALURON/2020/K-1/8'}`],
          ['Dymoszczelność', d.smoke, 'PN-EN 16034:2014-11'],
          ['Samozamykalność', 'C', 'PN-EN 16034:2014-11'],
          ['Zdolność do zwolnienia', d.release_capability === 'zapewniona' ? `zapewniona (drzwi na drogach ewakuacyjnych, zamknięcie wg ${ZKP_EVACUATION_LABELS[d.evacuation as keyof typeof ZKP_EVACUATION_LABELS] ?? 'PN-EN 179 / PN-EN 1125'})` : 'NPD', 'PN-EN 14351-2:2018-12'],
          ['Wysokość', height, 'PN-EN 14351-2:2018-12'],
        ]),
        { text: '9. Właściwości użytkowe wyrobu budowlanego określonego powyżej są zgodne z właściwościami użytkowymi deklarowanymi powyżej. Niniejsza krajowa deklaracja właściwości użytkowych wydana zostaje zgodnie z ustawą z dnia 16 kwietnia 2004 r. o wyrobach budowlanych na wyłączną odpowiedzialność producenta.', margin: [0, 10, 0, 0] },
      ]
    : [
        { text: 'DEKLARACJA WŁAŚCIWOŚCI UŻYTKOWYCH', style: 'h1', alignment: 'center' },
        { text: `Nr ${d.number}`, bold: true, fontSize: 12, alignment: 'center', margin: [0, 0, 0, 2] },
        { text: 'wg załącznika III do rozporządzenia (UE) nr 305/2011 w brzmieniu rozporządzenia delegowanego Komisji (UE) nr 574/2014', style: 'small', alignment: 'center', margin: [0, 0, 0, 10] },
        rows([
          ['1', `Niepowtarzalny kod identyfikacyjny typu wyrobu: ${d.type_code}`],
          ['2', `Zamierzone zastosowanie: drzwi zewnętrzne przeciwpożarowe i/lub dymoszczelne do zastosowania w strefach pożarowych${evac ? ' oraz na drogach ewakuacyjnych' : ''}; w konstrukcjach mocujących: ${d.mounting_text || '………………'} (wg raportu klasyfikacyjnego pkt 2.2.2.8 / 2.2.3.8). Nr zlecenia / konstrukcji: ${inp.orderNumber} / ${cons}`],
          ['3', `Producent: ${PRODUCER_FULL}`],
          ['4', 'Upoważniony przedstawiciel: nie dotyczy'],
          ['5', 'Systemy oceny i weryfikacji stałości właściwości użytkowych: system 1 – odporność ogniowa, dymoszczelność, samozamykalność (EN 16034) oraz zdolność do zwolnienia drzwi na drogach ewakuacyjnych (EN 14351-1 tabl. ZA.2); system 3 – pozostałe właściwości wg EN 14351-1'],
          ['6a', `Normy zharmonizowane: EN 16034:2014; EN 14351-1:2006+A2:2016. Jednostki notyfikowane: CERTBUD Sp. z o.o., nr 2310 – w systemie 1 przeprowadziła ocenę właściwości użytkowych na podstawie badań typu, wstępną inspekcję zakładu i ZKP oraz prowadzi nadzór, i wydała certyfikat stałości właściwości użytkowych nr ${d.certificate_no || '………………'}; LTB Sp. z o.o., nr 1827 – w systemie 3 przeprowadziła badania typu (sprawozdania nr ${d.test_reports || '………………'} wg zał. 6.7 cz. C)`],
          ['6b', 'Europejski dokument oceny: nie dotyczy'],
        ]),
        h2('7. Deklarowane właściwości użytkowe'),
        props([
          ['Odporność ogniowa', d.fire_class, 'EN 16034:2014'],
          ['Dymoszczelność', d.smoke, 'EN 16034:2014'],
          ['Samozamykalność', 'C', 'EN 16034:2014'],
          ['Trwałość samozamykalności – badanie wielokrotnego zamykania / otwierania', 'NPD', 'EN 16034:2014'],
          ['Trwałość samozamykalności – badania korozyjne', 'NPD', 'EN 16034:2014'],
          ['Zdolność do zwolnienia', d.release_capability === 'zapewniona' ? 'zapewniona (drogi ewakuacyjne)' : 'NPD', 'EN 14351-1:2006+A2:2016'],
          ['Odporność na obciążenie wiatrem', 'klasa C2', 'EN 14351-1:2006+A2:2016'],
          ['Wodoszczelność', d.water_class ? `klasa ${d.water_class}` : 'NPD', 'EN 14351-1:2006+A2:2016'],
          ['Przepuszczalność powietrza', 'klasa 2', 'EN 14351-1:2006+A2:2016'],
          ['Odporność na uderzenie (drzwi przeszklone grożące urazem)', d.impact_class || 'NPD', 'EN 14351-1:2006+A2:2016'],
          ['Współczynnik przenikania ciepła UD', d.ud_value && d.ud_value !== 'NPD' ? `${d.ud_value} W/(m²·K) wg obliczeń` : 'NPD', 'EN 14351-1:2006+A2:2016'],
          ['Wysokość', height, 'EN 14351-1:2006+A2:2016'],
          ['Substancje niebezpieczne; nośność urządzeń zabezpieczających; izolacyjność akustyczna; właściwości związane z promieniowaniem', 'NPD', 'EN 14351-1:2006+A2:2016'],
        ]),
        { text: `8. Odpowiednia dokumentacja techniczna: ${d.odt || 'ODT/MRP/1'} (kaskadowanie wyników badań systemodawcy ALURON).`, margin: [0, 10, 0, 4] },
        { text: 'Właściwości użytkowe wyrobu określonego powyżej są zgodne z zestawem deklarowanych właściwości użytkowych. Niniejsza deklaracja właściwości użytkowych wydana zostaje zgodnie z rozporządzeniem (UE) nr 305/2011 na wyłączną odpowiedzialność producenta określonego powyżej.' },
      ]

  content.push({
    columns: [
      { text: `W imieniu producenta podpisał(a): ${d.signer_name || '………………………'}${d.signer_title ? ` (${d.signer_title})` : ''}` },
      { text: `Wodzisław Śląski, ${d.issued_on}`, alignment: 'center' },
      { text: '…………………… (podpis)', alignment: 'right' },
    ],
    margin: [0, 24, 0, 0],
  })
  if (d.status === 'wycofana') {
    content.unshift({ text: `DEKLARACJA WYCOFANA ${d.withdrawn_at ? fmt(d.withdrawn_at) : ''} — ${d.withdraw_reason ?? ''}`, style: 'nok', alignment: 'center', margin: [0, 0, 0, 6] })
  }
  return base(`Załącznik 6.9 – ${kdwu ? 'Krajowa deklaracja właściwości użytkowych (KDWU)' : 'Deklaracja właściwości użytkowych (DWU)'}`, false, content, inp.printedAt)
}

// ── Tabliczka znamionowa 6.26 + etykieta B / CE 6.8 ───────────────────────
export type MarkingItem = {
  constructionNo: string
  card: ZkpProductCard
  declarationNo: string
  certificateNo: string
  year: number
  height_mm: number | null
}

/** Jedna strona = tabliczka (góra) + etykieta (dół) dla jednej konstrukcji; A6 poziomo. */
export function buildMarkingDefinition(items: MarkingItem[], printedAt: Date): TDocumentDefinitions {
  const content: Content[] = []
  items.forEach((it, idx) => {
    const c = it.card
    const zew = c.product_type === 'drzwi_zewn'
    const fire = fireClassLabel(c.range_code ?? '')
    const smoke = smokeLabel(c.range_code ?? '')
    const evac = c.evacuation !== 'nie' ? (zew ? 'EN 179 / EN 1125' : 'PN-EN 179 / PN-EN 1125') : '—'
    const plate: Array<[string, string]> = [
      ['Producent', PRODUCER_FULL],
      ['Wyrób', `${zew ? 'Zewnętrzne' : 'Wewnętrzne'} drzwi przeciwpożarowe systemu ALURON AS 75EI`],
      ['Odporność ogniowa', fire],
      ['Dymoszczelność', smoke],
      ['Samozamykalność', 'C'],
      ['Numer serii / partii', it.constructionNo],
      ['Certyfikat', `Nr ${it.certificateNo || '……………'} wg ${zew ? 'EN 16034 (CERTBUD Sp. z o.o., NB 2310)' : 'PN-EN 16034 (CERTBUD Sp. z o.o., AC 158)'}`],
      ['Drogi ewakuacyjne', evac],
      ['Rok produkcji', String(it.year)],
    ]
    const label: Array<[string, string]> = zew
      ? [
          ['Oznakowanie', `CE  2310  ·  ${String(it.year).slice(-2)}`],
          ['Producent', PRODUCER_FULL],
          ['Niepowtarzalny kod identyfikacyjny typu wyrobu', c.type_code],
          ['Nr DWU', it.declarationNo || '……………'],
          ['Normy zharmonizowane', 'EN 16034:2014; EN 14351-1:2006+A2:2016'],
          ['Zamierzone zastosowanie', `drzwi zewnętrzne przeciwpożarowe i/lub dymoszczelne${c.evacuation !== 'nie' ? ' na drogach ewakuacyjnych' : ''}`],
          ['Deklarowane właściwości', `odporność ogniowa ${fire}; dymoszczelność ${smoke}; samozamykalność C; zdolność do zwolnienia ${c.evacuation !== 'nie' ? 'zapewniona' : 'NPD'}; wysokość ${it.height_mm ?? '…'} mm`],
          ['Nr konstrukcji', it.constructionNo],
        ]
      : [
          ['Znak', `B  ·  ${String(it.year).slice(-2)}`],
          ['Producent', PRODUCER_FULL],
          ['Kod identyfikacyjny typu wyrobu', c.type_code],
          ['Nr KDWU', it.declarationNo || '……………'],
          ['Krajowe specyfikacje techniczne', 'PN-EN 16034:2014-11; PN-EN 14351-2:2018-12'],
          ['Jednostka certyfikująca / certyfikat', `CERTBUD Sp. z o.o., AC 158; krajowy certyfikat nr ${it.certificateNo || '……………'}`],
          ['Zamierzone zastosowanie', `drzwi wewnętrzne przeciwpożarowe i/lub dymoszczelne${c.evacuation !== 'nie' ? ' na drogach ewakuacyjnych' : ''}`],
          ['Deklarowane właściwości', `odporność ogniowa ${fire}; dymoszczelność ${smoke}; samozamykalność C; zdolność do zwolnienia ${c.evacuation !== 'nie' ? 'zapewniona' : 'NPD'}; wysokość ${it.height_mm ?? '…'} mm`],
          ['Nr konstrukcji', it.constructionNo],
        ]
    content.push(
      { text: `Tabliczka znamionowa (zał. 6.26) — ${it.constructionNo}`, style: 'h2', margin: [0, 0, 0, 4], pageBreak: idx > 0 ? 'before' : undefined },
      { table: { widths: [95, '*'], body: plate.map(([a, b]) => [{ text: a, bold: true }, b]) }, layout: ZKP_GRID },
      { text: `Etykieta ${zew ? 'CE' : 'B'} (zał. 6.8) — ${it.constructionNo}`, style: 'h2', margin: [0, 14, 0, 4] },
      { table: { widths: [95, '*'], body: label.map(([a, b]) => [{ text: a, bold: true }, b]) }, layout: ZKP_GRID },
    )
  })
  const def = base('Załączniki 6.26 / 6.8 – Tabliczka znamionowa i etykieta AS 75EI', false, content, printedAt)
  // A5: nagłówek łamie się na 2 linie — większy margines górny, żeby nie najeżdżał na tytuł
  return { ...def, pageSize: 'A5', pageMargins: [20, 56, 20, 30] }
}

export { ZKP_PRODUCER }
