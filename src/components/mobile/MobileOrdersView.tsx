import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, ArrowLeft, RefreshCw } from 'lucide-react'
import { supabase } from '../../supabaseClient'
import { countCompletedStages, isReleaseDateEmpty, isRushOrderSequence } from '../../utils'
import type { Order } from '../../types'
import { isOptimaClosed } from '../../lib/optimaRo'
import { groupPicks, pickProgress, type OrderPick } from '../../lib/orderPicks'
import MobileIntDoorPicking from './MobileIntDoorPicking'
import { CAT_COLORS, CAT_LABEL } from './mobileKategorie'
import { humanizeAndLog } from '../../lib/friendlyError'

const CATEGORIES = ['STA', 'Disting', 'ST', 'Techniczne', 'Bastion', 'DrzwiWewnetrzne', 'Aluminium'] as const


type Field = { label: string; value: string }

function detailSections(order: Order): { title: string; fields: Field[] }[] {
  const o = order as Record<string, unknown>
  const str = (v: unknown) => (v == null ? '' : String(v)).trim()
  const wh = [str(order.width), str(order.height)].filter(Boolean).join(' × ')
  const sections = [
    {
      title: 'Podstawowe',
      fields: [
        { label: 'Firma', value: str(order.company) },
        { label: 'Nr klienta', value: str(order.client_order_number) },
        { label: 'Ilość', value: str(order.quantity) },
        { label: 'Dzień produkcji', value: str(order.production_day) },
        { label: 'Data', value: str(order.order_date) },
        { label: 'System', value: str(order.system) },
        { label: 'Model', value: str(order.model) },
      ],
    },
    {
      title: 'Skrzydło',
      fields: [
        { label: 'Kolor skrzydła', value: str(order.wing_color) },
        { label: 'Wymiar (S×W)', value: wh },
        { label: 'Kierunek', value: str(order.direction) },
        { label: 'Otwieranie', value: str(order.opening) },
        { label: 'Szyba', value: str(order.glazing) },
        { label: 'Panel dekor.', value: str(order.decorative_panel) },
      ],
    },
    {
      title: 'Ościeżnica i okucia',
      fields: [
        { label: 'Kolor ościeżnicy', value: str(order.frame_color) },
        { label: 'Próg', value: str(order.threshold_color) },
        { label: 'Okucia', value: str(order.hardware) },
        { label: 'Pochwyt', value: str(order.handle) },
        { label: 'Wizjer', value: str(order.peephole) },
        { label: 'Elektrozaczep', value: str(order.electric_strike) },
        { label: 'Samozamykacz', value: str(order.samozamykacz) },
        { label: 'Poszerzenie', value: str(order.extension) },
      ],
    },
    {
      title: 'Naświetle / dostawka',
      fields: [
        { label: 'Naświetle górne', value: str(order.top_light) },
        { label: 'Szklenie naświetla', value: str(order.top_light_glazing) },
        { label: 'Dostawka boczna', value: str(order.side_panel_a || order.side_panel) },
        { label: 'Szklenie dostawki', value: str(order.side_panel_a_glazing || order.side_panel_glazing) },
      ],
    },
    {
      title: 'Bastion',
      fields: [
        { label: 'Kolekcja', value: str(o.bastion_collection) },
        { label: 'Typ ościeżnicy', value: str(o.bastion_frame_type) },
        { label: 'Zakres ościeżnicy', value: str(o.bastion_frame_range) },
      ],
    },
    {
      title: 'Uwagi',
      fields: [{ label: 'Uwagi', value: str(order.notes) }],
    },
  ]
  // pomiń sekcje bez żadnej wypełnionej wartości
  return sections
    .map((s) => ({ ...s, fields: s.fields.filter((f) => f.value !== '') }))
    .filter((s) => s.fields.length > 0)
}

type Props = {
  /** Wewn.: odznaczanie pozycji przygotowanych do pakowania (kierownik, magazyn) */
  canPickItems?: boolean
  initials?: string
}

type PickProg = { done: number; total: number; complete: boolean }

/** Postęp przygotowania dla listy Wewn. (pozycje + odznaczenia otwartych zleceń, porcjami po 150 id). */
// runda 10: błąd odczytu → null (lista pokazuje komunikat), a nie „0/N” jak przy braku odhaczeń
async function loadPickProgress(orderIds: number[]): Promise<Map<number, PickProg> | null> {
  const items: Array<{ id: number; order_id: number; optima_element_id: number | null; notes: string | null; component_id: number | null; optima_code: string | null; quantity: number }> = []
  const picks: OrderPick[] = []
  for (let i = 0; i < orderIds.length; i += 150) {
    const part = orderIds.slice(i, i + 150)
    const [it, pk] = await Promise.all([
      // 27.11 (testy): notes/component_id/optima_code — bez nich SYSTEM PRZESUWNY miał klucz skrzydła i lista mówiła „✓ komplet”
      supabase.from('order_internal_door_items').select('id, order_id, optima_element_id, notes, component_id, optima_code, quantity').in('order_id', part).limit(5000),
      supabase.from('order_item_picks').select('order_id, line_key, picked_at, picked_by, picked_initials, line_sig').in('order_id', part).limit(5000),
    ])
    if (it.error || pk.error) {
      console.error('[telefon] postęp przygotowania:', it.error ?? pk.error)
      return null
    }
    items.push(...((it.data ?? []) as typeof items))
    picks.push(...((pk.data ?? []) as OrderPick[]))
  }
  const byOrder = new Map<number, typeof items>()
  for (const it of items) byOrder.set(it.order_id, [...(byOrder.get(it.order_id) ?? []), it])
  const picksBy = groupPicks(picks)
  const out = new Map<number, PickProg>()
  for (const [id, its] of byOrder) out.set(id, pickProgress(its, picksBy.get(id)))
  return out
}

export default function MobileOrdersView({ canPickItems = false, initials = '' }: Props = {}) {
  const [category, setCategory] = useState<string>('STA')
  const [query, setQuery] = useState('')
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Order | null>(null)
  const [pickProg, setPickProg] = useState<Map<number, PickProg>>(new Map())
  // runda 10 (tester telefonu): błąd odczytu wyglądał jak „0 aktywnych zleceń”
  const [loadError, setLoadError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  // wersja zapytania — szybkie przełączanie chipów kategorii nie może
  // podmienić listy spóźnioną odpowiedzią poprzedniej kategorii
  const loadVersionRef = useRef(0)
  const load = useCallback(async (cat: string) => {
    const version = ++loadVersionRef.current
    setLoading(true)
    setLoadError(null)
    // Tylko OTWARTE + paginacja (PostgREST ucina do 1000, Bastion ma więcej
    // otwartych) — stary limit gubił najstarsze otwarte zlecenia
    const all: Order[] = []
    let from = 0
    const PAGE = 1000
    let fetchError: { message: string } | null = null
    for (;;) {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('category', cat)
        .is('release_date', null)
        .order('order_date', { ascending: false })
        .order('id', { ascending: false })
        .range(from, from + PAGE - 1)
      if (error) { fetchError = error; break }
      if (!data || data.length === 0) break
      all.push(...(data as Order[]))
      if (data.length < PAGE) break
      from += PAGE
    }
    if (!mountedRef.current || version !== loadVersionRef.current) return
    setLoading(false)
    if (fetchError) {
      setOrders([])
      setLoadError(humanizeAndLog(`Nie wczytano listy zleceń — ${fetchError.message}`, 'mobile-zlecenia'))
      return
    }
    const active = all.filter((o: Order) => {
      const extra = o.extra_fields as Record<string, unknown> | null
      if (extra?.cancelled === true) return false
      if (!isReleaseDateEmpty(o.release_date)) return false
      // RO zrealizowane / zamknięte w Optimie (tysiące z importu) — jak na komputerze, poza listą
      if (isOptimaClosed(o)) return false
      return true
    })
    setOrders(active)
    if (cat === 'DrzwiWewnetrzne') {
      const prog = await loadPickProgress(active.map((o) => o.id).filter((id): id is number => id != null))
      if (mountedRef.current && version === loadVersionRef.current) {
        setPickProg(prog ?? new Map())
        if (!prog) setLoadError('Nie wczytano postępu przygotowania drzwi — odśwież listę')
      }
    } else {
      setPickProg(new Map())
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    void load(category)
    return () => { mountedRef.current = false }
  }, [category, load])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return orders
    return orders.filter(
      (o) =>
        String(o.order_number ?? '').toLowerCase().includes(q) ||
        String(o.company ?? '').toLowerCase().includes(q) ||
        String(o.client_order_number ?? '').toLowerCase().includes(q) ||
        String(o.model ?? '').toLowerCase().includes(q),
    )
  }, [orders, query])

  if (selected) {
    const { completed, total, percent } = countCompletedStages(selected)
    const sections = detailSections(selected)
    return (
      <div className="morders-detail">
        <button type="button" className="mpack-back" onClick={() => { setSelected(null); if (selected.category === 'DrzwiWewnetrzne') void load(category) }}>
          <ArrowLeft size={18} /> Wróć do listy
        </button>
        <div className="morders-detail-head">
          <span className="mpack-cat" style={{ background: CAT_COLORS[selected.category] ?? '#475569' }}>
            {CAT_LABEL[selected.category] ?? selected.category}
          </span>
          <span className="morders-detail-nr">{selected.order_number}</span>
          {isRushOrderSequence(selected.sequence) && <span className="morders-rush">PILNE</span>}
        </div>
        {total > 0 && (
          <div className="morders-progress">
            <div className="morders-progress-bar">
              <div
                className="morders-progress-fill"
                style={{ width: `${percent}%`, background: percent === 100 ? '#16a34a' : '#3b82f6' }}
              />
            </div>
            <span className="morders-progress-label">Etapy: {completed}/{total} ({percent}%)</span>
          </div>
        )}
        {selected.category === 'DrzwiWewnetrzne' && selected.id != null && (
          <MobileIntDoorPicking orderId={selected.id} canEdit={canPickItems} initials={initials} />
        )}
        {sections.map((s) => (
          <div key={s.title} className="morders-section">
            <div className="morders-section-title">{s.title}</div>
            <div className="morders-fields">
              {s.fields.map((f) => (
                <div key={f.label} className="morders-field">
                  <span className="morders-field-label">{f.label}</span>
                  <span className="morders-field-value">{f.value}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="morders">
      <div className="morders-cats">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            className="morders-cat-chip"
            style={{
              background: category === c ? CAT_COLORS[c] : 'transparent',
              color: category === c ? '#fff' : CAT_COLORS[c],
              borderColor: CAT_COLORS[c],
            }}
            onClick={() => { setCategory(c); setQuery('') }}
          >
            {CAT_LABEL[c]}
          </button>
        ))}
      </div>

      <div className="morders-searchrow">
        <div className="mpack-search-box">
          <Search size={18} />
          <input
            type="text"
            inputMode="search"
            placeholder="Nr, firma, model…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button type="button" className="mstation-refresh" onClick={() => void load(category)}>
          <RefreshCw size={18} />
        </button>
      </div>

      <div className="morders-count">
        {loading ? 'Ładowanie…' : loadError && orders.length === 0 ? loadError : `${filtered.length} aktywnych zleceń`}
        {!loading && loadError && orders.length > 0 && <div style={{ color: '#b91c1c' }}>{loadError}</div>}
      </div>

      <div className="morders-list">
        {!loading && filtered.map((o) => {
          const { completed, total, percent } = countCompletedStages(o)
          const urgent = isRushOrderSequence(o.sequence)
          return (
            <button key={o.id} type="button" className="morders-card" onClick={() => setSelected(o)}>
              <div className="morders-card-top">
                <span className="morders-card-nr">{urgent && '⚡ '}{o.order_number}</span>
                <span className="morders-card-model">{o.model}</span>
              </div>
              <div className="morders-card-company">{o.company}</div>
              {o.category === 'DrzwiWewnetrzne' && o.id != null && (() => {
                const pp = pickProg.get(o.id)
                if (!pp || pp.total === 0) return null
                return (
                  <span className={`mpick-badge${pp.complete ? ' mpick-badge--done' : ''}`}>
                    {pp.complete ? '✓ przygotowane' : pp.done > 0 ? `przygotowano ${pp.done}/${pp.total}` : `${pp.total} poz. do przygotowania`}
                  </span>
                )
              })()}
              {total > 0 && (
                <div className="morders-card-prog">
                  <div className="morders-card-prog-bar">
                    <div
                      className="morders-card-prog-fill"
                      style={{ width: `${percent}%`, background: percent === 100 ? '#16a34a' : '#3b82f6' }}
                    />
                  </div>
                  <span className="morders-card-prog-txt">{completed}/{total}</span>
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
