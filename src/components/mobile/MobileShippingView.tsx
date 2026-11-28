import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, RefreshCw, Truck } from 'lucide-react'
import { supabase } from '../../supabaseClient'
import { humanizeAndLog } from '../../lib/friendlyError'
import { groupPicks, pickProgress, type OrderPick } from '../../lib/orderPicks'
import type { InternalDoorItem } from '../../types'
import { countCompletedStages, isReleaseDateEmpty, isRushOrderSequence } from '../../utils'
import { can, isCategoryScoped } from '../../lib/permissions'
import {
  cleanCompanyValue,
  createCompanyResolver,
  getOrderRouteDay,
  type CompanyShippingInfo,
} from '../../lib/companyMatch'
import type { Order } from '../../types'
import { CAT_COLORS, CAT_LABEL } from './mobileKategorie'


// Tylko kolumny potrzebne do karty, postępu etapów (countCompletedStages) i trasy —
// select('*') ciągnął kilka tysięcy pełnych wierszy na telefon
const SHIP_COLUMNS =
  'id, order_number, company, category, sequence, production_stages, extra_fields, system, ' +
  'linked_order_id, top_light, side_panel, side_panel_a, side_panel_b, notes, production_day, release_date'

const PAGE_SIZE = 100

type Row = {
  order: Order
  completed: number
  total: number
  percent: number
  urgent: boolean
  routeDay: string
}

type Props = {
  role: string
  /** Kategorie przypisane userowi — role zawężone (KD/PP) widzą tylko swoje */
  categories?: string[]
}

export default function MobileShippingView({ role, categories = [] }: Props) {
  const canRelease = can(role, 'orders.release')
  const scoped = isCategoryScoped(role)
  const [orders, setOrders] = useState<Order[]>([])
  const [companiesMap, setCompaniesMap] = useState<Map<string, CompanyShippingInfo>>(new Map())
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [confirm, setConfirm] = useState<Order | null>(null)
  // runda 4 (tester hali): przy drzwiach wewnętrznych telefon nie mówił, ile spakowano i czy są pozycje bez komponentu
  const [wewInfo, setWewInfo] = useState<{ done: number; total: number; bezKomponentu: number } | null>(null)
  // runda 10 (tester telefonu): przy błędzie ostrzeżenie „Spakowane x/y” po cichu znikało, a „Tak, wydane”
  // działało, zanim postęp się wczytał — teraz: czekamy na wczytanie, błąd mówimy wprost
  const [wewStan, setWewStan] = useState<'brak' | 'wczytuje' | 'ok' | 'blad'>('brak')
  useEffect(() => {
    setWewInfo(null)
    setWewStan(confirm?.category === 'DrzwiWewnetrzne' && confirm.id != null ? 'wczytuje' : 'brak')
    if (!confirm || confirm.category !== 'DrzwiWewnetrzne' || confirm.id == null) return
    const orderId = confirm.id
    let aktualne = true
    void (async () => {
      const [it, pk] = await Promise.all([
        supabase.from('order_internal_door_items').select('*').eq('order_id', orderId),
        supabase.from('order_item_picks').select('order_id, line_key, picked_at, picked_by, picked_initials, line_sig').eq('order_id', orderId),
      ])
      if (!aktualne) return
      if (it.error || pk.error) {
        console.error('[wydanie z telefonu] postęp pakowania:', it.error ?? pk.error)
        setWewStan('blad')
        return
      }
      setWewStan('ok')
      const items = (it.data ?? []) as unknown as InternalDoorItem[]
      const pr = pickProgress(items, groupPicks((pk.data ?? []) as OrderPick[]).get(orderId))
      setWewInfo({ done: pr.done, total: pr.total, bezKomponentu: items.filter((x) => x.component_id == null).length })
    })()
    return () => { aktualne = false }
  }, [confirm])
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const mountedRef = useRef(true)

  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flash = (m: string, sticky = false) => {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    setToast(humanizeAndLog(m, 'mobile-wysylka')) // techniczne błędy bazy/sieci po ludzku
    flashTimerRef.current = sticky ? null : setTimeout(() => setToast(null), 2500)
  }

  const load = useCallback(async () => {
    setLoading(true)
    // Paginacja — PostgREST ucina do 1000 wierszy, a otwartych jest kilka
    // tysięcy; sort tekstowy po order_number ucinał losowo (w tym świeże)
    const fetchAllOpen = async (): Promise<{ data: Order[]; error: { message: string } | null }> => {
      const all: Order[] = []
      let from = 0
      const PAGE = 1000
      for (;;) {
        const { data, error } = await supabase
          .from('orders')
          .select(SHIP_COLUMNS)
          .is('release_date', null)
          .order('id', { ascending: false })
          .range(from, from + PAGE - 1)
        if (error) return { data: all, error }
        if (!data || data.length === 0) break
        all.push(...(data as unknown as Order[]))
        if (data.length < PAGE) break
        from += PAGE
      }
      return { data: all, error: null }
    }
    const [ordersRes, companiesRes] = await Promise.all([
      fetchAllOpen(),
      supabase.from('companies').select('name, production_day, route_day'),
    ])
    if (!mountedRef.current) return
    setLoading(false)
    if (ordersRes.error) { flash('Błąd ładowania'); return }
    const allowed = new Set(categories)
    const active = (ordersRes.data ?? []).filter((o: Order) => {
      const extra = o.extra_fields as Record<string, unknown> | null
      if (extra?.cancelled === true) return false
      // role zawężone (kierownik działu) widzą tylko przypisane kategorie
      if (scoped && !allowed.has(o.category ?? '')) return false
      return true
    }) as Order[]
    setOrders(active)
    const m = new Map<string, CompanyShippingInfo>()
    for (const c of (companiesRes.data ?? []) as Array<{ name?: string; production_day?: string; route_day?: string }>) {
      m.set((c.name ?? '').trim().toLowerCase(), {
        production_day: cleanCompanyValue(c.production_day),
        route_day: cleanCompanyValue(c.route_day),
      })
    }
    setCompaniesMap(m)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped, categories.join('|')])

  useEffect(() => {
    mountedRef.current = true
    void load()
    return () => { mountedRef.current = false }
  }, [load])

  // Postęp i trasa liczone raz na zamówienie (wcześniej countCompletedStages w komparatorze)
  const rows = useMemo<Row[]>(() => {
    const resolve = createCompanyResolver(companiesMap)
    return orders.map((o) => {
      const { completed, total, percent } = countCompletedStages(o)
      return {
        order: o,
        completed,
        total,
        percent,
        urgent: isRushOrderSequence(o.sequence),
        routeDay: getOrderRouteDay(o, resolve(o.company)),
      }
    })
  }, [orders, companiesMap])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const base = q
      ? rows.filter(
          (r) =>
            String(r.order.order_number ?? '').toLowerCase().includes(q) ||
            String(r.order.company ?? '').toLowerCase().includes(q),
        )
      : rows
    return [...base].sort((a, b) => {
      if (a.urgent !== b.urgent) return a.urgent ? -1 : 1
      return b.percent - a.percent // najbardziej gotowe na górze
    })
  }, [rows, query])

  const visible = filtered.slice(0, visibleCount)

  const markReleased = async (order: Order) => {
    if (!canRelease) { flash('Brak uprawnień do wydania'); return }
    setSaving(true)
    try {
      // NAJPIERW data wydania, z twardym sprawdzeniem (guard .is null +
      // select): stara kolejność robiła WZ przed datą — gdy zapis daty padał
      // (RLS/już wydane), magazyn schodził, a zamówienie wracało jako otwarte
      // i drugie kliknięcie nie miało już czego wydać (rozjazd inwentaryzacji).
      const today = new Date().toLocaleDateString('sv-SE')
      const { data: updated, error } = await supabase
        .from('orders')
        .update({ release_date: today })
        .eq('id', order.id!)
        .is('release_date', null)
        // runda 4 (tester magazynu): lista na telefonie się nie odświeża — zlecenie anulowane w biurze dawało się wydać
        .or('extra_fields->>cancelled.is.null,extra_fields->>cancelled.neq.true')
        .select('id')
      if (!mountedRef.current) return
      if (error || !updated || updated.length === 0) {
        // runda 10 (tester telefonu): przy zgubionej odpowiedzi data mogła się zapisać, a WZ nie poszła —
        // ponowienie trafiało w „już wydane” i rezerwacje wisiały. Sprawdzamy stan w bazie: zlecenie wydane
        // i nie anulowane → dopinamy zdjęcie z magazynu (obie funkcje liczą tylko brakującą resztę).
        const { data: teraz } = await supabase
          .from('orders')
          .select('release_date, extra_fields')
          .eq('id', order.id!)
          .maybeSingle()
        if (!mountedRef.current) return
        const juzWydane =
          !!teraz &&
          !isReleaseDateEmpty(teraz.release_date as string | null) &&
          (teraz.extra_fields as { cancelled?: unknown } | null)?.cancelled !== true
        if (!juzWydane) {
          flash(
            error
              ? `Błąd: NIE wydano — ${error.message}`
              : 'NIE wydano — zamówienie jest już wydane, zostało anulowane albo nie masz uprawnień (odśwież listę)',
            true,
          )
          return
        }
      }
      // DOPIERO teraz fizyczne wydanie (WZ) — jak desktop. Braki z force=true
      // (zamówienie fizycznie wyjeżdża), błąd RPC nie cofa daty, ale krzyczy.
      // 27.11 (testy): drzwi wewnętrzne nie mają rezerwacji — schodzą z Magazynu 1 / 2 przez
      // issue_internal_door_stock (jak „Wydane” na komputerze); wcześniej telefon nic nie zdejmował.
      let warned = false
      try {
        const { error: relErr } = order.category === 'DrzwiWewnetrzne'
          ? await supabase.rpc('issue_internal_door_stock', { p_order_id: order.id! })
          : await supabase.rpc('release_remaining_for_order', { p_order_id: order.id!, p_force: true })
        if (relErr) {
          console.error('[wydanie z telefonu] WZ error:', relErr)
          warned = true
        }
      } catch (err) {
        console.error('[wydanie z telefonu] WZ error:', err)
        warned = true
      }
      if (!mountedRef.current) return
      setOrders((prev) => prev.filter((o) => o.id !== order.id))
      // ostrzeżenie zostaje na ekranie — sukces by je nadpisał
      if (warned) flash('Wydane, ale WZ z magazynu NIE zeszła — zgłoś kierownikowi', true)
      else flash('Oznaczono jako wydane ✓')
      setConfirm(null)
    } finally {
      if (mountedRef.current) setSaving(false)
    }
  }

  if (loading) {
    return <div className="mstation-boot"><div className="mlogin-spinner" /></div>
  }

  return (
    <div className="mship">
      <div className="morders-searchrow" style={{ padding: '0.75rem 0.75rem 0' }}>
        <div className="mpack-search-box">
          <Search size={18} />
          <input
            type="text"
            inputMode="search"
            placeholder="Nr lub firma…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setVisibleCount(PAGE_SIZE)
            }}
          />
        </div>
        <button type="button" className="mstation-refresh" onClick={() => void load()}>
          <RefreshCw size={18} />
        </button>
      </div>
      <div className="morders-count" style={{ padding: '0.5rem 1rem' }}>
        {filtered.length} do wydania
      </div>

      <div className="morders-list" style={{ padding: '0 0.75rem 0.75rem' }}>
        {visible.map(({ order: o, completed, total, percent, urgent, routeDay }) => {
          const ready = percent === 100 || total === 0
          return (
            <div key={o.id} className="mship-card">
              <div className="mship-card-info">
                <div className="morders-card-top">
                  <span className="morders-card-nr">
                    {urgent && '⚡ '}
                    <span className="mpack-cat" style={{ background: CAT_COLORS[o.category] ?? '#475569', marginRight: 6 }}>
                      {CAT_LABEL[o.category] ?? o.category}
                    </span>
                    {o.order_number}
                  </span>
                </div>
                <div className="morders-card-company">{o.company}</div>
                <div className="mship-meta">
                  {total > 0 && (
                    <span className={ready ? 'mship-ready' : 'mship-progress'}>
                      Etapy {completed}/{total}
                    </span>
                  )}
                  {routeDay && <span className="mship-route">🚛 {routeDay}</span>}
                </div>
              </div>
              <button
                type="button"
                className="mship-release-btn"
                onClick={() => setConfirm(o)}
                disabled={!canRelease}
                title={canRelease ? undefined : 'Brak uprawnień do wydania'}
                style={canRelease ? undefined : { opacity: 0.45, cursor: 'not-allowed' }}
              >
                <Truck size={16} /> Wydane
              </button>
            </div>
          )
        })}
        {filtered.length > visibleCount && (
          <button
            type="button"
            className="mship-release-btn"
            style={{ justifyContent: 'center', width: '100%', marginTop: '0.5rem' }}
            onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
          >
            Pokaż więcej ({filtered.length - visibleCount})
          </button>
        )}
        {filtered.length === 0 && <div className="mpack-info">Brak zamówień do wydania</div>}
      </div>

      {confirm && (
        <div className="mstation-confirm-overlay" onClick={() => !saving && setConfirm(null)}>
          <div className="mstation-confirm" onClick={(e) => e.stopPropagation()}>
            <div className="mstation-confirm-title">Oznaczyć jako wydane?</div>
            <div className="mstation-confirm-body">
              Zlecenie {confirm.order_number} — {confirm.company}<br />
              Zostanie ustawiona data wydania (dziś), z magazynu zejdą wszystkie
              pozostałe rezerwacje i zlecenie zniknie z listy.
              {(() => {
                const { completed, total } = countCompletedStages(confirm)
                return total > 0 && completed < total ? (
                  <>
                    <br />
                    <span style={{ color: '#b91c1c', fontWeight: 700 }}>
                      ⚠️ Zlecenie ma niezakończone etapy ({completed}/{total}). Na pewno wydać?
                    </span>
                  </>
                ) : null
              })()}
              {wewStan === 'wczytuje' && (
                <>
                  <br />
                  <span>Wczytuję postęp pakowania…</span>
                </>
              )}
              {wewStan === 'blad' && (
                <>
                  <br />
                  <span style={{ color: '#b91c1c', fontWeight: 700 }}>
                    ⚠️ Nie wczytano postępu pakowania (sprawdź internet) — nie wiadomo, czy wszystko odhaczone.
                  </span>
                </>
              )}
              {wewInfo && (
                <>
                  <br />
                  <span style={{ color: wewInfo.total > 0 && wewInfo.done < wewInfo.total ? '#b91c1c' : undefined, fontWeight: 700 }}>
                    Spakowane: {wewInfo.done}/{wewInfo.total}{wewInfo.total > 0 && wewInfo.done < wewInfo.total ? ' — nie wszystko odhaczone. Na pewno wydać?' : ''}
                  </span>
                  {wewInfo.bezKomponentu > 0 && (
                    <>
                      <br />
                      <span style={{ color: '#b45309' }}>⚠️ {wewInfo.bezKomponentu} poz. bez przypisanego komponentu — nie zejdą z magazynu.</span>
                    </>
                  )}
                </>
              )}
            </div>
            <div className="mstation-confirm-actions">
              <button type="button" className="mstation-confirm-cancel" onClick={() => setConfirm(null)} disabled={saving}>
                Anuluj
              </button>
              <button type="button" className="mstation-confirm-ok" onClick={() => void markReleased(confirm)} disabled={saving || !canRelease || wewStan === 'wczytuje'}>
                {saving ? 'Zapisywanie…' : 'Tak, wydane'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="mpack-toast">{toast}</div>}
    </div>
  )
}
