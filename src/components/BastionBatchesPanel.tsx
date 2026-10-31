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
  /** zlecenia Bastion po id (szczegóły w składzie partii, otwieranie) */
  ordersById: Map<number, Order>
  /** otwarte zlecenia z ościeżnicą „do partii", jeszcze bez partii */
  candidates: Order[]
  isManager: boolean
  /** kierownik albo pracownik z etapami Bastion — odhacza etapy partii i skręcanie */
  canMark: boolean
  currentInitials: string
  onCreateBatch: (orderIds: number[], notes: string) => Promise<number | null>
  onAddOrders: (batchId: number, orderIds: number[]) => Promise<boolean>
  onRemoveOrder: (batchId: number, orderId: number) => Promise<boolean>
  onDeleteBatch: (batchId: number) => Promise<boolean>
  onSetStage: (batchId: number, stageKey: string, value: string) => Promise<boolean>
  onSetNotes: (batchId: number, notes: string) => Promise<boolean>
  onOpenOrder?: (order: Order) => void
  /** skręcenie ościeżnicy = etap OŚĆ SKR. na zleceniu (ten sam mechanizm co w tabeli) */
  onMarkScrewed?: (orderId: number) => void | Promise<void>
}

const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10)
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`
}
const field = (o: Order, key: string) => String((o as Record<string, unknown>)[key] ?? '').trim()

/**
 * Podzakładka Bastion → Partie: lista partii ościeżnic regulowanych/opaskowych
 * (arkusz OŚC.REG. NOWE) + wybór zleceń do nowej partii. Etapy paneli/opasek
 * per partia (inicjały + data); skręcanie liczone ze zleceń (etap OŚĆ SKR.).
 */
export default function BastionBatchesPanel({
  batches,
  loading,
  busy,
  ordersById,
  candidates,
  isManager,
  canMark,
  currentInitials,
  onCreateBatch,
  onAddOrders,
  onRemoveOrder,
  onDeleteBatch,
  onSetStage,
  onSetNotes,
  onOpenOrder,
  onMarkScrewed,
}: Props) {
  const [showClosed, setShowClosed] = useState(false)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [search, setSearch] = useState('')
  const [screwingBatchId, setScrewingBatchId] = useState<number | null>(null)

  const visible = useMemo(() => batches.filter((b) => showClosed || b.status === 'open'), [batches, showClosed])
  const openBatches = useMemo(() => batches.filter((b) => b.status === 'open'), [batches])
  const closedCount = batches.length - openBatches.length

  const filteredCandidates = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rows = q
      ? candidates.filter((o) =>
          [o.order_number, o.company, field(o, 'bastion_frame_type'), o.frame_color, o.width, field(o, 'bastion_frame_range')]
            .join(' ')
            .toLowerCase()
            .includes(q),
        )
      : candidates
    return [...rows].sort((a, b) => String(b.order_number).localeCompare(String(a.order_number), 'pl', { numeric: true }))
  }, [candidates, search])

  // zaznaczenie tylko spośród aktualnych kandydatów (po utworzeniu partii znikają z listy)
  const selectedIds = useMemo(() => {
    const ids = new Set(candidates.map((o) => o.id as number))
    return [...selected].filter((id) => ids.has(id))
  }, [selected, candidates])
  const allVisibleSelected = filteredCandidates.length > 0 && filteredCandidates.every((o) => selected.has(o.id as number))

  const toggleOne = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const toggleAllVisible = () =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (allVisibleSelected) filteredCandidates.forEach((o) => next.delete(o.id as number))
      else filteredCandidates.forEach((o) => next.add(o.id as number))
      return next
    })
  const toggleExpanded = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const handleCreate = async () => {
    if (selectedIds.length === 0) return
    const notes = await appPrompt(
      `Utworzyć partię z ${selectedIds.length} zaznaczonych zleceń?\n\nNotatka (firma, kolor — opcjonalnie):`,
      { title: 'Nowa partia', confirmLabel: 'Utwórz partię' },
    )
    if (notes === null) return
    const id = await onCreateBatch(selectedIds, notes)
    if (id) {
      setSelected(new Set())
      setExpanded((prev) => new Set(prev).add(id))
    }
  }
  const handleAddTo = async (batchId: number) => {
    if (selectedIds.length === 0) return
    const ok = await onAddOrders(batchId, selectedIds)
    if (ok) setSelected(new Set())
  }

  const handleStage = async (b: BastionBatch, key: string) => {
    const def = BASTION_BATCH_STAGE_DEFS.find((d) => d.key === key)
    const cur = (b.stages[key]?.v ?? '').trim()
    if (cur) {
      const ok = await appConfirm(`Cofnąć etap „${def?.title ?? key}" partii ${b.batch_no} (${cur}, ${fmtDate(b.stages[key]?.at)})?`, {
        title: 'Cofnij etap partii',
        confirmLabel: 'Cofnij',
      })
      if (!ok) return
      await onSetStage(b.id, key, '')
      return
    }
    let initials = currentInitials.trim().toUpperCase()
    if (!initials) {
      const typed = await appPrompt('Brak inicjałów w profilu. Podaj inicjały:', { title: 'Etap partii' })
      if (!typed?.trim()) return
      initials = typed.trim().toUpperCase()
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

  // „Skręć całą partię": OŚĆ SKR. na każdym niedokręconym zleceniu po kolei
  const handleScrewAll = async (b: BastionBatch) => {
    if (!onMarkScrewed) return
    const pending = b.order_ids.filter((_, i) => !(b.order_screwed[i] ?? false))
    if (pending.length === 0) return
    const ok = await appConfirm(
      `Oznaczyć skręcenie ościeżnic dla ${pending.length} zleceń partii ${b.batch_no}? Ustawia etap „OŚĆ SKR." na każdym z nich; po komplecie partia zamknie się sama.`,
      { title: 'Skręć całą partię', confirmLabel: 'Oznacz skręcone' },
    )
    if (!ok) return
    setScrewingBatchId(b.id)
    try {
      for (const id of pending) await onMarkScrewed(id)
    } finally {
      setScrewingBatchId(null)
    }
  }

  return (
    <div className="bastion-batches">
      {/* ── partie ─────────────────────────────────────────────── */}
      <section className="bastion-batches-section">
        <div className="bastion-batches-toolbar">
          <h3 className="bastion-batches-title">
            Partie ościeżnic
            <span className="bastion-batches-count">otwarte: {openBatches.length}</span>
            {closedCount > 0 && <span className="bastion-batches-count bastion-batches-count--muted">zamknięte: {closedCount}</span>}
          </h3>
          <label className="bastion-batches-toggle">
            <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> pokaż zamknięte
          </label>
        </div>
        {loading && batches.length === 0 ? (
          <p className="muted">Wczytywanie partii…</p>
        ) : visible.length === 0 ? (
          <p className="muted bastion-batches-empty">
            {showClosed ? 'Brak partii.' : 'Brak otwartych partii.'}{isManager && candidates.length > 0 ? ' Zaznacz zlecenia poniżej i utwórz pierwszą.' : ''}
          </p>
        ) : (
          <div className="table-wrapper bastion-batches-wrapper">
            <table className="orders-table dt-table bastion-batches-table">
              <thead>
                <tr>
                  <th rowSpan={2} className="bastion-th-no">PARTIA</th>
                  <th rowSpan={2}>DATA</th>
                  <th rowSpan={2}>ZLECENIA</th>
                  <th colSpan={5} className="bastion-batches-group-th">PANELE</th>
                  <th colSpan={2} className="bastion-batches-group-th">OPASKI</th>
                  <th rowSpan={2} title="Skręcanie ościeżnic — liczone z etapu OŚĆ SKR. na zleceniach; komplet zamyka partię">SKRĘCANIE</th>
                  <th rowSpan={2}>NOTATKA</th>
                  {isManager && <th rowSpan={2} className="bastion-th-actions">AKCJE</th>}
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
                {visible.map((b) => (
                  <BatchRows
                    key={b.id}
                    b={b}
                    isOpen={expanded.has(b.id)}
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
                    onMarkScrewed={onMarkScrewed}
                    onScrewAll={() => void handleScrewAll(b)}
                    screwingAll={screwingBatchId === b.id}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── zlecenia do partii ──────────────────────────────────── */}
      {isManager && (
        <section className="bastion-batches-section">
          <div className="bastion-batches-toolbar">
            <h3 className="bastion-batches-title">
              Zlecenia do partii
              <span className="bastion-batches-count">{candidates.length} bez partii</span>
            </h3>
            <div className="bastion-batches-actions">
              <input
                type="search"
                className="search-input bastion-picker-search"
                placeholder="Szukaj: numer, firma, ościeżnica, kolor…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button type="button" className="btn btn-sm btn-primary" disabled={busy || selectedIds.length === 0} onClick={() => void handleCreate()}>
                Utwórz partię{selectedIds.length > 0 ? ` (${selectedIds.length})` : ''}
              </button>
              {openBatches.length > 0 && (
                <select
                  className="day-filter"
                  value=""
                  disabled={busy || selectedIds.length === 0}
                  onChange={(e) => {
                    const id = Number(e.target.value)
                    if (id) void handleAddTo(id)
                  }}
                  title="Dołóż zaznaczone zlecenia do otwartej partii"
                >
                  <option value="">Dołóż do partii…</option>
                  {openBatches.map((b) => (
                    <option key={b.id} value={b.id}>
                      partia {b.batch_no} ({b.items_count} zl.)
                    </option>
                  ))}
                </select>
              )}
              {selectedIds.length > 0 && (
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => setSelected(new Set())}>
                  Odznacz
                </button>
              )}
            </div>
          </div>
          {candidates.length === 0 ? (
            <p className="muted bastion-batches-empty">
              Brak otwartych zleceń z ościeżnicą „do partii" (regulowana, opaskowa, zabudowa — flaga w Konfiguracji → Bastion → Ościeżnica).
            </p>
          ) : filteredCandidates.length === 0 ? (
            <p className="muted bastion-batches-empty">Nic nie pasuje do „{search}".</p>
          ) : (
            <div className="table-wrapper bastion-picker-wrapper">
              <table className="orders-table dt-table bastion-picker-table">
                <thead>
                  <tr>
                    <th className="bastion-picker-check">
                      <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} title="Zaznacz / odznacz wszystkie widoczne" />
                    </th>
                    <th>NR</th>
                    <th>FIRMA</th>
                    <th>DATA</th>
                    <th>DZIEŃ PROD.</th>
                    <th>OŚCIEŻNICA</th>
                    <th>ZAKRES</th>
                    <th>KOLOR OŚC.</th>
                    <th>SZER.</th>
                    <th>KIERUNEK</th>
                    <th>ILOŚĆ</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCandidates.map((o) => {
                    const id = o.id as number
                    const checked = selected.has(id)
                    return (
                      <tr key={id} className={checked ? 'bastion-picker-row bastion-picker-row--checked' : 'bastion-picker-row'} onClick={() => toggleOne(id)}>
                        <td className="bastion-picker-check" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={checked} onChange={() => toggleOne(id)} />
                        </td>
                        <td className="order-num-td">
                          <button
                            type="button"
                            className="bastion-batch-item-num"
                            onClick={(e) => {
                              e.stopPropagation()
                              onOpenOrder?.(o)
                            }}
                            disabled={!onOpenOrder}
                            title="Otwórz zlecenie"
                          >
                            {o.order_number}
                          </button>
                        </td>
                        <td>{o.company}</td>
                        <td>{fmtDate(o.order_date)}</td>
                        <td>{o.production_day ?? ''}</td>
                        <td>{field(o, 'bastion_frame_type')}</td>
                        <td>{field(o, 'bastion_frame_range')}</td>
                        <td>{o.frame_color}</td>
                        <td>{o.width}</td>
                        <td>{o.direction}</td>
                        <td>{o.quantity ?? 1}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  )
}

type RowProps = {
  b: BastionBatch
  isOpen: boolean
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
  onMarkScrewed?: (orderId: number) => void | Promise<void>
  onScrewAll: () => void
  screwingAll: boolean
}

function BatchRows({ b, isOpen, busy, isManager, canMark, ordersById, onToggle, onStage, onNotes, onDelete, onRemove, onOpenOrder, onMarkScrewed, onScrewAll, screwingAll }: RowProps) {
  const closed = b.status === 'closed'
  const colSpan = 11 + (isManager ? 1 : 0)
  const progress = batchStageProgress(b)
  const range = screwingRangeLabel(b)
  const allScrewed = b.items_count > 0 && b.screwed_count === b.items_count
  return (
    <>
      <tr className={`bastion-batch-row${closed ? ' bastion-batch-row--closed' : ''}`}>
        <td className="bastion-th-no">
          <button type="button" className="bastion-batch-no" onClick={onToggle} title={isOpen ? 'Zwiń skład partii' : 'Pokaż skład partii'}>
            <span className="bastion-batch-caret">{isOpen ? '▾' : '▸'}</span>
            <span className="bastion-batch-chip bastion-batch-chip--lg">{b.batch_no}</span>
          </button>
          {closed && <div className="bastion-batch-closed" title={`Zamknięta ${fmtDate(b.closed_at)}`}>zamknięta {fmtDate(b.closed_at)}</div>}
        </td>
        <td>{fmtDate(b.created_at)}</td>
        <td title={b.order_numbers.join(', ')}>
          <strong>{b.items_count}</strong>
          <div className="bastion-batch-nums">{b.order_numbers.slice(0, 6).join(', ')}{b.order_numbers.length > 6 ? '…' : ''}</div>
        </td>
        {BASTION_BATCH_STAGE_DEFS.map((d) => {
          const st = b.stages[d.key]
          return (
            <td key={d.key} className="production-stage-td col-stage" title={st?.v ? `${d.title}: ${st.v} · ${fmtDate(st.at)}` : d.title}>
              <ProductionStageCell value={st?.v ?? ''} disabled={busy || !canMark} onPickEmpty={() => onStage(d.key)} onPickFilled={() => onStage(d.key)} />
              {st?.at && <div className="bastion-stage-date">{fmtDate(st.at).slice(0, 5)}</div>}
            </td>
          )
        })}
        <td title={`Etapy partii: ${progress}/${BASTION_BATCH_STAGE_DEFS.length}`}>
          <div className={allScrewed ? 'bastion-batch-screw bastion-batch-screw--done' : 'bastion-batch-screw'}>
            {b.screwed_count}/{b.items_count}
            {range && <span className="bastion-batch-screw-range">{range}</span>}
          </div>
          {canMark && onMarkScrewed && !allScrewed && (
            <button type="button" className="btn btn-sm btn-secondary bastion-batch-screw-all" disabled={busy || screwingAll} onClick={onScrewAll} title="Oznacz skręcenie ościeżnic na wszystkich niedokręconych zleceniach partii (etap OŚĆ SKR.)">
              {screwingAll ? 'Oznaczam…' : 'Skręć całą partię'}
            </button>
          )}
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
          <td className="bastion-th-actions">
            <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={onDelete} title="Usuń partię (zlecenia wracają do puli)">
              Usuń
            </button>
          </td>
        )}
      </tr>
      {isOpen && (
        <tr className="bastion-batch-items-row">
          <td colSpan={colSpan}>
            <table className="bastion-batch-items">
              <tbody>
                {b.order_ids.map((id, i) => {
                  const o = ordersById.get(id)
                  const num = b.order_numbers[i] ?? String(id)
                  const screwed = b.order_screwed[i] ?? false
                  return (
                    <tr key={id} className={screwed ? 'bastion-batch-item bastion-batch-item--screwed' : 'bastion-batch-item'}>
                      <td className="bastion-batch-item-numcell">
                        <button type="button" className="bastion-batch-item-num" onClick={() => o && onOpenOrder?.(o)} disabled={!o || !onOpenOrder} title={o ? 'Otwórz zlecenie' : 'Zlecenie poza bieżącą listą (zrealizowane / filtr)'}>
                          {num}
                        </button>
                      </td>
                      <td>{o?.company ?? ''}</td>
                      <td>{o ? field(o, 'bastion_frame_type') : ''}</td>
                      <td>{o ? field(o, 'bastion_frame_range') : ''}</td>
                      <td>{o?.frame_color ?? ''}</td>
                      <td>{o?.width ?? ''}</td>
                      <td>{o?.direction ?? ''}</td>
                      <td className="bastion-batch-item-state">
                        {screwed || !canMark || !onMarkScrewed ? (
                          <span className={screwed ? 'bastion-batch-item-flag bastion-batch-item-flag--ok' : 'bastion-batch-item-flag'}>
                            {screwed ? 'skręcona' : 'do skręcenia'}
                          </span>
                        ) : (
                          <button type="button" className="btn btn-sm btn-secondary" disabled={busy || screwingAll} onClick={() => void onMarkScrewed(id)} title="Oznacz skręconą (etap OŚĆ SKR. na zleceniu)">
                            Skręcona ✓
                          </button>
                        )}
                      </td>
                      <td className="bastion-batch-item-actions">
                        {isManager && (
                          <button type="button" className="bastion-batch-item-remove" disabled={busy} onClick={() => onRemove(id, num)} title="Wyjmij z partii">
                            ✕
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  )
}
