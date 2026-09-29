import pdfMake from 'pdfmake/build/pdfmake'
import type { TDocumentDefinitions } from 'pdfmake/interfaces'
import pdfFonts from 'pdfmake/build/vfs_fonts'

type PdfMakeRuntime = typeof pdfMake & {
  vfs?: Record<string, string>
  createPdf: (definition: TDocumentDefinitions) => { download: (fileName?: string) => void }
}
type PdfFontsRuntime = { pdfMake?: { vfs?: Record<string, string> }; vfs?: Record<string, string> }

const pdfMakeRuntime = pdfMake as unknown as PdfMakeRuntime
const pdfFontsRuntime = pdfFonts as unknown as PdfFontsRuntime
pdfMakeRuntime.vfs = pdfFontsRuntime.pdfMake?.vfs ?? pdfFontsRuntime.vfs

/** Jedna pozycja zamówienia u szklarza (element zamówienia produkcyjnego). */
export type GlassOrderLine = {
  orderNumber: string
  company: string
  element: string // 'Naświetle' | 'Dostawka A' | 'Dostawka B'
  glazing: string // rodzaj szkła (np. SATYNA); '' = niepodane
  glassDim: string // wymiar szyby PO naddatku, np. '354×2036'
  qty: number
}

export function generateGlassOrderPdf(lines: GlassOrderLine[], companyName = 'KR Center'): void {
  const dateStr = new Date().toLocaleDateString('pl-PL')

  // grupujemy po rodzaju szkła — szklarz tnie partiami per szkło
  const sorted = [...lines].sort(
    (a, b) =>
      (a.glazing || 'zzz').localeCompare(b.glazing || 'zzz', 'pl') ||
      a.orderNumber.localeCompare(b.orderNumber, 'pl'),
  )

  const body: unknown[][] = [
    [
      { text: 'Lp.', style: 'th', alignment: 'center' },
      { text: 'Rodzaj szkła', style: 'th' },
      { text: 'Wymiar szyby (mm)', style: 'th', alignment: 'center' },
      { text: 'Szt.', style: 'th', alignment: 'center' },
      { text: 'Element', style: 'th' },
      { text: 'Nr zlecenia', style: 'th', alignment: 'center' },
    ],
  ]
  let lastGlazing: string | null = null
  sorted.forEach((l, i) => {
    const g = l.glazing || '— (do ustalenia)'
    body.push([
      { text: String(i + 1), alignment: 'center', fontSize: 9 },
      { text: g, fontSize: 9, bold: g !== lastGlazing },
      { text: l.glassDim, alignment: 'center', fontSize: 10, bold: true },
      { text: String(l.qty), alignment: 'center', fontSize: 9 },
      { text: l.element, fontSize: 9 },
      { text: l.orderNumber, alignment: 'center', fontSize: 9 },
    ])
    lastGlazing = g
  })

  // podsumowanie sztuk per rodzaj szkła
  const totals = new Map<string, number>()
  sorted.forEach((l) => {
    const g = l.glazing || '— (do ustalenia)'
    totals.set(g, (totals.get(g) ?? 0) + l.qty)
  })
  const totalsText = Array.from(totals.entries())
    .map(([g, n]) => `${g}: ${n} szt.`)
    .join('   ·   ')

  const docDefinition: TDocumentDefinitions = {
    pageSize: 'A4',
    pageMargins: [30, 40, 30, 40],
    footer: (cur: number, total: number) => ({
      text: `Strona ${cur} z ${total}`,
      alignment: 'center', fontSize: 8, color: '#888', margin: [0, 8, 0, 0],
    }),
    content: [
      {
        columns: [
          { text: companyName, style: 'company', width: '*' },
          { text: `Data: ${dateStr}`, style: 'dateRight', width: 'auto' },
        ],
        marginBottom: 4,
      },
      { text: 'Zamówienie szyb', style: 'title', marginBottom: 2 },
      { text: `Pozycji: ${sorted.length}  ·  ${totalsText}`, style: 'subtitle', marginBottom: 10 },
      {
        table: { headerRows: 1, widths: [26, '*', 100, 32, 80, 70], body: body as never },
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
              { text: 'Zamówił/a:', fontSize: 9, color: '#555' },
              { text: '\n\n', fontSize: 9 },
              { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 160, y2: 0, lineWidth: 0.5 }] },
              { text: 'Podpis', fontSize: 8, color: '#888', marginTop: 2 },
            ],
          },
        ],
      },
    ],
    styles: {
      company: { fontSize: 11, bold: true, color: '#1e3a5f' },
      dateRight: { fontSize: 10, color: '#444', alignment: 'right' },
      title: { fontSize: 16, bold: true, color: '#1e293b', alignment: 'center' },
      subtitle: { fontSize: 9, color: '#666', alignment: 'center' },
      th: { bold: true, fontSize: 9, color: '#ffffff', fillColor: '#1e3a5f', margin: [4, 4, 4, 4] },
    },
    defaultStyle: { font: 'Roboto' },
  }

  pdfMakeRuntime.createPdf(docDefinition).download(
    `zamowienie-szyb_${new Date().toISOString().slice(0, 10)}.pdf`,
  )
}
