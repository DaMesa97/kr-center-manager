import pdfMake from 'pdfmake/build/pdfmake'
import type { TDocumentDefinitions } from 'pdfmake/interfaces'
import pdfFonts from 'pdfmake/build/vfs_fonts'
import { supabase } from '../supabaseClient'
import { ORDER_DOCUMENTS_BUCKET } from '../constants'
import { loadAluOrderTrace, type AluOrderTrace } from '../lib/aluTraceData'
import {
  buildDossierTocDefinition,
  dossierEntryNames,
  dossierZipName,
  sortDocumentsForExport,
  zkpGeneratedEntryName,
  type ZkpGeneratedDoc,
} from '../lib/dossierExport'
import { buildZipBlob, type ZipEntry } from '../lib/zipStore'
import { buildProductCardDefinition } from '../lib/zkpPrint'
import { buildDeclarationDefinition, buildProtocolDefinition } from '../lib/zkpPrintDocs'
import type { ZkpMaterialLot } from '../lib/zkp'
import type {
  ZkpCardCheck,
  ZkpFillingRecord,
  ZkpHardwareRecord,
  ZkpProductCard,
  ZkpRange,
  ZkpStageRecord,
} from '../lib/zkpCard'
import type { ZkpDeclaration, ZkpTestProtocol } from '../lib/zkpProtocol'

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

  // D61: karty wyrobu, protokoły 6.17.5 i deklaracje 6.9 z danych programu (zlecenia ZKP)
  let generated: ZkpGeneratedDoc[] | undefined
  if (trace.isZkp) {
    const gen = await buildZkpGeneratedEntries(trace, onProgress)
    if (gen) {
      generated = gen.docs
      entries.push(...gen.entries)
    }
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
    generated,
  })
  const tocBlob = await pdfMakeRuntime.createPdf(toc).getBlob()
  entries.unshift({ name: '00_Spis_tresci.pdf', data: new Uint8Array(await tocBlob.arrayBuffer()), date: exportedAt })

  const fileName = dossierZipName(trace.order.order_number, exportedAt)
  saveBlob(buildZipBlob(entries), fileName)
  const genFailed = generated?.filter((g) => g.failed).length ?? 0
  return { ok: true, fileName, files: entries.length - 1, failed: failed.size + genFailed }
}

async function pdfBytes(def: TDocumentDefinitions): Promise<Uint8Array> {
  const blob = await pdfMakeRuntime.createPdf(def).getBlob()
  return new Uint8Array(await blob.arrayBuffer())
}

/**
 * D61: PDF karty wyrobu (6.25) i protokołów 6.17.5 każdej AKTYWNEJ konstrukcji z kartą oraz deklaracji 6.9
 * zlecenia (wydane i wycofane — z oznaczeniem). Dane składane jak w oknie karty (useZkpCard).
 * Błąd odczytu → null (paczka bez tej części, jak dotąd); błąd jednego PDF → wiersz „NIE WYGENEROWANO”.
 */
async function buildZkpGeneratedEntries(
  trace: AluOrderTrace,
  onProgress?: (msg: string) => void,
): Promise<{ docs: ZkpGeneratedDoc[]; entries: ZipEntry[] } | null> {
  const orderId = trace.order.id
  if (orderId == null) return null
  onProgress?.('Wczytuję karty wyrobu i deklaracje…')
  const active = trace.constructions.filter((c) => c.status === 'aktywna').sort((a, b) => a.pp - b.pp)
  const activeById = new Map(active.map((c) => [c.id, c]))

  const [cardsRes, declRes, rangesRes] = await Promise.all([
    supabase.from('zkp_product_cards').select('*').eq('order_id', orderId),
    supabase.from('zkp_declarations').select('*').eq('order_id', orderId).order('id'),
    supabase.from('zkp_ranges').select('*').order('sort'),
  ])
  const firstErr = cardsRes.error ?? declRes.error ?? rangesRes.error
  if (firstErr) {
    console.error('dossier export: karty/deklaracje', firstErr)
    return null
  }
  const cards = ((cardsRes.data ?? []) as ZkpProductCard[])
    .filter((c) => activeById.has(c.construction_id))
    .sort((a, b) => (activeById.get(a.construction_id)?.pp ?? 0) - (activeById.get(b.construction_id)?.pp ?? 0))
  const declarations = (declRes.data ?? []) as ZkpDeclaration[]
  const ranges = (rangesRes.data ?? []) as ZkpRange[]
  const cardIds = cards.map((c) => c.id)

  let stages: ZkpStageRecord[] = []
  let hardware: ZkpHardwareRecord[] = []
  let fillings: ZkpFillingRecord[] = []
  let protocols: ZkpTestProtocol[] = []
  if (cardIds.length) {
    const [st, hw, fl, pt] = await Promise.all([
      supabase.from('zkp_card_stage_records').select('*').in('card_id', cardIds).order('id'),
      supabase.from('zkp_card_hardware').select('*').in('card_id', cardIds).order('id'),
      supabase.from('zkp_card_fillings').select('*').in('card_id', cardIds).order('id'),
      supabase.from('zkp_test_protocols').select('*').in('card_id', cardIds).order('attempt'),
    ])
    const err = st.error ?? hw.error ?? fl.error ?? pt.error
    if (err) {
      console.error('dossier export: zapisy kart', err)
      return null
    }
    stages = (st.data ?? []) as ZkpStageRecord[]
    hardware = (hw.data ?? []) as ZkpHardwareRecord[]
    fillings = (fl.data ?? []) as ZkpFillingRecord[]
    protocols = (pt.data ?? []) as ZkpTestProtocol[]
  }
  const lotIds = [...new Set([...stages, ...hardware, ...fillings].map((r) => r.lot_id).filter((id): id is number => id != null))]
  let lots: ZkpMaterialLot[] = []
  if (lotIds.length) {
    const { data, error } = await supabase.from('zkp_material_lots').select('*').in('id', lotIds)
    if (error) console.error('dossier export: partie', error)
    lots = (data ?? []) as ZkpMaterialLot[]
  }

  const docs: ZkpGeneratedDoc[] = []
  const entries: ZipEntry[] = []
  const now = new Date()
  const target = (constructionNo: string) => ({ constructionNo, orderNumber: trace.order.order_number, company: trace.order.company ?? '' })
  const add = async (doc: ZkpGeneratedDoc, build: () => TDocumentDefinitions, date: Date) => {
    try {
      entries.push({ name: doc.name, data: await pdfBytes(build()), date })
      docs.push(doc)
    } catch (e) {
      console.error('dossier export: PDF', doc.name, e)
      docs.push({ ...doc, failed: true })
    }
  }

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i]
    const con = activeById.get(card.construction_id)!
    onProgress?.(`Karta wyrobu ${i + 1}/${cards.length}: ${con.construction_no}`)
    const checksRes = await supabase.rpc('zkp_card_checks', { p_card_id: card.id })
    const range = ranges.find((r) => r.code === card.range_code) ?? null
    const state = card.decision === 'zwolniony' ? 'ZWOLNIONY' : card.decision === 'niezgodny' ? 'NIEZGODNY' : card.range_confirmed_at ? 'w produkcji' : 'szkic'
    await add(
      { kind: 'karta', name: zkpGeneratedEntryName('karta', con.construction_no), ident: con.construction_no, state },
      () =>
        buildProductCardDefinition({
          target: target(con.construction_no),
          data: {
            card,
            checks: (checksRes.data ?? []) as ZkpCardCheck[],
            stages: stages.filter((s) => s.card_id === card.id),
            hardware: hardware.filter((h) => h.card_id === card.id),
            fillings: fillings.filter((f) => f.card_id === card.id),
          },
          range,
          lots,
          components: [],
          printedAt: now,
        }),
      new Date(card.decided_at ?? card.range_confirmed_at ?? now),
    )
    for (const p of protocols.filter((x) => x.card_id === card.id)) {
      const pState = p.decision === 'zwolniony' ? 'ZWOLNIONY' : p.decision === 'wstrzymany' ? 'wstrzymany' : 'otwarty (w toku)'
      await add(
        {
          kind: 'protokol',
          name: zkpGeneratedEntryName('protokol', p.protocol_no, p.decision ? '' : 'OTWARTY'),
          ident: p.protocol_no,
          state: `${con.construction_no} · ${pState}`,
        },
        () =>
          buildProtocolDefinition({
            protocol: p,
            card,
            range,
            constructionNo: con.construction_no,
            orderNumber: trace.order.order_number,
            company: trace.order.company ?? '',
            printedAt: now,
          }),
        new Date(p.closed_at ?? p.updated_at ?? now),
      )
    }
  }

  const noById = new Map(trace.constructions.map((c) => [c.id, c]))
  for (const d of declarations) {
    onProgress?.(`Deklaracja ${d.number}`)
    const withdrawn = d.status === 'wycofana'
    const nos = d.construction_ids
      .map((id) => noById.get(id))
      .filter((c): c is NonNullable<typeof c> => !!c)
      .sort((a, b) => a.pp - b.pp)
      .map((c) => c.construction_no)
    await add(
      {
        kind: 'deklaracja',
        name: zkpGeneratedEntryName('deklaracja', d.number, withdrawn ? 'WYCOFANA' : ''),
        ident: d.number,
        state: withdrawn ? `wycofana: ${d.withdraw_reason ?? ''}`.trim() : `wydana ${d.issued_on}`,
      },
      () => buildDeclarationDefinition({ declaration: d, orderNumber: trace.order.order_number, constructionNos: nos, printedAt: now }),
      new Date(d.created_at ?? now),
    )
  }
  return { docs, entries }
}
