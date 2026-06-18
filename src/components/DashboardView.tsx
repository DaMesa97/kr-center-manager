import { useCallback, useEffect, useState } from 'react'
import {
  Package, AlertTriangle, ClipboardCheck, Truck, RefreshCw,
} from 'lucide-react'
import { supabase } from '../supabaseClient'
import Spinner from './Spinner'

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
  const [shippingCount, setShippingCount] = useState(0)
  const [totalActive, setTotalActive] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const results = await Promise.all(
        ORDER_CATEGORIES.map(async (cat) => {
          const { count } = await supabase
            .from('orders')
            .select('id', { count: 'exact', head: true })
            .eq('category', cat.key)
            .is('release_date', null)
            // Przepuść wiersze bez flagi cancelled (NULL) oraz cancelled=false
            .or('extra_fields->>cancelled.is.null,extra_fields->>cancelled.eq.false')
          return { key: cat.key, label: cat.label, color: cat.color, count: count ?? 0 }
        }),
      )
      setCounts(results)
      setTotalActive(results.reduce((s, r) => s + r.count, 0))

      // Wysyłka — wszystkie aktywne (nie wydane) to potencjalna wysyłka
      const { count: shipCount } = await supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .is('release_date', null)
        .or('extra_fields->>cancelled.is.null,extra_fields->>cancelled.eq.false')
      setShippingCount(shipCount ?? 0)
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
          <p className="dashboard-subtitle">
            {loading ? 'Ładowanie przeglądu…' : `${totalActive} aktywnych zleceń w produkcji`}
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
        >
          <Truck size={22} />
          <div className="dashboard-alert-num">{loading ? '…' : shippingCount}</div>
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
