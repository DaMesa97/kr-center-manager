import pdfMake from 'pdfmake/build/pdfmake'
import type { TDocumentDefinitions } from 'pdfmake/interfaces'
import pdfFonts from 'pdfmake/build/vfs_fonts'
import type { InventoryLine, InventorySession } from '../types'

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
): void {
  const dateStr = session.counted_date

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
    ...lines.map((line, i) => [
      { text: String(i + 1), alignment: 'center', fontSize: 9 },
      { text: line.component_code ?? '', fontSize: 8, bold: true },
      { text: line.component_name ?? `#${line.component_id}`, fontSize: 9 },
      { text: line.component_unit ?? '', alignment: 'center', fontSize: 9 },
      {
        text: line.counted_qty != null ? String(line.counted_qty) : '',
        alignment: 'center',
        fontSize: 9,
      },
    ]),
  ]

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
