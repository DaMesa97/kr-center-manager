import { useMemo, useState } from 'react'
import ProductionStageCell from './ProductionStageCell'
import { appConfirm, appPrompt } from '../lib/appDialogs'
import {
  BASTION_BATCH_STAGE_DEFS,
  batchStageProgress,
  screwingRangeLabel,
  type BastionBatch,
} from '../lib/bastionBatches'
import type { Order } from '../types'

type Props = {
  batches: BastionBatch[]
  loading: boolean
  busy: boolean
  /** zlecenia do pokazania w rozwinięciu partii (po id) — te, które tabela ma wczytane */
  ordersById: Map<number, Order>
  isManager: boolean
  /** kierownik albo pracownik z etapami Bastion — odhacza etapy partii */
  canMark: boolean
  currentInitials: string
  selectedCount: number
  onCreateFromSelection: (notes: string) => Promise<void>
  onAddSelectionToBatch: (batchId: number) => Promise<void>
  onClearSelection: () => void
  onRemoveOrder: (batchId: number, orderId: number) => Promise<boolean>
  onDeleteBatch: (batchId: number) => Promise<boolean>
  onSetStage: (batchId: number, stageKey: string, value: string) => Promise<boolean>
  onSetNotes: (batchId: number, notes: string) => Promise<boolean>
  onOpenOrder?: (order: Order) => void
}

const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`
}

/**
 * Partie ościeżnic regulowanych/opaskowych (arkusz OŚC.REG. NOWE):
 * wiersz = partia, 7 etapów paneli/opasek odhaczanych inicjałami, skręcanie
 * liczone ze zleceń (x/y + zakres dat), skład partii w rozwinięciu.
 */
export default function BastionBatchesPanel({
  batches,
  loading,
  busy,
  ordersById,
  isManager,
  canMark,
  currentInitials,
  selectedCount,
  onCreateFromSelection,
  onAddSelectionToBatch,
  onClearSelection,
  onRemoveOrder,
  onDeleteBatch,
  onSetStage,
  onSetNotes,
  onOpenOrder,
}: Props) {
  const [showClosed, setShowClosed] = useState(false)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  const visible = useMemo(
    () => batches.filter((b) => showClosed || b.status === 'open'),
    [batches, showClosed],
  )
  const closedCount = useMemo(() => batches.filter((b) => b.status === 'closed').length, [batches])
  const openBatches = useMemo(() => batches.filter((b) => b.status === 'open'), [batches])

  const toggleExpanded = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const handleCreate = async () => {
    const notes = await appPrompt(
      `Utworzyć partię z ${selectedCount} zaznaczonych zleceń?\n\nNotatka (firma, kolor — opcjonalnie):`,
      { title: 'Nowa partia', confirmLabel: 'Utwórz partię' },
    )
    if (notes === null) return
    await onCreateFromSelection(notes)
  }

  const handleStage = async (b: BastionBatch, key: string) => {
    const cur = (b.stages[key]?.v ?? '').trim()
    if (cur) {
      const ok = await appConfirm(`Cofnąć etap „${BASTION_BATCH_STAGE_DEFS.find((d) => d.key === key)?.title ?? key}" partii ${b.batch_no} (${cur})?`, {
        title: 'Cofnij etap partii',
        confirmLabel: 'Cofnij',
      })
      if (!ok) return
      await onSetStage(b.id, key, '')
      return
    }
    const initials = currentInitials.trim()
    if (!initials) {
      const typed = await appPrompt('Brak inicjałów w profilu. Podaj inicjały:', { title: 'Etap partii' })
      if (!typed?.trim()) return
      await onSetStage(b.id, key, typed.trim().toUpperCase())
      return
    }
    await onSetStage(b.id, key, initials)
  }

  const handleNotes = async (b: BastionBatch) => {
    const v = await appPrompt(
      `Notatka partii ${b.batch_no}${b.notes?.trim() ? ` (obecna: „${b.notes}")` : ''}.\nPusta = usuń notatkę:`,
      { title: 'Notatka partii', confirmLabel: 'Zapisz' },
    )
    if (v === null) return
    await onSetNotes(b.id, v)
  }

  const handleDelete = async (b: BastionBatch) => {
    const ok = await appConfirm(
      `Usunąć partię ${b.batch_no}? ${b.items_count} zleceń wróci do puli bez partii. Etapy partii przepadną.`,
      { title: 'Usuń partię', confirmLabel: 'Usuń', tone: 'danger' },
    )
    if (!ok) return
    await onDeleteBatch(b.id)
  }

  const handleRemove = async (b: BastionBatch, orderId: number, orderNumber: string) => {
    const ok = await appConfirm(`Wyjąć zlecenie ${orderNumber} z partii ${b.batch_no}?`, { title: 'Wyjmij z partii', confirmLabel: 'Wyjmij' })
    if (!ok) return
    await onRemoveOrder(b.id, orderId)
  }

  return (
    <section className="bastion-batches">
      <div className="bastion-batches-toolbar">
        <h3 className="bastion-batches-title">
          Partie ościeżnic regulowanych
          <span className="muted"> · otwarte: {openBatches.length}{closedCount > 0 ? ` · zamknięte: ${closedCount}` : ''}</span>
        </h3>
        <div className="bastion-batches-actions">
          {isManager && (
            <>
              <button type="button" className="btn btn-sm btn-primary" disabled={busy || selectedCount === 0} onClick={() => void handleCreate()}>
                Utwórz partię z zaznaczonych{selectedCount > 0 ? ` (${selectedCount})` : ''}
              </button>
              {selectedCount > 0 && openBatches.length > 0 && (
                <select
                  className="day-filter"
                  value=""
                  disabled={busy}
                  onChange={(e) => {
                    const id = Number(e.target.value)
                    if (id) void onAddSelectionToBatch(id)
                  }}
                  title="Dołóż zaznaczone zlecenia do istniejącej otwartej partii"
                >
                  <option value="">Dołóż do partii…</option>
                  {openBatches.map((b) => (
                    <option key={b.id} value={b.id}>
                      partia {b.batch_no} ({b.items_count} zl.)
                    </option>
                  ))}
                </select>
              )}
              {selectedCount > 0 && (
                <button type="button" className="btn btn-sm btn-secondary" onClick={onClearSelection}>
                  Odznacz
                </button>
              )}
            </>
          )}
          <label className="bastion-batches-toggle">
            <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> pokaż zamknięte
          </label>
        </div>
      </div>
      {isManager && selectedCount === 0 && openBatches.length === 0 && !loading && (
        <p className="muted bastion-batches-hint">
          Zaznacz zlecenia w tabeli poniżej (checkbox przy numerze) i kliknij „Utwórz partię". Do partii wchodzą ościeżnice
          z flagą „partia" w słowniku (regulowana, opaskowa, zabudowa).
        </p>
      )}
      {loading && batches.length === 0 ? (
        <p className="muted">Wczytywanie partii…</p>
      ) : visible.length === 0 ? (
        <p className="muted">Brak {showClosed ? '' : 'otwartych '}partii.</p>
      ) : (
        <div className="table-wrapper bastion-batches-wrapper">
          <table className="orders-table dt-table bastion-batches-table">
            <thead>
              <tr>
                <th rowSpan={2}>PARTIA</th>
                <th rowSpan={2}>DATA</th>
                <th rowSpan={2}>ZLECENIA</th>
                <th colSpan={5} className="bastion-batches-group-th">PANELE</th>
                <th colSpan={2} className="bastion-batches-group-th">OPASKI</th>
                <th rowSpan={2} title="Skręcanie ościeżnic — liczone z etapu OŚĆ SKR. na zleceniach; komplet zamyka partię">SKRĘCANIE KPL</th>
                <th rowSpan={2}>NOTATKA</th>
                {isManager && <th rowSpan={2}>AKCJE</th>}
              </tr>
              <tr>
                {BASTION_BATCH_STAGE_DEFS.map((d) => (
                  <th key={d.key} className="production-stage-th col-stage" title={d.title}>
                    {d.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((b) => {
                const isOpen = expanded.has(b.id)
                const progress = batchStageProgress(b)
                const range = screwingRangeLabel(b)
                return (
                  <BatchRows
                    key={b.id}
                    b={b}
                    isOpen={isOpen}
                    progress={progress}
                    range={range}
                    busy={busy}
                    isManager={isManager}
                    canMark={canMark}
                    ordersById={ordersById}
                    onToggle={() => toggleExpanded(b.id)}
                    onStage={(key) => void handleStage(b, key)}
                    onNotes={() => void handleNotes(b)}
                    onDelete={() => void handleDelete(b)}
                    onRemove={(orderId, num) => void handleRemove(b, orderId, num)}
                    onOpenOrder={onOpenOrder}
                  />
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

type RowProps = {
  b: BastionBatch
  isOpen: boolean
  progress: number
  range: string
  busy: boolean
  isManager: boolean
  canMark: boolean
  ordersById: Map<number, Order>
  onToggle: () => void
  onStage: (key: string) => void
  onNotes: () => void
  onDelete: () => void
  onRemove: (orderId: number, orderNumber: string) => void
  onOpenOrder?: (order: Order) => void
}

function BatchRows({ b, isOpen, progress, range, busy, isManager, canMark, ordersById, onToggle, onStage, onNotes, onDelete, onRemove, onOpenOrder }: RowProps) {
  const closed = b.status === 'closed'
  const colSpan = 11 + (isManager ? 1 : 0)
  return (
    <>
      <tr className={`bastion-batch-row${closed ? ' bastion-batch-row--closed' : ''}`}>
        <td className="order-num-td">
          <button type="button" className="bastion-batch-no" onClick={onToggle} title={isOpen ? 'Zwiń skład partii' : 'Pokaż skład partii'}>
            {isOpen ? '▾' : '▸'} <strong>{b.batch_no}</strong>
          </button>
          {closed && <span className="released-badge order-badge" title={`Zamknięta ${fmtDate(b.closed_at)}`}>ZAMKNIĘTA</span>}
        </td>
        <td>{fmtDate(b.created_at)}</td>
        <td title={b.order_numbers.join(', ')}>
          <strong>{b.items_count}</strong>
          <span className="muted"> · {b.order_numbers.slice(0, 6).join(', ')}{b.order_numbers.length > 6 ? '…' : ''}</span>
        </td>
        {BASTION_BATCH_STAGE_DEFS.map((d) => {
          const st = b.stages[d.key]
          return (
            <td key={d.key} className="production-stage-td col-stage" title={st?.v ? `${st.v} · ${fmtDate(st.at)}` : d.title}>
              <ProductionStageCell
                value={st?.v ?? ''}
                disabled={busy || !canMark}
                onPickEmpty={() => onStage(d.key)}
                onPickFilled={() => onStage(d.key)}
              />
            </td>
          )
        })}
        <td title={`Etapy partii: ${progress}/${BASTION_BATCH_STAGE_DEFS.length}`}>
          <span className={b.screwed_count === b.items_count && b.items_count > 0 ? 'bastion-batch-screw bastion-batch-screw--done' : 'bastion-batch-screw'}>
            {b.screwed_count}/{b.items_count}
          </span>
          {range && <div className="muted" style={{ fontSize: '0.78rem' }}>{range}</div>}
        </td>
        <td className="col-notes">
          {isManager ? (
            <button type="button" className="bastion-batch-notes-btn" onClick={onNotes} title="Edytuj notatkę">
              {b.notes?.trim() ? b.notes : <span className="muted">— dodaj —</span>}
            </button>
          ) : (
            b.notes ?? ''
          )}
        </td>
        {isManager && (
          <td>
            <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={onDelete} title="Usuń partię (zlecenia wracają do puli)">
              Usuń
            </button>
          </td>
        )}
      </tr>
      {isOpen && (
        <tr className="bastion-batch-items-row">
          <td colSpan={colSpan}>
            <ul className="bastion-batch-items">
              {b.order_ids.map((id, i) => {
                const o = ordersById.get(id)
                const num = b.order_numbers[i] ?? String(id)
                const screwed = b.order_screwed[i] ?? false
                return (
                  <li key={id} className={screwed ? 'bastion-batch-item bastion-batch-item--screwed' : 'bastion-batch-item'}>
                    <button
                      type="button"
                      className="bastion-batch-item-num"
                      onClick={() => o && onOpenOrder?.(o)}
                      disabled={!o || !onOpenOrder}
                      title={o ? 'Otwórz zlecenie' : 'Zlecenie poza bieżącą listą (filtr / zrealizowane)'}
                    >
                      {num}
                    </button>
                    <span className="muted">
                      {o ? ` ${o.company ?? ''} · ${String((o as Record<string, unknown>).bastion_frame_type ?? '')} · ${o.frame_color ?? ''} · ${o.width ?? ''}` : ''}
                    </span>
                    <span className={screwed ? 'bastion-batch-item-flag bastion-batch-item-flag--ok' : 'bastion-batch-item-flag'}>
                      {screwed ? 'skręcona' : 'do skręcenia'}
                    </span>
                    {isManager && (
                      <button type="button" className="btn btn-sm btn-secondary" disabled={busy} onClick={() => onRemove(id, num)} title="Wyjmij z partii">
                        ✕
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          </td>
        </tr>
      )}
    </>
  )
}
