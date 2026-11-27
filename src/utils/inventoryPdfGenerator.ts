import pdfMake from 'pdfmake/build/pdfmake'
import type { TDocumentDefinitions } from 'pdfmake/interfaces'
import pdfFonts from 'pdfmake/build/vfs_fonts'
import type { InventoryLine, InventorySession } from '../types'
import { PRODUCT_CATEGORY_LABELS } from '../constants'
import { groupInventoryLines, isDoorCategory } from '../lib/internalWarehouse'
import { buildDoorGrid, type GridBlock } from '../lib/doorStockGrid'

type PdfMakeRuntime = typeof pdfMake & {
  vfs?: Record<string, string>
  createPdf: (definition: TDocumentDefinitions) => {
    download: (fileName?: string) => void
    open: () => void
  }
}
type PdfFontsRuntime = {
  pdfMake?: { vfs?: Record<string, string> }
  vfs?: Record<string, string>
}

const pdfMakeRuntime = pdfMake as unknown as PdfMakeRuntime
const pdfFontsRuntime = pdfFonts as unknown as PdfFontsRuntime
pdfMakeRuntime.vfs = pdfFontsRuntime.pdfMake?.vfs ?? pdfFontsRuntime.vfs

export function generateInventorySheet(
  session: InventorySession,
  lines: InventoryLine[],
  companyName = 'KR Center',
  /** nazwa magazynu na kartce (Magazyn 1 / Magazyn 2 drzwi wewnętrznych) */
  warehouseName?: string,
): void {
  const dateStr = session.counted_date
  // magazyn wewnętrzne (27.11): kartka ułożona jak dawny Excel „STAN WEWNĘTRZNE MAGAZYN”
  if (lines.some((l) => isDoorCategory(l.component_category))) {
    generateDoorGridSheet(session, lines, companyName, warehouseName ?? 'magazyn wewnętrzne')
    return
  }

  // ŚLEPY SPIS: bez kolumny stanu systemowego — liczący nie może „podciągać"
  // wyniku pod system. Zamiast tego KOD komponentu (identyfikacja na hali).
  const tableBody: unknown[][] = [
    [
      { text: 'Lp.', style: 'tableHeader', alignment: 'center' },
      { text: 'Kod', style: 'tableHeader' },
      { text: 'Nazwa komponentu', style: 'tableHeader' },
      { text: 'J.m.', style: 'tableHeader', alignment: 'center' },
      { text: 'Ilość rzeczywista', style: 'tableHeader', alignment: 'center' },
    ],
    ...(() => {
      // magazyn wewnętrzny: grupy wg kategorii (skrzydła, ościeżnice, klamki…), w grupie po nazwie
      let lp = 0
      return groupInventoryLines(lines).flatMap((g) => [
        ...(g.key
          ? [[
              { text: `${PRODUCT_CATEGORY_LABELS[g.key] ?? g.key} (${g.lines.length})`, colSpan: 5, bold: true, fontSize: 9, fillColor: '#eeeeee', margin: [0, 2, 0, 2] },
              {}, {}, {}, {},
            ]]
          : []),
        ...g.lines.map((line) => rowFor(line, ++lp)),
      ])
    })(),
  ]

  function rowFor(line: InventoryLine, i: number): unknown[] {
    return [
      { text: String(i), alignment: 'center', fontSize: 9 },
      { text: line.component_code ?? '', fontSize: 8, bold: true },
      { text: line.component_name ?? `#${line.component_id}`, fontSize: 9 },
      { text: line.component_unit ?? '', alignment: 'center', fontSize: 9 },
      {
        text: line.counted_qty != null ? String(line.counted_qty) : '',
        alignment: 'center',
        fontSize: 9,
      },
    ]
  }

  const docDefinition: TDocumentDefinitions = {
    pageSize: 'A4',
    pageMargins: [30, 40, 30, 40],
    footer: (currentPage: number, pageCount: number) => ({
      text: `Strona ${currentPage} z ${pageCount}`,
      alignment: 'center',
      fontSize: 8,
      color: '#888',
      margin: [0, 8, 0, 0],
    }),
    content: [
      {
        columns: [
          { text: companyName, style: 'company', width: '*' },
          {
            text: `Data liczenia: ${dateStr}`,
            style: 'dateRight',
            width: 'auto',
          },
        ],
        marginBottom: 4,
      },
      {
        text: 'Arkusz inwentaryzacyjny',
        style: 'title',
        marginBottom: 2,
      },
      session.notes
        ? { text: `Uwagi: ${session.notes}`, style: 'subtitle', marginBottom: 10 }
        : { text: '', marginBottom: 10 },
      {
        table: {
          headerRows: 1,
          widths: [26, 90, '*', 36, 90],
          body: tableBody as unknown as import('pdfmake/interfaces').TableCell[][],
        },
        layout: {
          hLineWidth: (i: number) => (i === 0 || i === 1 ? 1.5 : 0.5),
          vLineWidth: () => 0.5,
          hLineColor: () => '#aaaaaa',
          vLineColor: () => '#cccccc',
          fillColor: (i: number) => (i === 0 ? '#1e3a5f' : i % 2 === 0 ? '#f5f7fa' : null),
        },
      },
      {
        marginTop: 24,
        columns: [
          {
            width: '50%',
            stack: [
              { text: 'Sporządził/a:', fontSize: 9, color: '#555' },
              { text: '\n\n', fontSize: 9 },
              { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 160, y2: 0, lineWidth: 0.5 }] },
              { text: 'Podpis', fontSize: 8, color: '#888', marginTop: 2 },
            ],
          },
          {
            width: '50%',
            stack: [
              { text: 'Zatwierdził/a:', fontSize: 9, color: '#555' },
              { text: '\n\n', fontSize: 9 },
              { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 160, y2: 0, lineWidth: 0.5 }] },
              { text: 'Podpis', fontSize: 8, color: '#888', marginTop: 2 },
            ],
          },
        ],
      },
      {
        text: `Wygenerowano: ${new Date().toLocaleDateString('pl-PL')} | Pozycji: ${lines.length}`,
        fontSize: 7,
        color: '#aaa',
        marginTop: 16,
        alignment: 'right',
      },
    ],
    styles: {
      company: { fontSize: 11, bold: true, color: '#1e3a5f' },
      dateRight: { fontSize: 10, color: '#444', alignment: 'right' },
      title: { fontSize: 16, bold: true, color: '#1e293b', alignment: 'center' },
      subtitle: { fontSize: 9, color: '#666', alignment: 'center' },
      tableHeader: {
        bold: true,
        fontSize: 9,
        color: '#ffffff',
        fillColor: '#1e3a5f',
        margin: [4, 4, 4, 4],
      },
    },
    defaultStyle: { font: 'Roboto' },
  }

  pdfMakeRuntime.createPdf(docDefinition as TDocumentDefinitions).download(
    `inwentaryzacja_${dateStr}.pdf`,
  )
}

// ---------------------------------------------------------------------
// Magazyn wewnętrzne (27.11): zakładki (PŁYTOWE, BRAVO…), bloki model + kolor po dwa w rzędzie,
// w bloku SZEROKOŚĆ | KIERUNEK | STAN | UWAGI — jak w starym Excelu. Ślepy spis: STAN pusty
// (chyba że już policzone). Ościeżnice: profil × BAZA L/P, BELKA szerokości.
// ---------------------------------------------------------------------
type Cell = Record<string, unknown>
const GRID_LINE = '#9aa5b5'
const TITLE_FILL = '#eef3d6'
const SUB_FILL = '#dfe6f1'
const HEAD_FILL = '#f1f5fb'
const gridLayout = { hLineWidth: () => 0.6, vLineWidth: () => 0.6, hLineColor: () => GRID_LINE, vLineColor: () => GRID_LINE }

function qtyText(l: InventoryLine): string {
  return l.counted_qty != null ? String(l.counted_qty) : ''
}

function blockContent(b: GridBlock<InventoryLine>): Record<string, unknown> {
  const stack: unknown[] = []
  b.tables.forEach((t, ti) => {
    if (t.kind === 'wing') {
      const body: Cell[][] = []
      if (ti === 0) body.push([{ text: b.title, colSpan: 4, bold: true, fontSize: 10, alignment: 'center', fillColor: TITLE_FILL, margin: [0, 3, 0, 3] }, {}, {}, {}])
      if (t.label) {
        body.push([
          { text: t.label, colSpan: 3, bold: true, fontSize: 9, alignment: 'center', fillColor: SUB_FILL },
          {},
          {},
          { text: 'UWAGI', fontSize: 7, alignment: 'center', fillColor: SUB_FILL, color: '#475569' },
        ])
      }
      body.push(['SZEROKOŚĆ', 'KIERUNEK', 'STAN', t.label ? '' : 'UWAGI'].map((h) => ({ text: h, fontSize: 6.5, alignment: 'center', fillColor: HEAD_FILL, color: '#475569' })))
      for (const row of t.rows) {
        const cells = t.columns
          .map((c, ci) => ({ c, l: row.cells[ci] }))
          .filter((x): x is { c: string; l: InventoryLine } => x.l != null)
        cells.forEach((x, k) => {
          body.push([
            k === 0
              ? { text: row.label, rowSpan: cells.length, bold: true, fontSize: 10, alignment: 'center', fillColor: '#f7f9e9', margin: [0, cells.length > 1 ? 5 : 1, 0, 0] }
              : {},
            { text: x.c, fontSize: 8, alignment: 'center', margin: [0, 2, 0, 2] },
            { text: qtyText(x.l), bold: true, fontSize: 10, alignment: 'center', margin: [0, 1, 0, 1] },
            { text: '' },
          ])
        })
      }
      stack.push({ table: { widths: [52, 52, '*', 58], body, dontBreakRows: true }, layout: gridLayout })
    } else {
      const n = t.columns.length
      const body: Cell[][] = [
        [{ text: b.title, colSpan: n + 1, bold: true, fontSize: 9.5, alignment: 'center', fillColor: TITLE_FILL, margin: [0, 3, 0, 3] }, ...t.columns.map(() => ({}))],
        [{ text: t.label || '', fontSize: 6.5, fillColor: HEAD_FILL }, ...t.columns.map((c) => ({ text: c, fontSize: 6.5, alignment: 'center', fillColor: HEAD_FILL, color: '#475569' }))],
        ...t.rows.map((row) => [
          { text: row.label, bold: true, fontSize: n > 3 ? 7 : 8.5, fillColor: '#f7f9e9', margin: [0, 2, 0, 2] },
          ...row.cells.map((l) =>
            l
              ? { text: qtyText(l), bold: true, fontSize: 9, alignment: 'center', margin: [0, 2, 0, 2] }
              : { text: '—', color: '#cbd5e1', fontSize: 7, alignment: 'center', fillColor: '#f1f1f1' },
          ),
        ]),
      ]
      stack.push({ table: { widths: [n > 3 ? 70 : '*', ...t.columns.map(() => (n > 3 ? '*' : 60))], body, dontBreakRows: true }, layout: gridLayout })
    }
  })
  return { stack, unbreakable: true }
}

function generateDoorGridSheet(session: InventorySession, lines: InventoryLine[], companyName: string, warehouseName: string): void {
  const dateStr = session.counted_date
  const sheets = buildDoorGrid(lines, (l) => ({
    name: l.component_name,
    product_category: l.component_category,
    door_model: l.component_door_model,
    door_color: l.component_door_color,
    door_size: l.component_door_size,
    door_direction: l.component_door_direction,
  }))
  const content: unknown[] = []
  sheets.forEach((sheet, si) => {
    content.push({
      ...(si > 0 ? { pageBreak: 'before' } : {}),
      columns: [
        { text: sheet.name, fontSize: 15, bold: true, color: '#1b304a', width: '*' },
        { text: `${companyName} · ${warehouseName} · data: ${dateStr}`, fontSize: 9, color: '#475569', alignment: 'right', width: 'auto', margin: [0, 5, 0, 0] },
      ],
      marginBottom: 8,
    })
    // dwa bloki w rzędzie, jak w Excelu
    for (let i = 0; i < sheet.blocks.length; i += 2) {
      const a = sheet.blocks[i]
      const b = sheet.blocks[i + 1]
      content.push({
        columns: [{ width: '*', ...blockContent(a) }, b ? { width: '*', ...blockContent(b) } : { width: '*', text: '' }],
        columnGap: 12,
        marginBottom: 10,
        unbreakable: true,
      })
    }
  })
  content.push({
    marginTop: 18,
    unbreakable: true,
    columns: ['Sporządził/a:', 'Zatwierdził/a:'].map((t) => ({
      width: '50%',
      stack: [
        { text: t, fontSize: 9, color: '#555' },
        { text: '\n\n', fontSize: 9 },
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 160, y2: 0, lineWidth: 0.5 }] },
        { text: 'Podpis', fontSize: 8, color: '#888', marginTop: 2 },
      ],
    })),
  })
  const docDefinition = {
    pageSize: 'A4',
    pageMargins: [24, 28, 24, 32],
    footer: (currentPage: number, pageCount: number) => ({
      text: `Arkusz inwentaryzacyjny · ${warehouseName} · ${dateStr} · strona ${currentPage} z ${pageCount} · pozycji ${lines.length}`,
      alignment: 'center',
      fontSize: 7.5,
      color: '#888',
      margin: [0, 10, 0, 0],
    }),
    content,
    defaultStyle: { font: 'Roboto' },
  }
  pdfMakeRuntime.createPdf(docDefinition as unknown as TDocumentDefinitions).download(`inwentaryzacja_${warehouseName.replace(/\s+/g, '_')}_${dateStr}.pdf`)
}
