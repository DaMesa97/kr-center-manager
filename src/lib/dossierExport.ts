import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces'
import { ALU_REALIZACJA_LABELS } from '../constants'
import { aluOrderExtra, formatAluDims, formatPlDateWithDow } from './alu'
import { formatProductionOrderNo } from './aluConstructions'
import { DOC_KIND_LABELS } from './aluDossier'
import { isReleaseDateEmpty } from '../utils'
import type { AluOrderTrace } from './aluTraceData'
import type { OrderDocument, OrderDocumentKind } from '../types'

// Eksport teczki zlecenia dla audytora (ZKP 5.9, zał. 6.34): jedna paczka ZIP
// = spis treści (PDF) + WSZYSTKIE wersje dokumentów, także wycofane (z oznaczeniem).
// Tu część „czysta" (nazwy plików, kolejność, treść spisu) — pobieranie i zapis
// w utils/dossierExportZip.ts.

/** Kolejność rodzajów jak w tabeli teczki (alu_dossier_status). */
const KIND_ORDER: OrderDocumentKind[] = ['ZK', 'LC', 'LP', 'LM', 'ZM', 'ZMAT', 'MONT', 'INNE']

export function sortDocumentsForExport(docs: OrderDocument[]): OrderDocument[] {
  const rank = (k: OrderDocumentKind) => {
    const i = KIND_ORDER.indexOf(k)
    return i < 0 ? KIND_ORDER.length : i
  }
  return [...docs].sort((a, b) => rank(a.kind) - rank(b.kind) || (b.version ?? 1) - (a.version ?? 1) || b.id - a.id)
}

/** Znaki niedozwolone w nazwach plików Windows → „_"; polskie litery zostają. */
export function sanitizeFileName(name: string, max = 100): string {
  // eslint-disable-next-line no-control-regex
  const clean = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '')
  if (clean.length <= max) return clean || 'plik'
  const dot = clean.lastIndexOf('.')
  const ext = dot > 0 && clean.length - dot <= 6 ? clean.slice(dot) : ''
  return clean.slice(0, max - ext.length) + ext
}

/** Nazwy plików w paczce: `NN_RODZAJ_vX[_WYCOFANY]_nazwa` — NN = Lp. w spisie, więc unikalne. */
export function dossierEntryNames(docs: OrderDocument[]): string[] {
  return docs.map((d, i) => {
    const nn = String(i + 1).padStart(2, '0')
    return `dokumenty/${nn}_${d.kind}_v${d.version ?? 1}${d.withdrawn_at ? '_WYCOFANY' : ''}_${sanitizeFileName(d.file_name)}`
  })
}

export function dossierZipName(orderNumber: string, now = new Date()): string {
  const ymd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return `Teczka_${sanitizeFileName(orderNumber).replace(/[\s_]+/g, '-')}_${ymd}.zip`
}

/** Stan wersji dokumentu w spisie: bieżąca (najwyższa niewycofana) / archiwalna / wycofana. */
export function documentState(doc: OrderDocument, all: OrderDocument[]): string {
  if (doc.withdrawn_at) return `wycofana: ${doc.withdraw_reason ?? ''}`.trim()
  const newer = all.some((d) => d.kind === doc.kind && !d.withdrawn_at && (d.version ?? 1) > (doc.version ?? 1))
  return newer ? 'archiwalna' : 'bieżąca'
}

function fmt(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })
}

const STATUS_TEXT = { jest: 'jest', brak: 'BRAK', nie_dotyczy: 'nie dotyczy' } as const

export type TocInput = {
  trace: AluOrderTrace
  docs: OrderDocument[]
  entryNames: string[]
  /** id dokumentów, których pliku nie udało się pobrać */
  failed: Set<number>
  exportedAt: Date
  exportedBy: string
  appVersion: string
}

/** Spis treści paczki (pdfmake) — nagłówek zlecenia, stan teczki, konstrukcje, pliki. */
export function buildDossierTocDefinition(inp: TocInput): TDocumentDefinitions {
  const { trace, docs, entryNames, failed } = inp
  const { order, production, positions, constructions } = trace
  const extra = aluOrderExtra(order)
  const cancelled = (order.extra_fields as Record<string, unknown> | null)?.cancelled === true
  const status = cancelled ? 'Anulowane' : !isReleaseDateEmpty(order.release_date) ? `Wydane ${order.release_date}` : 'W realizacji'
  const posById = new Map(positions.map((p) => [p.id, p]))

  const info: Array<[string, string]> = [
    ['Klient', order.company || '—'],
    ['Nr zlecenia w roku (ZKP 5.9)', production
      ? `${formatProductionOrderNo(production.year, production.zz)} — uruchomione ${fmt(production.started_at)}${production.started_by_name ? `, ${production.started_by_name}` : ''}`
      : 'nieuruchomione do produkcji'],
    ['Lista produkcyjna', extra.lp_number || '—'],
    ['Termin', extra.deadline ? formatPlDateWithDow(extra.deadline) : '—'],
    ['Realizacja', ALU_REALIZACJA_LABELS[extra.realizacja] ?? extra.realizacja],
    ['Status', status],
    ['Podlega ZKP (AS 75EI)', trace.isZkp ? 'tak' : 'nie'],
  ]

  const th = (t: string) => ({ text: t, style: 'th' })
  const section = (t: string): Content => ({ text: t, style: 'h2' })

  const dossierRows = trace.dossier.map((i) => [
    String(i.r_sort),
    i.r_label,
    { text: STATUS_TEXT[i.r_status] ?? i.r_status, bold: i.r_status === 'brak', color: i.r_status === 'brak' ? '#b91c1c' : undefined },
    i.r_detail || '',
    [i.r_at ? fmt(i.r_at) : '', i.r_by ?? ''].filter(Boolean).join(' · '),
  ])

  const constructionRows = [...constructions]
    .sort((a, b) => a.pp - b.pp)
    .map((c) => {
      const p = c.position_id != null ? posById.get(c.position_id) : undefined
      const desc = p ? [p.description, p.system, formatAluDims(p.width_mm, p.height_mm)].filter(Boolean).join(' · ') : '(pozycja usunięta)'
      return [
        { text: c.construction_no, bold: true, decoration: c.status === 'anulowana' ? ('lineThrough' as const) : undefined },
        String(c.pos_no),
        String(c.piece_index),
        desc,
        c.status === 'anulowana' ? `anulowana: ${c.status_reason ?? ''}` : 'aktywna',
      ]
    })

  const fileRows = docs.map((d, i) => [
    String(i + 1),
    { text: entryNames[i], fontSize: 7 },
    `${DOC_KIND_LABELS[d.kind] ?? d.kind}${d.number ? `\n${d.number}` : ''}`,
    `v${d.version ?? 1}`,
    [d.uploaded_by_name, fmt(d.uploaded_at)].filter(Boolean).join('\n'),
    failed.has(d.id)
      ? { text: 'NIE POBRANO PLIKU', color: '#b91c1c', bold: true }
      : documentState(d, trace.documents),
  ])

  const content: Content[] = [
    { text: `Teczka zlecenia ${order.order_number}`, style: 'h1' },
    { text: trace.isZkp ? 'ZKP AS 75EI — teczka zlecenia (pkt 5.9), zapisy wg zał. 6.34' : 'Stolarka aluminiowa — dokumenty zlecenia', style: 'sub' },
    {
      table: { widths: [150, '*'], body: info.map(([k, v]) => [{ text: k, style: 'label' }, v]) },
      layout: 'noBorders',
      margin: [0, 0, 0, 8],
    },
  ]

  if (dossierRows.length) {
    content.push(section('1. Stan teczki'), {
      table: { headerRows: 1, widths: [16, 140, 50, '*', 90], body: [[th('Lp.'), th('Dokument'), th('Stan'), th('Szczegóły'), th('Kiedy / kto')], ...dossierRows] },
      layout: 'lightHorizontalLines',
    })
  }

  content.push(section(`2. Konstrukcje (numery RRRR/ZZ/PP) — ${constructions.length}`))
  content.push(
    constructionRows.length
      ? {
          table: { headerRows: 1, widths: [70, 28, 34, '*', 110], body: [[th('Nr konstrukcji'), th('Poz.'), th('Sztuka'), th('Pozycja'), th('Status')], ...constructionRows] },
          layout: 'lightHorizontalLines',
        }
      : { text: 'Zlecenie nieuruchomione — numery konstrukcji nie zostały jeszcze nadane.', italics: true },
  )

  content.push(section(`3. Pliki w paczce — ${docs.length}`))
  content.push(
    fileRows.length
      ? {
          table: { headerRows: 1, widths: [16, '*', 90, 22, 80, 70], body: [[th('Lp.'), th('Plik w paczce'), th('Rodzaj / nr'), th('Wer.'), th('Wgrał'), th('Stan')], ...fileRows] },
          layout: 'lightHorizontalLines',
        }
      : { text: 'Brak dokumentów w teczce.', italics: true },
  )
  content.push({
    text:
      'Wersje „archiwalne" i „wycofane" zostają w teczce (ZKP 5.1.6) — nowy plik nie nadpisuje poprzedniego, dokument można tylko wycofać z podaniem powodu. ' +
      'Dokumenty wypełniane na papierze (karta wyrobu 6.25, samokontrola 6.16.5, protokół badań 6.17.5, deklaracja, rejestr 6.33) są w teczce papierowej, dopóki program ich nie generuje.',
    style: 'note',
  })

  return {
    pageSize: 'A4',
    pageMargins: [32, 36, 32, 40],
    info: { title: `Teczka zlecenia ${order.order_number}` },
    content,
    footer: (page: number, pages: number) => ({
      columns: [
        { text: `Wygenerowano ${fmt(inp.exportedAt.toISOString())}${inp.exportedBy ? ` · ${inp.exportedBy}` : ''} · KR Center Manager v${inp.appVersion}`, fontSize: 7, color: '#64748b' },
        { text: `${page} / ${pages}`, alignment: 'right', fontSize: 7, color: '#64748b' },
      ],
      margin: [32, 12, 32, 0],
    }),
    styles: {
      h1: { fontSize: 16, bold: true },
      sub: { fontSize: 9, color: '#475569', margin: [0, 2, 0, 10] },
      h2: { fontSize: 11, bold: true, margin: [0, 12, 0, 4] },
      th: { bold: true, fontSize: 8, color: '#334155' },
      label: { color: '#64748b' },
      note: { fontSize: 7.5, color: '#64748b', italics: true, margin: [0, 10, 0, 0] },
    },
    defaultStyle: { font: 'Roboto', fontSize: 8.5 },
  }
}
