import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, ArrowLeft, RefreshCw } from 'lucide-react'
import { supabase } from '../../supabaseClient'
import { countCompletedStages, isReleaseDateEmpty, isRushOrderSequence } from '../../utils'
import type { Order } from '../../types'

const CATEGORIES = ['STA', 'Disting', 'ST', 'Techniczne', 'Bastion', 'DrzwiWewnetrzne'] as const

const CAT_COLORS: Record<string, string> = {
  STA: '#005faf', Disting: '#4f46e5', ST: '#1d6d45',
  Techniczne: '#854d0e', Bastion: '#b3261e', DrzwiWewnetrzne: '#0369a1',
}
const CAT_LABEL: Record<string, string> = {
  STA: 'STA', Disting: 'Disting', ST: 'ST', Techniczne: 'Techn.', Bastion: 'Bastion', DrzwiWewnetrzne: 'Wewn.',
}

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

export default function MobileOrdersView() {
  const [category, setCategory] = useState<string>('STA')
  const [query, setQuery] = useState('')
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Order | null>(null)
  const mountedRef = useRef(true)

  const load = useCallback(async (cat: string) => {
    setLoading(true)
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('category', cat)
      .order('order_date', { ascending: false })
      .order('id', { ascending: false })
      .limit(500)
    if (!mountedRef.current) return
    setLoading(false)
    if (error) return
    const active = (data ?? []).filter((o: Order) => {
      const extra = o.extra_fields as Record<string, unknown> | null
      if (extra?.cancelled === true) return false
      if (o.release_date && !isReleaseDateEmpty(o.release_date)) return false
      return true
    }) as Order[]
    setOrders(active)
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
        String(o.model ?? '').toLowerCase().includes(q),
    )
  }, [orders, query])

  if (selected) {
    const { completed, total, percent } = countCompletedStages(selected)
    const sections = detailSections(selected)
    return (
      <div className="morders-detail">
        <button type="button" className="mpack-back" onClick={() => setSelected(null)}>
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
        {loading ? 'Ładowanie…' : `${filtered.length} aktywnych zleceń`}
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
