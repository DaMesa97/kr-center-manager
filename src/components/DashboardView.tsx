import { useCallback, useEffect, useState } from 'react'
import {
  Package, AlertTriangle, ClipboardCheck, Truck, RefreshCw,
} from 'lucide-react'
import { supabase } from '../supabaseClient'
import Spinner from './Spinner'
import { fetchAllPages } from '../lib/fetchPaged'

type Props = {
  currentUserFullName: string
  reviewCount: number
  alertsBadgeCount: number
  onNavigate: (tab: string) => void
}

const ORDER_CATEGORIES = [
  { key: 'STA', label: 'STA', color: '#005faf' },
  { key: 'Disting', label: 'Disting', color: '#4f46e5' },
  { key: 'ST', label: 'ST', color: '#1d6d45' },
  { key: 'Techniczne', label: 'Techniczne', color: '#854d0e' },
  { key: 'Bastion', label: 'Bastion', color: '#b3261e' },
  { key: 'DrzwiWewnetrzne', label: 'Drzwi wewn.', color: '#0369a1' },
] as const

type CategoryCount = { key: string; label: string; color: string; count: number }

const ORDERS_COUNT_HINT =
  'Liczone zlecenia nie wydane i nie anulowane. Titan (STA + ST + Bastion) i para Disting Plus (STA + Disting) liczą się jako JEDNO zlecenie. Kafelki kategorii niżej liczą wiersze w zakładkach.'

/** Zlecenia „logiczne": trójka Titana (titan_group) i para Disting Plus (linked_order_id) = 1 */
function countActiveOrders(rows: Array<{ id: number; linked_order_id: number | null; titan_group: string | null }>): number {
  const keys = new Set<string>()
  for (const o of rows) {
    if (o.titan_group) keys.add(`t:${o.titan_group}`)
    else if (o.linked_order_id != null) keys.add(`p:${Math.min(o.id, o.linked_order_id)}`)
    else keys.add(`o:${o.id}`)
  }
  return keys.size
}

function greeting(): string {
  // Bez Date.now w runtime workflow, ale tu zwykły komponent — Date jest OK
  const h = new Date().getHours()
  if (h < 12) return 'Dzień dobry'
  if (h < 18) return 'Cześć'
  return 'Dobry wieczór'
}

export default function DashboardView({
  currentUserFullName,
  reviewCount,
  alertsBadgeCount,
  onNavigate,
}: Props) {
  const [loading, setLoading] = useState(true)
  const [counts, setCounts] = useState<CategoryCount[]>([])
  // Jedna definicja dla „aktywnych zleceń" i „Do wysłania" (patrz ORDERS_COUNT_HINT)
  const [ordersCount, setOrdersCount] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // Jedno zapytanie (porcjami po 1000) o wszystkie aktywne wiersze — tylko
      // kolumny potrzebne do liczenia. Przepuść cancelled NULL oraz false.
      type ActiveRow = { id: number; category: string; linked_order_id: number | null; titan_group: string | null }
      const { data: active, error } = await fetchAllPages<ActiveRow>((from, to) =>
        supabase
          .from('orders')
          .select('id, category, linked_order_id, titan_group:extra_fields->>titan_group')
          .is('release_date', null)
          .or('extra_fields->>cancelled.is.null,extra_fields->>cancelled.eq.false')
          .order('id', { ascending: true })
          .range(from, to)
          .overrideTypes<ActiveRow[], { merge: false }>(),
      )
      if (error) console.error('[Dashboard]', error)

      // Kafelki kategorii liczą WIERSZE (tyle, ile widać w zakładkach)
      setCounts(
        ORDER_CATEGORIES.map((cat) => ({
          key: cat.key,
          label: cat.label,
          color: cat.color,
          count: active.filter((o) => o.category === cat.key).length,
        })),
      )
      setOrdersCount(countActiveOrders(active))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  return (
    <div className="dashboard-view">
      <div className="dashboard-header">
        <div>
          <h1 className="dashboard-greeting">{greeting()}, {currentUserFullName.split(' ')[0]}!</h1>
          <p className="dashboard-subtitle" title={ORDERS_COUNT_HINT}>
            {loading ? 'Ładowanie przeglądu…' : `${ordersCount} aktywnych zleceń w produkcji`}
          </p>
        </div>
        <button type="button" className="btn btn-sm btn-secondary" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={14} style={loading ? { animation: 'spin 1s linear infinite' } : {}} /> Odśwież
        </button>
      </div>

      {/* Karty akcji — rzeczy wymagające uwagi */}
      <div className="dashboard-alerts">
        <button
          type="button"
          className={`dashboard-alert-card ${reviewCount > 0 ? 'dashboard-alert-card--warn' : ''}`}
          onClick={() => onNavigate('Weryfikacja')}
        >
          <ClipboardCheck size={22} />
          <div className="dashboard-alert-num">{reviewCount}</div>
          <div className="dashboard-alert-label">Czeka na weryfikację</div>
        </button>

        <button
          type="button"
          className={`dashboard-alert-card ${alertsBadgeCount > 0 ? 'dashboard-alert-card--danger' : ''}`}
          onClick={() => onNavigate('Zamawianie')}
        >
          <AlertTriangle size={22} />
          <div className="dashboard-alert-num">{alertsBadgeCount}</div>
          <div className="dashboard-alert-label">Stany poniżej progu</div>
        </button>

        <button
          type="button"
          className="dashboard-alert-card"
          onClick={() => onNavigate('Wysyłka')}
          title={ORDERS_COUNT_HINT}
        >
          <Truck size={22} />
          <div className="dashboard-alert-num">{loading ? '…' : ordersCount}</div>
          <div className="dashboard-alert-label">Do wysłania</div>
        </button>
      </div>

      {/* Zlecenia per kategoria */}
      <div className="dashboard-section-title">
        <Package size={16} /> Zlecenia w toku wg kategorii
      </div>
      <div className="dashboard-categories">
        {loading ? (
          <Spinner center label="Ładowanie zleceń…" />
        ) : (
          counts.map((c) => (
            <button
              key={c.key}
              type="button"
              className="dashboard-cat-card"
              onClick={() => onNavigate(c.key)}
              style={{ borderTopColor: c.color }}
            >
              <div className="dashboard-cat-count" style={{ color: c.color }}>{c.count}</div>
              <div className="dashboard-cat-label">{c.label}</div>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
