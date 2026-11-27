// =====================================================================
// Układ „jak w Excelu” dla magazynu wewnętrzne (27.11, Tymek: kartka do
// inwentaryzacji i stany ułożone jak dawny plik „STAN WEWNĘTRZNE MAGAZYN”).
//
//   zakładka (PŁYTOWE, BRAVO, CREDIS, MALEO…)
//     └ blok: rodzina + kolor („CLASSIC BIAŁY”, „MALEO BLACK BIAŁY”)
//         └ tabelka: numer modelu („01”, „06 PRZESUWNE”) — wiersze szerokość, kolumny LEWA / PRAWA
//   OŚCIEŻNICE: blok rodzina + kolor, wiersze profil (OR1 (80-100)…), kolumny BAZA L/P, BELKA 60/70/80/90
//   LISTWY: ćwierćwałki, listwy opaskowe — wiersze kolor
//   POZOSTAŁE: wszystko, czego nie da się rozpoznać (nic nie ginie z kartki)
//
// Czysta logika: ten sam układ dla PDF (kartka do liczenia), widoku stanów
// i wpisywania spisu w programie.
// =====================================================================

export type GridAttrs = {
  name?: string | null
  product_category?: string | null
  door_model?: string | null
  door_color?: string | null
  door_size?: string | null
  door_direction?: string | null
}

export type GridTable<T> = {
  /** numer modelu w bloku skrzydeł („01”, „06 PRZESUWNE”); pusty dla ościeżnic / listew */
  label: string
  /** 'wing' = wiersz szerokość × kierunek (pionowo jak w Excelu), 'matrix' = wiersze × kolumny */
  kind: 'wing' | 'matrix'
  columns: string[]
  rows: Array<{ label: string; cells: Array<T | null> }>
}
export type GridBlock<T> = { title: string; tables: GridTable<T>[] }
export type GridSheet<T> = { name: string; blocks: GridBlock<T>[] }

export const SHEET_FRAMES = 'OŚCIEŻNICE'
export const SHEET_TRIM = 'LISTWY'
export const SHEET_OTHER = 'POZOSTAŁE'
/** kolejność zakładek jak w starym pliku; reszta alfabetycznie, potem ościeżnice, listwy, pozostałe */
const SHEET_ORDER = ['PŁYTOWE', 'BRAVO', 'CREDIS', 'MALEO', 'MODERNA', 'MONZA', 'PRATO', 'PRIMO', 'VERONA']
/** pierwsze słowo rodziny → zakładka (ALBERO i CLASSIC były razem w „PŁYTOWE”) */
const SHEET_ALIAS: Record<string, string> = { ALBERO: 'PŁYTOWE', CLASSIC: 'PŁYTOWE', TECHNIC: 'TECHNICZNE' }

const DIR_LABEL: Record<string, string> = { L: 'LEWA', P: 'PRAWA', '': '—' }
const DIR_ORDER = ['L', 'P', '']

const clean = (s: string | null | undefined) => String(s ?? '').replace(/\s+/g, ' ').trim()
const num = (s: string) => {
  const m = s.match(/\d+/)
  return m ? Number(m[0]) : Number.POSITIVE_INFINITY
}
const byPl = (a: string, b: string) => a.localeCompare(b, 'pl')

type Wing = { family: string; number: string; color: string; size: string; dir: string; variant: string }

const MODEL_NO = /^(\d{2}|UNI-\d+)$/i
const WING_PREFIX = /^(?:SKRZYDŁO\s+(?:WEW|NSTD)|DRZWI)\s+/i

function splitModel(model: string): { family: string; number: string } {
  const t = clean(model).split(' ')
  if (t.length > 1 && MODEL_NO.test(t[t.length - 1])) return { family: t.slice(0, -1).join(' '), number: t[t.length - 1] }
  return { family: t.join(' '), number: '' }
}

function normDir(d: string | null | undefined): string {
  const s = clean(d).toUpperCase()
  if (s.startsWith('L')) return 'L'
  if (s.startsWith('P')) return 'P'
  return ''
}

/** Skrzydło / drzwi: z pól kartoteki, a gdy ich brak albo rozmiar siedzi w kolorze — z nazwy. */
export function parseWing(a: GridAttrs): Wing | null {
  const model = clean(a.door_model)
  const color = clean(a.door_color)
  const size = clean(a.door_size)
  if (model && color && size) {
    const m = color.match(/^(.*?)\s*(\(.+\))$/)
    return { ...splitModel(model), color: m ? m[1] : color, size, dir: normDir(a.door_direction), variant: m ? m[2] : '' }
  }
  if (model && color) {
    // „BIAŁY 60L (szklenie satyna)”, „ANTRACYT 100” — rozmiar i kierunek wpadły do koloru
    const m = color.match(/^(.*?)\s+(\d{2,3})([LP])?\s*(\(.+\))?$/i)
    if (m) return { ...splitModel(model), color: m[1], size: m[2], dir: normDir(m[3]), variant: m[4] ?? '' }
  }
  const name = clean(a.name)
  const rest0 = name.replace(WING_PREFIX, '')
  if (rest0 === name) return null
  let rest = rest0
  let variant = ''
  const pr = rest.match(/^(.*)\s+(PRZESUWNE)$/i)
  if (pr) { rest = pr[1]; variant = pr[2].toUpperCase() }
  const tail = rest.match(/^(.*)\s+(\d{2,3})([LP])?\s*(\(.+\))?$/i)
  if (!tail) return null
  if (tail[4]) variant = [tail[4], variant].filter(Boolean).join(' ')
  const tokens = tail[1].split(' ')
  const idx = tokens.findIndex((t, i) => i > 0 && MODEL_NO.test(t))
  if (idx < 0 || idx === tokens.length - 1) return null
  return {
    family: tokens.slice(0, idx).join(' '),
    number: tokens[idx],
    color: tokens.slice(idx + 1).join(' '),
    size: tail[2],
    dir: normDir(tail[3]),
    variant,
  }
}

type Frame = { family: string; color: string; row: string; rowSort: number; col: string }

/** BAZA / BELKA ościeżnicy: „BAZA OR5 (220-260) BIAŁY LEWA”, „BELKA OŚCIEŻNICY PROSTEJ SONOMA 60”. */
export function parseFrame(a: GridAttrs): Frame | null {
  const m = clean(a.name).match(/^(BAZA|BELKA)\s+(.+?)\s+(LEWA|PRAWA|\d{2,3})$/i)
  if (!m) return null
  const kind = m[1].toUpperCase()
  const end = m[3].toUpperCase()
  const col = kind === 'BAZA' ? (/^\d/.test(end) ? null : `BAZA ${end}`) : /^\d/.test(end) ? `BELKA ${end}` : null
  if (!col) return null
  const r = m[2].match(/^(.*?)\s*\((\d+)\s*-\s*(\d+)\)\s*(.+)$/)
  if (r) {
    const profile = clean(r[1])
    const fam = profile.replace(/\b(OR|ORS|OPB)\d+/, '$1')
    return {
      family: fam === 'OR' ? 'OŚCIEŻNICA REGULOWANA OR' : fam,
      color: clean(r[4]),
      // wiersz = sam profil (rodzina jest w tytule bloku): „OPB1-90-PROMO (100-140)”, nie „OŚC. BEZPRZYLG. OPB1-90-PROMO …”
      row: `${profile.split(' ').pop()} (${r[2]}-${r[3]})`,
      rowSort: Number(r[2]),
      col,
    }
  }
  const p = m[2].match(/^OŚCIEŻNICY PROSTEJ\s+(.+)$/i)
  if (p) return { family: 'OŚCIEŻNICA PROSTA', color: clean(p[1]), row: 'prosta', rowSort: 0, col }
  return null
}

const TRIM_PREFIXES = ['ĆWIERĆWAŁEK', 'LISTWA OPASKOWA']

function parseTrim(a: GridAttrs): { family: string; row: string } | null {
  const name = clean(a.name)
  for (const p of TRIM_PREFIXES) {
    if (name.toUpperCase().startsWith(`${p} `)) return { family: p, row: name.slice(p.length + 1) }
  }
  return null
}

function sheetOfFamily(family: string): string {
  const first = family.split(' ')[0].toUpperCase()
  return SHEET_ALIAS[first] ?? first
}

function sheetRank(name: string): [number, string] {
  const i = SHEET_ORDER.indexOf(name)
  if (i >= 0) return [i, '']
  if (name === SHEET_FRAMES) return [1000, '']
  if (name === SHEET_TRIM) return [1001, '']
  if (name === SHEET_OTHER) return [1002, '']
  return [500, name]
}

/** Układa pozycje w zakładki / bloki / tabelki jak w dawnym Excelu. Każda pozycja trafia dokładnie raz. */
export function buildDoorGrid<T>(items: T[], attrs: (t: T) => GridAttrs): GridSheet<T>[] {
  // zakładka → blok → tabelka → wiersz → kolumna → pozycje
  type Acc = Map<string, Map<string, Map<string, { kind: 'wing' | 'matrix'; rowSort: Map<string, number>; cells: Map<string, Map<string, T[]>>; cols: Set<string> }>>>
  const acc: Acc = new Map()
  const put = (sheet: string, block: string, table: string, kind: 'wing' | 'matrix', row: string, rowSort: number, col: string, item: T) => {
    if (!acc.has(sheet)) acc.set(sheet, new Map())
    const s = acc.get(sheet)!
    if (!s.has(block)) s.set(block, new Map())
    const b = s.get(block)!
    if (!b.has(table)) b.set(table, { kind, rowSort: new Map(), cells: new Map(), cols: new Set() })
    const t = b.get(table)!
    t.rowSort.set(row, rowSort)
    t.cols.add(col)
    if (!t.cells.has(row)) t.cells.set(row, new Map())
    const r = t.cells.get(row)!
    r.set(col, [...(r.get(col) ?? []), item])
  }

  for (const item of items) {
    const a = attrs(item)
    const cat = clean(a.product_category)
    const w = cat === 'door_wing' || !cat ? parseWing(a) : null
    if (w) {
      const table = [w.number, w.variant].filter(Boolean).join(' ')
      put(sheetOfFamily(w.family), `${w.family} ${w.color}`, table, 'wing', w.size, num(w.size), w.dir, item)
      continue
    }
    const f = parseFrame(a)
    if (f) {
      put(SHEET_FRAMES, `${f.family} ${f.color}`, '', 'matrix', f.row, f.rowSort, f.col, item)
      continue
    }
    const tr = parseTrim(a)
    if (tr) {
      put(SHEET_TRIM, tr.family, '', 'matrix', tr.row, 0, 'STAN', item)
      continue
    }
    put(SHEET_OTHER, 'POZOSTAŁE', '', 'matrix', clean(a.name) || '?', 0, 'STAN', item)
  }

  const colOrder = (kind: 'wing' | 'matrix', cols: Set<string>): string[] => {
    if (kind === 'wing') return DIR_ORDER.filter((d) => cols.has(d))
    return [...cols].sort((x, y) => {
      const bx = x.startsWith('BAZA') ? 0 : 1
      const by = y.startsWith('BAZA') ? 0 : 1
      return bx - by || num(x) - num(y) || byPl(x, y)
    })
  }

  const out: GridSheet<T>[] = []
  for (const [sheetName, blocks] of acc) {
    const sheet: GridSheet<T> = { name: sheetName, blocks: [] }
    for (const [title, tables] of [...blocks].sort((x, y) => byPl(x[0], y[0]))) {
      const block: GridBlock<T> = { title, tables: [] }
      for (const [label, t] of [...tables].sort((x, y) => num(x[0]) - num(y[0]) || byPl(x[0], y[0]))) {
        const cols = colOrder(t.kind, t.cols)
        const rowNames = [...t.cells.keys()].sort((x, y) => (t.rowSort.get(x)! - t.rowSort.get(y)!) || byPl(x, y))
        const rows: GridTable<T>['rows'] = []
        for (const rn of rowNames) {
          const r = t.cells.get(rn)!
          // dwie kartoteki w jednej kratce (np. WEW i NSTD tego samego rozmiaru) — kolejny wiersz o tej samej etykiecie
          const depth = Math.max(...cols.map((c) => r.get(c)?.length ?? 0))
          for (let i = 0; i < depth; i++) rows.push({ label: rn, cells: cols.map((c) => r.get(c)?.[i] ?? null) })
        }
        block.tables.push({
          label,
          kind: t.kind,
          columns: t.kind === 'wing' ? cols.map((c) => DIR_LABEL[c]) : cols,
          rows,
        })
      }
      sheet.blocks.push(block)
    }
    out.push(sheet)
  }
  return out.sort((x, y) => {
    const [rx, nx] = sheetRank(x.name)
    const [ry, ny] = sheetRank(y.name)
    return rx - ry || byPl(nx, ny)
  })
}

/** Wszystkie pozycje w kolejności siatki (zakładka → blok → tabelka → wiersz → kolumna) — kolejność wpisywania z kartki. */
export function gridItems<T>(sheets: GridSheet<T>[]): T[] {
  const out: T[] = []
  for (const s of sheets) for (const b of s.blocks) for (const t of b.tables) for (const r of t.rows) for (const c of r.cells) if (c != null) out.push(c)
  return out
}
