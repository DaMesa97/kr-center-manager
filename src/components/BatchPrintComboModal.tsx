import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Printer, X } from 'lucide-react'
import { supabase } from '../supabaseClient'
import { renderLabelBody, renderLabelHtml, type LabelTemplate } from '../lib/labelRender'
import { matchedDocsForOrder, noDocReason, type DopDocument } from '../lib/dopMatch'
import { renderPdfForPrint, renderPdfPages } from '../lib/pdfPrint'
import { buildCombinedPdfHtml, type PdfSection } from '../lib/printBundle'
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
// wirtualny wpis na liście drukarek: jeden zbiorczy plik PDF zamiast druku
const PDF_EXPORT = '::pdf-export'
// Wirtualne drukarki PDF — ta sama lista co w electron/main.ts (label:printHtml).
// Druk partii na nie = okno zapisu PER ZAMÓWIENIE, więc kierujemy na zbiorczy PDF.
const VIRTUAL_PDF_RE = /print to pdf|adobe pdf|pdfcreator|pdf24|dopdf|foxit|nitro pdf|cutepdf|bullzip|primopdf|novapdf|tinypdf|pdf995/i
const PDF_SAVE_CANCELLED = 'Zapis PDF anulowany'

type PrintRes = { success: boolean; failureReason?: string; error?: string; printerDown?: boolean }

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
  // Świadome przerwanie partii (przycisk) — zamknięcie modala w trakcie druku
  // ucinało pętlę PO CICHU i nikt nie wiedział, ile się wydrukowało
  const cancelRef = useRef(false)

  const safeClose = () => {
    if (printing) {
      pushToast('Trwa drukowanie — użyj „Przerwij drukowanie" albo poczekaj', 'info')
      return
    }
    onClose()
  }

  const categories = useMemo(
    () => Array.from(new Set(orders.map((o) => String(o.category)))),
    [orders],
  )
  // klucz tekstowy — nowa TABLICA orders przy re-renderze App nie może
  // przeładowywać modala i nadpisywać wybranej drukarki (audyt druku)
  const categoriesKey = categories.slice().sort().join('|')

  useEffect(() => {
    mountedRef.current = true
    const cats = categoriesKey.split('|').filter(Boolean)
    void (async () => {
      const ipc = getIpc()
      const [tplRes, docsRes, prnList] = await Promise.all([
        supabase.from('label_templates').select('*').in('category', cats),
        supabase.from('print_documents').select('*').in('category', cats),
        ipc ? (ipc.invoke('printers:list') as Promise<WinPrinter[]>) : Promise.resolve([]),
      ])
      if (!mountedRef.current) return
      setTemplates((tplRes.data ?? []) as LabelTemplate[])
      setDocuments((docsRes.data ?? []) as PrintDocument[])
      const prns = (prnList ?? []) as WinPrinter[]
      setPrinters(prns)
      const saved = localStorage.getItem(PRINTER_LS_KEY)
      // nie nadpisuj wyboru użytkownika, jeśli już coś wybrał
      setPrinterName((prev) =>
        prev && prns.some((p) => p.name === prev)
          ? prev
          : (saved && prns.some((p) => p.name === saved) && saved) || prns.find((p) => p.isDefault)?.name || prns[0]?.name || '',
      )
      setLoading(false)
    })()
    return () => { mountedRef.current = false }
  }, [categoriesKey])

  const copiesFor = (order: Order): number => {
    const id = order.id
    if (id === undefined) return 1
    // domyślnie max(ilość, bastion_label_qty) — etykieta na każde skrzydło;
    // bastion_label_qty (Bastion: mnożnik etykiet), nie label_qty (nie istnieje)
    const fallback = Math.max(
      1,
      Number(order.quantity) || 1,
      Number((order as { bastion_label_qty?: unknown }).bastion_label_qty) || 1,
    )
    return Math.max(1, copiesByOrder[id] ?? fallback)
  }
  const setCopiesForOrder = (order: Order, value: number) => {
    const id = order.id
    if (id === undefined) return
    setCopiesByOrder((prev) => ({ ...prev, [id]: Math.max(1, value || 1) }))
  }

  const templateForCategory = (cat: string): LabelTemplate | undefined => {
    // deterministycznie: domyślny, potem alfabetycznie (wcześniej kolejność
    // z bazy = przypadkowa, gdy brak szablonu domyślnego)
    const forCat = templates
      .filter((t) => t.category === cat)
      .sort((a, b) => Number(b.is_default) - Number(a.is_default) || String(a.name).localeCompare(String(b.name), 'pl'))
    return forCat[0]
  }
  // JEDNA najlepiej dopasowana deklaracja (lista jest posortowana po
  // szczegółowości) — wcześniej drukowały się WSZYSTKIE pasujące (audyt druku)
  const bestDocForOrder = (order: Order): PrintDocument | undefined =>
    matchedDocsForOrder(order, documents)[0]

  // Zbiorczy eksport: etykiety + deklaracje wszystkich zamówień w JEDNYM pliku
  // PDF (jedno okno zapisu) — bez przepychanek z wirtualnymi drukarkami PDF
  const handleExportPdf = async () => {
    const ipc = getIpc()
    if (!ipc) { pushToast('Eksport dostępny tylko w aplikacji desktop', 'error'); return }
    setPrinting(true)
    setProgress(0)
    cancelRef.current = false
    let labelsSkip = 0
    let docsSkip = 0
    let zplSkipped = 0
    try {
      try {
      const sections: PdfSection[] = []
      for (let i = 0; i < orders.length; i++) {
        if (cancelRef.current) {
          pushToast(`Eksport przerwany (przygotowano ${i} z ${orders.length} zam., plik nie powstał)`, 'info')
          return
        }
        const order = orders[i]
        if (doLabels) {
          const tpl = templateForCategory(String(order.category))
          if (!tpl) labelsSkip++
          else {
            const { body, widthMm, heightMm } = await renderLabelBody(tpl, order)
            sections.push({ widthMm, heightMm, bodyHtml: body, repeat: copiesFor(order) })
          }
        }
        if (doDocs) {
          const doc = bestDocForOrder(order)
          if (!doc) docsSkip++
          else if (doc.doc_type === 'pdf' && doc.pdf_base64) {
            const { imgs, widthMm, heightMm } = await renderPdfPages(doc.pdf_base64)
            for (const src of imgs) {
              sections.push({
                widthMm, heightMm,
                bodyHtml: `<img src="${src}" style="width:${widthMm}mm;height:${heightMm}mm;display:block" />`,
              })
            }
          } else {
            zplSkipped++ // ZPL to język drukarki — nie da się go sensownie włożyć do PDF-a
          }
        }
        if (!mountedRef.current) return
        setProgress(i + 1)
      }
      if (sections.length === 0) {
        pushToast('Nie ma czego zapisać (brak szablonów/deklaracji PDF)', 'error')
        return
      }
      const single = orders.length === 1 ? orders[0] : null
      const defaultName = single
        ? [String(single.company ?? '').trim(), String(single.order_number ?? '').trim()].filter(Boolean).join(' ') || 'wydruk'
        : `komplet ${new Date().toISOString().slice(0, 10)} (${orders.length} zam.)`
      const html = buildCombinedPdfHtml(sections, defaultName)
      const res = (await ipc.invoke('print:exportPdf', { html, defaultName })) as { success: boolean; error?: string }
      if (res?.success) {
        const notes: string[] = []
        if (labelsSkip) notes.push(`${labelsSkip} bez szablonu etykiety`)
        if (docsSkip) notes.push(`${docsSkip} bez deklaracji`)
        if (zplSkipped) notes.push(`${zplSkipped} deklaracji ZPL pominięto (PDF nie obsłuży ZPL)`)
        pushToast(`Zapisano PDF${notes.length ? ` (${notes.join(', ')})` : ''}`, 'success')
        onDone?.()
        onClose()
      } else if (res?.error !== 'Zapis PDF anulowany') {
        pushToast(`Błąd eksportu PDF: ${res?.error ?? 'nieznany'}`, 'error')
      }
      } catch (e) {
        // każdy zonk (pdfjs, render, IPC) ląduje w toaście zamiast wiecznego "Drukuję…"
        pushToast(`Błąd eksportu PDF: ${(e as Error).message}`, 'error')
      }
    } finally {
      if (mountedRef.current) setPrinting(false)
    }
  }

  const handlePrint = async () => {
    const ipc = getIpc()
    if (!ipc) { pushToast('Druk dostępny tylko w aplikacji desktop', 'error'); return }
    if (!printerName) { pushToast('Wybierz drukarkę', 'error'); return }
    if (!doLabels && !doDocs) { pushToast('Zaznacz co drukować (etykieta / DoP)', 'error'); return }
    if (printerName === PDF_EXPORT) { await handleExportPdf(); return }
    if (VIRTUAL_PDF_RE.test(printerName)) {
      // drukarka PDF: jeden plik zamiast okna zapisu na każde zamówienie
      localStorage.setItem(PRINTER_LS_KEY, printerName)
      await handleExportPdf()
      return
    }
    setPrinting(true)
    setProgress(0)
    cancelRef.current = false
    localStorage.setItem(PRINTER_LS_KEY, printerName)
    let labelsOk = 0, labelsFail = 0, labelsSkip = 0
    let docsOk = 0, docsFail = 0, docsSkip = 0
    let lastLabelError = ''
    let lastDocError = ''
    // drukarka offline / nie odpowiada → stop CAŁEJ partii (wcześniej każde
    // zamówienie czekało na sprawdzenie i kończyło się "0/bł.30" bez powodu)
    let stopReason = ''
    let stopOrderNr = ''
    let zplNotSent = 0
    let processed = 0 // licznik lokalny — stan `progress` w closure byłby nieświeży
    const failMsg = (res: PrintRes | undefined, fallback: string) => res?.failureReason || res?.error || fallback
    const isFatal = (res: PrintRes | undefined) => !!res?.printerDown || res?.failureReason === PDF_SAVE_CANCELLED
    try {
      // ZPL zbieramy do JEDNEJ paczki — każde wywołanie printRaw to osobny
      // PowerShell z kompilacją C# (sekundy!), więc paczka = jeden strzał
      const zplParts: string[] = []
      for (let i = 0; i < orders.length; i++) {
        if (cancelRef.current || stopReason) break
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
              })) as PrintRes
              if (res?.success) labelsOk++
              else {
                labelsFail++
                lastLabelError = failMsg(res, 'druk HTML odrzucony')
                if (isFatal(res)) { stopReason = lastLabelError; stopOrderNr = String(order.order_number ?? '') }
              }
            } catch (e) { labelsFail++; lastLabelError = (e as Error).message }
          }
        }
        // 2) DoP — JEDNA najlepiej dopasowana deklaracja per zamówienie
        if (doDocs && !stopReason) {
          const doc = bestDocForOrder(order)
          if (!doc) docsSkip++
          else if (doc.doc_type === 'pdf' && doc.pdf_base64) {
            // deklaracja PDF: render pdfjs → druk jak etykieta
            try {
              const { html, widthMm, heightMm } = await renderPdfForPrint(doc.pdf_base64, doc.name)
              const res = (await ipc.invoke('label:printHtml', {
                html, deviceName: printerName, copies: 1, widthMm, heightMm,
              })) as PrintRes
              if (res?.success) docsOk++
              else {
                docsFail++
                lastDocError = failMsg(res, 'druk HTML odrzucony')
                if (isFatal(res)) { stopReason = lastDocError; stopOrderNr = String(order.order_number ?? '') }
              }
            } catch (e) { docsFail++; lastDocError = (e as Error).message }
          } else if (doc.zpl_content) {
            zplParts.push(doc.zpl_content)
          } else {
            docsSkip++
          }
        }
        if (!mountedRef.current) return
        if (stopReason) break
        processed = i + 1
        setProgress(i + 1)
      }
      if (doDocs && zplParts.length > 0) {
        if (cancelRef.current || stopReason) {
          // przerwane / drukarka padła — zebranej paczki ZPL już nie wysyłamy
          zplNotSent = zplParts.length
        } else {
          try {
            const res = (await ipc.invoke('label:printRaw', {
              deviceName: printerName, zpl: zplParts.join('\n'), copies: 1,
            })) as PrintRes
            if (res?.success) docsOk += zplParts.length
            else {
              docsFail += zplParts.length
              lastDocError = failMsg(res, 'RAW odrzucony')
              if (res?.printerDown) stopReason = lastDocError
            }
          } catch (e) { docsFail += zplParts.length; lastDocError = (e as Error).message }
        }
      }
      const parts: string[] = []
      if (doLabels) parts.push(`etykiety ${labelsOk}${labelsFail ? `/bł.${labelsFail}` : ''}${labelsSkip ? `/brak szablonu ${labelsSkip}` : ''}`)
      if (doDocs) parts.push(`DoP ${docsOk}${docsFail ? `/bł.${docsFail}` : ''}${docsSkip ? `/bez dok. ${docsSkip}` : ''}${zplNotSent ? `/ZPL niewysłane ${zplNotSent}` : ''}`)
      const anyFail = labelsFail + docsFail > 0
      const cancelled = cancelRef.current

      if (stopReason) {
        pushToast(
          `Druk zatrzymany${stopOrderNr ? ` na zam. ${stopOrderNr}` : ''} (${processed}/${orders.length} gotowe) — ${stopReason.slice(0, 200)} | ${parts.join(', ')}`,
          stopReason === PDF_SAVE_CANCELLED ? 'info' : 'error',
        )
        return
      }
      // wszystko pominięte (brak szablonu / DoP) — to NIE jest sukces: modal
      // zostaje otwarty, zaznaczenie nietknięte
      if (!cancelled && labelsOk + docsOk === 0 && !anyFail) {
        const why: string[] = []
        if (labelsSkip) why.push(`${labelsSkip} bez szablonu etykiety`)
        if (docsSkip) why.push(`${docsSkip} bez deklaracji DoP`)
        pushToast(`Nic nie wydrukowano${why.length ? ` — ${why.join(', ')}` : ''}`, 'error')
        return
      }
      const errDetail = [
        labelsFail && lastLabelError ? `etykieta: ${lastLabelError}` : '',
        docsFail && lastDocError ? `DoP: ${lastDocError}` : '',
      ].filter(Boolean).join('; ')
      pushToast(
        `${cancelled ? `PRZERWANO po ${processed}/${orders.length} — ` : ''}Wydruk: ${parts.join(', ')}${errDetail ? ` — ${errDetail.slice(0, 200)}` : ''}`,
        anyFail ? 'error' : cancelled ? 'info' : 'success',
      )
      if (!anyFail && !cancelled) { onDone?.(); onClose() }
    } finally {
      if (mountedRef.current) setPrinting(false)
    }
  }

  return createPortal(
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={safeClose}>
      <div className="order-modal order-modal--sta" style={{ maxWidth: 600 }} onClick={(e) => e.stopPropagation()}>
        <div className="order-modal-header">
          <h2>Drukuj komplet — {orders.length} zam.</h2>
          <button type="button" className="btn btn-icon btn-ghost" onClick={safeClose}><X size={18} /></button>
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
                  <option value={PDF_EXPORT}>💾 Zapisz do PDF (jeden plik: etykiety + deklaracje)</option>
                  {printers.map((p) => (
                    <option key={p.name} value={p.name}>{p.displayName || p.name}{p.isDefault ? ' (domyślna)' : ''}</option>
                  ))}
                </select>
              </label>
              {VIRTUAL_PDF_RE.test(printerName) ? (
                <p style={{ margin: 0, fontSize: 13, opacity: 0.8 }}>
                  To drukarka PDF — zamiast okna zapisu dla każdego zamówienia powstanie jeden zbiorczy plik PDF.
                </p>
              ) : null}

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
                    const bestDoc = bestDocForOrder(o)
                    const hasTpl = !!templateForCategory(String(o.category))
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
                            {doLabels && !hasTpl ? (
                              <span
                                className="batch-chip"
                                style={{ color: '#b91c1c', cursor: 'help' }}
                                title={`Brak szablonu etykiety dla kategorii ${String(o.category)} — etykieta zostanie pominięta`}
                              >
                                brak szablonu ⓘ
                              </span>
                            ) : null}
                            {doDocs ? (
                              bestDoc ? (
                                <span className="batch-chip" title={`Deklaracja: ${bestDoc.name}`}>
                                  DoP: {String(bestDoc.name).slice(0, 28)}
                                </span>
                              ) : (
                                <span
                                  className="batch-chip"
                                  style={{ color: '#b91c1c', cursor: 'help' }}
                                  title={noDocReason(o, documents)}
                                >
                                  brak DoP ⓘ
                                </span>
                              )
                            ) : null}
                          </span>
                        </div>
                        {doLabels && hasTpl ? (
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
          {printing ? (
            <button type="button" className="btn btn-sm btn-danger" onClick={() => { cancelRef.current = true }}>
              Przerwij drukowanie
            </button>
          ) : (
            <button type="button" className="btn btn-sm btn-primary" onClick={onClose}>Anuluj</button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
