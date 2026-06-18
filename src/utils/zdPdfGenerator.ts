import pdfMake from 'pdfmake/build/pdfmake'
import type { TDocumentDefinitions } from 'pdfmake/interfaces'
import pdfFonts from 'pdfmake/build/vfs_fonts'
import type { CompanySettings, Supplier } from '../types'

export type ZdPdfData = {
  zdNumber: string
  createdAt: string
  expectedDelivery: string | null
  notes: string | null
  company: CompanySettings
  supplier: Supplier
  items: Array<{
    component_name: string
    component_code: string
    quantity_ordered: number
    units_per_pallet: number | null
    pallets_per_full_tir: number | null
    notes: string | null
  }>
  totalPallets: number
  tirFillness: number | null
}

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

function buildDocDefinition(data: ZdPdfData): TDocumentDefinitions {
  const itemRows = data.items.map((item, index) => [
    { text: String(index + 1), alignment: 'right' },
    item.component_name,
    item.component_code,
    { text: String(item.quantity_ordered), alignment: 'right' },
    { text: 'szt.', alignment: 'center' },
    item.notes ?? '—',
  ])
  const totalQty = data.items.reduce((sum, item) => sum + Number(item.quantity_ordered || 0), 0)
  const companyContact = [data.company.phone, data.company.email].filter(Boolean).join(' | ')

  const docDefinition: TDocumentDefinitions = {
    pageSize: 'A4',
    pageMargins: [36, 88, 36, 56],
    header: {
      margin: [36, 24, 36, 0],
      stack: [
        {
          columns: [
            {
              width: '*',
              stack: [
                { text: data.company.company_name || 'Firma', style: 'companyName' },
              ],
            },
            {
              width: 'auto',
              stack: [
                { text: data.zdNumber, alignment: 'right', bold: true, fontSize: 11 },
                { text: `Data wystawienia: ${data.createdAt}`, alignment: 'right', color: '#666', fontSize: 9 },
              ],
            },
          ],
        },
        { canvas: [{ type: 'line', x1: 0, y1: 8, x2: 523, y2: 8, lineWidth: 1, lineColor: '#d1d5db' }] },
      ],
    },
    footer: (currentPage, pageCount) => ({
      margin: [36, 0, 36, 16],
      columns: [
        {
          width: '*',
          text: [data.company.company_name, data.company.nip ? `NIP: ${data.company.nip}` : null, companyContact]
            .filter(Boolean)
            .join(' | '),
          fontSize: 8,
          color: '#888',
        },
        {
          width: 'auto',
          text: `Strona ${currentPage} z ${pageCount}`,
          alignment: 'right',
          fontSize: 8,
          color: '#888',
        },
      ],
    }),
    content: [
      {
        columns: [
          {
            width: '50%',
            stack: [
              { text: 'NABYWCA', style: 'sectionLabel' },
              { text: data.company.company_name, style: 'companyName' },
              data.company.address_line1,
              data.company.address_line2,
              [data.company.postal_code, data.company.city].filter(Boolean).join(' '),
              data.company.country,
              data.company.nip ? [{ text: 'NIP: ', bold: true }, data.company.nip] : null,
              data.company.regon ? [{ text: 'REGON: ', bold: true }, data.company.regon] : null,
              data.company.phone ? [{ text: 'Tel: ', bold: true }, data.company.phone] : null,
              data.company.email ? [{ text: 'Email: ', bold: true }, data.company.email] : null,
              data.company.bank_account ? [{ text: 'Bank: ', bold: true }, data.company.bank_account] : null,
            ].filter(Boolean),
          },
          {
            width: '50%',
            stack: [
              { text: 'DOSTAWCA', style: 'sectionLabel' },
              { text: data.supplier.name, style: 'supplierName' },
              data.supplier.contact_person ? `Osoba kontaktowa: ${data.supplier.contact_person}` : null,
              data.supplier.email ? `Email: ${data.supplier.email}` : null,
              data.supplier.phone ? `Tel: ${data.supplier.phone}` : null,
            ].filter(Boolean),
          },
        ],
        margin: [0, 20, 0, 20],
      },
      { text: 'ZAMÓWIENIE DO DOSTAWCY', style: 'docTitle' },
      { text: data.zdNumber, style: 'zdNumber' },
      { text: `Data wystawienia: ${data.createdAt}`, style: 'metaCenter' },
      data.expectedDelivery && { text: `Przewidywana dostawa: ${data.expectedDelivery}`, style: 'metaCenter' },
      {
        table: {
          headerRows: 1,
          widths: [25, '*', 95, 52, 46, '*'],
          body: [
            [
              { text: 'Lp.', style: 'th' },
              { text: 'SKU', style: 'th' },
              { text: 'Kod', style: 'th' },
              { text: 'Ilość', style: 'thRight' },
              { text: 'Jm.', style: 'th' },
              { text: 'Uwagi', style: 'th' },
            ],
            ...itemRows,
          ],
        },
        layout: 'lightHorizontalLines',
      },
      {
        text:
          `Łącznie pozycji: ${data.items.length} | Łącznie sztuk: ${totalQty}` +
          (data.totalPallets > 0 ? ` | Palet: ${data.totalPallets}` : '') +
          (data.tirFillness != null ? ` | Wypełnienie TIR: ${Math.round(data.tirFillness * 100)}%` : ''),
        style: 'totalsRow',
        margin: [0, 15, 0, 0],
      },
      data.notes
        ? [
            { text: 'Uwagi do zamówienia:', style: 'notesLabel' },
            { text: data.notes, style: 'notesContent' },
          ]
        : null,
      {
        columns: [
          {
            width: '50%',
            stack: [
              { text: 'Wystawił', style: 'signature' },
              { text: '_______________________', style: 'signatureLine' },
            ],
          },
          {
            width: '50%',
            stack: [
              { text: 'Odebrał', style: 'signature' },
              { text: '_______________________', style: 'signatureLine' },
            ],
          },
        ],
        margin: [0, 60, 0, 0],
      },
    ].filter(Boolean) as NonNullable<TDocumentDefinitions['content']>,
    styles: {
      docTitle: { fontSize: 18, bold: true, alignment: 'center', margin: [0, 10, 0, 5] },
      zdNumber: { fontSize: 14, alignment: 'center', color: '#666', margin: [0, 5, 0, 10] },
      metaCenter: { fontSize: 10, alignment: 'center', color: '#666' },
      sectionLabel: { fontSize: 10, bold: true, color: '#666', margin: [0, 0, 0, 5] },
      companyName: { fontSize: 13, bold: true, margin: [0, 2, 0, 4] },
      supplierName: { fontSize: 13, bold: true, margin: [0, 2, 0, 4] },
      th: { fillColor: '#f3f4f6', bold: true, fontSize: 10, alignment: 'left' },
      thRight: { fillColor: '#f3f4f6', bold: true, fontSize: 10, alignment: 'right' },
      totalsRow: { fontSize: 11, bold: true, alignment: 'right' },
      signature: { fontSize: 10, alignment: 'center', margin: [0, 50, 0, 0] },
      signatureLine: { alignment: 'center', margin: [0, 30, 0, 0] },
      notesLabel: { fontSize: 10, bold: true, margin: [0, 15, 0, 5] },
      notesContent: { fontSize: 10, italics: true, margin: [10, 0, 0, 0] },
    },
    defaultStyle: { font: 'Roboto', fontSize: 10 },
  }
  return docDefinition
}

export const generateZdPdf = async (data: ZdPdfData, mode: 'open' | 'download' = 'download') => {
  const docDefinition = buildDocDefinition(data)
  const pdf = pdfMakeRuntime.createPdf(docDefinition)
  if (mode === 'download') {
    pdf.download(`${data.zdNumber}.pdf`)
    return
  }
  pdf.open()
}
