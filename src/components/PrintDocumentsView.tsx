import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Printer, Plus, Trash2, Upload } from 'lucide-react'
import { supabase } from '../supabaseClient'
import type { CurrentUser, ToastVariant } from '../types'

type Props = {
  isManager: boolean
  currentUser: CurrentUser | null
  pushToast: (message: string, variant: ToastVariant) => void
}

type PrintDocument = { id: number; category: string; name: string; zpl_content: string }
type LabelPrinter = { id: number; name: string; ip: string; port: number; is_default: boolean }

const CATEGORIES = ['STA', 'Disting', 'ST', 'Techniczne', 'Bastion', 'DrzwiWewnetrzne'] as const
const CAT_LABEL: Record<string, string> = {
  STA: 'STA', Disting: 'Disting', ST: 'ST', Techniczne: 'Techniczne', Bastion: 'Bastion', DrzwiWewnetrzne: 'Wewnętrzne',
}

type IpcLike = { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> }
function getIpc(): IpcLike | undefined {
  return (window as Window & { ipcRenderer?: IpcLike }).ipcRenderer
}

export default function PrintDocumentsView({ isManager, pushToast }: Props) {
  const [documents, setDocuments] = useState<PrintDocument[]>([])
  const [printers, setPrinters] = useState<LabelPrinter[]>([])
  const [category, setCategory] = useState<string>('STA')
  const [loading, setLoading] = useState(true)
  const [printingId, setPrintingId] = useState<number | null>(null)
  const [copies, setCopies] = useState<Record<number, number>>({})
  const [selectedPrinterId, setSelectedPrinterId] = useState<number | ''>('')
  const mountedRef = useRef(true)
  const fileRef = useRef<HTMLInputElement>(null)

  // formularz nowego dokumentu
  const [addOpen, setAddOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newZpl, setNewZpl] = useState('')
  const [saving, setSaving] = useState(false)

  // formularz drukarki
  const [prnName, setPrnName] = useState('')
  const [prnIp, setPrnIp] = useState('')
  const [prnPort, setPrnPort] = useState('9100')
  const [prnOpen, setPrnOpen] = useState(false)
  const [editingPrinterId, setEditingPrinterId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [docsRes, prnRes] = await Promise.all([
      supabase.from('print_documents').select('*').order('category').order('name'),
      supabase.from('label_printers').select('*').order('name'),
    ])
    if (!mountedRef.current) return
    setLoading(false)
    setDocuments((docsRes.data ?? []) as PrintDocument[])
    const prn = (prnRes.data ?? []) as LabelPrinter[]
    setPrinters(prn)
    setSelectedPrinterId((prev) => {
      if (prev !== '') return prev
      const def = prn.find((p) => p.is_default) ?? prn[0]
      return def ? def.id : ''
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

  const handlePrint = async (doc: PrintDocument) => {
    const printer = printers.find((p) => p.id === selectedPrinterId)
    if (!printer) {
      pushToast('Wybierz drukarkę Zebra', 'error')
      return
    }
    const n = Math.max(1, Number(copies[doc.id]) || 1)
    const ipc = getIpc()
    if (!ipc) {
      pushToast('Druk dostępny tylko w aplikacji desktop', 'error')
      return
    }
    setPrintingId(doc.id)
    try {
      const res = (await ipc.invoke('label:printZpl', {
        ip: printer.ip,
        port: printer.port,
        zpl: doc.zpl_content,
        copies: n,
      })) as { success: boolean; error?: string }
      if (res?.success) {
        pushToast(`Wysłano ${n} szt. „${doc.name}" na ${printer.name}`, 'success')
      } else {
        pushToast(`Błąd druku: ${res?.error ?? 'nieznany'}`, 'error')
      }
    } finally {
      if (mountedRef.current) setPrintingId(null)
    }
  }

  const handleAddDocument = async () => {
    const name = newName.trim()
    const zpl = newZpl.trim()
    if (!name || !zpl) {
      pushToast('Podaj nazwę i treść ZPL', 'error')
      return
    }
    setSaving(true)
    try {
      const { error } = await supabase.from('print_documents').insert([{ category, name, zpl_content: zpl }])
      if (error) { pushToast(`Błąd: ${error.message}`, 'error'); return }
      pushToast('Dokument dodany', 'success')
      setAddOpen(false); setNewName(''); setNewZpl('')
      await load()
    } finally {
      if (mountedRef.current) setSaving(false)
    }
  }

  const handleFile = (file: File | undefined) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      setNewZpl(String(reader.result ?? ''))
      if (!newName.trim()) setNewName(file.name.replace(/\.(zpl|prn|txt)$/i, ''))
    }
    reader.readAsText(file)
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleDeleteDocument = async (doc: PrintDocument) => {
    if (!window.confirm(`Usunąć dokument „${doc.name}"?`)) return
    const { error } = await supabase.from('print_documents').delete().eq('id', doc.id)
    if (error) { pushToast(`Błąd: ${error.message}`, 'error'); return }
    pushToast('Usunięto', 'success')
    await load()
  }

  const resetPrinterForm = () => {
    setPrnName(''); setPrnIp(''); setPrnPort('9100'); setEditingPrinterId(null)
  }

  const startEditPrinter = (p: LabelPrinter) => {
    setEditingPrinterId(p.id)
    setPrnName(p.name); setPrnIp(p.ip); setPrnPort(String(p.port))
    setPrnOpen(true)
  }

  const handleAddPrinter = async () => {
    const name = prnName.trim()
    const ip = prnIp.trim()
    const port = Number(prnPort) || 9100
    if (!name || !ip) { pushToast('Podaj nazwę i IP drukarki', 'error'); return }
    const { error } = await supabase
      .from('label_printers')
      .insert([{ name, ip, port, is_default: printers.length === 0 }])
    if (error) { pushToast(`Błąd: ${error.message}`, 'error'); return }
    pushToast('Drukarka dodana', 'success')
    resetPrinterForm(); setPrnOpen(false)
    await load()
  }

  const handleUpdatePrinter = async () => {
    if (editingPrinterId === null) return
    const name = prnName.trim()
    const ip = prnIp.trim()
    const port = Number(prnPort) || 9100
    if (!name || !ip) { pushToast('Podaj nazwę i IP drukarki', 'error'); return }
    const { error } = await supabase
      .from('label_printers')
      .update({ name, ip, port })
      .eq('id', editingPrinterId)
    if (error) { pushToast(`Błąd: ${error.message}`, 'error'); return }
    pushToast('Drukarka zaktualizowana', 'success')
    resetPrinterForm()
    await load()
  }

  const handleSetDefaultPrinter = async (p: LabelPrinter) => {
    if (p.is_default) return
    // jedna domyślna — zdejmij flagę z reszty, ustaw na wybranej
    const { error: clearErr } = await supabase
      .from('label_printers')
      .update({ is_default: false })
      .neq('id', p.id)
    if (clearErr) { pushToast(`Błąd: ${clearErr.message}`, 'error'); return }
    const { error } = await supabase
      .from('label_printers')
      .update({ is_default: true })
      .eq('id', p.id)
    if (error) { pushToast(`Błąd: ${error.message}`, 'error'); return }
    pushToast(`Domyślna: ${p.name}`, 'success')
    await load()
  }

  const handleDeletePrinter = async (p: LabelPrinter) => {
    if (!window.confirm(`Usunąć drukarkę „${p.name}"?`)) return
    const { error } = await supabase.from('label_printers').delete().eq('id', p.id)
    if (error) { pushToast(`Błąd: ${error.message}`, 'error'); return }
    if (selectedPrinterId === p.id) setSelectedPrinterId('')
    if (editingPrinterId === p.id) resetPrinterForm()
    await load()
  }

  return (
    <div className="print-docs-view">
      <div className="orders-filters" style={{ marginBottom: 12, alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <label className="movements-view-filter">
          <span className="movements-view-filter-label">Drukarka Zebra</span>
          <select
            className="day-filter"
            value={selectedPrinterId === '' ? '' : String(selectedPrinterId)}
            onChange={(e) => setSelectedPrinterId(e.target.value === '' ? '' : Number(e.target.value))}
          >
            <option value="">— wybierz —</option>
            {printers.map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.ip})</option>
            ))}
          </select>
        </label>
        {isManager && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPrnOpen((v) => !v)}>
            Drukarki Zebra…
          </button>
        )}
      </div>

      {isManager && prnOpen && (
        <div className="print-docs-printers">
          <div className="print-docs-printers-list">
            {printers.length === 0 ? (
              <span className="no-results">Brak skonfigurowanych drukarek</span>
            ) : (
              printers.map((p) => (
                <div key={p.id} className={`print-docs-printer-row ${editingPrinterId === p.id ? 'print-docs-printer-row--editing' : ''}`}>
                  <span><strong>{p.name}</strong> — {p.ip}:{p.port}{p.is_default ? ' (domyślna)' : ''}</span>
                  <div className="print-docs-printer-row-actions">
                    {!p.is_default && (
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => void handleSetDefaultPrinter(p)}>
                        Ustaw domyślną
                      </button>
                    )}
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => startEditPrinter(p)}>
                      Edytuj
                    </button>
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => void handleDeletePrinter(p)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="print-docs-printer-add">
            <input type="text" placeholder="Nazwa" value={prnName} onChange={(e) => setPrnName(e.target.value)} />
            <input type="text" placeholder="IP (np. 192.168.1.50)" value={prnIp} onChange={(e) => setPrnIp(e.target.value)} />
            <input type="text" placeholder="Port" value={prnPort} onChange={(e) => setPrnPort(e.target.value)} style={{ width: 70 }} />
            {editingPrinterId === null ? (
              <button type="button" className="btn btn-sm btn-success" onClick={() => void handleAddPrinter()}>Dodaj</button>
            ) : (
              <>
                <button type="button" className="btn btn-sm btn-success" onClick={() => void handleUpdatePrinter()}>Zapisz zmiany</button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={resetPrinterForm}>Anuluj</button>
              </>
            )}
          </div>
        </div>
      )}

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

      {isManager && (
        <div style={{ margin: '12px 0' }}>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => setAddOpen((v) => !v)}>
            <Plus size={14} /> Dodaj dokument ({CAT_LABEL[category]})
          </button>
        </div>
      )}

      {isManager && addOpen && (
        <div className="print-docs-add">
          <input type="text" placeholder="Nazwa dokumentu (np. DoP STA 90)" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <div className="print-docs-add-zpl">
            <textarea
              placeholder="Wklej treść ZPL (^XA…^XZ) albo wgraj plik"
              value={newZpl}
              onChange={(e) => setNewZpl(e.target.value)}
              rows={6}
            />
            <div className="print-docs-add-actions">
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => fileRef.current?.click()}>
                <Upload size={14} /> Wgraj plik .zpl
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".zpl,.prn,.txt"
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
              <span className="print-docs-name">{doc.name}</span>
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
                  disabled={printingId === doc.id || selectedPrinterId === ''}
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
