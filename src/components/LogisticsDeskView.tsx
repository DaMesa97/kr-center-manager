// =====================================================================
// Wysyłka → biurko kierownika logistyki („Do fakturowania”), 1:1 z makietą
// „Wysyłka — lista dnia” (artefakt, decyzje Tymka 16–17.11.2026, wiersz w wariancie C).
//  • dzień produkcji ↔ trasa (sprzężone), szukanie, „Schowaj już oznaczone”;
//  • firma po firmie: checkbox „do fakturowania” (= extra_fields.ready_to_invoice jak dotąd,
//    nic go nie blokuje), „Oznacz wszystkie”;
//  • wiersz: pasek stanu (zielony = na magazynie wysyłkowym), nr, model, system, kolor,
//    rozmiar+kierunek, szt., kategoria; pod spodem nr klienta, RO z Optimy („BRAK RO” tylko
//    dla zleceń z konfiguratora), złożone/wiek, ostrzeżenia — nic się nie zawija;
//  • „Dodaj do trasy zlecenie nr” (numer powtarza się między kategoriami → pytamy które);
//  • „Lista do fakturowania (N)” — zestawienie per trasa bez cen, do druku;
//  • „Trasa wyjechała” — orders.shipped_at (osobne od wydania z Excela, którego nie ruszamy).
// Reguły w lib/logisticsDesk.ts (testy). Dane z useShipping (otwarte + wydane ≤ 14 dni).
// =====================================================================
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Order } from '../types'
import { ileOdm } from '../utils/odmiana'
import { CATEGORY_LABELS } from '../constants'
import { isOrderReadyToInvoice } from '../utils'
import { appConfirm } from '../lib/appDialogs'
import { createCompanyResolver, type CompanyShippingInfo } from '../lib/companyMatch'
import {
  DESK_DAYS, PROD_OF_ROUTE, ROUTE_OF_PROD, SPECIAL_ROUTES, buildPrintList, defaultRouteForToday, deskAge, deskNoRo, deskRouteOf, deskSpec,
  deskWarehouseState, deskWarnings, fmtDay, fmtDayFull, isDeskDay, isShipped, readRoutePin, shipButtonLabel, shippedToday, type DeskDay,
} from '../lib/logisticsDesk'
import { shortRoNumber } from './ErpStatusBadge'
import Spinner from './Spinner'

type Props = {
  /** otwarte zlecenia (zawężone do kategorii użytkownika) */
  orders: Order[]
  /** wydane w ostatnich 14 dniach (STA: „przekazane na Bukową”) */
  releasedOrders: Order[]
  /** wszystkie otwarte (bez zawężenia) — do kompletów par / trójek */
  allOrders: Order[]
  companiesMap: Map<string, CompanyShippingInfo>
  loading: boolean
  canInvoice: boolean
  /** oznaczanie „Trasa wyjechała” (kierownik) */
  canShip: boolean
  userLabel: string
  onRefresh: () => void
  onShowDetails: (order: Order) => void
  onToggleReadyToInvoice: (order: Order, ready: boolean) => Promise<void>
  onPin: (order: Order, route: string | null) => Promise<boolean | void>
  onMarkShipped: (ids: number[], route: string, shipped: boolean) => Promise<number>
}

const CAT_STYLE: Record<string, { bg: string; fg: string }> = {
  STA: { bg: '#dbeafe', fg: '#1e40af' }, ST: { bg: '#ede9fe', fg: '#5b21b6' }, Disting: { bg: '#dcfce7', fg: '#166534' },
  Bastion: { bg: '#fee2e2', fg: '#991b1b' }, Techniczne: { bg: '#f3f4f6', fg: '#374151' }, DrzwiWewnetrzne: { bg: '#e0f2fe', fg: '#075985' }, Aluminium: { bg: '#f1f5f9', fg: '#334155' },
}
const CAT_ORDER = ['STA', 'Disting', 'ST', 'Bastion', 'Techniczne', 'DrzwiWewnetrzne', 'Aluminium']
const PREFS_KEY = 'kr-logistics-desk'

/** route = dzień tygodnia albo trasa specjalna (odbiór osobisty, montaż własny, bez trasy); prod = null poza dniami */
type Prefs = { prod: DeskDay | null; route: string; hideMarked: boolean }

function loadPrefs(): Prefs {
  const def = defaultRouteForToday()
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (raw) {
      const p = JSON.parse(raw) as Partial<Prefs> & { savedDay?: string }
      // zapamiętany wybór obowiązuje tylko tego samego dnia — rano biurko wraca do dzisiejszej trasy
      if (p.savedDay === new Date().toDateString() && typeof p.route === 'string' && p.route) {
        return { prod: isDeskDay(p.prod) ? p.prod : null, route: p.route, hideMarked: !!p.hideMarked }
      }
      return { prod: def.prod, route: def.route, hideMarked: !!p.hideMarked }
    }
  } catch { /* localStorage niedostępny */ }
  return { prod: def.prod, route: def.route, hideMarked: false }
}

type DeskRow = {
  order: Order
  route: string
  pinned: boolean
  marked: boolean
  state: ReturnType<typeof deskWarehouseState>
  warnings: ReturnType<typeof deskWarnings>
  noRo: boolean
  age: ReturnType<typeof deskAge>
  spec: ReturnType<typeof deskSpec>
  shippedNow: boolean
  freshToday: boolean
}
type DeskFirm = { name: string; rows: DeskRow[]; marked: number; packed: number }

const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function LogisticsDeskView({
  orders, releasedOrders, allOrders, companiesMap, loading, canInvoice, canShip, userLabel,
  onRefresh, onShowDetails, onToggleReadyToInvoice, onPin, onMarkShipped,
}: Props) {
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs)
  const [query, setQuery] = useState('')
  const [printOpen, setPrintOpen] = useState(false)
  const [pin, setPin] = useState('')
  const [pinHint, setPinHint] = useState('')
  const [pinChoices, setPinChoices] = useState<Order[] | null>(null)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ ...prefs, savedDay: new Date().toDateString() })) } catch { /* ignore */ }
  }, [prefs])

  const resolveCompany = useMemo(() => createCompanyResolver(companiesMap), [companiesMap])

  // kandydaci: otwarte + wydane ≤ 14 dni, bez anulowanych, bez wyjechanych wcześniej niż dziś
  const candidates = useMemo(() => {
    const byId = new Map<number, Order>()
    for (const o of [...orders, ...releasedOrders]) {
      if (o.id === undefined) continue
      const extra = o.extra_fields as Record<string, unknown> | null
      if (extra?.cancelled === true) continue
      if (isShipped(o) && !shippedToday(o)) continue
      if (!byId.has(o.id)) byId.set(o.id, o)
    }
    return Array.from(byId.values())
  }, [orders, releasedOrders])

  const today = todayIso()
  const q = query.trim().toLowerCase()

  // CAŁA trasa — z niej liczniki, lista do fakturowania i „Trasa wyjechała”. Filtry „Schowaj już oznaczone”
  // i szukanie tylko ukrywają wiersze (zwiad 21.11: wcześniej lista do druku była pusta, a wyjazd pomijał oznaczone)
  const routeFirms = useMemo<DeskFirm[]>(() => {
    const map = new Map<string, DeskRow[]>()
    for (const o of candidates) {
      const route = deskRouteOf(o, resolveCompany(o.company))
      if (route !== prefs.route) continue
      const marked = isOrderReadyToInvoice(o)
      const row: DeskRow = {
        order: o, route, pinned: !!readRoutePin(o), marked,
        state: deskWarehouseState(o), warnings: deskWarnings(o, allOrders), noRo: deskNoRo(o), age: deskAge(o), spec: deskSpec(o),
        shippedNow: shippedToday(o), freshToday: String(o.order_date ?? '').slice(0, 10) === today,
      }
      const key = o.company.trim()
      const arr = map.get(key) ?? []
      arr.push(row)
      map.set(key, arr)
    }
    const out: DeskFirm[] = []
    for (const [name, rows] of map) {
      rows.sort((a, b) => {
        const ca = CAT_ORDER.indexOf(a.order.category ?? ''), cb = CAT_ORDER.indexOf(b.order.category ?? '')
        if (ca !== cb) return ca - cb
        return String(a.order.order_number).localeCompare(String(b.order.order_number), 'pl', { numeric: true })
      })
      out.push({ name, rows, marked: rows.filter((r) => r.marked).length, packed: rows.filter((r) => r.state.packed).length })
    }
    out.sort((a, b) => a.name.localeCompare(b.name, 'pl'))
    return out
  }, [candidates, resolveCompany, prefs.route, allOrders, today])

  const firms = useMemo<DeskFirm[]>(() => {
    if (!prefs.hideMarked && !q) return routeFirms
    const out: DeskFirm[] = []
    for (const f of routeFirms) {
      const rows = f.rows.filter((r) => {
        if (prefs.hideMarked && r.marked) return false
        const o = r.order
        if (q && !(o.company.toLowerCase().includes(q) || String(o.order_number).toLowerCase().includes(q) || String(o.client_order_number ?? '').toLowerCase().includes(q))) return false
        return true
      })
      if (rows.length) out.push({ ...f, rows })
    }
    return out
  }, [routeFirms, prefs.hideMarked, q])

  const kpi = useMemo(() => {
    let n = 0, marked = 0, packed = 0, shipped = 0
    for (const f of routeFirms) for (const r of f.rows) { n++; if (r.marked) marked++; if (r.state.packed) packed++; if (r.shippedNow) shipped++ }
    return { firms: routeFirms.length, orders: n, marked, packed, shipped }
  }, [routeFirms])

  const printList = useMemo(
    () => buildPrintList(routeFirms.map((f) => ({ name: f.name, orders: f.rows.map((r) => r.order) })), isOrderReadyToInvoice),
    [routeFirms],
  )

  const setProd = (p: DeskDay) => setPrefs((x) => ({ ...x, prod: p, route: ROUTE_OF_PROD[p] }))
  const setRoute = (r: string) => setPrefs((x) => ({ ...x, route: r, prod: isDeskDay(r) ? PROD_OF_ROUTE[r] : null }))

  // trasy do wyboru: dni tygodnia + specjalne + cokolwiek innego, co firmy mają wpisane (z licznikiem zleceń)
  const routeOptions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const o of candidates) {
      const r = deskRouteOf(o, resolveCompany(o.company))
      counts.set(r, (counts.get(r) ?? 0) + 1)
    }
    const known = new Set<string>([...DESK_DAYS, ...SPECIAL_ROUTES])
    const other = Array.from(counts.keys()).filter((r) => !known.has(r)).sort((a, b) => a.localeCompare(b, 'pl'))
    return { list: [...DESK_DAYS, ...SPECIAL_ROUTES, ...other], counts }
  }, [candidates, resolveCompany])

  // „Dodaj do trasy zlecenie nr” — numer zlecenia powtarza się między kategoriami
  const doPin = useCallback(async (chosen?: Order) => {
    const nr = pin.trim()
    let target = chosen
    if (!target) {
      if (!nr) return
      const hits = candidates.filter((o) => String(o.order_number).trim() === nr)
      if (hits.length === 0) { setPinHint(`Nie ma otwartego zlecenia ${nr}`); setPinChoices(null); return }
      if (hits.length > 1) { setPinChoices(hits); setPinHint(''); return }
      target = hits[0]
    }
    setPinChoices(null)
    const currentRoute = deskRouteOf(target, resolveCompany(target.company))
    if (currentRoute === prefs.route) { setPinHint(`${target.category} ${target.order_number} już jest na tej trasie`); setPin(''); return }
    setBusy(true)
    const ok = await onPin(target, prefs.route)
    setBusy(false)
    // runda 5 (tester uprawnień): przy odmowie bazy obok czerwonego błędu pokazywało się zielone „Dodano…”
    if (ok === false) { setPinHint(`Nie dodano ${target.category} ${target.order_number} — brak uprawnień do zmiany tego zlecenia`); return }
    setPin('')
    setPinHint(`Dodano ${target.category} ${target.order_number} (${target.company}, normalnie trasa ${currentRoute || '—'})`)
  }, [pin, candidates, resolveCompany, prefs.route, onPin])

  const markAll = async (f: DeskFirm) => {
    const unmarked = f.rows.filter((r) => !r.marked)
    setBusy(true)
    if (unmarked.length) for (const r of unmarked) await onToggleReadyToInvoice(r.order, true)
    else for (const r of f.rows) await onToggleReadyToInvoice(r.order, false)
    setBusy(false)
  }

  const shipRoute = async () => {
    const doWyjazdu = routeFirms.filter((f) => f.rows.some((r) => !isShipped(r.order)))
    const ids = doWyjazdu.flatMap((f) => f.rows.filter((r) => !isShipped(r.order)).map((r) => r.order.id!))
    if (ids.length === 0) { return }
    const notPacked = doWyjazdu.flatMap((f) => f.rows.filter((r) => !isShipped(r.order) && !r.state.packed)).length
    const ok = await appConfirm(
      `${shipButtonLabel(prefs.route)} — ${prefs.route}: oznaczyć ${ileOdm(ids.length, 'zlecenie', 'zlecenia', 'zleceń')} z ${ileOdm(doWyjazdu.length, 'firmy', 'firm', 'firm')}?` +
      (notPacked ? ` Uwaga: ${notPacked} z nich nie ma kompletu etapów / wydania — jeśli zostały na hali, odznacz je po oznaczeniu („cofnij” w wierszu).` : '') +
      ' Data wydania z Excela zostaje bez zmian.',
    )
    if (!ok) return
    setBusy(true)
    await onMarkShipped(ids, prefs.route, true)
    setBusy(false)
  }

  const printNow = () => {
    document.body.classList.add('ldesk-print')
    const cleanup = () => { document.body.classList.remove('ldesk-print'); window.removeEventListener('afterprint', cleanup) }
    window.addEventListener('afterprint', cleanup)
    window.print()
    setTimeout(cleanup, 60_000)
  }

  const dateLabel = new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date())

  return (
    <div className="ldesk">
      <div className="ldesk-head">
        <div className="ldesk-title">
          <h2>Wysyłka · do fakturowania</h2>
          <span className="ldesk-muted">{dateLabel}{userLabel ? ` · ${userLabel}` : ''}</span>
        </div>
        <label className="ldesk-field">
          <span>Dzień produkcji</span>
          <select className="day-filter" value={prefs.prod ?? ''} onChange={(e) => { if (isDeskDay(e.target.value)) setProd(e.target.value) }}>
            {prefs.prod == null && <option value="">— (trasa specjalna)</option>}
            {DESK_DAYS.map((d) => <option key={d} value={d}>{d} → trasa {ROUTE_OF_PROD[d]}</option>)}
          </select>
        </label>
        <label className="ldesk-field">
          <span>Trasa</span>
          <select className="day-filter" value={prefs.route} onChange={(e) => setRoute(e.target.value)}>
            {routeOptions.list.map((r) => (
              <option key={r} value={r}>{r}{routeOptions.counts.get(r) ? ` (${routeOptions.counts.get(r)})` : ''}</option>
            ))}
          </select>
        </label>
        <label className="ldesk-field ldesk-field--grow">
          <span>Szukaj</span>
          <input type="search" className="search-input" placeholder="Firma, nr zlecenia albo nr klienta…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <button type="button" className={`btn ${printOpen ? 'btn-secondary' : 'btn-primary'}`} onClick={() => setPrintOpen((v) => !v)}>
          {printOpen ? 'Zamknij listę' : `Lista do fakturowania (${kpi.marked})`}
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onRefresh} disabled={loading} title="Odśwież">↻</button>
      </div>

      <div className="ldesk-kpis">
        <div className="ldesk-kpi"><span className="ldesk-kpi__label">Na trasie {prefs.route}</span><span className="ldesk-kpi__value">{kpi.firms} firm · {kpi.orders} zleceń</span></div>
        <div className="ldesk-kpi ldesk-kpi--blue"><span className="ldesk-kpi__label">Do fakturowania</span><span className="ldesk-kpi__value">{kpi.marked}</span></div>
        <div className="ldesk-kpi ldesk-kpi--green"><span className="ldesk-kpi__label">Na magazynie wysyłkowym (informacja)</span><span className="ldesk-kpi__value">{kpi.packed} z {kpi.orders}</span></div>
        <div className="ldesk-kpi ldesk-kpi--dark">
          <span className="ldesk-kpi__label">Wyjazd</span>
          <span className="ldesk-kpi__value">{kpi.shipped ? `wyjechało dziś ${kpi.shipped}` : 'jeszcze nie wyjechała'}</span>
          {canShip && (
            <button type="button" className="btn btn-sm btn-primary" disabled={busy || loading || kpi.orders - kpi.shipped === 0} onClick={() => void shipRoute()} title="Oznacza wyjazd / odbiór wszystkich widocznych zleceń tej trasy (shipped_at); wydanie z Excela bez zmian">
              {shipButtonLabel(prefs.route)}
            </button>
          )}
        </div>
      </div>

      {printOpen && (
        <section className="ldesk-print-area">
          <div className="ldesk-print-head">
            <h3>Lista do fakturowania — trasa {prefs.route} — {fmtDayFull(today)}</h3>
            <span className="ldesk-muted">{kpi.marked} zleceń{userLabel ? ` · oznaczył: ${userLabel}` : ''}</span>
          </div>
          {printList.length === 0 ? (
            <p className="ldesk-muted">Nic jeszcze nie oznaczono do fakturowania na tej trasie.</p>
          ) : (
            <table className="ldesk-print-table">
              <thead><tr><th>NR</th><th>KATEGORIA</th><th>MODEL</th><th>SYSTEM · KOLOR · ROZMIAR</th><th className="num">SZT.</th><th>NR ZAM. KLIENTA</th><th>RO OPTIMA</th></tr></thead>
              <tbody>
                {printList.map((f) => (
                  <FirmPrintRows key={f.name} firm={f} />
                ))}
              </tbody>
            </table>
          )}
          <div className="ldesk-actions ldesk-noprint">
            <button type="button" className="btn btn-primary btn-sm" onClick={printNow} disabled={printList.length === 0}>Drukuj / zapisz PDF</button>
          </div>
        </section>
      )}

      <div className="ldesk-tools ldesk-noprint">
        <label className="ldesk-check"><input type="checkbox" checked={prefs.hideMarked} onChange={(e) => setPrefs((x) => ({ ...x, hideMarked: e.target.checked }))} /> Schowaj już oznaczone</label>
        <div className="ldesk-pin">
          <span className="ldesk-muted">Dodaj do trasy zlecenie nr</span>
          <input type="text" className="search-input" style={{ width: 110 }} placeholder="np. 7072" value={pin} onChange={(e) => { setPin(e.target.value); setPinHint(''); setPinChoices(null) }} onKeyDown={(e) => { if (e.key === 'Enter') void doPin() }} />
          <button type="button" className="btn btn-sm btn-secondary" disabled={busy || !pin.trim()} onClick={() => void doPin()}>Dodaj do trasy</button>
          {pinHint && <span className="ldesk-muted">{pinHint}</span>}
        </div>
      </div>
      {pinChoices && (
        <div className="ldesk-pin-choices">
          <span>Numer {pin.trim()} ma kilka zleceń — które dodać?</span>
          {pinChoices.map((o) => {
            const cs = CAT_STYLE[o.category ?? ''] ?? CAT_STYLE.Techniczne
            return (
              <button key={o.id} type="button" className="btn btn-sm btn-secondary" onClick={() => void doPin(o)}>
                <span className="ldesk-cat" style={{ background: cs.bg, color: cs.fg }}>{CATEGORY_LABELS[o.category as keyof typeof CATEGORY_LABELS] ?? o.category}</span>
                <b>{o.order_number}</b> {o.company} · {o.model} <span className="ldesk-muted">(trasa {deskRouteOf(o, resolveCompany(o.company)) || '—'})</span>
              </button>
            )
          })}
          <button type="button" className="crm-link" onClick={() => setPinChoices(null)}>anuluj</button>
        </div>
      )}

      {loading && firms.length === 0 ? (
        <Spinner center label="Ładowanie zleceń…" />
      ) : firms.length === 0 ? (
        <div className="ldesk-empty">Nic nie pasuje do wyboru: trasa {prefs.route}{q ? `, szukane „${query}”` : ''}{prefs.hideMarked ? ', bez oznaczonych' : ''}.</div>
      ) : (
        firms.map((f) => (
          <section key={f.name} className="ldesk-firm">
            <div className="ldesk-firm__head">
              <div className="ldesk-firm__title">
                <span className="ldesk-firm__name">{f.name}</span>
                <span className="ldesk-muted">{ileOdm(f.rows.length, 'zlecenie', 'zlecenia', 'zleceń')} · {f.marked} do fakturowania · {f.packed} na magazynie</span>
              </div>
              {canInvoice && (
                <button type="button" className="btn btn-sm btn-secondary" disabled={busy} onClick={() => void markAll(f)}>
                  {f.rows.length - f.marked > 0 ? `Oznacz wszystkie (${f.rows.length - f.marked})` : 'Odznacz wszystkie'}
                </button>
              )}
            </div>
            {f.rows.map((r) => {
              const o = r.order
              const cs = CAT_STYLE[o.category ?? ''] ?? CAT_STYLE.Techniczne
              const bar = r.shippedNow ? '#2563eb' : r.state.packed ? '#10b981' : '#d1d5db'
              const isOpen = expanded === o.id
              const warnText = r.warnings.map((w) => `⚠ ${w.text}`).join(' · ')
              const notes = String(o.notes ?? '').trim()
              const uwagi = [warnText, notes].filter(Boolean).join(' · ')
              return (
                <div key={o.id} className={`ldesk-row${r.marked ? ' ldesk-row--marked' : ''}${r.shippedNow ? ' ldesk-row--shipped' : ''}`} style={{ borderLeftColor: bar }}>
                  <div className="ldesk-row__main">
                    <input
                      type="checkbox"
                      className="ldesk-row__check"
                      checked={r.marked}
                      disabled={!canInvoice || busy}
                      title={r.marked ? 'Do fakturowania — kliknij, żeby zdjąć' : 'Oznacz do fakturowania'}
                      aria-label={`Do fakturowania ${o.order_number}`}
                      onChange={(e) => void onToggleReadyToInvoice(o, e.target.checked)}
                    />
                    <div className="ldesk-row__body">
                      <div className="ldesk-row__line1">
                        <span className="ldesk-row__nr">{o.order_number}</span>
                        <span className="ldesk-row__model">{o.model}</span>
                        {r.spec.system && <span className="ldesk-row__spec">{r.spec.system}</span>}
                        {r.spec.color && <span className="ldesk-row__spec">{r.spec.color}</span>}
                        {r.spec.size && <span className="ldesk-row__size">{r.spec.size}</span>}
                        <span className="ldesk-muted">× {Number(o.quantity) || 1}</span>
                        <span className="ldesk-cat" style={{ background: cs.bg, color: cs.fg }}>{CATEGORY_LABELS[o.category as keyof typeof CATEGORY_LABELS] ?? o.category}</span>
                        {r.shippedNow && <span className="ldesk-badge ldesk-badge--blue">WYJECHAŁO {new Date(o.shipped_at!).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}</span>}
                        {!r.shippedNow && r.pinned && <span className="ldesk-badge ldesk-badge--amber">DODANE DO TRASY</span>}
                        {!r.shippedNow && !r.pinned && r.freshToday && <span className="ldesk-badge ldesk-badge--amber">NOWE DZIŚ</span>}
                      </div>
                      <div className="ldesk-row__line2" title={[warnText, notes ? `Uwagi: ${notes}` : ''].filter(Boolean).join('\n')}>
                        <span>nr klienta <b className={o.client_order_number ? '' : 'ldesk-muted'}>{String(o.client_order_number ?? '').trim() || '—'}</b></span>
                        <span>RO <b className={o.erp_ro_number ? 'ldesk-ro' : r.noRo ? 'ldesk-ro--missing' : 'ldesk-muted'} title={o.erp_ro_number ? `RO w Optimie: ${o.erp_ro_number}` : r.noRo ? 'Zlecenie z konfiguratora bez numeru RO — sprawdź w Integracjach' : 'Zlecenie z arkusza — RO nie jest przekazywane'}>{o.erp_ro_number ? shortRoNumber(o.erp_ro_number) : r.noRo ? 'BRAK RO' : '—'}</b></span>
                        <span>złożone {fmtDay(o.order_date)} · <span className={`ldesk-age ldesk-age--${r.age.level}`}>{r.age.days} dni{r.age.level === 'late' ? ' ⚑' : ''}</span></span>
                        <span className={`ldesk-row__uwagi${r.warnings.length ? ' ldesk-row__uwagi--warn' : ''}`}>{uwagi || '—'}</span>
                      </div>
                    </div>
                    <span className={`ldesk-state ${r.state.packed ? 'ldesk-state--ok' : 'ldesk-state--no'}`} title={r.state.label}>
                      {r.state.packed ? 'NA MAGAZYNIE' : r.state.source === 'wydanie' ? 'na Marklowickiej' : r.state.source === 'brak' ? 'bez etapów' : 'niespakowane'}
                    </span>
                    <button type="button" className="btn btn-sm btn-secondary" onClick={() => setExpanded(isOpen ? null : o.id!)}>{isOpen ? 'Zwiń' : 'Szczegóły'}</button>
                  </div>
                  {isOpen && (
                    <div className="ldesk-row__details">
                      <div><span className="ldesk-dl">KOLOR / WYMIAR</span><span>{[o.wing_color, o.frame_color ? `ościeżnica ${o.frame_color}` : '', `${o.width ?? ''}${o.direction ? ' ' + o.direction : ''}`, o.height ? `wys. ${o.height}` : ''].filter(Boolean).join(' · ') || '—'}</span></div>
                      <div><span className="ldesk-dl">MAGAZYN WYSYŁKOWY</span><span>{r.state.label}</span></div>
                      <div><span className="ldesk-dl">MAGAZYN / SZYBA</span><span>{[o.stock_status ? `stan: ${o.stock_status}` : '', o.glass_order_date ? `szyba zamówiona ${fmtDay(o.glass_order_date)}${o.glass_received ? `, odebrana${o.glass_received_date ? ' ' + fmtDay(o.glass_received_date) : ''}` : ', jeszcze nie ma'}` : ''].filter(Boolean).join(' · ') || '—'}</span></div>
                      <div><span className="ldesk-dl">UWAGI</span><span>{[notes, o.defects ? `braki: ${o.defects}` : ''].filter(Boolean).join(' · ') || '—'}</span></div>
                      <div className="ldesk-row__details-actions">
                        <button type="button" className="btn btn-sm btn-primary" onClick={() => onShowDetails(o)}>Otwórz zlecenie</button>
                        {r.pinned && !r.shippedNow && <button type="button" className="btn btn-sm btn-secondary" disabled={busy} onClick={() => void onPin(o, null)}>Odepnij od tej trasy</button>}
                        {r.shippedNow && canShip && <button type="button" className="btn btn-sm btn-secondary" disabled={busy} onClick={() => void onMarkShipped([o.id!], prefs.route, false)}>Cofnij wyjazd (zostało na hali)</button>}
                        {o.release_date && <span className="ldesk-muted">Wydanie z Excela: {fmtDayFull(o.release_date)}</span>}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </section>
        ))
      )}

      <div className="ldesk-foot ldesk-noprint">
        <span>Oznaczenie „do fakturowania” to ten sam znacznik co w kolumnie FAKTURA; nic go nie blokuje. „Na magazynie” = STA: wydanie z Excela (przekazane na Bukową), reszta: wszystkie etapy odhaczone. Data wydania z Excela zostaje bez zmian.</span>
        <span>„Trasa wyjechała” zapisuje wyjazd (osobne pole); zlecenia zostają na liście do końca dnia z plakietką, jutro znikają. Zlecenie z innej trasy dodane ręcznie ma plakietkę „dodane do trasy” przez 7 dni.</span>
      </div>
    </div>
  )
}

function FirmPrintRows({ firm }: { firm: ReturnType<typeof buildPrintList>[number] }) {
  return (
    <>
      <tr className="ldesk-print-firm"><td colSpan={7}>{firm.name}</td></tr>
      {firm.rows.map((r) => (
        <tr key={`${firm.name}-${r.cat}-${r.nr}`}>
          <td><b>{r.nr}</b></td>
          <td>{CATEGORY_LABELS[r.cat as keyof typeof CATEGORY_LABELS] ?? r.cat}</td>
          <td>{r.model}</td>
          <td>{r.spec}</td>
          <td className="num">× {r.qty}</td>
          <td>{r.client || '—'}</td>
          <td className={r.noRo ? 'ldesk-ro--missing' : ''}>{r.ro ? shortRoNumber(r.ro) : r.noRo ? 'BRAK RO' : '—'}</td>
        </tr>
      ))}
    </>
  )
}
