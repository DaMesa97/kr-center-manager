// Parser PDF-ów z AluronCAD: LISTA PRODUKCYJNA (LP) i OPTYMALIZACJA (LC).
// Wejście = tekst z położeniem (PdfTextPage[] z pdfText.ts / fixture), bez DOM —
// czyste funkcje, testowane na src/__tests__/fixtures/alu/*.json.
//
// Zasady ogólne:
//  - linia = elementy o tym samym y (±LINE_TOL pt), posortowane po x,
//  - etykieta: wartość = elementy na prawo w tej samej linii (do następnej etykiety),
//    a gdy brak — element pod etykietą (nagłówek „LISTA PRODUKCYJNA NR:” / „ZLECENIE:”),
//  - strona → pozycja: stopka `OF341/2026 (N)` (N = numer pozycji), zapasowo wiersz „Poz.: N”,
//  - tabele materiałów: grupa = kod (lewa kolumna, w linii z ilością/wymiarem) + wiersze
//    `N szt | L mm` + nazwa (lewa kolumna bez wiersza, pod kodem).
// Wszystko, czego nie da się odczytać jednoznacznie → warning (po polsku), nigdy wyjątek.

import type {
  AluConstructionType,
  AluGlassLine,
  AluLcParseResult,
  AluLpHeader,
  AluLpParseResult,
  AluLpPosition,
  AluParsedDocument,
  AluProductionNotes,
  PdfTextItem,
  PdfTextPage,
} from '../types'

// ---------------------------------------------------------------------------
// Pomocnicze: linie, liczby, tekst
// ---------------------------------------------------------------------------

const LINE_TOL = 2
/** stopka = dolne 5% strony */
const FOOTER_FRACTION = 0.95

type Line = { page: PdfTextPage; y: number; items: PdfTextItem[]; text: string }

function buildLines(page: PdfTextPage, items: PdfTextItem[] = page.items): Line[] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x)
  const lines: Line[] = []
  for (const it of sorted) {
    const last = lines[lines.length - 1]
    if (last && Math.abs(it.y - last.y) <= LINE_TOL) {
      last.items.push(it)
    } else {
      lines.push({ page, y: it.y, items: [it], text: '' })
    }
  }
  for (const ln of lines) {
    ln.items.sort((a, b) => a.x - b.x)
    ln.text = squeeze(ln.items.map((i) => i.str).join(' '))
  }
  return lines
}

function squeeze(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function parseNum(s: string | null | undefined): number | null {
  if (!s) return null
  const m = s.replace(/\s/g, '').match(/-?\d+(?:[.,]\d+)?/)
  if (!m) return null
  const v = Number(m[0].replace(',', '.'))
  return Number.isFinite(v) ? v : null
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

function isLabel(str: string): boolean {
  return /:\s*$/.test(str.trim())
}

function isFooterItem(page: PdfTextPage, it: PdfTextItem): boolean {
  return it.y > page.height * FOOTER_FRACTION
}

function itemsOverlapX(a: PdfTextItem, b: PdfTextItem, slack = 4): boolean {
  return a.x < b.x + b.w + slack && b.x < a.x + a.w + slack
}

// ---------------------------------------------------------------------------
// Etykieta → wartość
// ---------------------------------------------------------------------------

type LabelMatch = { item: PdfTextItem; inline: string }

function findLabel(page: PdfTextPage, re: RegExp): LabelMatch | null {
  const hits = page.items
    .filter((it) => re.test(it.str))
    .sort((a, b) => a.y - b.y || a.x - b.x)
  const item = hits[0]
  if (!item) return null
  const m = item.str.match(re)
  const inline = m ? squeeze(item.str.slice((m.index ?? 0) + m[0].length)) : ''
  return { item, inline }
}

/** Elementy na prawo od etykiety w tej samej linii, aż do następnej etykiety (lub dużej luki). */
function valueRight(page: PdfTextPage, label: PdfTextItem, used: Set<PdfTextItem>, maxGap = 120): PdfTextItem[] {
  const out: PdfTextItem[] = []
  const candidates = page.items
    .filter((it) => it !== label && Math.abs(it.y - label.y) <= LINE_TOL && it.x > label.x)
    .sort((a, b) => a.x - b.x)
  let edge = label.x + label.w
  for (const it of candidates) {
    if (isLabel(it.str)) break
    if (it.x - edge > maxGap) break
    out.push(it)
    used.add(it)
    edge = it.x + it.w
  }
  return out
}

/** Kolejne linie tej samej kolumny (x ±3) pod ostatnim elementem wartości — wielolinijkowe wartości. */
function continuationLines(
  page: PdfTextPage,
  first: PdfTextItem,
  used: Set<PdfTextItem>,
  stopY: number,
  maxPitch = 14,
): string[] {
  const out: string[] = []
  let prev = first
  for (;;) {
    const next = page.items
      .filter(
        (it) =>
          !used.has(it) &&
          it.y > prev.y + LINE_TOL &&
          it.y - prev.y <= maxPitch &&
          it.y < stopY &&
          Math.abs(it.x - first.x) <= 3,
      )
      .sort((a, b) => a.y - b.y)[0]
    if (!next) break
    // linia musi być „sama” — bez etykiety w tej samej linii na lewo od niej
    const labelOnLine = page.items.find(
      (it) => it !== next && Math.abs(it.y - next.y) <= LINE_TOL && it.x < next.x && isLabel(it.str),
    )
    if (labelOnLine) break
    used.add(next)
    out.push(next.str)
    prev = next
  }
  return out
}

/** Element bezpośrednio pod etykietą (nagłówek LP: numer stoi większą czcionką pod etykietą). */
function valueBelow(page: PdfTextPage, label: PdfTextItem, used: Set<PdfTextItem>): PdfTextItem | null {
  const hit = page.items
    .filter((it) => !used.has(it) && it.y > label.y + LINE_TOL && it.y - label.y <= 30 && itemsOverlapX(it, label))
    .sort((a, b) => a.y - b.y)[0]
  if (hit) used.add(hit)
  return hit ?? null
}

function labelValue(page: PdfTextPage, re: RegExp, used: Set<PdfTextItem>, opts: { below?: boolean } = {}): string | null {
  const lab = findLabel(page, re)
  if (!lab) return null
  used.add(lab.item)
  if (lab.inline) return lab.inline
  const right = valueRight(page, lab.item, used)
  if (right.length) return squeeze(right.map((i) => i.str).join(' '))
  if (opts.below) {
    const below = valueBelow(page, lab.item, used)
    if (below) return squeeze(below.str)
  }
  return ''
}

// ---------------------------------------------------------------------------
// Daty, kolory, typ konstrukcji, uwagi produkcyjne
// ---------------------------------------------------------------------------

/** „23.10.2026 16:59:12” → „2026-10-23T16:59:12” (lokalnie, bez strefy). */
export function parseAluDateTime(s: string | null | undefined): string | null {
  if (!s) return null
  const m = s.match(/(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/)
  if (!m) return null
  const [, dd, mm, yyyy, hh, mi, ss] = m
  const date = `${yyyy}-${mm}-${dd}`
  if (!hh) return date
  return `${date}T${hh.padStart(2, '0')}:${mi}:${ss ?? '00'}`
}

const COLOR_WORDS: Record<string, string> = {
  brazowy: 'brązowy',
  bialy: 'biały',
  zolty: 'żółty',
  zloty: 'złoty',
  rozowy: 'różowy',
  blekitny: 'błękitny',
  zielony: 'zielony',
}

/**
 * „9R/AR-RAL8019-MAT [Aluron Color Collectoin 2 okucia];92 [brazowy]”
 *   → „9R/AR-RAL8019-MAT; 92 brązowy”
 * Nawiasy kwadratowe z nazwą kolekcji (duplikat informacji) wylatują, inne są rozpakowywane.
 */
export function cleanAluColor(raw: string): string {
  return raw
    .split(';')
    .map((part) =>
      squeeze(
        part.replace(/\[([^\]]*)\]/g, (_m, inner: string) =>
          /aluron|collect|okuci|kolekcj/i.test(inner) ? ' ' : ` ${inner} `,
        ),
      )
        .split(' ')
        .map((w) => COLOR_WORDS[w.toLowerCase()] ?? w)
        .join(' '),
    )
    .filter(Boolean)
    .join('; ')
}

export function detectConstructionType(description: string): AluConstructionType {
  const d = description.toLowerCase()
  if (/drzwi/.test(d)) return 'drzwi'
  if (/\bokn[oa]\b|\bokien/.test(d)) return 'okno'
  if (/ścian|scian|witryn|fasad|przegrod|przegród/.test(d)) return 'scianka'
  return 'inne'
}

const NOTE_LABEL_RE: Record<keyof AluProductionNotes, RegExp> = {
  okucia: /^okucia\b\s*:?\s*/i,
  klamka: /^klamka\b\s*:?\s*/i,
  dodatki: /^dodatki\b\s*:?\s*/i,
  prog: /^pr[óo]g\b\s*:?\s*/i,
  inne: /^(?:inne|uwagi)\b\s*:?\s*/i,
}

const EMPTY_TOKENS = new Set(['', 'nie', 'brak', '-', '0', 'nd', 'n/d'])

function humanizeNote(key: keyof AluProductionNotes, raw: string | undefined): string | undefined {
  if (!raw) return undefined
  let s = squeeze(raw).replace(NOTE_LABEL_RE[key], '')
  // AluronCAD potrafi powtórzyć etykietę („Próg: Próg aluminiowy”) — druga kopia też wylatuje
  s = s.replace(NOTE_LABEL_RE[key], '')
  const tokens = s
    .split(/[+;]/)
    .map((t) => squeeze(t))
    .filter((t) => !EMPTY_TOKENS.has(t.toLowerCase()))
  if (!tokens.length) return undefined
  if (key === 'klamka' && !/zam[ek]/i.test(tokens[0])) tokens[0] = `zamek ${tokens[0]}`
  return capitalize(tokens.join(', '))
}

/** Uwagi produkcyjne z AluronCAD → czytelna forma dla hali (kody modeli zostają). */
export function humanizeProductionNotes(raw: {
  okucia?: string
  klamka?: string
  dodatki?: string
  prog?: string
  inne?: string
}): AluProductionNotes {
  const out: AluProductionNotes = {}
  const okucia = humanizeNote('okucia', raw.okucia)
  const klamka = humanizeNote('klamka', raw.klamka)
  const dodatki = humanizeNote('dodatki', raw.dodatki)
  const prog = humanizeNote('prog', raw.prog)
  const inne = humanizeNote('inne', raw.inne)
  if (okucia) out.okucia = okucia
  if (klamka) out.klamka = klamka
  if (dodatki) out.dodatki = dodatki
  if (prog) out.prog = prog
  if (inne) out.inne = inne
  return out
}

// ---------------------------------------------------------------------------
// Rozpoznanie dokumentu
// ---------------------------------------------------------------------------

const LP_TITLE_RE = /LISTA\s+PRODUKCYJNA\s+NR\s*:?/i
const LC_TITLE_RE = /OPTYMALIZACJA\s+NR\s*:?/i

export function parseAluDocument(pages: PdfTextPage[]): AluParsedDocument | null {
  const first = pages[0]
  if (!first) return null
  const text = first.items.map((i) => i.str).join(' ')
  if (LP_TITLE_RE.test(text)) return parseAluLp(pages)
  if (LC_TITLE_RE.test(text)) return parseAluLc(pages)
  return null
}

// ---------------------------------------------------------------------------
// LC — lista cięcia (OPTYMALIZACJA)
// ---------------------------------------------------------------------------

export function parseAluLc(pages: PdfTextPage[]): AluLcParseResult {
  const page = pages[0]
  if (!page) return { kind: 'LC', lc_number: '', order_number: '', client: '' }
  const used = new Set<PdfTextItem>()
  const lc_number = labelValue(page, LC_TITLE_RE, used, { below: true }) ?? ''
  const order_number = labelValue(page, /^Zlecenie\s*:/i, used, { below: true }) ?? ''
  const client = labelValue(page, /^Klient\s*:/i, used) ?? ''
  return { kind: 'LC', lc_number, order_number, client }
}

// ---------------------------------------------------------------------------
// LP — nagłówek
// ---------------------------------------------------------------------------

function parseLpHeader(page: PdfTextPage, warnings: string[]): AluLpHeader {
  const used = new Set<PdfTextItem>()
  const lp_number = labelValue(page, LP_TITLE_RE, used, { below: true }) ?? ''
  if (!lp_number) warnings.push('Nie odczytano numeru listy produkcyjnej (LP)')

  const order_number = labelValue(page, /^ZLECENIE\s*:/i, used, { below: true }) ?? ''
  if (!order_number) warnings.push('Nie odczytano numeru zlecenia (OF)')

  const createdRaw = labelValue(page, /^Utworzono\s*:/i, used)
  const created_at = parseAluDateTime(createdRaw)
  if (!created_at) warnings.push('Nie odczytano daty utworzenia LP')

  const positions_count = parseNum(labelValue(page, /^Ilość pozycji\s*:/i, used))
  if (positions_count === null) warnings.push('Nie odczytano ilości pozycji z nagłówka')
  const area_m2 = parseNum(labelValue(page, /^Powierzchnia \[m2\]\s*:/i, used))
  const weight_kg = parseNum(labelValue(page, /^Masa \[kg\]\s*:/i, used))

  // Termin realizacji PRZED Klientem: jego kontynuacja stoi w tej samej kolumnie,
  // w której byłby klient — zużyte elementy nie mogą trafić do klienta.
  let deadline_text = ''
  const deadlineLab = findLabel(page, /^Termin realizacji\s*:/i)
  if (deadlineLab) {
    used.add(deadlineLab.item)
    const parts: string[] = []
    if (deadlineLab.inline) parts.push(deadlineLab.inline)
    const right = valueRight(page, deadlineLab.item, used)
    parts.push(...right.map((i) => i.str))
    const anchor = right[0]
    if (anchor) parts.push(...continuationLines(page, anchor, used, page.height * FOOTER_FRACTION))
    deadline_text = squeeze(parts.join(' '))
  }

  let client = ''
  const clientLab = findLabel(page, /^Klient\s*:/i)
  if (clientLab) {
    used.add(clientLab.item)
    const parts: string[] = []
    if (clientLab.inline) parts.push(clientLab.inline)
    const right = valueRight(page, clientLab.item, used)
    parts.push(...right.map((i) => i.str))
    const anchor = right[0]
    if (anchor) parts.push(...continuationLines(page, anchor, used, page.height * FOOTER_FRACTION))
    client = squeeze(parts.join(' '))
  } else {
    warnings.push('Brak pola „Klient” w nagłówku')
  }

  return { lp_number, order_number, created_at, client, positions_count, area_m2, weight_kg, deadline_text }
}

// ---------------------------------------------------------------------------
// LP — strony → pozycje
// ---------------------------------------------------------------------------

const POZ_RE = /^Poz\.?\s*:?\s*(\d+)\s*(.*)$/i

/** Numer pozycji ze stopki `OF341/2026 (N)`; null gdy brak. */
function footerPositionNo(page: PdfTextPage, orderNumber: string): number | null {
  const footer = page.items.filter((it) => isFooterItem(page, it))
  const candidates = footer
    .map((it) => ({ it, m: it.str.match(/^(.+?)\s+\((\d+)\)$/) }))
    .filter((c): c is { it: PdfTextItem; m: RegExpMatchArray } => !!c.m && !/^\d+$/.test(c.m[1].trim()))
  const byOrder = orderNumber ? candidates.find((c) => c.m[1].trim() === orderNumber) : undefined
  const pick = byOrder ?? candidates.sort((a, b) => a.it.x - b.it.x)[0]
  return pick ? Number(pick.m[2]) : null
}

function pozLine(lines: Line[]): { posNo: number; description: string; line: Line } | null {
  for (const ln of lines) {
    const first = ln.items[0]
    const m = first.str.match(POZ_RE)
    if (m) {
      const rest = ln.items.slice(1).filter((i) => i.x + i.w < ln.page.width * 0.58)
      const description = squeeze([m[2], ...rest.map((i) => i.str)].join(' '))
      return { posNo: Number(m[1]), description, line: ln }
    }
  }
  return null
}

type PageGroup = { posNo: number; pages: PdfTextPage[] }

function groupPagesByPosition(pages: PdfTextPage[], orderNumber: string, warnings: string[]): PageGroup[] {
  const groups: PageGroup[] = []
  let current: PageGroup | null = null
  for (const page of pages) {
    const bodyLines = buildLines(page, page.items.filter((it) => !isFooterItem(page, it)))
    const poz = pozLine(bodyLines)
    const fromFooter = footerPositionNo(page, orderNumber)
    const posNo = fromFooter ?? poz?.posNo ?? null
    if (poz && fromFooter !== null && poz.posNo !== fromFooter) {
      warnings.push(`Strona ${page.pageNumber}: stopka wskazuje pozycję ${fromFooter}, a wiersz „Poz.” pozycję ${poz.posNo}`)
    }
    if (posNo === null) {
      if (current) current.pages.push(page)
      else warnings.push(`Strona ${page.pageNumber}: nie da się przypisać do pozycji (brak stopki i wiersza „Poz.”)`)
      continue
    }
    let target: PageGroup | undefined = current && current.posNo === posNo ? current : groups.find((g) => g.posNo === posNo)
    if (!target) {
      target = { posNo, pages: [] }
      groups.push(target)
    }
    target.pages.push(page)
    current = target
  }
  return groups
}

// ---------------------------------------------------------------------------
// LP — blok pozycji (strona z rysunkiem)
// ---------------------------------------------------------------------------

const BLOCK_LABEL_RE = /^(System|Kolor profili|Kolor okuć|Kolor okuc|Wypełnienia|Wypelnienia)\s*:\s*(.*)$/i

type PositionBlock = {
  description: string
  system: string
  profile_color: string
  hardware_color: string
  fillings: string
  quantity: number | null
  weight_kg: number | null
  u_value: number | null
  pozY: number
}

function parsePositionBlock(page: PdfTextPage, warnings: string[]): PositionBlock | null {
  const body = page.items.filter((it) => !isFooterItem(page, it))
  const poz = pozLine(buildLines(page, body))
  if (!poz) return null
  const split = page.width * 0.58

  // --- lewa kolumna: System / Kolor profili / Kolor okuć / Wypełnienia (wielolinijkowe, wyśrodkowane)
  const leftLines = buildLines(
    page,
    body.filter((it) => it.y > poz.line.y + LINE_TOL && it.x + it.w < split),
  )
  const fields = new Map<string, string[]>()
  let currentKey: string | null = null
  let prev: Line | null = null
  for (const ln of leftLines) {
    const m = ln.text.match(BLOCK_LABEL_RE)
    if (m) {
      const key = m[1].toLowerCase().replace('okuc', 'okuć').replace('wypelnienia', 'wypełnienia')
      if (fields.has(key)) break // drugi, skrócony blok „System / Kolor profili” — bierzemy pierwszy
      fields.set(key, [m[2]])
      currentKey = key
      prev = ln
      continue
    }
    if (!currentKey || !prev) break
    const gap = ln.y - prev.y
    const center = (l: Line) => {
      const a = l.items[0]
      const b = l.items[l.items.length - 1]
      return (a.x + b.x + b.w) / 2
    }
    const sameColumn = Math.abs(ln.items[0].x - prev.items[0].x) <= 3
    const sameCenter = Math.abs(center(ln) - center(prev)) <= 10
    if (gap > 14 || !(sameColumn || sameCenter)) break
    fields.get(currentKey)?.push(ln.text)
    prev = ln
  }
  const field = (k: string) => squeeze((fields.get(k) ?? []).join(' '))
  const system = field('system')
  const profile_color = cleanAluColor(field('kolor profili'))
  const hardware_color = cleanAluColor(field('kolor okuć'))
  const fillings = squeeze(field('wypełnienia').replace(/\s*;\s*/g, '; '))
  if (!system) warnings.push('Nie odczytano systemu profili')
  if (!profile_color) warnings.push('Nie odczytano koloru profili')

  // --- prawa kolumna: Ilość / Ciężar razem / Współczynnik U
  const rightLines = buildLines(
    page,
    body.filter((it) => it.x >= split && it.y >= poz.line.y - 30 && it.y <= poz.line.y + 130),
  )
  let quantity: number | null = null
  let weight_kg: number | null = null
  let u_value: number | null = null
  for (const ln of rightLines) {
    let m = ln.text.match(/^Ilość\s*:\s*(.+)$/i)
    if (m) {
      quantity = parseNum(m[1])
      continue
    }
    m = ln.text.match(/^Ciężar razem\s*:\s*(.+)$/i)
    if (m) {
      weight_kg = parseNum(m[1])
      continue
    }
    m = ln.text.match(/^Współczynnik U\s*:\s*(.+)$/i)
    if (m) u_value = parseNum(m[1])
  }
  if (quantity === null) warnings.push('Nie odczytano ilości sztuk pozycji — przyjęto 1')

  return {
    description: poz.description,
    system,
    profile_color,
    hardware_color,
    fillings,
    quantity,
    weight_kg,
    u_value,
    pozY: poz.line.y,
  }
}

// ---------------------------------------------------------------------------
// LP — sekcje materiałów i uwagi produkcyjne (strumień linii po stronach pozycji)
// ---------------------------------------------------------------------------

type MaterialRow = { qty: number | null; length_mm: number | null; cutA: number | null; cutB: number | null; width_mm: number | null; height_mm: number | null }
type MaterialGroup = { code: string; name: string; rows: MaterialRow[] }
type Section = { name: string; groups: MaterialGroup[] }

const KNOWN_SECTIONS = new Set([
  'profile',
  'profile dodatkowe',
  'uszczelki',
  'akcesoria',
  'okucia',
  'szklenie i blachy',
  'uwagi produkcyjne',
  'wstawione grupy materiałów',
])

function sectionHeaderName(ln: Line): string | null {
  if (ln.items.length !== 1) return null
  const it = ln.items[0]
  const name = ln.text.replace(/:\s*$/, '').trim()
  if (KNOWN_SECTIONS.has(name.toLowerCase())) return name
  if (it.h >= 11 && it.x < ln.page.width * 0.12 && !/\d/.test(name) && name.length <= 40) return name
  return null
}

const QTY_RE = /^(\d+)\s*szt\.?$/i
const LEN_RE = /^(\d+(?:[.,]\d+)?)\s*mm\.?(?:\s*\(\s*(\d+)\s*'?\s*;\s*(\d+)\s*'?\s*\))?/i
const GLASS_DIM_RE = /(\d+(?:[.,]\d+)?)\s*mm\s*x\s*(\d+(?:[.,]\d+)?)\s*mm/i

function parseMaterialRow(ln: Line): { row: MaterialRow | null; left: PdfTextItem | null } {
  const qtyItem = ln.items.find((i) => QTY_RE.test(i.str))
  const dimItem = ln.items.find((i) => LEN_RE.test(i.str) || GLASS_DIM_RE.test(i.str))
  const anchorX = qtyItem?.x ?? dimItem?.x ?? ln.page.width * 0.4
  const left = ln.items.find((i) => i.x < anchorX - 50 && i.x < ln.page.width * 0.3) ?? null
  if (!qtyItem && !dimItem) return { row: null, left }
  const row: MaterialRow = { qty: null, length_mm: null, cutA: null, cutB: null, width_mm: null, height_mm: null }
  if (qtyItem) row.qty = Number(qtyItem.str.match(QTY_RE)?.[1])
  if (dimItem) {
    const g = dimItem.str.match(GLASS_DIM_RE)
    const l = dimItem.str.match(LEN_RE)
    if (g) {
      row.width_mm = parseNum(g[1])
      row.height_mm = parseNum(g[2])
    } else if (l) {
      row.length_mm = parseNum(l[1])
      row.cutA = l[2] !== undefined ? Number(l[2]) : null
      row.cutB = l[3] !== undefined ? Number(l[3]) : null
    }
  }
  return { row, left }
}

type PositionScan = { sections: Section[]; notesRaw: Record<string, string>; notesOther: string[] }

function scanPositionPages(pages: PdfTextPage[], startAfterY: number | null): PositionScan {
  const sections: Section[] = []
  const notesRaw: Record<string, string> = {}
  const notesOther: string[] = []
  let section: Section | null = null
  let inNotes = false
  let group: MaterialGroup | null = null

  pages.forEach((page, idx) => {
    const body = page.items.filter((it) => !isFooterItem(page, it))
    const lines = buildLines(page, body)
    for (const ln of lines) {
      // na stronie z rysunkiem sekcje mogą zaczynać się dopiero pod blokiem pozycji
      if (idx === 0 && startAfterY !== null && ln.y <= startAfterY) continue
      const header = sectionHeaderName(ln)
      if (header) {
        const lower = header.toLowerCase()
        inNotes = lower === 'uwagi produkcyjne'
        if (inNotes) {
          section = null
        } else {
          section = { name: header, groups: [] }
          sections.push(section)
        }
        group = null
        continue
      }
      if (inNotes) {
        const m = ln.text.match(/^(Okucia|Klamka|Dodatki|Pr[óo]g)\s*:\s*(.*)$/i)
        if (m) {
          const key = m[1].toLowerCase().replace('próg', 'prog')
          notesRaw[key] = notesRaw[key] ? `${notesRaw[key]}; ${m[2]}` : m[2]
        } else if (!/^(U|Rw)\s*=/.test(ln.text)) {
          notesOther.push(ln.text)
        }
        continue
      }
      if (!section) continue
      if (/^Kod\s*:/.test(ln.text) && ln.items.length >= 2) continue // nagłówek kolumn tabeli
      const { row, left } = parseMaterialRow(ln)
      if (left && row) {
        group = { code: left.str, name: '', rows: [row] }
        section.groups.push(group)
      } else if (left) {
        if (group) group.name = squeeze(`${group.name} ${ln.items.filter((i) => i.x < page.width * 0.3).map((i) => i.str).join(' ')}`)
      } else if (row && group) {
        group.rows.push(row)
      }
    }
  })
  return { sections, notesRaw, notesOther }
}

// ---------------------------------------------------------------------------
// LP — wymiary konstrukcji z ościeżnicy, szkło
// ---------------------------------------------------------------------------

type Segment = { length: number; cutA: number | null; cutB: number | null }

function frameDimensions(
  scan: PositionScan,
  drawingPage: PdfTextPage | null,
  type: AluConstructionType,
  warnings: string[],
): { width_mm: number | null; height_mm: number | null } {
  const profile = scan.sections.find((s) => s.name.toLowerCase() === 'profile')
  if (!profile) {
    warnings.push('Brak sekcji „Profile” — wymiary konstrukcji nieznane')
    return { width_mm: null, height_mm: null }
  }
  const frame = profile.groups.find((g) => /^Ościeżnica|^Oscieznica/i.test(g.name) || /^Ościeżnica/i.test(g.code))
  if (!frame) {
    warnings.push('Brak ościeżnicy w sekcji „Profile” — wymiary konstrukcji nieznane')
    return { width_mm: null, height_mm: null }
  }
  const segments: Segment[] = []
  for (const r of frame.rows) {
    if (r.length_mm === null) continue
    for (let i = 0; i < Math.max(1, r.qty ?? 1); i++) segments.push({ length: r.length_mm, cutA: r.cutA, cutB: r.cutB })
  }
  if (!segments.length) {
    warnings.push('Ościeżnica bez odcinków — wymiary konstrukcji nieznane')
    return { width_mm: null, height_mm: null }
  }
  const lengths = [...new Set(segments.map((s) => s.length))].sort((a, b) => a - b)
  if (lengths.length === 1) {
    warnings.push('Ościeżnica ma jedną długość odcinków — wymiary do sprawdzenia')
    return { width_mm: lengths[0], height_mm: lengths[0] }
  }
  if (lengths.length > 2) warnings.push('Ościeżnica ma więcej niż dwie długości odcinków — wymiary do sprawdzenia')

  const count = (len: number) => segments.filter((s) => s.length === len).length
  const other = (len: number) => lengths.find((l) => l !== len) ?? null

  // Drzwi (3 odcinki): szerokość = odcinek cięty 45/45 (nadproże), reszta = wysokość.
  if (type === 'drzwi' || segments.length === 3) {
    const top = segments.find((s) => s.cutA === 45 && s.cutB === 45)
    if (top && count(top.length) === 1) return { width_mm: top.length, height_mm: other(top.length) }
    const single = lengths.find((l) => count(l) === 1)
    if (single !== undefined) return { width_mm: single, height_mm: other(single) }
  }

  // Okno (4 odcinki, 2 długości): szerokość = wymiar wypisany na rysunku wyżej (nad rysunkiem).
  if (drawingPage) {
    const yOf = (len: number) =>
      drawingPage.items
        .filter((it) => it.str.trim() === String(len))
        .map((it) => it.y)
        .sort((a, b) => a - b)[0]
    const [a, b] = lengths
    const ya = yOf(a)
    const yb = yOf(b)
    if (ya !== undefined && yb !== undefined && ya !== yb) {
      return ya < yb ? { width_mm: a, height_mm: b } : { width_mm: b, height_mm: a }
    }
  }
  warnings.push('Wymiary do sprawdzenia (nie rozstrzygnięto szerokość/wysokość z rysunku)')
  return { width_mm: lengths[0], height_mm: lengths[1] }
}

const NOT_GLASS_RE = /blacha|formatka|q-tape|płyta|plyta|panel/i

function glassLines(scan: PositionScan, warnings: string[]): AluGlassLine[] {
  const section = scan.sections.find((s) => s.name.toLowerCase() === 'szklenie i blachy')
  if (!section) {
    warnings.push('Brak sekcji „Szklenie i blachy”')
    return []
  }
  const out: AluGlassLine[] = []
  for (const g of section.groups) {
    if (NOT_GLASS_RE.test(`${g.code} ${g.name}`)) continue
    for (const r of g.rows) {
      if (r.width_mm === null || r.height_mm === null) {
        warnings.push(`Szkło „${g.code}”: brak wymiarów`)
        continue
      }
      let qty = r.qty
      if (qty === null) {
        qty = 1
        warnings.push(`Szkło „${g.code}” ${r.width_mm}×${r.height_mm}: ilość niepewna — przyjęto 1`)
      }
      const same = out.find((l) => l.spec === g.code && l.width_mm === r.width_mm && l.height_mm === r.height_mm)
      if (same) {
        same.qty += qty
        continue
      }
      out.push({ spec: squeeze(g.code), width_mm: r.width_mm, height_mm: r.height_mm, qty })
    }
  }
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      if (out[i].width_mm === out[j].width_mm && out[i].height_mm === out[j].height_mm) {
        warnings.push(`Dwie linie szkła o tych samych wymiarach ${out[i].width_mm}×${out[i].height_mm} („${out[i].spec}”, „${out[j].spec}”) — sprawdź`)
      }
    }
  }
  if (!out.length) warnings.push('Nie znaleziono szyb w sekcji „Szklenie i blachy”')
  return out
}

// ---------------------------------------------------------------------------
// LP — całość
// ---------------------------------------------------------------------------

function parsePosition(group: PageGroup): AluLpPosition {
  const warnings: string[] = []
  const drawingPage = group.pages.find((p) => pozLine(buildLines(p, p.items.filter((it) => !isFooterItem(p, it)))) !== null) ?? null
  const block = drawingPage ? parsePositionBlock(drawingPage, warnings) : null
  if (!block) warnings.push('Brak wiersza „Poz.” — nie odczytano opisu, systemu i kolorów')

  const description = block?.description ?? ''
  const construction_type = detectConstructionType(description)

  // strumień sekcji: strona z rysunkiem (od bloku pozycji w dół), potem reszta stron pozycji
  const orderedPages = drawingPage ? [drawingPage, ...group.pages.filter((p) => p !== drawingPage)] : group.pages
  const scan = scanPositionPages(orderedPages, drawingPage && block ? block.pozY : null)

  const notes = humanizeProductionNotes({ ...scan.notesRaw, inne: scan.notesOther.join('; ') || undefined })
  if (!Object.keys(scan.notesRaw).length && !scan.notesOther.length) warnings.push('Brak sekcji „Uwagi produkcyjne”')

  const dims = frameDimensions(scan, drawingPage, construction_type, warnings)
  const glass = glassLines(scan, warnings)

  return {
    pos_no: group.posNo,
    description,
    construction_type,
    system: block?.system ?? '',
    profile_color: block?.profile_color ?? '',
    hardware_color: block?.hardware_color ?? '',
    fillings: block?.fillings ?? '',
    width_mm: dims.width_mm,
    height_mm: dims.height_mm,
    quantity: block?.quantity ?? 1,
    weight_kg: block?.weight_kg ?? null,
    u_value: block?.u_value ?? null,
    notes,
    glass,
    warnings,
  }
}

export function parseAluLp(pages: PdfTextPage[]): AluLpParseResult {
  const warnings: string[] = []
  const first = pages[0]
  if (!first) {
    return {
      kind: 'LP',
      header: { lp_number: '', order_number: '', created_at: null, client: '', positions_count: null, area_m2: null, weight_kg: null, deadline_text: '' },
      positions: [],
      warnings: ['Pusty dokument'],
    }
  }
  const header = parseLpHeader(first, warnings)
  const groups = groupPagesByPosition(pages, header.order_number, warnings)
  const positions = groups.sort((a, b) => a.posNo - b.posNo).map(parsePosition)
  if (!positions.length) warnings.push('Nie znaleziono żadnej pozycji')
  if (header.positions_count !== null && positions.length !== header.positions_count) {
    warnings.push(`Nagłówek podaje ${header.positions_count} poz., odczytano ${positions.length}`)
  }
  return { kind: 'LP', header, positions, warnings }
}
