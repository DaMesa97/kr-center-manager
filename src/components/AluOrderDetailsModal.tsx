import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ALU_REALIZACJA_LABELS } from '../constants'
import { aluLoadingDate, aluOrderExtra, aluOrderProgress, formatPlDateWithDow } from '../lib/alu'
import { formatProductionOrderNo } from '../lib/aluConstructions'
import { appConfirm } from '../lib/appDialogs'
import { isReleaseDateEmpty } from '../utils'
import AluPositionsTable from './AluPositionsTable'
import AluLabelPrintModal from './AluLabelPrintModal'
import type {
  AluConstruction, AluPosition, AluProductionOrder, Order, OrderDocument, OrderDocumentKind, ToastVariant,
} from '../types'

// Szczegóły zlecenia aluminium: nagłówek z LP, PDF-y (LP + lista cięcia),
// pozycje z postępem etapów. Nową wersję LP wgrywa się przez import (nadpisanie).

type Props = {
  order: Order
  positions: AluPosition[]
  documents: OrderDocument[]
  /** ZKP 5.9: numery konstrukcji (sztuki) i uruchomienie zlecenia */
  constructions: AluConstruction[]
  production: AluProductionOrder | null
  onStartProduction: () => Promise<boolean>
  isManager: boolean
  uploading: boolean
  onClose: () => void
  onOpenDocument: (doc: OrderDocument) => void
  onUploadDocument: (kind: OrderDocumentKind, file: File) => Promise<void>
  onReimport: () => void
  /** Anulowanie zlecenia (kierownik, tylko otwarte) — wspólny flow z innymi kategoriami */
  onCancel?: () => void
  /** druk etykiet (etykieta na sztukę) — brak = bez przycisku */
  canPrintLabels?: boolean
  pushToast?: (message: string, variant: ToastVariant) => void
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })
}

export default function AluOrderDetailsModal({
  order, positions, documents, constructions, production, onStartProduction, isManager, uploading, onClose,
  onOpenDocument, onUploadDocument, onReimport, onCancel, canPrintLabels, pushToast,
}: Props) {
  const [labelsOpen, setLabelsOpen] = useState(false)
  const [starting, setStarting] = useState(false)
  const extra = aluOrderExtra(order)
  const lp = documents.find((d) => d.kind === 'LP')
  const lc = documents.find((d) => d.kind === 'LC')
  const zm = documents.find((d) => d.kind === 'ZM')
  const lcInputRef = useRef<HTMLInputElement>(null)
  const [pendingKind, setPendingKind] = useState<OrderDocumentKind | null>(null)
  const progress = aluOrderProgress(positions)
  const qty = positions.reduce((s, p) => s + (Number(p.quantity) || 0), 0)
  const cancelled = (order.extra_fields as Record<string, unknown> | null)?.cancelled === true
  const released = !isReleaseDateEmpty(order.release_date)

  // ZKP 5.9: numer konstrukcji nadawany przy uruchomieniu, potem niezmienny
  const handleStart = async () => {
    const ok = await appConfirm(
      `Uruchomić zlecenie ${order.order_number} do produkcji? Program nada kolejny numer zlecenia w roku i numery konstrukcji ` +
        `RRRR/ZZ/PP wszystkim ${qty} sztukom. Numerów nie da się potem zmienić ani zwolnić.`,
      { title: 'Uruchomienie do produkcji', confirmLabel: 'Uruchom' },
    )
    if (!ok) return
    setStarting(true)
    await onStartProduction()
    setStarting(false)
  }
  const constructionsByPos = [...constructions].sort((a, b) => a.pos_no - b.pos_no || a.pp - b.pp)

  const pickFile = (kind: OrderDocumentKind) => {
    setPendingKind(kind)
    lcInputRef.current?.click()
  }
  const onFilePicked = async (file: File | null) => {
    if (!file || !pendingKind) return
    if (!/\.pdf$/i.test(file.name)) return
    await onUploadDocument(pendingKind, file)
    setPendingKind(null)
    if (lcInputRef.current) lcInputRef.current.value = ''
  }

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="order-modal alu-details-modal" onClick={(e) => e.stopPropagation()}>
        <div className="order-modal-header">
          <h2>
            {order.order_number} — {order.company || '—'}
            <span className={`alu-realizacja-chip alu-realizacja-chip--${extra.realizacja}`} style={{ marginLeft: 10 }}>
              {ALU_REALIZACJA_LABELS[extra.realizacja]}
            </span>
          </h2>
          <button className="btn btn-icon btn-ghost" onClick={onClose} aria-label="Zamknij">×</button>
        </div>

        <div className="alu-modal-body">
        <div className="alu-details-grid">
          <div><span className="alu-details-label">Lista produkcyjna</span>{extra.lp_number || '—'}</div>
          <div><span className="alu-details-label">LP utworzona</span>{fmtDate(extra.lp_created_at)}</div>
          <div><span className="alu-details-label">Termin (dzień trasy)</span>{extra.deadline ? formatPlDateWithDow(extra.deadline) : '—'}</div>
          <div title="1 dzień roboczy przed terminem">
            <span className="alu-details-label">Załadunek</span>{extra.deadline ? formatPlDateWithDow(aluLoadingDate(extra.deadline)) : '—'}
          </div>
          <div><span className="alu-details-label">Pozycje / sztuki</span>{positions.length} / {qty}</div>
          <div><span className="alu-details-label">Powierzchnia</span>{extra.area_m2 != null ? `${extra.area_m2} m²` : '—'}</div>
          <div><span className="alu-details-label">Masa</span>{extra.weight_kg != null ? `${extra.weight_kg} kg` : '—'}</div>
          <div><span className="alu-details-label">Postęp</span>{progress.total ? `${progress.percent}% (${progress.done}/${progress.total})` : '—'}</div>
          <div>
            <span className="alu-details-label">Status</span>
            {cancelled ? 'Anulowane' : released ? `Wydane ${order.release_date}` : 'W realizacji'}
          </div>
          <div title="ZKP 5.9 — kolejny numer zlecenia aluminium w roku, nadawany przy uruchomieniu do produkcji">
            <span className="alu-details-label">Nr zlecenia (ZKP)</span>
            {production
              ? `${formatProductionOrderNo(production.year, production.zz)} · ${fmtDate(production.started_at)}${production.started_by_name ? ` · ${production.started_by_name}` : ''}`
              : 'nieuruchomione'}
          </div>
        </div>

        <div className="alu-docs-row">
          <span className="alu-details-label">Dokumenty</span>
          {lp ? (
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => onOpenDocument(lp)} title={lp.file_name}>
              📄 Otwórz LP {lp.number ? `(${lp.number})` : ''}
            </button>
          ) : (
            <span className="alu-doc-missing">brak PDF listy produkcyjnej</span>
          )}
          {lc ? (
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => onOpenDocument(lc)} title={lc.file_name}>
              ✂️ Otwórz listę cięcia {lc.number ? `(${lc.number})` : ''}
            </button>
          ) : (
            <span className="alu-doc-missing">brak listy cięcia</span>
          )}
          {zm ? (
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => onOpenDocument(zm)} title={zm.file_name}>
              🪟 Otwórz ZM GLASS {zm.number ? `(${zm.number})` : ''}
            </button>
          ) : (
            <span className="alu-doc-missing">brak ZM GLASS</span>
          )}
          {isManager && !cancelled && (
            <>
              <button type="button" className="btn btn-sm btn-primary" disabled={uploading} onClick={() => pickFile('LC')}>
                {uploading && pendingKind === 'LC' ? 'Wgrywam…' : lc ? 'Zamień listę cięcia' : '+ Dodaj listę cięcia'}
              </button>
              <button type="button" className="btn btn-sm btn-primary" disabled={uploading} onClick={() => pickFile('ZM')} title="Zamówienie szyb do szklarza generowane w LiczOkna">
                {uploading && pendingKind === 'ZM' ? 'Wgrywam…' : zm ? 'Zamień ZM GLASS' : '+ Dodaj ZM GLASS'}
              </button>
              <button type="button" className="btn btn-sm btn-secondary" onClick={onReimport} title="Wgraj nową wersję listy produkcyjnej — pozycje zostaną nadpisane, oznaczone etapy zostają">
                Nowa wersja LP…
              </button>
              <input
                ref={lcInputRef}
                type="file"
                accept="application/pdf,.pdf"
                style={{ display: 'none' }}
                onChange={(e) => void onFilePicked(e.target.files?.[0] ?? null)}
              />
            </>
          )}
        </div>

        <AluPositionsTable positions={positions} />

        {/* ZKP 5.9 — numery konstrukcji; anulowane zostają (numer nie wraca do puli) */}
        {constructionsByPos.length > 0 && (
          <div className="alu-docs-row" style={{ flexWrap: 'wrap', alignItems: 'baseline' }}>
            <span className="alu-details-label">Numery konstrukcji</span>
            {constructionsByPos.map((c) => (
              <span
                key={c.id}
                className="badge badge-neutral"
                style={c.status === 'anulowana' ? { textDecoration: 'line-through', opacity: 0.55 } : undefined}
                title={
                  c.status === 'anulowana'
                    ? `Poz. ${c.pos_no}, sztuka ${c.piece_index} — anulowana: ${c.status_reason ?? ''}`
                    : `Poz. ${c.pos_no}, sztuka ${c.piece_index}`
                }
              >
                {c.construction_no}
              </span>
            ))}
          </div>
        )}
        </div>

        <div className="order-form-actions">
          {isManager && !cancelled && !released && onCancel && (
            <button type="button" className="btn btn-danger" onClick={onCancel} style={{ marginRight: 'auto' }}>
              Anuluj zlecenie
            </button>
          )}
          {isManager && !cancelled && !released && !production && positions.length > 0 && (
            <button type="button" className="btn btn-primary" disabled={starting} onClick={() => void handleStart()}>
              {starting ? 'Uruchamiam…' : '▶ Uruchom do produkcji'}
            </button>
          )}
          {canPrintLabels && pushToast && !cancelled && positions.length > 0 && (
            <button type="button" className="btn btn-primary" onClick={() => setLabelsOpen(true)}>
              🏷 Etykiety ({qty})
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={onClose}>Zamknij</button>
        </div>
      </div>
      {labelsOpen && pushToast && (
        <AluLabelPrintModal
          order={order}
          positions={positions}
          constructions={constructions}
          onClose={() => setLabelsOpen(false)}
          pushToast={pushToast}
        />
      )}
    </div>,
    document.body,
  )
}
