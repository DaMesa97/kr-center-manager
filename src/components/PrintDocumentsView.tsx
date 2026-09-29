import { appConfirm } from '../lib/appDialogs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Printer, Plus, Trash2, Upload } from 'lucide-react'
import { supabase } from '../supabaseClient'
import type { DopDocument } from '../lib/dopMatch'
import { renderPdfForPrint, uint8ToBase64 } from '../lib/pdfPrint'
import type { CurrentUser, ToastVariant } from '../types'

type Props = {
  isManager: boolean
  currentUser: CurrentUser | null
  pushToast: (message: string, variant: ToastVariant) => void
}

type PrintDocument = DopDocument
type WinPrinter = { name: string; displayName?: string; isDefault?: boolean }

const CATEGORIES = ['STA', 'Disting', 'ST', 'Techniczne', 'Bastion', 'DrzwiWewnetrzne'] as const
const CAT_LABEL: Record<string, string> = {
  STA: 'STA', Disting: 'Disting', ST: 'ST', Techniczne: 'Techniczne', Bastion: 'Bastion', DrzwiWewnetrzne: 'Wewnętrzne',
}
const PRINTER_LS_KEY = 'labelPrinterName'

type IpcLike = { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> }
function getIpc(): IpcLike | undefined {
  return (window as Window & { ipcRenderer?: IpcLike }).ipcRenderer
}

export default function PrintDocumentsView({ isManager, pushToast }: Props) {
  const [documents, setDocuments] = useState<PrintDocument[]>([])
  const [printers, setPrinters] = useState<WinPrinter[]>([])
  const [printerName, setPrinterName] = useState('')
  const [category, setCategory] = useState<string>('STA')
  const [loading, setLoading] = useState(true)
  const [printingId, setPrintingId] = useState<number | null>(null)
  const [copies, setCopies] = useState<Record<number, number>>({})
  const [packagePrinting, setPackagePrinting] = useState(false)
  const mountedRef = useRef(true)
  const fileRef = useRef<HTMLInputElement>(null)

  // formularz nowego dokumentu
  const [addOpen, setAddOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newZpl, setNewZpl] = useState('')
  // deklaracja w PDF: base64 + rozmiar do podglądu (alternatywa dla ZPL)
  const [newPdfB64, setNewPdfB64] = useState('')
  const [newPdfInfo, setNewPdfInfo] = useState('')
  const [newSystem, setNewSystem] = useState('')
  const [newWykonawca, setNewWykonawca] = useState('')
  const [newGlazing, setNewGlazing] = useState('')
  const [newFrameKind, setNewFrameKind] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const ipc = getIpc()
    const [docsRes, winList] = await Promise.all([
      supabase.from('print_documents').select('*').order('category').order('name'),
      ipc ? (ipc.invoke('printers:list') as Promise<WinPrinter[]>) : Promise.resolve([]),
    ])
    if (!mountedRef.current) return
    setLoading(false)
    setDocuments((docsRes.data ?? []) as PrintDocument[])
    const prns = (winList ?? []) as WinPrinter[]
    setPrinters(prns)
    setPrinterName((prev) => {
      if (prev && prns.some((p) => p.name === prev)) return prev
      const saved = localStorage.getItem(PRINTER_LS_KEY)
      return (saved && prns.some((p) => p.name === saved) && saved) || prns.find((p) => p.isDefault)?.name || prns[0]?.name || ''
    })
  }, [])

  useEffect(() => {
    mountedRef.current = true
    void load()
    return () => { mountedRef.current = false }
  }, [load])

  const docsForCat = useMemo(
    () => documents.filter((d) => d.category === category),
    [documents, category],
  )

  const printZplRaw = async (zpl: string, n: number): Promise<{ success: boolean; error?: string }> => {
    const ipc = getIpc()
    if (!ipc) return { success: false, error: 'Druk dostępny tylko w aplikacji desktop' }
    return (await ipc.invoke('label:printRaw', { deviceName: printerName, zpl, copies: n })) as { success: boolean; error?: string }
  }

  // Dokument PDF: pdfjs renderuje strony → druk jak etykieta (label:printHtml)
  const printPdfDoc = async (doc: PrintDocument, n: number): Promise<{ success: boolean; error?: string }> => {
    const ipc = getIpc()
    if (!ipc) return { success: false, error: 'Druk dostępny tylko w aplikacji desktop' }
    if (!doc.pdf_base64) return { success: false, error: 'Dokument nie ma zapisanego PDF-a' }
    try {
      const { html, widthMm, heightMm } = await renderPdfForPrint(doc.pdf_base64, doc.name)
      return (await ipc.invoke('label:printHtml', {
        html, deviceName: printerName, copies: n, widthMm, heightMm,
      })) as { success: boolean; error?: string }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  }

  const printDoc = async (doc: PrintDocument, n: number) =>
    doc.doc_type === 'pdf' ? printPdfDoc(doc, n) : printZplRaw(doc.zpl_content ?? '', n)

  const handlePrint = async (doc: PrintDocument) => {
    if (!printerName) { pushToast('Wybierz drukarkę', 'error'); return }
    const n = Math.max(1, Number(copies[doc.id]) || 1)
    localStorage.setItem(PRINTER_LS_KEY, printerName)
    setPrintingId(doc.id)
    try {
      const res = await printDoc(doc, n)
      if (res?.success) pushToast(`Wysłano ${n} szt. „${doc.name}" na ${printerName}`, 'success')
      else pushToast(`Błąd druku: ${res?.error ?? 'nieznany'}`, 'error')
    } finally {
      if (mountedRef.current) setPrintingId(null)
    }
  }

  const handlePrintPackage = async () => {
    if (!printerName) { pushToast('Wybierz drukarkę', 'error'); return }
    if (docsForCat.length === 0) { pushToast('Brak dokumentów w tej kategorii', 'error'); return }
    localStorage.setItem(PRINTER_LS_KEY, printerName)
    setPackagePrinting(true)
    let ok = 0
    let failed = 0
    try {
      for (const doc of docsForCat) {
        const n = Math.max(1, Number(copies[doc.id]) || 1)
        try {
          const res = await printDoc(doc, n)
          if (res?.success) ok++
          else failed++
        } catch { failed++ }
      }
      pushToast(`Paczka: wydrukowano ${ok}${failed ? `, błędów ${failed}` : ''}`, failed ? 'error' : 'success')
    } finally {
      if (mountedRef.current) setPackagePrinting(false)
    }
  }

  const handleAddDocument = async () => {
    const name = newName.trim()
    const zpl = newZpl.trim()
    const isPdf = !!newPdfB64
    if (!name || (!zpl && !isPdf)) {
      pushToast('Podaj nazwę i treść ZPL albo wgraj PDF', 'error')
      return
    }
    setSaving(true)
    try {
      const { error } = await supabase.from('print_documents').insert([
        {
          category, name,
          doc_type: isPdf ? 'pdf' : 'zpl',
          zpl_content: isPdf ? null : zpl,
          pdf_base64: isPdf ? newPdfB64 : null,
          system: newSystem.trim() || null,
          wykonawca: newWykonawca || null,
          glazing_type: newGlazing || null,
          frame_kind: newFrameKind || null,
        },
      ])
      if (error) { pushToast(`Błąd: ${error.message}`, 'error'); return }
      pushToast('Dokument dodany', 'success')
      setAddOpen(false); setNewName(''); setNewZpl(''); setNewPdfB64(''); setNewPdfInfo(''); setNewSystem(''); setNewWykonawca(''); setNewGlazing(''); setNewFrameKind('')
      await load()
    } finally {
      if (mountedRef.current) setSaving(false)
    }
  }

  const handleFile = (file: File | undefined) => {
    if (!file) return
    const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf'
    const reader = new FileReader()
    reader.onload = () => {
      if (isPdf) {
        const bytes = new Uint8Array(reader.result as ArrayBuffer)
        setNewPdfB64(uint8ToBase64(bytes))
        setNewPdfInfo(`${file.name} · ${(bytes.length / 1024).toFixed(0)} KB`)
        setNewZpl('')
      } else {
        setNewZpl(String(reader.result ?? ''))
        setNewPdfB64('')
        setNewPdfInfo('')
      }
      if (!newName.trim()) setNewName(file.name.replace(/\.(zpl|prn|txt|pdf)$/i, ''))
    }
    if (isPdf) reader.readAsArrayBuffer(file)
    else reader.readAsText(file)
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleDeleteDocument = async (doc: PrintDocument) => {
    if (!(await appConfirm(`Usunąć dokument „${doc.name}"?`))) return
    const { error } = await supabase.from('print_documents').delete().eq('id', doc.id)
    if (error) { pushToast(`Błąd: ${error.message}`, 'error'); return }
    pushToast('Usunięto', 'success')
    await load()
  }

  return (
    <div className="print-docs-view">
      <div className="orders-filters" style={{ marginBottom: 12, alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <label className="movements-view-filter">
          <span className="movements-view-filter-label">Drukarka</span>
          <select className="day-filter" value={printerName} onChange={(e) => setPrinterName(e.target.value)}>
            <option value="">— wybierz —</option>
            {printers.map((p) => (
              <option key={p.name} value={p.name}>{p.displayName || p.name}{p.isDefault ? ' (domyślna)' : ''}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="components-filter-pills">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            className={`alerts-filter-pill ${category === c ? 'alerts-filter-pill--active' : ''}`}
            onClick={() => setCategory(c)}
          >
            {CAT_LABEL[c]}
          </button>
        ))}
      </div>

      <div style={{ margin: '12px 0', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {docsForCat.length > 0 && (
          <button
            type="button"
            className="btn btn-sm btn-success"
            disabled={packagePrinting || !printerName}
            onClick={() => void handlePrintPackage()}
            title="Drukuj wszystkie dokumenty tej kategorii naraz"
          >
            <Printer size={14} /> {packagePrinting ? 'Drukuję paczkę…' : `Drukuj paczkę (${docsForCat.length})`}
          </button>
        )}
        {isManager && (
          <button type="button" className="btn btn-sm btn-primary" onClick={() => setAddOpen((v) => !v)}>
            <Plus size={14} /> Dodaj dokument ({CAT_LABEL[category]})
          </button>
        )}
      </div>

      {isManager && addOpen && (
        <div className="print-docs-add">
          <input type="text" placeholder="Nazwa dokumentu (np. DoP STA 90)" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <input type="text" placeholder="System (puste = dowolny, np. NORMAL PLUS)" value={newSystem} onChange={(e) => setNewSystem(e.target.value)} />
          <div className="print-docs-dwu-attrs">
            <select value={newWykonawca} onChange={(e) => setNewWykonawca(e.target.value)} title="Realizator">
              <option value="">Realizator: dowolny</option>
              <option value="Center">Center</option>
              <option value="Profil">Profil</option>
              <option value="WZ">WZ</option>
            </select>
            <select value={newGlazing} onChange={(e) => setNewGlazing(e.target.value)} title="Szklone / pełne">
              <option value="">Szklenie: dowolne</option>
              <option value="szklone">Szklone</option>
              <option value="pelne">Pełne</option>
            </select>
            {/* rodzaj ościeżnicy to kryterium TYLKO dla Bastiona — w innych
                kategoriach mylił (pytanie Tymka: "skąd to w STA?") */}
            {category === 'Bastion' && (
              <select value={newFrameKind} onChange={(e) => setNewFrameKind(e.target.value)} title="Rodzaj ościeżnicy (Bastion)">
                <option value="">Ościeżnica: dowolna</option>
                <option value="stalowa">Stalowa</option>
                <option value="drewniana">Drewniana</option>
              </select>
            )}
          </div>
          <div className="print-docs-add-zpl">
            {newPdfB64 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8 }}>
                <span>📄 PDF gotowy: <strong>{newPdfInfo}</strong></span>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setNewPdfB64(''); setNewPdfInfo('') }}>
                  Usuń
                </button>
              </div>
            ) : (
              <textarea
                placeholder="Wklej treść ZPL (^XA…^XZ) albo wgraj plik .zpl / .pdf"
                value={newZpl}
                onChange={(e) => setNewZpl(e.target.value)}
                rows={6}
              />
            )}
            <div className="print-docs-add-actions">
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => fileRef.current?.click()}>
                <Upload size={14} /> Wgraj plik .zpl / .pdf
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".zpl,.prn,.txt,.pdf,application/pdf"
                style={{ display: 'none' }}
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
              <button type="button" className="btn btn-sm btn-success" disabled={saving} onClick={() => void handleAddDocument()}>
                {saving ? 'Zapisywanie…' : 'Zapisz dokument'}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <p className="no-results">Ładowanie…</p>
      ) : docsForCat.length === 0 ? (
        <p className="no-results">Brak dokumentów dla kategorii {CAT_LABEL[category]}.</p>
      ) : (
        <div className="print-docs-list">
          {docsForCat.map((doc) => (
            <div key={doc.id} className="print-docs-row">
              <span className="print-docs-name">
                {doc.name}
                <span
                  className="print-docs-system-badge"
                  style={doc.doc_type === 'pdf' ? { background: '#dbeafe', color: '#1d4ed8' } : undefined}
                >
                  {doc.doc_type === 'pdf' ? 'PDF' : 'ZPL'}
                </span>
                {doc.system && doc.system.trim() ? <span className="print-docs-system-badge">{doc.system}</span> : null}
                {doc.wykonawca ? <span className="print-docs-system-badge">{doc.wykonawca}</span> : null}
                {doc.glazing_type ? <span className="print-docs-system-badge">{doc.glazing_type === 'pelne' ? 'pełne' : 'szklone'}</span> : null}
                {doc.frame_kind ? <span className="print-docs-system-badge">ośc. {doc.frame_kind}</span> : null}
              </span>
              <div className="print-docs-actions">
                <input
                  type="number"
                  min={1}
                  className="print-docs-copies"
                  value={copies[doc.id] ?? 1}
                  onChange={(e) => setCopies((p) => ({ ...p, [doc.id]: Math.max(1, Number(e.target.value) || 1) }))}
                  title="Liczba kopii"
                />
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  disabled={printingId === doc.id || !printerName}
                  onClick={() => void handlePrint(doc)}
                >
                  <Printer size={14} /> {printingId === doc.id ? 'Drukuję…' : 'Drukuj'}
                </button>
                {isManager && (
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => void handleDeleteDocument(doc)}>
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
