import type { Content, CustomTableLayout, TDocumentDefinitions } from 'pdfmake/interfaces'
import {
  ZKP_CARD_STATUS_LABELS,
  ZKP_EVACUATION_LABELS,
  ZKP_FILLING_FIELDS,
  ZKP_GAP_SIDES,
  ZKP_HARDWARE_SLOTS,
  ZKP_LIGHT_LABELS,
  ZKP_OPENING_LABELS,
  ZKP_OPERATIONS,
  ZKP_POSITION_LABELS,
  ZKP_PRODUCT_TYPE_LABELS,
  ZKP_STAGES,
  cardStatus,
  latestBy,
  type ZkpCardCheck,
  type ZkpCompetency,
  type ZkpPerson,
  type ZkpFillingRecord,
  type ZkpHardwareRecord,
  type ZkpProductCard,
  type ZkpRange,
  type ZkpRegisterRow,
  type ZkpStageRecord,
} from './zkpCard'
import { ZKP_CRITICAL_KIND_LABELS, ZKP_LOT_DECISION_LABELS, type ZkpComponent, type ZkpMaterialLot, type ZkpSupplier } from './zkp'

// Treść wydruków ZKP AS 75EI w układzie załączników: karta wyrobu 6.25,
// rejestr wyrobów 6.33 (układ własny wg księgi — „konstrukcje, deklaracje, montaż”),
// rejestr przyjęć komponentów krytycznych 6.24 (układ własny wg pkt 8 briefu).

const PRODUCER = 'MR Profil Iwona Maroszek · zakład: ul. Marklowicka 17, 44-300 Wodzisław Śląski'

function fmt(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })
}
// Roboto z pdfmake nie ma znaków ☐/☒ — pola wyboru jako [X] / [ ]
const box = (on: boolean) => (on ? '[X]' : '[ ]')
// jak 'lightHorizontalLines', ale z mniejszymi odstępami — szerokie rejestry mieszczą się na A4 poziomo
const GRID: CustomTableLayout = {
  hLineWidth: (i, node) => (i === 0 || i === node.table.body.length ? 0 : i === (node.table.headerRows ?? 0) ? 1.2 : 0.5),
  vLineWidth: () => 0,
  hLineColor: (i, node) => (i === (node.table.headerRows ?? 0) ? '#334155' : '#cbd5e1'),
  paddingLeft: (i) => (i === 0 ? 0 : 4),
  paddingRight: (i, node) => (i === (node.table.widths?.length ?? 1) - 1 ? 0 : 4),
}
const GAP_SHORT = { zaw: 'zaw.', zamk: 'zamk.', nad: 'nadproż.' } as const
const th = (t: string) => ({ text: t, style: 'th' })
const h2 = (t: string): Content => ({ text: t, style: 'h2' })

function base(title: string, landscape: boolean, content: Content[], printedAt: Date): TDocumentDefinitions {
  return {
    pageSize: 'A4',
    pageOrientation: landscape ? 'landscape' : 'portrait',
    pageMargins: [28, 46, 28, 36],
    info: { title },
    header: {
      columns: [
        { text: title, bold: true, fontSize: 9 },
        { text: PRODUCER, alignment: 'right', fontSize: 7, color: '#475569' },
      ],
      margin: [28, 18, 28, 0],
    },
    footer: (page: number, pages: number) => ({
      columns: [
        { text: `Wydruk z KR Center Manager · ${fmt(printedAt.toISOString())}`, fontSize: 7, color: '#64748b' },
        { text: `${page} / ${pages}`, alignment: 'right', fontSize: 7, color: '#64748b' },
      ],
      margin: [28, 10, 28, 0],
    }),
    content,
    styles: {
      h1: { fontSize: 14, bold: true, margin: [0, 0, 0, 6] },
      h2: { fontSize: 10, bold: true, margin: [0, 10, 0, 4] },
      th: { bold: true, fontSize: 7.5, color: '#334155', fillColor: '#f1f5f9' },
      small: { fontSize: 7, color: '#475569' },
      nok: { color: '#b91c1c', bold: true },
    },
    defaultStyle: { font: 'Roboto', fontSize: 8 },
  }
}

// ── Karta wyrobu 6.25 ────────────────────────────────────────────────────
export type ProductCardInput = {
  target: { constructionNo: string; orderNumber: string; company: string }
  data: {
    card: ZkpProductCard | null
    checks: ZkpCardCheck[]
    stages: ZkpStageRecord[]
    hardware: ZkpHardwareRecord[]
    fillings: ZkpFillingRecord[]
  }
  range: ZkpRange | null
  lots: ZkpMaterialLot[]
  components: ZkpComponent[]
  printedAt: Date
}

export function buildProductCardDefinition(inp: ProductCardInput): TDocumentDefinitions {
  const c = inp.data.card
  const lotById = new Map(inp.lots.map((l) => [l.id, l]))
  const lotNo = (id: number | null) => (id == null ? '' : lotById.get(id)?.lot_no ?? `#${id}`)
  const stage = latestBy(inp.data.stages, (s) => s.stage_key)
  const hw = latestBy(inp.data.hardware, (h) => h.slot)
  const fl = latestBy(inp.data.fillings, (f) => f.field)
  const title = 'Załącznik 6.25 – Karta wyrobu ALURON AS 75EI'
  if (!c) return base(title, false, [{ text: 'Brak karty.' }], inp.printedAt)

  const pick = <T extends string>(labels: Record<T, string>, value: T | null) =>
    (Object.keys(labels) as T[]).map((k) => `${box(k === value)} ${labels[k]}`).join('   ')

  const identRows: Array<[string, string]> = [
    ['Numer konstrukcji (RRRR/ZZ/PP) / kod typu wyrobu (zał. 6.8)', `${inp.target.constructionNo} / ${c.type_code || '—'}`],
    ['Numer zlecenia produkcyjnego / zamówienia klienta', inp.target.orderNumber],
    ['Klient / obiekt', inp.target.company || '—'],
    ['Typ; skrzydła; kierunek; strona',
      `${pick(ZKP_PRODUCT_TYPE_LABELS, c.product_type)};  skrzydła: ${box(c.leaves === 1)} 1 ${box(c.leaves === 2)} 2;  ${pick(ZKP_OPENING_LABELS, c.opening)};  ${box(c.hand === 'L')} L ${box(c.hand === 'P')} P`],
    ['Zakres raportu', ['EI30', 'EI30S', 'EI60', 'EI60S', 'S'].map((r) => `${box(c.range_code === r)} ${r}`).join('  ') + (inp.range ? `  (${inp.range.report})` : '')],
    ['Ewakuacja', pick(ZKP_EVACUATION_LABELS, c.evacuation)],
    ['Nadświetle / doświetle', pick(ZKP_LIGHT_LABELS, c.light)],
  ]

  const content: Content[] = [
    { text: `Karta wyrobu ${inp.target.constructionNo}`, style: 'h1' },
    h2('A. Identyfikacja konstrukcji'),
    { table: { widths: [180, '*'], body: [[th('Pole'), th('Wpis')], ...identRows] }, layout: GRID },
    h2('B. Sprawdzenie zakresu przed uruchomieniem – limity z tabeli K'),
    {
      table: {
        headerRows: 1,
        widths: ['*', 130, 150, 34],
        body: [
          [th('Parametr'), th('Wartość w zleceniu'), th('Limit dla zakresu'), th('Zgodne')],
          ...inp.data.checks.map((k) => [k.r_label, k.r_value ?? '—', k.r_limit, { text: k.r_ok ? 'tak' : 'NIE', style: k.r_ok ? undefined : 'nok', alignment: 'center' as const }]),
        ],
      },
      layout: GRID,
    },
    {
      text: `Zakres potwierdził: ${c.range_confirmed_by_name || '………………'}   data: ${c.range_confirmed_at ? fmt(c.range_confirmed_at) : '…………'}`,
      margin: [0, 4, 0, 0],
    },
    h2('C. Etapy produkcji i kontrola międzyoperacyjna'),
    {
      table: {
        headerRows: 1,
        widths: ['*', 90, 60, 36, 62, 50],
        body: [
          [th('Etap'), th('Komponent: nr katalogowy'), th('Nr partii'), th('Wynik'), th('Data'), th('Operator')],
          ...ZKP_STAGES.map((s) => {
            const r = stage.get(s.key)
            const gaps = s.key === 'regulacja' && r?.gaps
              ? `\nszczeliny A/B/C [mm]: ${ZKP_GAP_SIDES.map((sd) => `${GAP_SHORT[sd.key]} ${(['A', 'B', 'C'] as const).map((g) => r.gaps?.[g][sd.key] ?? '…').join('/')}`).join(', ')}`
              : ''
            return [
              `${s.no}. ${s.label}${s.critical ? ' K' : ''}${gaps}`,
              r?.catalog_no || (s.lotKind ? '' : '–'),
              s.lotKind ? lotNo(r?.lot_id ?? null) : '–',
              { text: r ? (r.result === 'nd' ? 'n/d' : r.result) : '', style: r?.result === 'NOK' ? 'nok' : undefined },
              r ? fmt(r.recorded_at) : '',
              r?.operator ?? '',
            ]
          }),
        ],
      },
      layout: GRID,
    },
    h2('D. Okucia'),
    {
      table: {
        headerRows: 1,
        widths: ['*', 110, 70, 30, 80, 50],
        body: [
          [th('Okucie'), th('Producent / model'), th('Nr DWU / dokumentu'), th('Liczba'), th('Punkt raportu / warunek'), th('Partia')],
          ...ZKP_HARDWARE_SLOTS.map((s) => {
            const r = hw.get(s.key)
            return [s.label, r?.producer_model ?? '', r?.dwu_no ?? '', r ? String(r.count) : '', r?.condition_ref ?? '', lotNo(r?.lot_id ?? null)]
          }),
        ],
      },
      layout: GRID,
    },
    h2('E. Wypełnienia'),
    {
      table: {
        headerRows: 1,
        widths: [70, 80, '*', 44, 70, 56],
        body: [
          [th('Pole'), th('Tabela / wiersz raportu'), th('Producent / nazwa handlowa / budowa'), th('Grubość [mm]'), th('Wymiary [mm]'), th('Nr partii')],
          ...ZKP_FILLING_FIELDS.map((f) => {
            const r = fl.get(f.key)
            return [f.label, r?.table_row ?? '', r?.product ?? '', r?.thickness_mm != null ? String(r.thickness_mm) : '', r?.dims ?? '', lotNo(r?.lot_id ?? null)]
          }),
        ],
      },
      layout: GRID,
    },
    h2('F. Zwolnienie'),
    {
      table: {
        widths: [180, '*'],
        body: [
          ['Protokół badań 6.17.5 nr', c.test_protocol_no || ''],
          ['Decyzja', `${box(c.decision === 'zwolniony')} ZWOLNIONY   ${box(c.decision === 'niezgodny')} NIEZGODNY${c.nonconformity_ref ? ` (rejestr 6.20 nr ${c.nonconformity_ref})` : ''}`],
          ['Numer deklaracji (KDWU / DWU)', c.declaration_no || ''],
          ['Data wydania', c.released_on || ''],
          ['Pełnomocnik ZKP / Zastępca: data, podpis', c.decided_at ? `${c.decided_by_name} · ${fmt(c.decided_at)} (zapis elektroniczny)` : ''],
        ],
      },
      layout: GRID,
    },
  ]
  return base(title, false, content, inp.printedAt)
}

// ── Rejestr wyrobów 6.33 ─────────────────────────────────────────────────
export function buildRegister633Definition(rows: ZkpRegisterRow[], subtitle: string, printedAt: Date): TDocumentDefinitions {
  const body = rows.map((r, i) => {
    const st = cardStatus({ card_id: r.r_card_id, range_confirmed: r.r_range_confirmed, decision: r.r_decision })
    const cancelled = r.r_status === 'anulowana'
    return [
      String(i + 1),
      { text: r.r_construction_no, bold: true, decoration: cancelled ? ('lineThrough' as const) : undefined },
      `${r.r_order_number}\n${r.r_year}/${r.r_zz < 10 ? `0${r.r_zz}` : r.r_zz} · poz. ${r.r_pos_no}`,
      r.r_company ?? '',
      r.r_type_code || '',
      r.r_range_code ?? '',
      r.r_active_w && r.r_active_h ? `${r.r_active_w}×${r.r_active_h}${r.r_leaves === 2 ? ' (+bierne)' : ''}` : '',
      cancelled ? 'anulowana' : ZKP_CARD_STATUS_LABELS[st],
      r.r_test_protocol_no ?? '',
      r.r_declaration_no ?? '',
      r.r_released_on ?? (r.r_release_date ?? ''),
      r.r_mont_doc ? 'tak' : '',
      r.r_decided_by_name ? `${r.r_decided_by_name}\n${fmt(r.r_decided_at)}` : '',
    ]
  })
  const content: Content[] = [
    { text: 'Rejestr wyrobów AS 75EI (konstrukcje, deklaracje, montaż)', style: 'h1' },
    { text: subtitle, style: 'small', margin: [0, 0, 0, 6] },
    {
      table: {
        headerRows: 1,
        widths: [16, 52, 62, '*', 90, 30, 54, 56, 60, 60, 44, 30, 64],
        body: [
          [th('Lp.'), th('Nr konstrukcji'), th('Zlecenie / nr w roku'), th('Klient / obiekt'), th('Kod typu wyrobu (6.8)'), th('Zakres'),
            th('Skrzydło [mm]'), th('Karta 6.25'), th('Protokół 6.17.5'), th('Deklaracja KDWU / DWU'), th('Data wydania'), th('Montaż 6.28'), th('Zwolnił')],
          ...body,
        ],
      },
      layout: GRID,
    },
    { text: 'Konstrukcje anulowane zostają w rejestrze (numer nie wraca do puli, ZKP 5.9).', style: 'small', margin: [0, 6, 0, 0] },
  ]
  return base('Załącznik 6.33 – Rejestr wyrobów AS 75EI', true, content, printedAt)
}

// ── Rejestr przyjęć 6.24 ─────────────────────────────────────────────────
export type Register624Input = {
  lots: ZkpMaterialLot[]
  components: ZkpComponent[]
  suppliers: ZkpSupplier[]
  /** YYYY-MM-DD włącznie */
  from: string
  to: string
}

export function register624Rows(inp: Register624Input): ZkpMaterialLot[] {
  return inp.lots
    .filter((l) => l.received_on >= inp.from && l.received_on <= inp.to)
    .sort((a, b) => a.received_on.localeCompare(b.received_on) || a.id - b.id)
}

export function buildRegister624Definition(inp: Register624Input, printedAt: Date): TDocumentDefinitions {
  const comp = new Map(inp.components.map((c) => [c.id, c]))
  const sup = new Map(inp.suppliers.map((s) => [s.id, s.name]))
  const yn = (b: boolean) => (b ? 'tak' : 'NIE')
  const body = register624Rows(inp).map((l, i) => {
    const c = comp.get(l.component_id)
    return [
      String(i + 1),
      l.received_on,
      sup.get(l.supplier_id) ?? `#${l.supplier_id}`,
      l.delivery_doc,
      `${c?.name ?? `#${l.component_id}`}${c?.zkp_critical_kind ? `\n${ZKP_CRITICAL_KIND_LABELS[c.zkp_critical_kind]}` : ''}`,
      l.catalog_no,
      String(l.quantity),
      { text: l.lot_no || 'BRAK', style: l.lot_no ? undefined : 'nok' },
      `${l.quality_doc_kind}${l.quality_doc_no ? `\n${l.quality_doc_no}` : ''}${l.quality_doc_path ? '\n(skan)' : ''}`,
      `zam.: ${yn(l.conforms_to_order)}\n6.10.5: ${yn(l.conforms_to_list_6105)}\nstan: ${yn(l.condition_ok)}${l.condition_notes ? `\n${l.condition_notes}` : ''}`,
      { text: `${ZKP_LOT_DECISION_LABELS[l.decision]}${l.decision_reason ? `\n${l.decision_reason}` : ''}`, style: l.decision === 'przyjeto' ? undefined : 'nok' },
      `${l.received_by_name}${l.decided_by_name && l.decided_by_name !== l.received_by_name ? `\ndecyzja: ${l.decided_by_name}` : ''}\n${fmt(l.decided_at ?? l.created_at)}`,
      l.pz_reference,
    ]
  })
  const content: Content[] = [
    { text: 'Rejestr przyjęć komponentów krytycznych AS 75EI', style: 'h1' },
    { text: `Okres: ${inp.from} – ${inp.to} · pozycji: ${body.length}`, style: 'small', margin: [0, 0, 0, 6] },
    {
      table: {
        headerRows: 1,
        widths: [16, 44, 70, 56, '*', 44, 26, 52, 72, 58, 58, 72, 56],
        body: [
          [th('Lp.'), th('Data'), th('Dostawca (6.31)'), th('WZ / faktura'), th('Komponent (6.10.5)'), th('Nr kat.'), th('Ilość'), th('Nr partii'),
            th('Dokument jakości'), th('Zgodność'), th('Decyzja'), th('Przyjął / zwolnił'), th('PZ')],
          ...body,
        ],
      },
      layout: GRID,
    },
    { text: 'Brak nr partii lub dokumentu jakości = kwarantanna; zwolnienie z kwarantanny tylko decyzją Pełnomocnika / Zastępcy.', style: 'small', margin: [0, 6, 0, 0] },
  ]
  return base('Załącznik 6.24 – Rejestr przyjęć komponentów krytycznych AS 75EI', true, content, printedAt)
}

// ── Matryca kompetencji 6.27 ─────────────────────────────────────────────
export function buildMatrix627Definition(people: ZkpPerson[], competencies: ZkpCompetency[], printedAt: Date): TDocumentDefinitions {
  const active = new Map<string, ZkpCompetency>()
  for (const c of competencies) if (!c.withdrawn_at) active.set(`${c.profile_id}|${c.operation}`, c)
  const body = people.map((p) => [
    `${p.initials} ${p.full_name}`.trim(),
    p.zkp_position ? ZKP_POSITION_LABELS[p.zkp_position] : '',
    ...ZKP_OPERATIONS.map((o) => {
      const c = active.get(`${p.id}|${o.key}`)
      return c ? { text: `[X]\n${c.granted_on.slice(0, 10).split('-').reverse().join('.')}`, alignment: 'center' as const } : { text: '[ ]', alignment: 'center' as const }
    }),
  ])
  const content: Content[] = [
    { text: 'Matryca kompetencji — produkcja drzwi ALURON AS 75EI', style: 'h1' },
    { text: `Stan na ${fmt(printedAt.toISOString())} · osób: ${people.length}`, style: 'small', margin: [0, 0, 0, 6] },
    {
      table: {
        headerRows: 1,
        widths: ['*', 110, ...ZKP_OPERATIONS.map(() => 50)],
        body: [[th('Osoba'), th('Stanowisko (zał. 6.1)'), ...ZKP_OPERATIONS.map((o) => th(o.short))], ...body],
      },
      layout: GRID,
    },
    { text: ZKP_OPERATIONS.map((o) => o.label).join(' · '), style: 'small', margin: [0, 6, 0, 0] },
    {
      text: '[X] = aktywne uprawnienie (data nadania). Uprawnienia nadaje i wycofuje Pełnomocnik ZKP / Zastępca; wycofane zostają w historii programu z powodem. ' +
        'Podpis każdej operacji w karcie wyrobu (6.25) jest sprawdzany w tej matrycy (ZKP 5.3.2).',
      style: 'small',
      margin: [0, 4, 0, 0],
    },
  ]
  return base('Załącznik 6.27 – Matryca kompetencji', true, content, printedAt)
}
