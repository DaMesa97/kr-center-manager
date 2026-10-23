import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { createPortal } from 'react-dom'
import DataTable, { type DataTableColumn } from './DataTable'
import { ALU_CONSTRUCTION_LABELS, ALU_REALIZACJA_LABELS } from '../constants'
import { defaultAluDeadline, formatAluGlass, formatAluNotes } from '../lib/alu'
import { extractPdfTextPages } from '../lib/pdfText'
import { parseAluDocument } from '../lib/aluLpParser'
import type {
  AluConstructionType, AluLcParseResult, AluLpParseResult, AluLpPosition, AluProductionNotes, AluRealizacja,
  OrderDocumentKind, ToastVariant,
} from '../types'

// Import zlecenia aluminium z PDF: lista produkcyjna (LP, wymagana) + lista cięcia
// (LC, opcjonalna — komplet). Sama LC dopina się do ISTNIEJĄCEGO zlecenia po numerze OF.
// Parser czyta tekst po współrzędnych; wszystko, co rozpoznał, jest tu do poprawki
// PRZED zapisem (AluronCAD generuje rozjechane PDF-y).

export type AluImportMode = 'check' | 'overwrite' | 'duplicate'
export type AluImportResult = { orderId: number; result: 'created' | 'overwritten' | 'exists'; orderNumber: string }
export type AluImportOpts = { company: string; deadline: string; realizacja: AluRealizacja; mode: AluImportMode }

type Props = {
  open: boolean
  companies: string[]
  /** numer OF zlecenia, dla którego wgrywamy nową wersję (z okna szczegółów) — podpowiedź */
  reimportOrderNumber?: string | null
  onClose: () => void
  onImport: (parsed: AluLpParseResult, opts: AluImportOpts) => Promise<AluImportResult | null>
  onUploadDocument: (orderId: number, kind: OrderDocumentKind, number: string | null, file: File) => Promise<boolean>
  onFindOrder: (orderNumber: string) => Promise<Array<{ id: number; order_number: string; company: string }>>
  onDone: (orderId: number) => void
  pushToast: (msg: string, variant: ToastVariant) => void
}

type Picked = { lp: File | null; lc: File | null }
type EditablePosition = AluLpPosition

const NOTE_FIELDS: Array<[keyof AluProductionNotes, string]> = [
  ['okucia', 'Okucia'],
  ['klamka', 'Klamka'],
  ['dodatki', 'Dodatki'],
  ['prog', 'Próg'],
  ['inne', 'Inne'],
]

async function parseFile(file: File) {
  const pages = await extractPdfTextPages(await file.arrayBuffer())
  return parseAluDocument(pages)
}

export default function AluImportModal({
  open, companies, reimportOrderNumber, onClose, onImport, onUploadDocument, onFindOrder, onDone, pushToast,
}: Props) {
  const [picked, setPicked] = useState<Picked>({ lp: null, lc: null })
  const [parsing, setParsing] = useState(false)
  const [lp, setLp] = useState<AluLpParseResult | null>(null)
  const [lc, setLc] = useState<AluLcParseResult | null>(null)
  const [orderNumber, setOrderNumber] = useState('')
  const [company, setCompany] = useState('')
  const [deadline, setDeadline] = useState(defaultAluDeadline())
  const [realizacja, setRealizacja] = useState<AluRealizacja>('wysylka')
  const [positions, setPositions] = useState<EditablePosition[]>([])
  const [notesOpen, setNotesOpen] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [existsPanel, setExistsPanel] = useState<AluImportResult | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setPicked({ lp: null, lc: null }); setLp(null); setLc(null); setPositions([]); setExistsPanel(null)
    setOrderNumber(''); setCompany(''); setDeadline(defaultAluDeadline()); setRealizacja('wysylka'); setNotesOpen(null)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving && !parsing) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, saving, parsing, onClose])

  // Rozpoznaj pliki po TREŚCI (nie po nazwie) — LP / LC w dowolnej kolejności
  const addFiles = async (files: File[]) => {
    const pdfs = files.filter((f) => /\.pdf$/i.test(f.name))
    if (pdfs.length === 0) {
      pushToast('Wgraj plik PDF (lista produkcyjna / lista cięcia z AluronCAD)', 'error')
      return
    }
    setParsing(true)
    try {
      for (const file of pdfs) {
        const parsed = await parseFile(file)
        if (!parsed) {
          pushToast(`${file.name}: to nie jest lista produkcyjna ani lista cięcia z AluronCAD`, 'error')
          continue
        }
        if (parsed.kind === 'LP') {
          setLp(parsed)
          setPicked((p) => ({ ...p, lp: file }))
          setOrderNumber(parsed.header.order_number)
          setPositions(parsed.positions.map((pos) => ({ ...pos, notes: { ...pos.notes }, glass: pos.glass.map((g) => ({ ...g })) })))
          if (parsed.header.client && !company) setCompany(parsed.header.client)
          if (parsed.warnings.length > 0) pushToast(`LP: ${parsed.warnings.length} uwag parsera — sprawdź podgląd`, 'info')
        } else {
          setLc(parsed)
          setPicked((p) => ({ ...p, lc: file }))
        }
      }
    } catch (err) {
      console.error('alu import parse:', err)
      pushToast(`Nie udało się odczytać PDF: ${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      setParsing(false)
    }
  }

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    void addFiles(Array.from(e.dataTransfer.files ?? []))
  }

  const updatePos = (idx: number, patch: Partial<EditablePosition>) =>
    setPositions((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)))
  const updateNote = (idx: number, key: keyof AluProductionNotes, value: string) =>
    setPositions((prev) => prev.map((p, i) => (i === idx ? { ...p, notes: { ...p.notes, [key]: value } } : p)))

  const lcMismatch = lp && lc && lc.order_number.trim() !== lp.header.order_number.trim()
  const problems = useMemo(() => {
    const out: string[] = []
    if (lp) {
      if (!orderNumber.trim()) out.push('Brak numeru zlecenia (OF).')
      if (!company.trim()) out.push('Wybierz firmę (klienta).')
      if (!deadline) out.push('Ustaw termin.')
      if (positions.length === 0) out.push('LP nie ma żadnej pozycji.')
      positions.forEach((p) => {
        if (!(Number(p.quantity) > 0)) out.push(`Poz. ${p.pos_no}: ilość musi być > 0.`)
        if (!p.width_mm || !p.height_mm) out.push(`Poz. ${p.pos_no}: brak wymiaru konstrukcji (S×W).`)
      })
      if (lcMismatch) out.push(`Lista cięcia jest do zlecenia ${lc?.order_number}, a LP do ${lp.header.order_number}.`)
    }
    return out
  }, [lp, lc, lcMismatch, orderNumber, company, deadline, positions])

  // Tylko LC bez LP → dopnij do istniejącego zlecenia
  const attachLcOnly = async () => {
    if (!lc || !picked.lc) return
    setSaving(true)
    try {
      const found = await onFindOrder(lc.order_number)
      if (found.length === 0) {
        pushToast(`Nie ma zlecenia ${lc.order_number} — najpierw wgraj listę produkcyjną (LP) tego zlecenia`, 'error')
        return
      }
      const target = found[0]
      const ok = await onUploadDocument(target.id, 'LC', lc.lc_number, picked.lc)
      if (ok) {
        pushToast(`Lista cięcia ${lc.lc_number} dopięta do zlecenia ${target.order_number}`, 'success')
        onDone(target.id)
        onClose()
      }
    } finally {
      setSaving(false)
    }
  }

  const save = async (mode: AluImportMode) => {
    if (!lp || !picked.lp) return
    if (mode === 'check' && problems.length > 0) {
      pushToast(problems[0], 'error')
      return
    }
    setSaving(true)
    try {
      const parsed: AluLpParseResult = {
        ...lp,
        header: { ...lp.header, order_number: orderNumber.trim(), client: company.trim() },
        positions: positions.map((p) => ({
          ...p,
          quantity: Math.max(1, Math.round(Number(p.quantity) || 1)),
          width_mm: p.width_mm ? Math.round(Number(p.width_mm)) : null,
          height_mm: p.height_mm ? Math.round(Number(p.height_mm)) : null,
        })),
      }
      const res = await onImport(parsed, { company: company.trim(), deadline, realizacja, mode })
      if (!res) return
      if (res.result === 'exists') {
        setExistsPanel(res)
        return
      }
      setExistsPanel(null)
      const lpOk = await onUploadDocument(res.orderId, 'LP', lp.header.lp_number, picked.lp)
      let lcOk = true
      if (lc && picked.lc && !lcMismatch) lcOk = await onUploadDocument(res.orderId, 'LC', lc.lc_number, picked.lc)
      pushToast(
        `${res.result === 'overwritten' ? 'Zaktualizowano' : 'Utworzono'} zlecenie ${res.orderNumber} (${parsed.positions.length} poz.)` +
          (lpOk && lcOk ? '' : ' — UWAGA: nie wszystkie PDF-y się wgrały, dodaj je w szczegółach'),
        lpOk && lcOk ? 'success' : 'error',
      )
      onDone(res.orderId)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const columns = useMemo<DataTableColumn<EditablePosition>[]>(
    () => [
      { key: 'pos_no', label: 'POZ.', className: 'col-order-text', sortValue: (p) => p.pos_no, render: (p) => p.pos_no },
      {
        key: 'type',
        label: 'TYP',
        className: 'col-order-text',
        stopRowClick: true,
        render: (p, i) => (
          <select value={p.construction_type} onChange={(e) => updatePos(i, { construction_type: e.target.value as AluConstructionType })}>
            {Object.entries(ALU_CONSTRUCTION_LABELS).map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
        ),
      },
      {
        key: 'description',
        label: 'OPIS',
        className: 'col-order-text alu-col-description',
        stopRowClick: true,
        render: (p, i) => <input value={p.description} onChange={(e) => updatePos(i, { description: e.target.value })} />,
      },
      {
        key: 'system',
        label: 'SYSTEM',
        className: 'col-order-text',
        stopRowClick: true,
        render: (p, i) => <input value={p.system} onChange={(e) => updatePos(i, { system: e.target.value })} style={{ width: 90 }} />,
      },
      {
        key: 'profile_color',
        label: 'KOLOR PROFILI',
        className: 'col-order-text',
        stopRowClick: true,
        render: (p, i) => <input value={p.profile_color} onChange={(e) => updatePos(i, { profile_color: e.target.value })} />,
      },
      {
        key: 'hardware_color',
        label: 'KOLOR OKUĆ',
        className: 'col-order-text',
        stopRowClick: true,
        render: (p, i) => <input value={p.hardware_color} onChange={(e) => updatePos(i, { hardware_color: e.target.value })} />,
      },
      {
        key: 'dims',
        label: 'S × W [mm]',
        className: 'col-order-text',
        stopRowClick: true,
        tdClassName: (p) => (!p.width_mm || !p.height_mm ? 'alu-cell--warn' : undefined),
        render: (p, i) => (
          <span className="alu-dims-edit">
            <input type="number" value={p.width_mm ?? ''} onChange={(e) => updatePos(i, { width_mm: e.target.value === '' ? null : Number(e.target.value) })} />
            ×
            <input type="number" value={p.height_mm ?? ''} onChange={(e) => updatePos(i, { height_mm: e.target.value === '' ? null : Number(e.target.value) })} />
          </span>
        ),
      },
      {
        key: 'quantity',
        label: 'ILOŚĆ',
        className: 'col-order-text',
        stopRowClick: true,
        render: (p, i) => (
          <input type="number" min={1} value={p.quantity} onChange={(e) => updatePos(i, { quantity: Number(e.target.value) })} style={{ width: 60 }} />
        ),
      },
      {
        key: 'glass',
        label: 'SZKŁO',
        className: 'col-order-text',
        tdTitle: (p) => formatAluGlass(p.glass) || undefined,
        render: (p) => formatAluGlass(p.glass) || <span className="alu-doc-missing">brak</span>,
      },
      {
        key: 'notes',
        label: 'UWAGI PRODUKCYJNE',
        className: 'col-order-text alu-col-description',
        stopRowClick: true,
        render: (p, i) => (
          <button type="button" className="alu-notes-toggle" onClick={() => setNotesOpen(notesOpen === i ? null : i)} title="Edytuj uwagi">
            {formatAluNotes(p.notes) || <span className="alu-doc-missing">brak — dodaj</span>}
          </button>
        ),
      },
      {
        key: 'warnings',
        label: '⚠',
        className: 'col-order-text',
        tdTitle: (p) => p.warnings.join('\n') || undefined,
        render: (p) => (p.warnings.length > 0 ? <span className="alu-warn-badge" title={p.warnings.join('\n')}>{p.warnings.length}</span> : ''),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [notesOpen],
  )

  if (!open) return null

  return createPortal(
    <div className="modal-overlay" onClick={() => !saving && !parsing && onClose()}>
      <div className="order-modal alu-import-modal" onClick={(e) => e.stopPropagation()}>
        <div className="order-modal-header">
          <h2>Wgraj listę produkcyjną{reimportOrderNumber ? ` — nowa wersja ${reimportOrderNumber}` : ''}</h2>
          <button className="btn btn-icon btn-ghost" onClick={onClose} disabled={saving || parsing} aria-label="Zamknij">×</button>
        </div>

        <div
          className={`alu-dropzone ${dragOver ? 'alu-dropzone--over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
        >
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => { void addFiles(Array.from(e.target.files ?? [])); e.target.value = '' }}
          />
          {parsing ? (
            <span>Czytam PDF…</span>
          ) : (
            <span>
              Przeciągnij tu PDF-y z AluronCAD (lista produkcyjna + lista cięcia) albo kliknij, żeby wybrać.
              <br />
              <small>Pliki rozpoznaję po treści, kolejność nie ma znaczenia.</small>
            </span>
          )}
          <div className="alu-dropzone-files">
            <span className={`alu-doc-chip ${picked.lp ? 'alu-doc-chip--on' : ''}`}>LP {picked.lp ? `✓ ${lp?.header.lp_number ?? picked.lp.name}` : '— brak'}</span>
            <span className={`alu-doc-chip ${picked.lc ? 'alu-doc-chip--on' : ''}`}>LC {picked.lc ? `✓ ${lc?.lc_number ?? picked.lc.name}` : '— brak (opcjonalnie)'}</span>
          </div>
        </div>

        {!lp && lc && (
          <div className="alu-import-info">
            Sama lista cięcia <strong>{lc.lc_number}</strong> dla zlecenia <strong>{lc.order_number}</strong> — dopnę ją do istniejącego zlecenia.
            <button type="button" className="btn btn-sm btn-primary" style={{ marginLeft: 10 }} disabled={saving} onClick={() => void attachLcOnly()}>
              {saving ? 'Wgrywam…' : `Dopnij do ${lc.order_number}`}
            </button>
          </div>
        )}

        {lp && (
          <>
            <div className="order-form-grid alu-import-header">
              <label>
                <span className="order-field-label-text">Nr zlecenia (OF)</span>
                <input value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} />
              </label>
              <label>
                <span className="order-field-label-text">Lista produkcyjna</span>
                <input readOnly className="input-readonly" value={`${lp.header.lp_number}${lp.header.created_at ? ` · ${new Date(lp.header.created_at).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })}` : ''}`} />
              </label>
              <label>
                <span className="order-field-label-text">Firma (klient) *</span>
                <input list="alu-companies-list" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="wybierz lub wpisz" />
                <datalist id="alu-companies-list">
                  {companies.map((c) => <option key={c} value={c} />)}
                </datalist>
              </label>
              <label>
                <span className="order-field-label-text">Termin *</span>
                <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
                <small className="alu-field-hint">domyślnie +4 tygodnie{lp.header.deadline_text ? ` · w LP: „${lp.header.deadline_text}”` : ''}</small>
              </label>
              <label>
                <span className="order-field-label-text">Realizacja</span>
                <select value={realizacja} onChange={(e) => setRealizacja(e.target.value as AluRealizacja)}>
                  {Object.entries(ALU_REALIZACJA_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </label>
              <label>
                <span className="order-field-label-text">Z LP</span>
                <input readOnly className="input-readonly" value={`${lp.header.positions_count ?? positions.length} poz. · ${lp.header.area_m2 ?? '?'} m² · ${lp.header.weight_kg ?? '?'} kg`} />
              </label>
            </div>

            {(lp.warnings.length > 0 || problems.length > 0) && (
              <ul className="alu-import-warnings">
                {problems.map((w) => <li key={`p-${w}`} className="alu-import-warnings__problem">{w}</li>)}
                {lp.warnings.map((w) => <li key={`w-${w}`}>{w}</li>)}
              </ul>
            )}

            <DataTable
              rows={positions}
              rowKey={(p) => p.pos_no}
              columns={columns}
              wrapperClassName="orders-table-wrapper alu-positions-wrapper"
              emptyText="Parser nie znalazł pozycji w tym PDF."
              renderAfterRow={(p, i) =>
                notesOpen === i ? (
                  <tr className="alu-notes-row">
                    <td colSpan={columns.length}>
                      <div className="alu-notes-grid">
                        {NOTE_FIELDS.map(([k, label]) => (
                          <label key={k}>
                            <span className="order-field-label-text">{label}</span>
                            <input value={p.notes[k] ?? ''} onChange={(e) => updateNote(i, k, e.target.value)} />
                          </label>
                        ))}
                      </div>
                    </td>
                  </tr>
                ) : null
              }
            />

            {existsPanel && (
              <div className="alu-exists-panel" role="alert">
                <div>
                  Zlecenie <strong>{existsPanel.orderNumber}</strong> już jest w programie. Co zrobić?
                </div>
                <div className="alu-exists-actions">
                  <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save('overwrite')}>
                    Nadpisz pozycje (oznaczone etapy zostają)
                  </button>
                  <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => void save('duplicate')}>
                    Dodaj ponownie jako osobne zlecenie
                  </button>
                  <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => setExistsPanel(null)}>
                    Anuluj
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        <div className="order-form-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving || parsing}>Anuluj</button>
          {lp && !existsPanel && (
            <button type="button" className="btn btn-success" disabled={saving || parsing || problems.length > 0} onClick={() => void save('check')} title={problems[0]}>
              {saving ? 'Zapisuję…' : `Zapisz zlecenie (${positions.length} poz.)`}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
