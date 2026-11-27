import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import Spinner from '../Spinner'
import { CATEGORY_LABELS } from '../../constants'
import { useDniWolne } from '../../hooks/useDniWolne'
import { useShipments, type PendingOrder, type ShipmentWithOrders } from '../../hooks/useShipments'
import {
  SHIPMENT_STATUS_LABELS,
  addWorkingDays,
  blOczekujeZaDlugo,
  canEditPallets,
  commonBl,
  dayLabel,
  daySummary,
  daysSince,
  groupByBl,
  groupByDate,
  isNonWorkingDay,
  isoDate,
  nextWorkingDay,
  type PendingSection,
} from '../../lib/shipments'
import { appConfirm } from '../../lib/appDialogs'
import type { ToastVariant } from '../../types'

type Props = {
  /** zapis: kierownik / magazynier / obsługa klienta (jak RLS order_shipments) */
  canEdit: boolean
  pushToast: (msg: string, variant: ToastVariant) => void
}

const catLabel = (c: string) => (CATEGORY_LABELS as Record<string, string>)[c] ?? c
const dataPl = (iso: string | null) => (iso ? dayLabel(iso) : 'bez daty')

const SEKCJE: Array<{ k: PendingSection; tytul: string; opis: string }> = [
  { k: 'gotowe', tytul: 'Gotowe do wysyłki', opis: 'produkcja skończona — planuj kuriera' },
  { k: 'produkcja', tytul: 'W produkcji', opis: 'jeszcze się robią — kuriera można zaplanować wcześniej' },
  { k: 'stare', tytul: 'Do sprawdzenia — starsze niż 30 dni', opis: 'pewnie już pojechały, tylko nikt nie wpisał wydania' },
]

/**
 * Wysyłki kurierem (SUUS) — ekran magazyniera (27.11): „Do wysyłki” w trzech częściach (gotowe / w produkcji /
 * stare do sprawdzenia, w każdej od najnowszych; zamknięte w Optimie znikają) → „Wysyłka kurierem” (data wysyłki
 * i doręczenia, palety) zakłada od razu przesyłkę SUUS w BaseLinkerze → „Zaplanowane”. Palety schodzą z Bukowej
 * przy „Nadane” (trigger w bazie).
 */
export default function ShipmentsView({ canEdit, pushToast }: Props) {
  const { pending, shipments, loading, load, suggestPallets, createShipment, updateShipment, setStatus, cancelShipment, zlecPrzesylke, podpowiedzDaty, oznaczWydane, potwierdzUsuniecieBl } = useShipments(pushToast)
  const dniWolne = useDniWolne()
  const [tab, setTab] = useState<'do' | 'plan'>('do')
  const [day, setDay] = useState(() => isoDate(new Date()))
  const [q, setQ] = useState('')
  const [bezKuriera, setBezKuriera] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [plan, setPlan] = useState<null | { orders: PendingOrder[]; bl: string; suggested: { vertical: number; horizontal: number } }>(null)
  const [wydane, setWydane] = useState<null | Array<{ o: PendingOrder; data: string; zrodlo: string }>>(null)
  const [busy, setBusy] = useState(false)
  const today = isoDate(new Date())

  const summary = useMemo(() => daySummary(shipments, day), [shipments, day])

  // 27.11: tylko zamówienia z metodą dostawy „Kurier” w BaseLinkerze; reszta pod „pokaż”
  const ukryte = useMemo(() => pending.filter((o) => o.dostawa !== 'kurier'), [pending])
  const widoczne = useMemo(() => (bezKuriera ? pending : pending.filter((o) => o.dostawa === 'kurier')), [pending, bezKuriera])
  // 27.11 (testy): grupy po nr BL liczone ze WSZYSTKICH widocznych zleceń, a szukanie filtruje całe grupy —
  // inaczej „_1” z wyszukiwarki dawało osobną wysyłkę dla _1 i drugą dla _2/_3 (podwójne pobranie)
  const sekcje = useMemo(() => {
    const t = q.trim().toLowerCase()
    const pasuje = (o: PendingOrder) =>
      [o.bl, o.client, o.order_number, o.client_order_number, o.items, catLabel(o.category)].filter(Boolean).join(' ').toLowerCase().includes(t)
    const g = groupByBl(widoczne).filter((x) => !t || x.rows.some(pasuje))
    const out: Record<PendingSection, typeof g> = { gotowe: [], produkcja: [], stare: [] }
    for (const x of g) {
      const s: PendingSection = x.rows.every((r) => r.section === 'stare') ? 'stare' : x.rows.every((r) => r.ready) ? 'gotowe' : 'produkcja'
      out[s].push(x)
    }
    return out
  }, [widoczne, q])
  const byDate = useMemo(() => groupByDate(shipments), [shipments])
  const nAktywne = useMemo(() => shipments.filter((s) => s.status !== 'anulowana').length, [shipments])
  /** Wysyłki (nieanulowane) na nr BL — ostrzeżenie w oknie planowania: druga wysyłka nie dostanie pobrania. */
  const wysylkiBl = useMemo(() => {
    const m = new Map<string, number[]>()
    for (const s of shipments) {
      if (s.status === 'anulowana' || !s.bl_order_id) continue
      const k = String(s.bl_order_id)
      m.set(k, [...(m.get(k) ?? []), s.id])
    }
    return m
  }, [shipments])

  const otworzPlan = async (orders: PendingOrder[]) => {
    if (!canEdit || orders.length === 0) return
    setBusy(true)
    const suggested = await suggestPallets(orders.map((o) => o.id))
    setBusy(false)
    setPlan({ orders, bl: commonBl(orders), suggested })
  }

  const otworzWydane = async (orders: PendingOrder[]) => {
    if (!canEdit || orders.length === 0) return
    setBusy(true)
    const pod = await podpowiedzDaty(orders.map((o) => o.id))
    setBusy(false)
    setWydane(
      orders.map((o) => {
        const p = pod.get(o.id)
        const ok = p && p <= today && (!o.order_date || p >= String(o.order_date).slice(0, 10))
        return { o, data: ok ? (p as string) : today, zrodlo: ok ? 'ostatnia zmiana etapów produkcji' : 'brak historii etapów — dziś' }
      }),
    )
  }

  const zaznaczoneStare = pending.filter((o) => selected.has(o.id) && o.section === 'stare')

  return (
    <div className="shipments-view">
      <div className="shipments-head">
        <div className="shipments-head-title">
          <h1>Wysyłki kurierem</h1>
          <span>Zlecenia Po Drzwi do nadania SUUS · gotowe na górze, stare do sprawdzenia na dole</span>
        </div>
        <div className="shipments-head-actions">
          <div className="shipments-seg" role="tablist" aria-label="Widok">
            <button type="button" role="tab" aria-selected={tab === 'do'} className={tab === 'do' ? 'is-active' : undefined} onClick={() => setTab('do')}>
              Do wysyłki ({sekcje.gotowe.length + sekcje.produkcja.length})
            </button>
            <button type="button" role="tab" aria-selected={tab === 'plan'} className={tab === 'plan' ? 'is-active' : undefined} onClick={() => setTab('plan')}>
              Zaplanowane ({nAktywne})
            </button>
          </div>
          <button type="button" className="shipments-btn-outline" onClick={() => void load()} disabled={loading}>
            {loading ? 'Odświeżam…' : 'Odśwież'}
          </button>
        </div>
      </div>

      {loading && pending.length === 0 && shipments.length === 0 ? (
        <Spinner center label="Wczytywanie wysyłek…" />
      ) : tab === 'do' ? (
        <>
          <div className="shipments-tiles">
            {SEKCJE.map((sek) => (
              <div key={sek.k} className={`shipments-tile shipments-tile--${sek.k}`}>
                <span>{sek.k === 'stare' ? 'Do sprawdzenia · ponad 30 dni' : sek.tytul}</span>
                <strong>{sekcje[sek.k].length}</strong>
              </div>
            ))}
          </div>
          <div className="shipments-toolbar">
            <span className="shipments-hint">
              Tylko zamówienia z dostawą „Kurier” w BaseLinkerze, w każdej grupie od najnowszych. Zamknięte w Optimie nie pokazują się wcale.
              {ukryte.length > 0 && (
                <>
                  {' '}
                  <button type="button" className="shipments-link shipments-link--inline" onClick={() => setBezKuriera((v) => !v)} aria-pressed={bezKuriera}>
                    {bezKuriera
                      ? `schowaj zlecenia bez kuriera (${ukryte.length})`
                      : `pokaż schowane: ${ukryte.filter((o) => o.dostawa === 'inna').length} z inną dostawą (odbiór, montaż), ${ukryte.filter((o) => o.dostawa === 'brak').length} bez danych z BL`}
                  </button>
                </>
              )}
            </span>
            <input type="search" className="shipments-search" placeholder="Szukaj: nr BL, klient, nr zlecenia, model…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {sekcje.gotowe.length + sekcje.produkcja.length + sekcje.stare.length === 0 && <p className="shipments-empty">Brak zleceń Po Drzwi do wysłania kurierem.</p>}
          {SEKCJE.map((sek) =>
            sekcje[sek.k].length === 0 ? null : (
              <section key={sek.k} className={`shipments-card-section shipments-card-section--${sek.k}`} aria-label={sek.tytul}>
                <header className="shipments-section-head">
                  <span className={`shipments-pill shipments-pill--${sek.k}`}>{sek.tytul}</span>
                  <span className="shipments-section-desc">{sek.opis}</span>
                  {canEdit && sek.k === 'stare' && (
                    <button type="button" className="shipments-btn-warn shipments-section-btn" disabled={busy || zaznaczoneStare.length === 0} onClick={() => void otworzWydane(zaznaczoneStare)}>
                      Oznacz zaznaczone jako wydane ({zaznaczoneStare.length})
                    </button>
                  )}
                </header>
                <div className="shipments-scroll">
                  <table className="shipments-table">
                    {sek.k === 'gotowe' && (
                      <thead>
                        <tr>
                          <th className="shipments-col-bl">Nr BL</th>
                          <th>Klient · co jedzie</th>
                          <th className="shipments-col-kat">Kategoria</th>
                          <th className="shipments-col-data">Zamówione</th>
                          <th className="shipments-col-akcja" aria-label="Akcja" />
                        </tr>
                      </thead>
                    )}
                    <tbody>
                      {sekcje[sek.k].map((g) => {
                        const najnowsze = g.rows[0]
                        const klienci = [...new Set(g.rows.map((r) => r.client).filter(Boolean))].join(', ') || '—'
                        const kategorie = [...new Set(g.rows.map((r) => r.category))]
                        const zaznaczone = g.rows.every((r) => selected.has(r.id))
                        const zProcentem = g.rows.filter((r) => r.percent != null)
                        const procent = zProcentem.length ? Math.min(...zProcentem.map((r) => r.percent as number)) : null
                        const postep = zProcentem.find((r) => r.percent === procent)?.progress ?? ''
                        return (
                          <tr key={g.key} className={zaznaczone && sek.k === 'stare' ? 'shipments-row--sel' : undefined}>
                            <td className="shipments-col-bl">
                              {canEdit && sek.k === 'stare' ? (
                                <label className="shipments-bl-check">
                                  <input
                                    type="checkbox"
                                    checked={zaznaczone}
                                    onChange={() =>
                                      setSelected((prev) => {
                                        const n = new Set(prev)
                                        for (const r of g.rows) {
                                          if (zaznaczone) n.delete(r.id)
                                          else n.add(r.id)
                                        }
                                        return n
                                      })
                                    }
                                  />
                                  {g.bl || 'bez nr BL'}
                                </label>
                              ) : (
                                <strong>{g.bl || 'bez nr BL'}</strong>
                              )}
                            </td>
                            <td>
                              <strong>{klienci}</strong>
                              {najnowsze.dostawa !== 'kurier' && (
                                <span className="shipments-dostawa">{najnowsze.dostawa === 'brak' ? 'brak danych z BL' : najnowsze.metoda}</span>
                              )}
                              {g.rows.map((r) => (
                                <div key={r.id} className="shipments-pos">
                                  <span className="shipments-pos-nr">zlec. {r.order_number ?? `#${r.id}`}</span> · {r.items || catLabel(r.category)}
                                  {r.quantity ? ` · ${r.quantity} szt.` : ''}
                                </div>
                              ))}
                            </td>
                            <td className="shipments-col-kat">
                              {kategorie.map((k) => (
                                <span key={k} className={`shipments-kat shipments-kat--${k}`}>{catLabel(k)}</span>
                              ))}
                            </td>
                            <td className="shipments-col-data">
                              {najnowsze.order_date ? dayLabel(najnowsze.order_date) : '—'}
                              {sek.k === 'stare' && <div className="shipments-age">{daysSince(najnowsze.order_date, today)} dni</div>}
                            </td>
                            <td className="shipments-col-akcja">
                              {sek.k === 'produkcja' && (
                                <div className="shipments-progress">
                                  {procent != null ? (
                                    <>
                                      <span className="shipments-bar"><i style={{ width: `${procent}%` }} /></span>
                                      {postep}
                                    </>
                                  ) : (
                                    <span className="shipments-muted">bez etapów</span>
                                  )}
                                </div>
                              )}
                              {canEdit && sek.k === 'gotowe' && (
                                <button type="button" className="shipments-btn-dark" disabled={busy} onClick={() => void otworzPlan(g.rows)}>
                                  Wysyłka kurierem
                                </button>
                              )}
                              {canEdit && sek.k === 'produkcja' && (
                                <button type="button" className="shipments-link" disabled={busy} onClick={() => void otworzPlan(g.rows)}>
                                  zaplanuj wcześniej
                                </button>
                              )}
                              {canEdit && sek.k === 'stare' && (
                                <button type="button" className="shipments-btn-warn" disabled={busy} onClick={() => void otworzWydane(g.rows)}>
                                  Oznacz jako wydane
                                </button>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            ),
          )}
        </>
      ) : (
        <div className="shipments-days">
          <div className="shipments-tiles shipments-tiles--plan">
            <label className="shipments-tile shipments-tile--dzien">
              <span>Dzień</span>
              <PoleDaty value={day} onChange={(v) => setDay(v || isoDate(new Date()))} label="Dzień wysyłek" />
            </label>
            <div className="shipments-tile"><span>Wysyłek</span><strong>{summary.count}</strong></div>
            <div className="shipments-tile"><span>Palet pionowych</span><strong>{summary.vertical}</strong></div>
            <div className="shipments-tile"><span>Palet poziomych</span><strong>{summary.horizontal}</strong></div>
          </div>
          {byDate.length === 0 && <p className="shipments-empty">Brak zaplanowanych wysyłek.</p>}
          {byDate.map((d) => (
            <section key={d.date ?? 'brak'} className="shipments-day">
              <h3 className="shipments-day-title">
                {dataPl(d.date)}
                <span className="shipments-day-sum">
                  {(() => {
                    const s = daySummary(d.rows, d.date ?? '')
                    return d.date ? `${s.count} wys. · pion. ${s.vertical} · poz. ${s.horizontal}` : ''
                  })()}
                </span>
              </h3>
              {d.rows.map((s) => (
                <ShipmentCard key={s.id} s={s} canEdit={canEdit} onStatus={setStatus} onUpdate={updateShipment} onCancel={cancelShipment} onPonow={(id) => zlecPrzesylke(id).then(async (ok) => { await load(); return ok })} onUsunietaWBl={potwierdzUsuniecieBl} />
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
          dniWolne={dniWolne}
          inneWysylki={plan.bl ? wysylkiBl.get(plan.bl) ?? [] : []}
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

      {wydane && (
        <WydaneModal
          pozycje={wydane}
          today={today}
          onClose={() => setWydane(null)}
          onSave={async (lista) => {
            const ok = await oznaczWydane(lista)
            if (ok) {
              setWydane(null)
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

/** Pole daty z dniem tygodnia w środku („pon. 30.11.2026”); kalendarz otwiera niewidoczny input pod spodem. */
function PoleDaty({ value, onChange, label, max, min }: { value: string; onChange: (v: string) => void; label: string; max?: string; min?: string }) {
  return (
    <span className="shipments-date">
      <span>{dayLabel(value) || 'wybierz datę'}</span>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M16 3v4M8 3v4M3 10h18" />
      </svg>
      <input
        type="date"
        aria-label={label}
        value={value}
        max={max}
        min={min}
        onChange={(e) => onChange(e.target.value)}
        onClick={(e) => {
          // klik w dowolne miejsce pola otwiera kalendarz (inaczej tylko w ikonę po prawej)
          try {
            e.currentTarget.showPicker()
          } catch {
            /* starsza przeglądarka — zostaje zwykłe pole */
          }
        }}
      />
    </span>
  )
}

function PlanModal({
  orders,
  bl,
  suggested,
  defaultDate,
  dniWolne,
  inneWysylki,
  onClose,
  onSave,
}: {
  orders: PendingOrder[]
  bl: string
  suggested: { vertical: number; horizontal: number }
  defaultDate: string
  dniWolne: Set<string>
  inneWysylki: number[]
  onClose: () => void
  onSave: (v: { shipDate: string; deliveryDate: string; vertical: number; horizontal: number; notes: string }) => Promise<boolean>
}) {
  const [shipDate, setShipDate] = useState(defaultDate)
  const [vertical, setVertical] = useState(suggested.vertical)
  const [horizontal, setHorizontal] = useState(suggested.horizontal)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const deliveryDate = addWorkingDays(shipDate, 2, dniWolne)
  const bezPalet = vertical + horizontal === 0
  const dzis = isoDate(new Date())
  const wPrzeszlosci = !!shipDate && shipDate < dzis
  const wolny = !!shipDate && isNonWorkingDay(shipDate, dniWolne)
  return createPortal(
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={() => { if (!saving) onClose() }}>
      <div className="order-modal shipments-modal" onClick={(e) => e.stopPropagation()}>
        <div className="order-modal-header">
          <h2>Wysyłka kurierem · SUUS{bl ? ` — BL ${bl}` : ''}</h2>
          <button type="button" className="btn btn-icon btn-ghost" onClick={onClose} disabled={saving}>X</button>
        </div>
        <div className="shipments-modal-body">
          <p className="shipments-modal-orders">
            {orders.map((o) => `${o.order_number ?? `#${o.id}`}${o.client ? ` (${o.client})` : ''}`).join(', ')}
          </p>
          <div className="shipments-dates">
            <label className="shipments-field">
              <span>Data wysyłki</span>
              <PoleDaty value={shipDate} onChange={setShipDate} label="Data wysyłki" min={dzis} />
              {wPrzeszlosci ? (
                <span className="shipments-warn">Data w przeszłości — wybierz dziś albo później.</span>
              ) : wolny ? (
                <span className="shipments-warn">To weekend albo święto — SUUS tego dnia nie odbierze.</span>
              ) : (
                <span className="muted shipments-counter-hint">domyślnie najbliższy dzień roboczy</span>
              )}
            </label>
            <div className="shipments-field">
              <span>Data doręczenia</span>
              <span className="shipments-delivery">{dayLabel(deliveryDate) || '—'}</span>
              <span className="muted shipments-counter-hint">wysyłka + 2 dni robocze · liczy się sama</span>
            </div>
          </div>
          <div className="shipments-counters">
            <Counter label="Palety pionowe" value={vertical} onChange={setVertical} hint={`podpowiedź: ${suggested.vertical}`} />
            <Counter label="Palety poziome" value={horizontal} onChange={setHorizontal} hint={`podpowiedź: ${suggested.horizontal}`} />
          </div>
          <label className="shipments-field">
            <span>Uwagi (idą do SUUS)</span>
            <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="np. zadzwonić przed dostawą" />
          </label>
          <p className="muted shipments-counter-hint">
            Po zapisie program od razu zakłada przesyłkę SUUS w BaseLinkerze (palety jednorazowe po 100 kg, ubezpieczenie, pobranie jeśli zaznaczone w BL) — etykieta i maile idą z BaseLinkera.
            Palety zejdą z magazynu Bukowa dopiero przy „Nadane”.
          </p>
          {!bl && <p className="shipments-warn">Brak numeru BaseLinker — przesyłkę trzeba będzie założyć ręcznie w BL.</p>}
          {inneWysylki.length > 0 && (
            <p className="shipments-warn">
              To zamówienie BL ma już wysyłkę {inneWysylki.map((x) => `#${x}`).join(', ')}. Druga przesyłka nie dostanie pobrania (żeby klient nie płacił dwa razy) — kwoty sprawdź w BaseLinkerze.
            </p>
          )}
        </div>
        <div className="order-form-actions">
          <button
            type="button"
            className="btn btn-success shipments-btn"
            disabled={saving || bezPalet || !shipDate || wPrzeszlosci}
            title={bezPalet ? 'Dodaj co najmniej jedną paletę' : undefined}
            onClick={async () => {
              setSaving(true)
              const ok = await onSave({ shipDate, deliveryDate, vertical, horizontal, notes })
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

function WydaneModal({
  pozycje,
  today,
  onClose,
  onSave,
}: {
  pozycje: Array<{ o: PendingOrder; data: string; zrodlo: string }>
  today: string
  onClose: () => void
  onSave: (lista: Array<{ id: number; data: string }>) => Promise<boolean>
}) {
  const [daty, setDaty] = useState<Record<number, string>>(() => Object.fromEntries(pozycje.map((p) => [p.o.id, p.data])))
  const [saving, setSaving] = useState(false)
  return createPortal(
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={() => { if (!saving) onClose() }}>
      <div className="order-modal shipments-modal" onClick={(e) => e.stopPropagation()}>
        <div className="order-modal-header">
          <h2>Oznacz jako wydane</h2>
          <button type="button" className="btn btn-icon btn-ghost" onClick={onClose} disabled={saving}>X</button>
        </div>
        <div className="shipments-modal-body">
          <p className="shipments-modal-orders">
            Data wydania liczy się w statystykach do czasu realizacji — popraw ją, jeśli wiesz, kiedy towar pojechał. Program zamyka rezerwacje tych
            zleceń, ale niczego nie zdejmuje ze stanu magazynu (stany po inwentaryzacji już tego nie mają).
          </p>
          {pozycje.map((p) => (
            <div key={p.o.id} className="shipments-wydane-row">
              <div>
                <strong>{p.o.order_number ?? `#${p.o.id}`}</strong> · {catLabel(p.o.category)}{p.o.client ? ` · ${p.o.client}` : ''}
                <div className="muted shipments-counter-hint">zamówione {p.o.order_date ? dayLabel(p.o.order_date) : '—'} · podpowiedź: {p.zrodlo}</div>
              </div>
              <PoleDaty value={daty[p.o.id] ?? ''} onChange={(v) => setDaty((d) => ({ ...d, [p.o.id]: v }))} label={`Data wydania ${p.o.order_number ?? p.o.id}`} max={today} />
            </div>
          ))}
        </div>
        <div className="order-form-actions">
          <button
            type="button"
            className="btn btn-success shipments-btn"
            disabled={saving || pozycje.some((p) => !daty[p.o.id])}
            onClick={async () => {
              setSaving(true)
              const ok = await onSave(pozycje.map((p) => ({ id: p.o.id, data: daty[p.o.id] })))
              if (!ok) setSaving(false)
            }}
          >
            {saving ? 'Zapisywanie…' : `Zapisz wydanie (${pozycje.length})`}
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
  onPonow,
  onUsunietaWBl,
}: {
  s: ShipmentWithOrders
  canEdit: boolean
  onStatus: (id: number, status: ShipmentWithOrders['status'], msg: string) => Promise<boolean>
  onUpdate: (id: number, patch: { pallets_vertical: number; pallets_horizontal: number }, msg?: string) => Promise<boolean>
  onCancel: (s: ShipmentWithOrders) => Promise<boolean>
  onPonow: (id: number) => Promise<boolean>
  onUsunietaWBl: (id: number) => Promise<boolean>
}) {
  const anulowana = s.status === 'anulowana'
  // „oczekuje” starsze niż 3 min: BaseLinker nie odpowiedział — pokazujemy błąd i „Ponów” (z prośbą o sprawdzenie BL)
  const zawieszona = blOczekujeZaDlugo(s)
  const zakladaSie = s.bl_status === 'oczekuje' && !zawieszona
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
          {s.delivery_date && <span> · doręczenie <strong>{dayLabel(s.delivery_date)}</strong></span>}
          {s.notes && <span> · {s.notes}</span>}
        </div>
        <div className="shipments-card-bl">
          {anulowana && s.bl_package_id ? (
            <span className="shipments-bl shipments-bl--blad">
              Wysyłka anulowana, ale przesyłka SUUS <strong>{s.bl_package_number || s.bl_package_id}</strong> jest w BaseLinkerze — usuń ją tam, inaczej przyjedzie kurier.
            </span>
          ) : s.bl_status === 'utworzona' || s.bl_package_number ? (
            <span className="shipments-bl shipments-bl--ok">
              SUUS w BaseLinkerze: <strong>{s.bl_package_number || 'założona'}</strong>
              {s.bl_error && <span className="shipments-warn"> · {s.bl_error}</span>}
            </span>
          ) : zakladaSie ? (
            <span className="shipments-bl">Zakładam przesyłkę w BaseLinkerze…</span>
          ) : zawieszona ? (
            <span className="shipments-bl shipments-bl--blad">BaseLinker nie odpowiedział od kilku minut — zanim ponowisz, sprawdź w BL, czy przesyłka nie powstała (ref. PD-WYS-{s.id}).</span>
          ) : s.bl_status === 'blad' ? (
            <span className="shipments-bl shipments-bl--blad">BaseLinker: {s.bl_error || 'błąd'}</span>
          ) : (
            <span className="shipments-bl muted">bez przesyłki w BaseLinkerze</span>
          )}
          {canEdit && !s.bl_package_id && s.status !== 'nadana' && !anulowana && !zakladaSie && s.bl_order_id && (
            <button type="button" className="btn btn-sm btn-secondary" disabled={busy} onClick={() => void run(() => onPonow(s.id))}>
              {s.bl_status === 'blad' || zawieszona ? 'Ponów w BaseLinkerze' : 'Załóż przesyłkę w BaseLinkerze'}
            </button>
          )}
          {canEdit && anulowana && s.bl_package_id && (
            <button type="button" className="btn btn-sm btn-secondary" disabled={busy} onClick={() => void run(() => onUsunietaWBl(s.id))}>
              Usunięta w BaseLinkerze
            </button>
          )}
        </div>
        {edit && (
          <div className="shipments-counters">
            <Counter label="Palety pionowe" value={v} onChange={setV} />
            <Counter label="Palety poziome" value={h} onChange={setH} />
            {s.bl_package_id && <span className="shipments-warn">Przesyłka w SUUS już jest — zmianę palet wpisz też w BaseLinkerze.</span>}
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
                <button type="button" className="btn btn-primary shipments-btn" disabled={busy} onClick={() => void run(() => onStatus(s.id, 'gotowa', 'Spakowane'))}>
                  Spakowane
                </button>
              )}
              {(s.status === 'zaplanowana' || s.status === 'gotowa') && (
                <button type="button" className="btn btn-success shipments-btn" disabled={busy} onClick={() => void run(() => onStatus(s.id, 'nadana', 'Nadane — palety zdjęte z Bukowej'))}>
                  Nadane
                </button>
              )}
              {canEditPallets(s.status) && (
                <button type="button" className="btn btn-secondary shipments-btn" disabled={busy} onClick={() => setEdit(true)}>
                  Zmień palety
                </button>
              )}
              {s.status !== 'nadana' && !anulowana && (
                <button
                  type="button"
                  className="btn btn-danger shipments-btn"
                  disabled={busy || zakladaSie}
                  title={zakladaSie ? 'Przesyłka właśnie zakłada się w BaseLinkerze — poczekaj chwilę' : undefined}
                  onClick={async () => {
                    const msg = s.bl_package_id
                      ? 'Zlecenia wrócą na listę „Do wysyłki”. UWAGA: przesyłka SUUS w BaseLinkerze zostaje — anuluj ją tam ręcznie.'
                      : 'Zlecenia wrócą na listę „Do wysyłki”.'
                    const ok = await appConfirm(msg, { title: 'Anulować wysyłkę?', confirmLabel: 'Anuluj wysyłkę', tone: 'danger' })
                    if (!ok) return
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
