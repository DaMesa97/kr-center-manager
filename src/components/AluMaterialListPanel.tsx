import { useEffect, useRef, useState } from 'react'
import { appAlert, appConfirm } from '../lib/appDialogs'
import { currentDocument } from '../lib/aluDossier'
import type { AluMaterialListParseResult } from '../lib/aluMaterialListParser'
import type { AluMaterialList, AluMaterialListItemRow, Order, OrderDocument } from '../types'

// Lista materiałowa zlecenia (Aluron .xls) — zestawienie materiałowe w teczce
// (ZKP 5.9). Import = nowa wersja dokumentu LM z pozycjami; poprzednie zostają.

type ListData = { list: AluMaterialList; items: AluMaterialListItemRow[] }

type Props = {
  order: Order
  documents: OrderDocument[]
  canImport: boolean
  onOpenDocument: (doc: OrderDocument) => void
  onImport: (file: File, parsed: AluMaterialListParseResult) => Promise<boolean>
  fetchList: (documentId: number) => Promise<ListData | null>
}

const fmtNum = (n: number | null) => (n == null ? '' : n.toLocaleString('pl-PL', { maximumFractionDigits: 3 }))
const fmtPln = (n: number | null) =>
  n == null ? '—' : n.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' zł'

export default function AluMaterialListPanel({ order, documents, canImport, onOpenDocument, onImport, fetchList }: Props) {
  const lm = currentDocument(documents, 'LM')
  const [expanded, setExpanded] = useState(false)
  const [data, setData] = useState<ListData | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const lmId = lm?.id
  useEffect(() => {
    setData(null)
    if (!expanded || lmId == null) return
    let alive = true
    void fetchList(lmId).then((d) => {
      if (alive) setData(d)
    })
    return () => {
      alive = false
    }
  }, [expanded, lmId, fetchList])

  const onFilePicked = async (file: File | null) => {
    if (fileRef.current) fileRef.current.value = ''
    if (!file) return
    if (!/\.xlsx?$/i.test(file.name)) {
      await appAlert('Wybierz plik .xls lub .xlsx z listą materiałową z programu Aluron.')
      return
    }
    setBusy(true)
    try {
      // SheetJS ładowany dopiero przy imporcie (osobny chunk)
      const { readMaterialListRows, parseAluMaterialListRows, sameAluOrderNumber } = await import('../lib/aluMaterialListParser')
      let parsed: AluMaterialListParseResult
      try {
        parsed = parseAluMaterialListRows(readMaterialListRows(await file.arrayBuffer()))
      } catch (e) {
        await appAlert(`Nie udało się odczytać pliku ${file.name}: ${e instanceof Error ? e.message : String(e)}`)
        return
      }
      if (parsed.items.length === 0) {
        await appAlert(`W pliku ${file.name} nie znaleziono pozycji listy materiałowej.\n${parsed.warnings.join('\n')}`)
        return
      }
      const groups = new Set(parsed.items.map((i) => i.group)).size
      const lines = [
        `Zlecenie w pliku: ${parsed.order_number || '—'}${parsed.created_at ? ` (utworzono ${parsed.created_at})` : ''}`,
        `${parsed.items.length} pozycji w ${groups} grupach · wartość materiału ${fmtPln(parsed.total_value)}`,
      ]
      if (!sameAluOrderNumber(parsed.order_number, order.order_number)) {
        lines.push(`⚠ Numer zlecenia w pliku różni się od ${order.order_number}!`)
      }
      lines.push(...parsed.warnings.map((w) => `⚠ ${w}`))
      if (lm) lines.push(`Obecna lista v${lm.version} zostanie w teczce jako poprzednia wersja.`)
      const ok = await appConfirm(lines.join('\n'), { title: 'Import listy materiałowej', confirmLabel: 'Importuj' })
      if (ok && (await onImport(file, parsed))) setExpanded(true)
    } finally {
      setBusy(false)
    }
  }

  let lastGroup: string | null = null

  return (
    <div className="alu-material-list">
      <div className="alu-docs-row" style={{ flexWrap: 'wrap' }}>
        <span className="alu-details-label">Lista materiałowa</span>
        {lm ? (
          <>
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => setExpanded((v) => !v)}>
              {expanded ? '▾ Ukryj pozycje' : '▸ Pokaż pozycje'}
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => onOpenDocument(lm)} title={lm.file_name}>
              Plik v{lm.version}{lm.number ? ` (${lm.number})` : ''}
            </button>
          </>
        ) : (
          <span className="alu-doc-missing">brak listy materiałowej</span>
        )}
        {canImport && (
          <>
            <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => fileRef.current?.click()}>
              {busy ? 'Wczytuję…' : lm ? 'Nowa wersja listy (.xls)' : '+ Importuj listę materiałową (.xls)'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              style={{ display: 'none' }}
              onChange={(e) => void onFilePicked(e.target.files?.[0] ?? null)}
            />
          </>
        )}
      </div>

      {expanded && lm && !data && <div className="alu-doc-missing">Wczytuję pozycje…</div>}
      {expanded && data && (
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Kod elementu</th>
                <th>Opis</th>
                <th style={{ textAlign: 'right' }}>Ilość</th>
                <th>J.m.</th>
                <th style={{ textAlign: 'right' }} title="Zapotrzebowanie bez odpadów">Potrzeba netto</th>
              </tr>
            </thead>
            <tbody>
              {data.items.flatMap((it) => {
                const rows = []
                if (it.group_name !== lastGroup) {
                  lastGroup = it.group_name
                  rows.push(
                    <tr key={`g-${it.id}`}>
                      <td colSpan={5}><strong>{it.group_name || 'Bez grupy'}</strong></td>
                    </tr>,
                  )
                }
                rows.push(
                  <tr key={it.id}>
                    <td>{it.code}</td>
                    <td>{it.description}</td>
                    <td style={{ textAlign: 'right' }}>{fmtNum(it.quantity)}</td>
                    <td>{it.unit}</td>
                    <td style={{ textAlign: 'right' }}>{fmtNum(it.need_net)}</td>
                  </tr>,
                )
                return rows
              })}
            </tbody>
          </table>
          <div className="alu-doc-missing" style={{ marginTop: 4 }}>
            {data.list.source_order_number} · {data.list.item_count} pozycji · wartość materiału {fmtPln(data.list.total_value)} ·
            zaimportowano {new Date(data.list.imported_at).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })}
            {data.list.imported_by_name ? ` · ${data.list.imported_by_name}` : ''}
          </div>
        </div>
      )}
    </div>
  )
}
