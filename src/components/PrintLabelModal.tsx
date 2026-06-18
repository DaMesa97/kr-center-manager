import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Printer, X } from 'lucide-react'
import { supabase } from '../supabaseClient'
import { renderLabelHtml, type LabelTemplate } from '../lib/labelRender'
import type { Order, ToastVariant } from '../types'

type Props = {
  order: Order
  onClose: () => void
  pushToast: (message: string, variant: ToastVariant) => void
}

type WinPrinter = { name: string; displayName?: string; isDefault?: boolean }
type IpcLike = { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> }
function getIpc(): IpcLike | undefined {
  return (window as Window & { ipcRenderer?: IpcLike }).ipcRenderer
}

const PRINTER_LS_KEY = 'labelPrinterName'

export default function PrintLabelModal({ order, onClose, pushToast }: Props) {
  const [templates, setTemplates] = useState<LabelTemplate[]>([])
  const [printers, setPrinters] = useState<WinPrinter[]>([])
  const [templateId, setTemplateId] = useState<number | ''>('')
  const [printerName, setPrinterName] = useState<string>('')
  const [copies, setCopies] = useState(1)
  const [previewHtml, setPreviewHtml] = useState('')
  const [loading, setLoading] = useState(true)
  const [printing, setPrinting] = useState(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    void (async () => {
      const ipc = getIpc()
      const [tplRes, prnList] = await Promise.all([
        supabase.from('label_templates').select('*').eq('category', order.category).order('is_default', { ascending: false }).order('name'),
        ipc ? (ipc.invoke('printers:list') as Promise<WinPrinter[]>) : Promise.resolve([]),
      ])
      if (!mountedRef.current) return
      const tpls = (tplRes.data ?? []) as LabelTemplate[]
      setTemplates(tpls)
      setTemplateId(tpls.find((t) => t.is_default)?.id ?? tpls[0]?.id ?? '')
      const prns = (prnList ?? []) as WinPrinter[]
      setPrinters(prns)
      const saved = localStorage.getItem(PRINTER_LS_KEY)
      const pick = (saved && prns.some((p) => p.name === saved) && saved) || prns.find((p) => p.isDefault)?.name || prns[0]?.name || ''
      setPrinterName(pick)
      setLoading(false)
    })()
    return () => { mountedRef.current = false }
  }, [order])

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === templateId) ?? null,
    [templates, templateId],
  )

  // generuj podgląd przy zmianie szablonu
  useEffect(() => {
    let cancelled = false
    if (!selectedTemplate) { setPreviewHtml(''); return }
    void renderLabelHtml(selectedTemplate, order).then((html) => {
      if (!cancelled) setPreviewHtml(html)
    })
    return () => { cancelled = true }
  }, [selectedTemplate, order])

  const handlePrint = useCallback(async () => {
    const ipc = getIpc()
    if (!ipc) { pushToast('Druk dostępny tylko w aplikacji desktop', 'error'); return }
    if (!selectedTemplate) { pushToast('Wybierz szablon', 'error'); return }
    if (!printerName) { pushToast('Wybierz drukarkę', 'error'); return }
    setPrinting(true)
    try {
      const html = await renderLabelHtml(selectedTemplate, order)
      localStorage.setItem(PRINTER_LS_KEY, printerName)
      const res = (await ipc.invoke('label:printHtml', {
        html,
        deviceName: printerName,
        copies: Math.max(1, copies),
        widthMm: Number(selectedTemplate.width_mm) || 100,
        heightMm: Number(selectedTemplate.height_mm) || 50,
      })) as { success: boolean; failureReason?: string }
      if (res?.success) {
        pushToast(`Wydrukowano etykietę (${copies} szt.)`, 'success')
        onClose()
      } else {
        pushToast(`Błąd druku: ${res?.failureReason ?? 'nieznany'}`, 'error')
      }
    } finally {
      if (mountedRef.current) setPrinting(false)
    }
  }, [selectedTemplate, printerName, copies, order, onClose, pushToast])

  return createPortal(
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="order-modal order-modal--sta" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
        <div className="order-modal-header">
          <h2>Drukuj etykietę — {order.order_number}</h2>
          <button type="button" className="btn btn-icon btn-ghost" onClick={onClose}><X size={18} /></button>
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {loading ? (
            <p className="no-results">Ładowanie…</p>
          ) : templates.length === 0 ? (
            <p className="no-results">
              Brak szablonu etykiety dla kategorii {order.category}. Dodaj go w zakładce Etykiety → Szablony.
            </p>
          ) : (
            <>
              <label className="order-field-full">
                <span className="order-field-label-text">Szablon</span>
                <select value={templateId === '' ? '' : String(templateId)} onChange={(e) => setTemplateId(e.target.value === '' ? '' : Number(e.target.value))}>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>{t.name} ({t.width_mm}×{t.height_mm}mm)</option>
                  ))}
                </select>
              </label>

              <label className="order-field-full">
                <span className="order-field-label-text">Drukarka</span>
                <select value={printerName} onChange={(e) => setPrinterName(e.target.value)}>
                  <option value="">— wybierz —</option>
                  {printers.map((p) => (
                    <option key={p.name} value={p.name}>{p.displayName || p.name}{p.isDefault ? ' (domyślna)' : ''}</option>
                  ))}
                </select>
              </label>

              <label className="order-field-full" style={{ maxWidth: 140 }}>
                <span className="order-field-label-text">Liczba kopii</span>
                <input type="number" min={1} value={copies} onChange={(e) => setCopies(Math.max(1, Number(e.target.value) || 1))} />
              </label>

              <div>
                <span className="order-field-label-text">Podgląd</span>
                <div className="label-preview-frame">
                  <iframe title="Podgląd etykiety" srcDoc={previewHtml} style={{ width: '100%', height: 380, border: 'none' }} />
                </div>
              </div>
            </>
          )}
        </div>

        <div className="order-form-actions">
          <button type="button" className="btn btn-primary" disabled={printing || loading || templates.length === 0} onClick={() => void handlePrint()}>
            <Printer size={16} /> {printing ? 'Drukuję…' : 'Drukuj'}
          </button>
          <button type="button" className="btn btn-sm btn-primary" onClick={onClose}>Anuluj</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
