import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, RefreshCw, Truck } from 'lucide-react'
import { supabase } from '../../supabaseClient'
import { countCompletedStages, isRushOrderSequence } from '../../utils'
import type { Order } from '../../types'

const CAT_COLORS: Record<string, string> = {
  STA: '#005faf', Disting: '#4f46e5', ST: '#1d6d45',
  Techniczne: '#854d0e', Bastion: '#b3261e', DrzwiWewnetrzne: '#0369a1',
}
const CAT_LABEL: Record<string, string> = {
  STA: 'STA', Disting: 'Disting', ST: 'ST', Techniczne: 'Techn.', Bastion: 'Bastion', DrzwiWewnetrzne: 'Wewn.',
}

export default function MobileShippingView() {
  const [orders, setOrders] = useState<Order[]>([])
  const [companiesMap, setCompaniesMap] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [confirm, setConfirm] = useState<Order | null>(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const mountedRef = useRef(true)

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2500) }

  const load = useCallback(async () => {
    setLoading(true)
    const [ordersRes, companiesRes] = await Promise.all([
      supabase.from('orders').select('*').is('release_date', null).order('order_number', { ascending: false }).limit(2000),
      supabase.from('companies').select('name, route_day'),
    ])
    if (!mountedRef.current) return
    setLoading(false)
    if (ordersRes.error) { flash('Błąd ładowania'); return }
    const active = (ordersRes.data ?? []).filter((o: Order) => {
      const extra = o.extra_fields as Record<string, unknown> | null
      return extra?.cancelled !== true
    }) as Order[]
    setOrders(active)
    const m = new Map<string, string>()
    for (const c of (companiesRes.data ?? []) as Array<{ name?: string; route_day?: string }>) {
      m.set((c.name ?? '').trim().toLowerCase(), String(c.route_day ?? ''))
    }
    setCompaniesMap(m)
  }, [])

  useEffect(() => {
    mountedRef.current = true
    void load()
    return () => { mountedRef.current = false }
  }, [load])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const base = q
      ? orders.filter(
          (o) =>
            String(o.order_number ?? '').toLowerCase().includes(q) ||
            String(o.company ?? '').toLowerCase().includes(q),
        )
      : orders
    return [...base].sort((a, b) => {
      const au = isRushOrderSequence(a.sequence), bu = isRushOrderSequence(b.sequence)
      if (au !== bu) return au ? -1 : 1
      const ap = countCompletedStages(a).percent, bp = countCompletedStages(b).percent
      return bp - ap // najbardziej gotowe na górze
    })
  }, [orders, query])

  const markReleased = async (order: Order) => {
    setSaving(true)
    try {
      const today = new Date().toISOString().split('T')[0]
      const { error } = await supabase.from('orders').update({ release_date: today }).eq('id', order.id!)
      if (!mountedRef.current) return
      if (error) { flash(`Błąd: ${error.message}`); return }
      setOrders((prev) => prev.filter((o) => o.id !== order.id))
      flash('Oznaczono jako wydane ✓')
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
            onChange={(e) => setQuery(e.target.value)}
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
        {filtered.map((o) => {
          const { completed, total, percent } = countCompletedStages(o)
          const routeDay = companiesMap.get((o.company ?? '').trim().toLowerCase()) || ''
          const urgent = isRushOrderSequence(o.sequence)
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
              >
                <Truck size={16} /> Wydane
              </button>
            </div>
          )
        })}
        {filtered.length === 0 && <div className="mpack-info">Brak zamówień do wydania</div>}
      </div>

      {confirm && (
        <div className="mstation-confirm-overlay" onClick={() => !saving && setConfirm(null)}>
          <div className="mstation-confirm" onClick={(e) => e.stopPropagation()}>
            <div className="mstation-confirm-title">Oznaczyć jako wydane?</div>
            <div className="mstation-confirm-body">
              Zlecenie {confirm.order_number} — {confirm.company}<br />
              Zostanie ustawiona data wydania (dziś) i zniknie z listy.
            </div>
            <div className="mstation-confirm-actions">
              <button type="button" className="mstation-confirm-cancel" onClick={() => setConfirm(null)} disabled={saving}>
                Anuluj
              </button>
              <button type="button" className="mstation-confirm-ok" onClick={() => void markReleased(confirm)} disabled={saving}>
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
