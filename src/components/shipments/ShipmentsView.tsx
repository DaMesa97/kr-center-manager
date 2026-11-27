import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import Spinner from '../Spinner'
import { CATEGORY_LABELS } from '../../constants'
import { useDniWolne } from '../../hooks/useDniWolne'
import { useShipments, type PendingOrder, type ShipmentWithOrders } from '../../hooks/useShipments'
import {
  SHIPMENT_STATUS_LABELS,
  canEditPallets,
  commonBl,
  daySummary,
  groupByBl,
  groupByDate,
  isoDate,
  nextWorkingDay,
} from '../../lib/shipments'
import type { ToastVariant } from '../../types'

type Props = {
  /** zapis: kierownik / magazynier / obsługa klienta (jak RLS order_shipments) */
  canEdit: boolean
  pushToast: (msg: string, variant: ToastVariant) => void
}

const catLabel = (c: string) => (CATEGORY_LABELS as Record<string, string>)[c] ?? c
const dataPl = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric', month: 'numeric' }) : 'bez daty')

/**
 * Wysyłki kurierem (SUUS) — ekran magazyniera (27.11): „Do wysyłki” (zlecenia Po Drzwi
 * pogrupowane po nr BL) → „Wysyłka kurierem” (data, palety z podpowiedzi) → „Zaplanowane”
 * (Gotowe / Nadane / Anuluj). Palety schodzą z Bukowej same (trigger w bazie) przy „Gotowe”.
 */
export default function ShipmentsView({ canEdit, pushToast }: Props) {
  const { pending, shipments, loading, load, suggestPallets, createShipment, updateShipment, setStatus, cancelShipment } = useShipments(pushToast)
  const dniWolne = useDniWolne()
  const [tab, setTab] = useState<'do' | 'plan'>('do')
  const [day, setDay] = useState(() => isoDate(new Date()))
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [plan, setPlan] = useState<null | { orders: PendingOrder[]; bl: string; suggested: { vertical: number; horizontal: number } }>(null)
  const [busy, setBusy] = useState(false)

  const summary = useMemo(() => daySummary(shipments, day), [shipments, day])

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return pending
    return pending.filter((o) =>
      [o.bl, o.client, o.order_number, o.client_order_number, o.items, catLabel(o.category)].filter(Boolean).join(' ').toLowerCase().includes(t),
    )
  }, [pending, q])
  const groups = useMemo(() => groupByBl(filtered), [filtered])
  const byDate = useMemo(() => groupByDate(shipments), [shipments])

  const toggle = (id: number) =>
    setSelected((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const otworzPlan = async (orders: PendingOrder[]) => {
    if (!canEdit || orders.length === 0) return
    setBusy(true)
    const suggested = await suggestPallets(orders.map((o) => o.id))
    setBusy(false)
    setPlan({ orders, bl: commonBl(orders), suggested })
  }

  return (
    <div className="shipments-view">
      <div className="shipments-summary">
        <label className="shipments-summary-date">
          <span>Dzień</span>
          <input type="date" value={day} onChange={(e) => setDay(e.target.value || isoDate(new Date()))} />
        </label>
        <div className="shipments-summary-stat"><strong>{summary.count}</strong><span>wysyłek</span></div>
        <div className="shipments-summary-stat"><strong>{summary.vertical}</strong><span>palet pionowych</span></div>
        <div className="shipments-summary-stat"><strong>{summary.horizontal}</strong><span>palet poziomych</span></div>
        <button type="button" className="btn btn-secondary shipments-btn" onClick={() => void load()} disabled={loading}>
          {loading ? 'Odświeżam…' : 'Odśwież'}
        </button>
      </div>

      <div className="subtab-bar" role="tablist" aria-label="Wysyłki">
        <button type="button" role="tab" aria-selected={tab === 'do'} className={`btn ${tab === 'do' ? 'btn-primary' : 'btn-secondary'} shipments-btn`} onClick={() => setTab('do')}>
          Do wysyłki ({pending.length})
        </button>
        <button type="button" role="tab" aria-selected={tab === 'plan'} className={`btn ${tab === 'plan' ? 'btn-primary' : 'btn-secondary'} shipments-btn`} onClick={() => setTab('plan')}>
          Zaplanowane ({shipments.length})
        </button>
      </div>

      {loading && pending.length === 0 && shipments.length === 0 ? (
        <Spinner center label="Wczytywanie wysyłek…" />
      ) : tab === 'do' ? (
        <>
          <div className="shipments-toolbar">
            <input type="text" className="search-input" placeholder="Szukaj: nr BL, klient, nr zlecenia, model…" value={q} onChange={(e) => setQ(e.target.value)} />
            {canEdit && selected.size > 0 && (
              <button
                type="button"
                className="btn btn-success shipments-btn"
                disabled={busy}
                onClick={() => void otworzPlan(pending.filter((o) => selected.has(o.id)))}
              >
                Wysyłka kurierem — zaznaczone ({selected.size})
              </button>
            )}
          </div>
          {groups.length === 0 && <p className="muted">Brak zleceń Po Drzwi do wysłania.</p>}
          <div className="shipments-groups">
            {groups.map((g) => (
              <section key={g.key} className="shipments-group">
                <header className="shipments-group-head">
                  <div>
                    <div className="shipments-group-bl">{g.bl ? `BL ${g.bl}` : 'bez nr BL'}</div>
                    <div className="shipments-group-client">{[...new Set(g.rows.map((r) => r.client).filter(Boolean))].join(', ') || '—'}</div>
                  </div>
                  {canEdit && (
                    <button type="button" className="btn btn-primary shipments-btn" disabled={busy} onClick={() => void otworzPlan(g.rows)}>
                      Wysyłka kurierem{g.rows.length > 1 ? ` (${g.rows.length} zlec.)` : ''}
                    </button>
                  )}
                </header>
                <table className="shipments-table">
                  <thead>
                    <tr>
                      {canEdit && <th aria-label="Zaznacz" />}
                      <th>Nr zlecenia</th>
                      <th>Kategoria</th>
                      <th>Model / pozycje</th>
                      <th>Ilość</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((o) => (
                      <tr key={o.id} className={selected.has(o.id) ? 'shipments-row--sel' : undefined} onClick={canEdit ? () => toggle(o.id) : undefined}>
                        {canEdit && (
                          <td onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" className="shipments-check" checked={selected.has(o.id)} onChange={() => toggle(o.id)} aria-label={`Zaznacz ${o.order_number ?? o.id}`} />
                          </td>
                        )}
                        <td><strong>{o.order_number ?? `#${o.id}`}</strong></td>
                        <td>{catLabel(o.category)}</td>
                        <td className="shipments-items">{o.items || '—'}</td>
                        <td>{o.quantity ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ))}
          </div>
        </>
      ) : (
        <div className="shipments-days">
          {byDate.length === 0 && <p className="muted">Brak zaplanowanych wysyłek.</p>}
          {byDate.map((d) => (
            <section key={d.date ?? 'brak'} className="shipments-day">
              <h3 className="shipments-day-title">
                {dataPl(d.date)} {d.date && <span className="muted">({d.date})</span>}
                <span className="shipments-day-sum">
                  {(() => {
                    const s = daySummary(d.rows, d.date ?? '')
                    return d.date ? `${s.count} wys. · pion. ${s.vertical} · poz. ${s.horizontal}` : ''
                  })()}
                </span>
              </h3>
              {d.rows.map((s) => (
                <ShipmentCard key={s.id} s={s} canEdit={canEdit} onStatus={setStatus} onUpdate={updateShipment} onCancel={cancelShipment} />
              ))}
            </section>
          ))}
        </div>
      )}

      {plan && (
        <PlanModal
          orders={plan.orders}
          bl={plan.bl}
          suggested={plan.suggested}
          defaultDate={nextWorkingDay(new Date(), dniWolne)}
          onClose={() => setPlan(null)}
          onSave={async (v) => {
            const ok = await createShipment({ orderIds: plan.orders.map((o) => o.id), bl: plan.bl, suggested: plan.suggested, ...v })
            if (ok) {
              setPlan(null)
              setSelected(new Set())
            }
            return ok
          }}
        />
      )}
    </div>
  )
}

function Counter({ label, value, onChange, hint }: { label: string; value: number; onChange: (n: number) => void; hint?: string }) {
  return (
    <div className="shipments-counter">
      <span className="shipments-counter-label">{label}</span>
      <div className="shipments-counter-row">
        <button type="button" className="btn btn-secondary shipments-counter-btn" onClick={() => onChange(Math.max(0, value - 1))} aria-label={`${label}: mniej`}>−</button>
        <span className="shipments-counter-value">{value}</span>
        <button type="button" className="btn btn-secondary shipments-counter-btn" onClick={() => onChange(value + 1)} aria-label={`${label}: więcej`}>+</button>
      </div>
      {hint && <span className="muted shipments-counter-hint">{hint}</span>}
    </div>
  )
}

function PlanModal({
  orders,
  bl,
  suggested,
  defaultDate,
  onClose,
  onSave,
}: {
  orders: PendingOrder[]
  bl: string
  suggested: { vertical: number; horizontal: number }
  defaultDate: string
  onClose: () => void
  onSave: (v: { shipDate: string; vertical: number; horizontal: number; notes: string }) => Promise<boolean>
}) {
  const [shipDate, setShipDate] = useState(defaultDate)
  const [vertical, setVertical] = useState(suggested.vertical)
  const [horizontal, setHorizontal] = useState(suggested.horizontal)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  return createPortal(
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={() => { if (!saving) onClose() }}>
      <div className="order-modal shipments-modal" onClick={(e) => e.stopPropagation()}>
        <div className="order-modal-header">
          <h2>Wysyłka kurierem{bl ? ` — BL ${bl}` : ''}</h2>
          <button type="button" className="btn btn-icon btn-ghost" onClick={onClose} disabled={saving}>X</button>
        </div>
        <div className="shipments-modal-body">
          <p className="shipments-modal-orders">
            {orders.map((o) => `${o.order_number ?? `#${o.id}`}${o.client ? ` (${o.client})` : ''}`).join(', ')}
          </p>
          <label className="shipments-field">
            <span>Data wysyłki</span>
            <input type="date" value={shipDate} onChange={(e) => setShipDate(e.target.value)} />
          </label>
          <div className="shipments-counters">
            <Counter label="Palety pionowe" value={vertical} onChange={setVertical} hint={`podpowiedź: ${suggested.vertical}`} />
            <Counter label="Palety poziome" value={horizontal} onChange={setHorizontal} hint={`podpowiedź: ${suggested.horizontal}`} />
          </div>
          <label className="shipments-field">
            <span>Uwagi</span>
            <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="np. zadzwonić przed dostawą" />
          </label>
        </div>
        <div className="order-form-actions">
          <button
            type="button"
            className="btn btn-success shipments-btn"
            disabled={saving}
            onClick={async () => {
              setSaving(true)
              const ok = await onSave({ shipDate, vertical, horizontal, notes })
              if (!ok) setSaving(false)
            }}
          >
            {saving ? 'Zapisywanie…' : 'Zaplanuj wysyłkę'}
          </button>
          <button type="button" className="btn btn-secondary shipments-btn" onClick={onClose} disabled={saving}>Anuluj</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function ShipmentCard({
  s,
  canEdit,
  onStatus,
  onUpdate,
  onCancel,
}: {
  s: ShipmentWithOrders
  canEdit: boolean
  onStatus: (id: number, status: ShipmentWithOrders['status'], msg: string) => Promise<boolean>
  onUpdate: (id: number, patch: { pallets_vertical: number; pallets_horizontal: number }, msg?: string) => Promise<boolean>
  onCancel: (s: ShipmentWithOrders) => Promise<boolean>
}) {
  const [edit, setEdit] = useState(false)
  const [v, setV] = useState(s.pallets_vertical)
  const [h, setH] = useState(s.pallets_horizontal)
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<boolean>) => {
    setBusy(true)
    await fn()
    setBusy(false)
  }
  const clients = [...new Set(s.orders.map((o) => o.client).filter(Boolean))].join(', ')
  return (
    <article className={`shipments-card shipments-card--${s.status}`}>
      <div className="shipments-card-main">
        <div className="shipments-card-title">
          <strong>{s.bl_order_id ? `BL ${s.bl_order_id}` : `Wysyłka #${s.id}`}</strong>
          {clients && <span> · {clients}</span>}
          <span className={`shipments-status shipments-status--${s.status}`}>{SHIPMENT_STATUS_LABELS[s.status]}</span>
        </div>
        <div className="shipments-card-orders">
          {s.orders.map((o) => `${o.order_number ?? `#${o.id}`} (${catLabel(o.category)}${o.quantity ? `, ${o.quantity} szt.` : ''})`).join(' · ') || 'brak zleceń'}
        </div>
        <div className="shipments-card-meta">
          <span>Palety: pionowe <strong>{s.pallets_vertical}</strong>, poziome <strong>{s.pallets_horizontal}</strong></span>
          {s.pallets_suggested && (
            <span className="muted"> (podpowiedź {s.pallets_suggested.vertical ?? 0}/{s.pallets_suggested.horizontal ?? 0})</span>
          )}
          <span> · {s.carrier}</span>
          {s.bl_package_number && <span> · przesyłka <strong>{s.bl_package_number}</strong></span>}
          {s.notes && <span> · {s.notes}</span>}
        </div>
        {edit && (
          <div className="shipments-counters">
            <Counter label="Palety pionowe" value={v} onChange={setV} />
            <Counter label="Palety poziome" value={h} onChange={setH} />
          </div>
        )}
      </div>
      {canEdit && (
        <div className="shipments-card-actions">
          {edit ? (
            <>
              <button
                type="button"
                className="btn btn-success shipments-btn"
                disabled={busy}
                onClick={() => void run(async () => {
                  const ok = await onUpdate(s.id, { pallets_vertical: v, pallets_horizontal: h }, 'Zapisano palety')
                  if (ok) setEdit(false)
                  return ok
                })}
              >
                Zapisz palety
              </button>
              <button type="button" className="btn btn-secondary shipments-btn" disabled={busy} onClick={() => { setV(s.pallets_vertical); setH(s.pallets_horizontal); setEdit(false) }}>
                Anuluj zmianę
              </button>
            </>
          ) : (
            <>
              {s.status === 'zaplanowana' && (
                <button type="button" className="btn btn-primary shipments-btn" disabled={busy} onClick={() => void run(() => onStatus(s.id, 'gotowa', 'Gotowe — palety zdjęte z Bukowej'))}>
                  Gotowe (spakowane)
                </button>
              )}
              {s.status === 'gotowa' && (
                <button type="button" className="btn btn-success shipments-btn" disabled={busy} onClick={() => void run(() => onStatus(s.id, 'nadana', 'Nadane'))}>
                  Nadane
                </button>
              )}
              {canEditPallets(s.status) && (
                <button type="button" className="btn btn-secondary shipments-btn" disabled={busy} onClick={() => setEdit(true)}>
                  Zmień palety
                </button>
              )}
              {s.status !== 'nadana' && (
                <button
                  type="button"
                  className="btn btn-danger shipments-btn"
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm('Anulować wysyłkę? Palety wrócą na stan, a zlecenia wrócą na listę „Do wysyłki”.')) return
                    void run(() => onCancel(s))
                  }}
                >
                  Anuluj
                </button>
              )}
            </>
          )}
        </div>
      )}
    </article>
  )
}
