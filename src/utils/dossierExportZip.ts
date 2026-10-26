import pdfMake from 'pdfmake/build/pdfmake'
import type { TDocumentDefinitions } from 'pdfmake/interfaces'
import pdfFonts from 'pdfmake/build/vfs_fonts'
import { supabase } from '../supabaseClient'
import { ORDER_DOCUMENTS_BUCKET } from '../constants'
import { loadAluOrderTrace } from '../lib/aluTraceData'
import { buildDossierTocDefinition, dossierEntryNames, dossierZipName, sortDocumentsForExport } from '../lib/dossierExport'
import { buildZipBlob, type ZipEntry } from '../lib/zipStore'

// Eksport teczki zlecenia aluminium do jednej paczki ZIP: 00_Spis_tresci.pdf
// + wszystkie wersje dokumentów z bucketu order-documents. Plik, którego nie da
// się pobrać, nie przerywa eksportu — trafia do spisu jako „NIE POBRANO".

type PdfMakeRuntime = typeof pdfMake & {
  vfs?: Record<string, string>
  createPdf: (definition: TDocumentDefinitions) => { getBlob: () => Promise<Blob> }
}
type PdfFontsRuntime = { pdfMake?: { vfs?: Record<string, string> }; vfs?: Record<string, string> }

const pdfMakeRuntime = pdfMake as unknown as PdfMakeRuntime
const pdfFontsRuntime = pdfFonts as unknown as PdfFontsRuntime
pdfMakeRuntime.vfs = pdfFontsRuntime.pdfMake?.vfs ?? pdfFontsRuntime.vfs

export type DossierExportResult = { ok: true; fileName: string; files: number; failed: number } | { ok: false; error: string }

async function currentUserName(): Promise<string> {
  const { data } = await supabase.auth.getUser()
  const uid = data.user?.id
  if (!uid) return ''
  const { data: p } = await supabase.from('profiles').select('full_name, initials').eq('id', uid).maybeSingle<{ full_name: string | null; initials: string | null }>()
  return p?.full_name || p?.initials || ''
}

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** Pobiera komplet teczki zlecenia, składa ZIP i zapisuje go na dysku. */
export async function exportOrderDossierZip(orderId: number, onProgress?: (msg: string) => void): Promise<DossierExportResult> {
  onProgress?.('Wczytuję zlecenie…')
  const traceRes = await loadAluOrderTrace(orderId)
  if (!traceRes.ok) return { ok: false, error: traceRes.error }
  const trace = traceRes.value

  const docs = sortDocumentsForExport(trace.documents)
  const names = dossierEntryNames(docs)
  const bucket = supabase.storage.from(ORDER_DOCUMENTS_BUCKET)
  const entries: ZipEntry[] = []
  const failed = new Set<number>()

  for (let i = 0; i < docs.length; i++) {
    onProgress?.(`Pobieram ${i + 1}/${docs.length}: ${docs[i].file_name}`)
    const { data, error } = await bucket.download(docs[i].storage_path)
    if (error || !data) {
      failed.add(docs[i].id)
      continue
    }
    entries.push({ name: names[i], data: new Uint8Array(await data.arrayBuffer()), date: new Date(docs[i].uploaded_at) })
  }

  onProgress?.('Składam spis treści…')
  const exportedAt = new Date()
  const toc = buildDossierTocDefinition({
    trace,
    docs,
    entryNames: names,
    failed,
    exportedAt,
    exportedBy: await currentUserName(),
    appVersion: __APP_VERSION__,
  })
  const tocBlob = await pdfMakeRuntime.createPdf(toc).getBlob()
  entries.unshift({ name: '00_Spis_tresci.pdf', data: new Uint8Array(await tocBlob.arrayBuffer()), date: exportedAt })

  const fileName = dossierZipName(trace.order.order_number, exportedAt)
  saveBlob(buildZipBlob(entries), fileName)
  return { ok: true, fileName, files: entries.length - 1, failed: failed.size }
}
