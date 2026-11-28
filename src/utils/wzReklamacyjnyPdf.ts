import pdfMake from 'pdfmake/build/pdfmake'
import type { TDocumentDefinitions } from 'pdfmake/interfaces'
import pdfFonts from 'pdfmake/build/vfs_fonts'
import { formatIlosc } from '../lib/magazynFormat'

type PdfMakeRuntime = typeof pdfMake & {
  vfs?: Record<string, string>
  createPdf: (definition: TDocumentDefinitions) => { download: (fileName?: string) => void }
}
type PdfFontsRuntime = { pdfMake?: { vfs?: Record<string, string> }; vfs?: Record<string, string> }
const pdfMakeRuntime = pdfMake as unknown as PdfMakeRuntime
const pdfFontsRuntime = pdfFonts as unknown as PdfFontsRuntime
pdfMakeRuntime.vfs = pdfFontsRuntime.pdfMake?.vfs ?? pdfFontsRuntime.vfs

export type WzrPdfData = {
  numer: string
  data: string
  magazyn: string
  firma: string | null
  nrZlecenia: string | null
  reklamacja: string | null
  powod: string | null
  uwagi: string | null
  anulowany?: string | null
  pozycje: Array<{ kod: string | null; nazwa: string; jm: string; ilosc: number; uwagi: string | null }>
}

/** WZ reklamacyjny do podpisu: nagłówek, pozycje, Wydał / Odebrał. */
export function generateWzReklamacyjnyPdf(d: WzrPdfData, companyName = 'KR Center'): void {
  const fmt = formatIlosc
  const info = (label: string, value: string | null) =>
    value ? [{ text: label, color: '#64748b', fontSize: 8.5 }, { text: value, fontSize: 10, bold: true }] : null
  const pola = [
    info('Magazyn', d.magazyn),
    info('Firma / klient', d.firma),
    info('Nr zlecenia', d.nrZlecenia),
    info('Reklamacja', d.reklamacja),
    info('Powód', d.powod),
  ].filter(Boolean) as unknown[][]

  const doc = {
    pageSize: 'A4',
    pageMargins: [36, 40, 36, 44],
    content: [
      {
        columns: [
          { text: companyName, fontSize: 11, bold: true, color: '#1b304a' },
          { text: `Data wystawienia: ${d.data}`, fontSize: 10, color: '#444', alignment: 'right' },
        ],
        marginBottom: 10,
      },
      { text: 'WZ REKLAMACYJNY', fontSize: 18, bold: true, alignment: 'center', color: '#1e293b' },
      { text: d.numer, fontSize: 13, alignment: 'center', marginBottom: d.anulowany ? 4 : 14 },
      ...(d.anulowany ? [{ text: `ANULOWANY — ${d.anulowany}`, color: '#b3261e', bold: true, alignment: 'center', marginBottom: 12 }] : []),
      {
        table: { widths: [110, '*'], body: pola },
        layout: 'noBorders',
        marginBottom: 12,
      },
      {
        table: {
          headerRows: 1,
          widths: [24, 80, '*', 34, 50, 110],
          body: [
            ['Lp.', 'Kod', 'Nazwa', 'J.m.', 'Ilość', 'Uwagi'].map((h) => ({ text: h, bold: true, fontSize: 9, color: '#fff', fillColor: '#1e3a5f', margin: [2, 3, 2, 3] })),
            ...d.pozycje.map((p, i) => [
              { text: String(i + 1), alignment: 'center', fontSize: 9 },
              { text: p.kod ?? '', fontSize: 8, bold: true },
              { text: p.nazwa, fontSize: 9 },
              { text: p.jm, alignment: 'center', fontSize: 9 },
              { text: fmt(p.ilosc), alignment: 'center', bold: true, fontSize: 10 },
              { text: p.uwagi ?? '', fontSize: 8.5 },
            ]),
          ],
        },
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => '#aaaaaa',
          vLineColor: () => '#cccccc',
        },
      },
      ...(d.uwagi ? [{ text: `Uwagi: ${d.uwagi}`, fontSize: 9.5, marginTop: 10 }] : []),
      {
        marginTop: 46,
        columns: ['Wydał/a (magazyn)', 'Odebrał/a'].map((t) => ({
          width: '50%',
          stack: [
            { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 180, y2: 0, lineWidth: 0.5 }] },
            { text: t, fontSize: 8.5, color: '#666', marginTop: 3 },
          ],
        })),
      },
    ],
    footer: (currentPage: number, pageCount: number) => ({
      text: `${d.numer} · strona ${currentPage} z ${pageCount}`,
      alignment: 'center',
      fontSize: 7.5,
      color: '#888',
      margin: [0, 12, 0, 0],
    }),
    defaultStyle: { font: 'Roboto' },
  }
  pdfMakeRuntime.createPdf(doc as unknown as TDocumentDefinitions).download(`${d.numer.replace(/\//g, '-')}.pdf`)
}
