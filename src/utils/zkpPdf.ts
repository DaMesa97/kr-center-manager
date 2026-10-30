import pdfMake from 'pdfmake/build/pdfmake'
import type { TDocumentDefinitions } from 'pdfmake/interfaces'
import pdfFonts from 'pdfmake/build/vfs_fonts'
import {
  buildMatrix627Definition,
  buildProductCardDefinition,
  buildRegister624Definition,
  buildRegister633Definition,
  type Register624Input,
} from '../lib/zkpPrint'
import {
  buildDeclarationDefinition,
  buildMarkingDefinition,
  buildProtocolDefinition,
  type DeclarationPrintInput,
  type MarkingItem,
  type ProtocolPrintInput,
} from '../lib/zkpPrintDocs'
import type { ZkpCardData } from '../hooks/useZkpCards'
import type { ZkpCompetency, ZkpPerson, ZkpRange, ZkpRegisterRow } from '../lib/zkpCard'
import type { ZkpCardTarget } from '../components/zkp/ZkpCardModal'
import type { ZkpData } from '../components/zkp/ZkpView'

// Wydruki ZKP AS 75EI (pdfmake, czcionka Roboto z polskimi znakami): karta wyrobu 6.25,
// rejestr wyrobów 6.33, rejestr przyjęć 6.24. Treść dokumentów — lib/zkpPrint.ts.

type PdfMakeRuntime = typeof pdfMake & {
  vfs?: Record<string, string>
  createPdf: (definition: TDocumentDefinitions) => { download: (fileName?: string) => void }
}
type PdfFontsRuntime = { pdfMake?: { vfs?: Record<string, string> }; vfs?: Record<string, string> }

const pdfMakeRuntime = pdfMake as unknown as PdfMakeRuntime
const pdfFontsRuntime = pdfFonts as unknown as PdfFontsRuntime
pdfMakeRuntime.vfs = pdfFontsRuntime.pdfMake?.vfs ?? pdfFontsRuntime.vfs

const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '-')

export function printProductCardPdf(target: ZkpCardTarget, data: ZkpCardData, ranges: ZkpRange[], zkp: ZkpData) {
  const def = buildProductCardDefinition({
    target,
    data,
    range: ranges.find((r) => r.code === data.card?.range_code) ?? null,
    lots: zkp.lots,
    components: zkp.components,
    printedAt: new Date(),
  })
  pdfMakeRuntime.createPdf(def).download(`Karta_wyrobu_${safe(target.constructionNo)}.pdf`)
}

export function printRegister633Pdf(rows: ZkpRegisterRow[], title: string) {
  pdfMakeRuntime.createPdf(buildRegister633Definition(rows, title, new Date())).download(`Rejestr_wyrobow_6.33_${new Date().toLocaleDateString('sv-SE')}.pdf`)
}

export function printMatrix627Pdf(people: ZkpPerson[], competencies: ZkpCompetency[]) {
  pdfMakeRuntime.createPdf(buildMatrix627Definition(people, competencies, new Date())).download(`Matryca_kompetencji_6.27_${new Date().toLocaleDateString('sv-SE')}.pdf`)
}

export function printRegister624Pdf(input: Register624Input) {
  pdfMakeRuntime.createPdf(buildRegister624Definition(input, new Date())).download(`Rejestr_przyjec_6.24_${input.from}_${input.to}.pdf`)
}

// ── etap D+E: protokół 6.17.5, deklaracja 6.9, tabliczka 6.26 / etykieta 6.8 ──
export function printProtocolPdf(inp: Omit<ProtocolPrintInput, 'printedAt'>) {
  pdfMakeRuntime.createPdf(buildProtocolDefinition({ ...inp, printedAt: new Date() })).download(`Protokol_6.17.5_${safe(inp.protocol.protocol_no)}.pdf`)
}

export function printDeclarationPdf(inp: Omit<DeclarationPrintInput, 'printedAt'>) {
  pdfMakeRuntime.createPdf(buildDeclarationDefinition({ ...inp, printedAt: new Date() })).download(`${safe(inp.declaration.number)}.pdf`)
}

export function printMarkingPdf(items: MarkingItem[]) {
  const name = items.length === 1 ? `Tabliczka_${safe(items[0].constructionNo)}` : `Tabliczki_${items.length}_szt`
  pdfMakeRuntime.createPdf(buildMarkingDefinition(items, new Date())).download(`${name}.pdf`)
}
