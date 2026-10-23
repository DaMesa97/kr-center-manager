import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Printer, X } from 'lucide-react'
import { supabase } from '../supabaseClient'
import { labelPagesHtml, renderLabelBody, renderLabelHtml, type LabelTemplate } from '../lib/labelRender'
import { ALU_CATEGORY } from '../constants'
import { formatAluDims } from '../lib/alu'
import type { AluPosition, Order, ToastVariant } from '../types'

// Etykiety stolarki aluminiowej: JEDNA etykieta na SZTUKĘ pozycji („SZT. 2/5”),
// jak hala klika sztuki. Wszystkie wybrane sztuki idą jednym zadaniem druku
// (strona = etykieta) — szablon z kategorii Aluminium (Etykiety → Szablony).

type Props = {
  order: Order
  positions: AluPosition[]
  onClose: () => void
  pushToast: (message: string, variant: ToastVariant) => void
}

type WinPrinter = { name: string; displayName?: string; isDefault?: boolean }
type IpcLike = { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> }
const getIpc = (): IpcLike | undefined => (window as Window & { ipcRenderer?: IpcLike }).ipcRenderer

const PRINTER_LS_KEY = 'labelPrinterName'

export default function AluLabelPrintModal({ order, positions, onClose, pushToast }: Props) {
  const [templates, setTemplates] = useState<LabelTemplate[]>([])
  const [printers, setPrinters] = useState<WinPrinter[]>([])
  const [templateId, setTemplateId] = useState<number | ''>('')
  const [printerName, setPrinterName] = useState('')
  const [selected, setSelected] = useState<Set<number>>(() => new Set(positions.map((p) => p.id)))
  const [previewHtml, setPreviewHtml] = useState('')
  const [loading, setLoading] = useState(true)
  const [printing, setPrinting] = useState(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    void (async () => {
      const ipc = getIpc()
      const [tplRes, prnList] = await Promise.all([
        supabase.from('label_templates').select('*').eq('category', ALU_CATEGORY).order('is_default', { ascending: false }).order('name'),
        ipc ? (ipc.invoke('printers:list') as Promise<WinPrinter[]>) : Promise.resolve([]),
      ])
      if (!mountedRef.current) return
      const tpls = (tplRes.data ?? []) as LabelTemplate[]
      setTemplates(tpls)
      setTemplateId(tpls.find((t) => t.is_default)?.id ?? tpls[0]?.id ?? '')
      const prns = (prnList ?? []) as WinPrinter[]
      setPrinters(prns)
      let saved: string | null = null
      try {
        saved = localStorage.getItem(PRINTER_LS_KEY)
      } catch {
        /* ignore */
      }
      setPrinterName((saved && prns.some((p) => p.name === saved) && saved) || prns.find((p) => p.isDefault)?.name || prns[0]?.name || '')
      setLoading(false)
    })()
    return () => {
      mountedRef.current = false
    }
  }, [])

  const template = useMemo(() => templates.find((t) => t.id === templateId) ?? null, [templates, templateId])
  const sorted = useMemo(() => [...positions].sort((a, b) => a.pos_no - b.pos_no), [positions])
  const pieces = useMemo(
    () =>
      sorted
        .filter((p) => selected.has(p.id))
        .flatMap((p) => Array.from({ length: Math.max(1, Number(p.quantity) || 1) }, (_, i) => ({ position: p, piece: i + 1 }))),
    [sorted, selected],
  )

  useEffect(() => {
    let cancelled = false
    const first = pieces[0]
    if (!template || !first) {
      setPreviewHtml('')
      return
    }
    void renderLabelHtml(template, order, first).then((html) => {
      if (!cancelled) setPreviewHtml(html)
    })
    return () => {
      cancelled = true
    }
  }, [template, order, pieces])

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const handlePrint = async () => {
    const ipc = getIpc()
    if (!ipc) return pushToast('Druk dostępny tylko w aplikacji desktop', 'error')
    if (!template) return pushToast('Wybierz szablon', 'error')
    if (!printerName) return pushToast('Wybierz drukarkę', 'error')
    if (pieces.length === 0) return pushToast('Zaznacz co najmniej jedną pozycję', 'error')
    setPrinting(true)
    try {
      const w = Number(template.width_mm) || 100
      const h = Number(template.height_mm) || 150
      const bodies: string[] = []
      for (const ctx of pieces) bodies.push((await renderLabelBody(template, order, ctx)).body)
      const html = labelPagesHtml(bodies, w, h, [order.company, order.order_number].filter(Boolean).join(' '))
      try {
        localStorage.setItem(PRINTER_LS_KEY, printerName)
      } catch {
        /* ignore */
      }
      const res = (await ipc.invoke('label:printHtml', { html, deviceName: printerName, copies: 1, widthMm: w, heightMm: h })) as {
        success: boolean
        failureReason?: string
      }
      if (res?.success) {
        pushToast(`Wydrukowano ${pieces.length} etykiet(y)`, 'success')
        onClose()
      } else {
        pushToast(`Błąd druku: ${res?.failureReason ?? 'nieznany'}`, 'error')
      }
    } catch (e) {
      pushToast(`Błąd druku: ${(e as Error).message}`, 'error')
    } finally {
      if (mountedRef.current) setPrinting(false)
    }
  }

  return createPortal(
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="order-modal order-modal--sta" style={{ maxWidth: 760 }} onClick={(e) => e.stopPropagation()}>
        <div className="order-modal-header">
          <h2>Etykiety — {order.order_number}</h2>
          <button type="button" className="btn btn-icon btn-ghost" onClick={onClose} aria-label="Zamknij">
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: 20 }}>
          {loading ? (
            <p className="no-results">Ładowanie…</p>
          ) : templates.length === 0 ? (
            <p className="no-results">Brak szablonu etykiety dla stolarki aluminiowej. Dodaj go w zakładce Etykiety → Szablony (kategoria Aluminium).</p>
          ) : (
            <div className="alu-label-print">
              <div className="alu-label-print-form">
                <label className="order-field-full">
                  <span className="order-field-label-text">Szablon</span>
                  <select value={templateId === '' ? '' : String(templateId)} onChange={(e) => setTemplateId(e.target.value === '' ? '' : Number(e.target.value))}>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.width_mm}×{t.height_mm}mm)
                      </option>
                    ))}
                  </select>
                </label>
                <label className="order-field-full">
                  <span className="order-field-label-text">Drukarka</span>
                  <select value={printerName} onChange={(e) => setPrinterName(e.target.value)}>
                    <option value="">— wybierz —</option>
                    {printers.map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.displayName || p.name}
                        {p.isDefault ? ' (domyślna)' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <div>
                  <span className="order-field-label-text">Pozycje (etykieta na każdą sztukę)</span>
                  <div className="alu-label-print-positions">
                    {sorted.map((p) => (
                      <label key={p.id} className="alu-label-print-pos">
                        <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                        <span>
                          <strong>poz. {p.pos_no}</strong> · {formatAluDims(p.width_mm, p.height_mm) || '—'} · ×{p.quantity}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="alu-label-print-count">
                  Do druku: <strong>{pieces.length}</strong> etykiet(y)
                </div>
              </div>
              <div>
                <span className="order-field-label-text">Podgląd (pierwsza etykieta)</span>
                <div className="label-preview-frame">
                  <iframe title="Podgląd etykiety" srcDoc={previewHtml} style={{ width: '100%', height: 440, border: 'none' }} />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="order-form-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={printing || loading || templates.length === 0 || pieces.length === 0}
            onClick={() => void handlePrint()}
          >
            <Printer size={16} /> {printing ? 'Drukuję…' : `Drukuj (${pieces.length})`}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Anuluj
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
