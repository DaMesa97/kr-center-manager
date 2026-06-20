import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Printer, X } from 'lucide-react'
import { supabase } from '../supabaseClient'
import { renderLabelHtml, type LabelTemplate } from '../lib/labelRender'
import { matchedDocsForOrder, type DopDocument } from '../lib/dopMatch'
import type { Order, ToastVariant } from '../types'

type Props = {
  orders: Order[]
  onClose: () => void
  onDone?: () => void
  initialMode?: 'all' | 'docs'
  pushToast: (message: string, variant: ToastVariant) => void
}

type PrintDocument = DopDocument
type WinPrinter = { name: string; displayName?: string; isDefault?: boolean }

type IpcLike = { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> }
function getIpc(): IpcLike | undefined {
  return (window as Window & { ipcRenderer?: IpcLike }).ipcRenderer
}

const PRINTER_LS_KEY = 'labelPrinterName'
const hasRealDim = (v: unknown) => /[1-9]/.test(String(v ?? ''))

export default function BatchPrintComboModal({ orders, onClose, onDone, initialMode = 'all', pushToast }: Props) {
  const [templates, setTemplates] = useState<LabelTemplate[]>([])
  const [documents, setDocuments] = useState<PrintDocument[]>([])
  const [printers, setPrinters] = useState<WinPrinter[]>([])
  const [printerName, setPrinterName] = useState('')
  const [doLabels, setDoLabels] = useState(initialMode !== 'docs')
  const [doDocs, setDoDocs] = useState(true)
  const [copiesByOrder, setCopiesByOrder] = useState<Record<number, number>>({})
  const [loading, setLoading] = useState(true)
  const [printing, setPrinting] = useState(false)
  const [progress, setProgress] = useState(0)
  const mountedRef = useRef(true)

  const categories = useMemo(
    () => Array.from(new Set(orders.map((o) => String(o.category)))),
    [orders],
  )

  useEffect(() => {
    mountedRef.current = true
    void (async () => {
      const ipc = getIpc()
      const [tplRes, docsRes, prnList] = await Promise.all([
        supabase.from('label_templates').select('*').in('category', categories),
        supabase.from('print_documents').select('*').in('category', categories),
        ipc ? (ipc.invoke('printers:list') as Promise<WinPrinter[]>) : Promise.resolve([]),
      ])
      if (!mountedRef.current) return
      setTemplates((tplRes.data ?? []) as LabelTemplate[])
      setDocuments((docsRes.data ?? []) as PrintDocument[])
      const prns = (prnList ?? []) as WinPrinter[]
      setPrinters(prns)
      const saved = localStorage.getItem(PRINTER_LS_KEY)
      setPrinterName((saved && prns.some((p) => p.name === saved) && saved) || prns.find((p) => p.isDefault)?.name || prns[0]?.name || '')
      setLoading(false)
    })()
    return () => { mountedRef.current = false }
  }, [categories])

  const copiesFor = (order: Order): number => {
    const id = order.id
    if (id === undefined) return 1
    return Math.max(1, copiesByOrder[id] ?? 1)
  }
  const setCopiesForOrder = (order: Order, value: number) => {
    const id = order.id
    if (id === undefined) return
    setCopiesByOrder((prev) => ({ ...prev, [id]: Math.max(1, value || 1) }))
  }

  const templateForCategory = (cat: string): LabelTemplate | undefined => {
    const forCat = templates.filter((t) => t.category === cat)
    return forCat.find((t) => t.is_default) ?? forCat[0]
  }
  const docsForOrder = (order: Order): PrintDocument[] => matchedDocsForOrder(order, documents)

  const handlePrint = async () => {
    const ipc = getIpc()
    if (!ipc) { pushToast('Druk dostępny tylko w aplikacji desktop', 'error'); return }
    if (!printerName) { pushToast('Wybierz drukarkę', 'error'); return }
    if (!doLabels && !doDocs) { pushToast('Zaznacz co drukować (etykieta / DoP)', 'error'); return }
    setPrinting(true)
    setProgress(0)
    localStorage.setItem(PRINTER_LS_KEY, printerName)
    let labelsOk = 0, labelsFail = 0, labelsSkip = 0
    let docsOk = 0, docsFail = 0, docsSkip = 0
    try {
      for (let i = 0; i < orders.length; i++) {
        const order = orders[i]
        // 1) etykieta QR (HTML -> Windows)
        if (doLabels) {
          const tpl = templateForCategory(String(order.category))
          if (!tpl) { labelsSkip++ }
          else {
            try {
              const html = await renderLabelHtml(tpl, order)
              const res = (await ipc.invoke('label:printHtml', {
                html,
                deviceName: printerName,
                copies: copiesFor(order),
                widthMm: Number(tpl.width_mm) || 100,
                heightMm: Number(tpl.height_mm) || 50,
              })) as { success: boolean }
              if (res?.success) labelsOk++; else labelsFail++
            } catch { labelsFail++ }
          }
        }
        // 2) DoP / dokumenty (surowy ZPL -> ta sama drukarka Windows, RAW spool)
        if (doDocs) {
          const docs = docsForOrder(order)
          if (docs.length === 0) { docsSkip++ }
          for (const doc of docs) {
            try {
              const res = (await ipc.invoke('label:printRaw', {
                deviceName: printerName, zpl: doc.zpl_content, copies: 1,
              })) as { success: boolean }
              if (res?.success) docsOk++; else docsFail++
            } catch { docsFail++ }
          }
        }
        if (!mountedRef.current) return
        setProgress(i + 1)
      }
      const parts: string[] = []
      if (doLabels) parts.push(`etykiety ${labelsOk}${labelsFail ? `/bł.${labelsFail}` : ''}${labelsSkip ? `/brak szablonu ${labelsSkip}` : ''}`)
      if (doDocs) parts.push(`DoP ${docsOk}${docsFail ? `/bł.${docsFail}` : ''}${docsSkip ? `/bez dok. ${docsSkip}` : ''}`)
      const anyFail = labelsFail + docsFail > 0
      pushToast(`Wydruk: ${parts.join(', ')}`, anyFail ? 'error' : 'success')
      if (!anyFail) { onDone?.(); onClose() }
    } finally {
      if (mountedRef.current) setPrinting(false)
    }
  }

  return createPortal(
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="order-modal order-modal--sta" style={{ maxWidth: 600 }} onClick={(e) => e.stopPropagation()}>
        <div className="order-modal-header">
          <h2>Drukuj komplet — {orders.length} zam.</h2>
          <button type="button" className="btn btn-icon btn-ghost" onClick={onClose}><X size={18} /></button>
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {loading ? (
            <p className="no-results">Ładowanie…</p>
          ) : (
            <>
              <label className="order-field-full">
                <span className="order-field-label-text">Drukarka (Windows)</span>
                <select value={printerName} onChange={(e) => setPrinterName(e.target.value)}>
                  <option value="">— wybierz —</option>
                  {printers.map((p) => (
                    <option key={p.name} value={p.name}>{p.displayName || p.name}{p.isDefault ? ' (domyślna)' : ''}</option>
                  ))}
                </select>
              </label>

              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <input type="checkbox" checked={doLabels} onChange={(e) => setDoLabels(e.target.checked)} />
                  Etykieta QR
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <input type="checkbox" checked={doDocs} onChange={(e) => setDoDocs(e.target.checked)} />
                  DoP / dokumenty
                </label>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span className="order-field-label-text">Zamówienia</span>
                <div className="batch-label-list">
                  {orders.map((o) => {
                    const docCount = docsForOrder(o).length
                    return (
                      <div key={o.id ?? o.order_number} className="batch-label-row">
                        <span className="batch-label-row-nr">{o.order_number}</span>
                        <div className="batch-label-row-info">
                          <span className="batch-label-row-sys">{String(o.system ?? '').trim() || o.category}</span>
                          <span className="batch-label-row-chips">
                            {hasRealDim(o.side_panel) || hasRealDim(o.side_panel_a) || hasRealDim(o.side_panel_b) ? (
                              <span className="batch-chip batch-chip--panel">dostawka</span>
                            ) : null}
                            {hasRealDim(o.top_light) ? <span className="batch-chip batch-chip--light">naświetle</span> : null}
                            {doDocs ? <span className="batch-chip">{docCount} DoP</span> : null}
                          </span>
                        </div>
                        {doLabels ? (
                          <input
                            type="number"
                            min={1}
                            className="batch-label-row-qty"
                            value={copiesFor(o)}
                            onChange={(e) => setCopiesForOrder(o, Number(e.target.value))}
                            title="Liczba etykiet QR"
                          />
                        ) : (
                          <span className="batch-label-row-qty" style={{ textAlign: 'center' }}>—</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="order-form-actions">
          <button type="button" className="btn btn-primary" disabled={printing || loading} onClick={() => void handlePrint()}>
            <Printer size={16} /> {printing ? `Drukuję… ${progress}/${orders.length}` : 'Drukuj komplet'}
          </button>
          <button type="button" className="btn btn-sm btn-primary" onClick={onClose}>Anuluj</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
