import { useCallback, useEffect, useState } from 'react'
import {
  Package, AlertTriangle, ClipboardCheck, Truck, RefreshCw, FileX2, Clock, Wrench,
} from 'lucide-react'
import { supabase } from '../supabaseClient'
import type { LeadTimeRule } from '../types'
import { summarizeDashboard, type DashboardRow, type DashboardSummary } from '../lib/dashboardCounts'
import Spinner from './Spinner'
import { fetchAllPages } from '../lib/fetchPaged'

type Props = {
  currentUserFullName: string
  reviewCount: number
  /** zlecenia z erp_status = NIEPOMYŚLNY (RO w Optimie nie powstało) */
  erpErrorCount?: number
  /** synchronizacja wydań z Excela (#116): ile do decyzji, kiedy ostatnia, czy przeterminowana */
  excelSync?: { openCount: number; lastSyncAt: string | null; stale: boolean }
  alertsBadgeCount: number
  /** drugi argument = sekcja Weryfikacji, do której przewinąć (#115) */
  onNavigate: (tab: string, focus?: 'review' | 'excel' | 'erp' | 'duplicates') => void
  /** reguły terminów (order_lead_time_rules) — kafel „Po terminie” dla całej firmy */
  leadTimeRules?: LeadTimeRule[]
}

const ORDER_CATEGORIES = [
  { key: 'STA', label: 'STA', color: '#005faf' },
  { key: 'Disting', label: 'Disting', color: '#4f46e5' },
  { key: 'ST', label: 'ST', color: '#1d6d45' },
  { key: 'Techniczne', label: 'Techniczne', color: '#854d0e' },
  { key: 'Bastion', label: 'Bastion', color: '#b3261e' },
  { key: 'DrzwiWewnetrzne', label: 'Drzwi wewn.', color: '#0369a1' },
  { key: 'Aluminium', label: 'Aluminium', color: '#475569' },
] as const

type CategoryCount = { key: string; label: string; color: string; count: number }

const ORDERS_COUNT_HINT =
  'Liczone zlecenia nie wydane i nie anulowane, bez Technicznych (osobny kafel). Titan (STA + ST + Bastion) i para Disting Plus (STA + Disting) liczą się jako JEDNO zlecenie. Kafelki kategorii niżej liczą wiersze w zakładkach.'

// D13 (28.11): „Do wysłania” ≠ „w produkcji” — tylko zlecenia z ukończonymi etapami
const READY_HINT =
  'Zlecenia, w których WSZYSTKIE etapy produkcji są odhaczone (status „Gotowe” w zakładce Wysyłka). Para Disting Plus / zestaw Titan liczy się raz i dopiero, gdy każda niewydana noga jest gotowa. Bez Technicznych i drzwi wewnętrznych (ich spakowanie widać w zakładce Wysyłki).'

const EMPTY_SUMMARY: DashboardSummary = {
  inProduction: 0, readyToShip: 0, technicalOpen: 0, technicalOverdue: 0, overdueTotal: 0, overdueByCategory: {},
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
  erpErrorCount = 0,
  excelSync,
  alertsBadgeCount,
  onNavigate,
  leadTimeRules = [],
}: Props) {
  const [loading, setLoading] = useState(true)
  const [counts, setCounts] = useState<CategoryCount[]>([])
  // D13: „w produkcji” (bez Technicznych), „Do wysłania” (wszystkie etapy), Techniczne osobno
  const [summary, setSummary] = useState<DashboardSummary>(EMPTY_SUMMARY)
  /** testy 27.11 (runda 3): błąd pobierania pokazywał „0 aktywnych zleceń” albo liczbę częściową */
  const [blad, setBlad] = useState<string | null>(null)
  // testy 27.11 (runda 3, prezes): pasek „N przeterminowanych” liczył tylko otwartą zakładkę, a na Pulpicie go nie było
  const [poTerminie, setPoTerminie] = useState<Array<{ key: string; label: string; n: number }>>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // Jedno zapytanie (porcjami po 1000) o wszystkie aktywne wiersze — tylko
      // kolumny potrzebne do liczenia (etapy: production_stages, system dla Titana ST,
      // postęp Aluminium z extra_fields). Przepuść cancelled NULL oraz false.
      const { data: active, error } = await fetchAllPages<DashboardRow>((from, to) =>
        supabase
          .from('orders')
          .select('id, category, linked_order_id, titan_group:extra_fields->>titan_group, order_date, system, production_stages, alu_progress:extra_fields->alu->progress, top_light, side_panel, side_panel_a, side_panel_b, bastion_frame_type')
          .is('release_date', null)
          .or('extra_fields->>cancelled.is.null,extra_fields->>cancelled.eq.false')
          .order('id', { ascending: true })
          .range(from, to)
          .overrideTypes<DashboardRow[], { merge: false }>(),
      )
      if (error) console.error('[Dashboard]', error)
      setBlad(error ? (error as { message?: string }).message ?? String(error) : null)

      // Kafelki kategorii liczą WIERSZE (tyle, ile widać w zakładkach)
      setCounts(
        ORDER_CATEGORIES.map((cat) => ({
          key: cat.key,
          label: cat.label,
          color: cat.color,
          count: active.filter((o) => o.category === cat.key).length,
        })),
      )
      // runda 4 (recenzent): para Disting Plus / zestaw Titan to jedno zlecenie klienta — w sumie liczone raz;
      // D13: Techniczne poza „Po terminie” i „Do wysłania” — mają własny kafel
      const sum = summarizeDashboard(active, leadTimeRules)
      setSummary(sum)
      setPoTerminie(
        ORDER_CATEGORIES.map((cat) => ({
          key: cat.key,
          label: cat.label,
          n: sum.overdueByCategory[cat.key] ?? 0,
        })).filter((c) => c.n > 0),
      )
    } finally {
      setLoading(false)
    }
  }, [leadTimeRules])

  useEffect(() => { void load() }, [load])
  const najwiecejPoTerminie = [...poTerminie].sort((a, b) => b.n - a.n)[0]

  return (
    <div className="dashboard-view">
      <div className="dashboard-header">
        <div>
          <h1 className="dashboard-greeting">{greeting()}, {currentUserFullName.split(' ')[0]}!</h1>
          <p className="dashboard-subtitle" title={ORDERS_COUNT_HINT}>
            {loading ? 'Ładowanie przeglądu…' : blad ? `Nie udało się wczytać przeglądu (${blad}) — liczby mogą być niepełne, kliknij Odśwież` : `${summary.inProduction} aktywnych zleceń w produkcji (bez Technicznych)`}
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
          onClick={() => onNavigate('Weryfikacja', 'review')}
        >
          <ClipboardCheck size={22} />
          <div className="dashboard-alert-num">{reviewCount}</div>
          <div className="dashboard-alert-label">Czeka na weryfikację</div>
        </button>

        <button
          type="button"
          className={`dashboard-alert-card ${erpErrorCount > 0 ? 'dashboard-alert-card--danger' : ''}`}
          onClick={() => onNavigate('Weryfikacja', 'erp')}
          title="Zamówienia z konfiguratora, dla których nie powstało RO w Optimie (poprawka w Airtable → Ponów wysyłkę)"
        >
          <FileX2 size={22} />
          <div className="dashboard-alert-num">{erpErrorCount}</div>
          <div className="dashboard-alert-label">Błędy ERP (Optima)</div>
        </button>

        {excelSync && (
          <button
            type="button"
            className={`dashboard-alert-card ${excelSync.stale ? 'dashboard-alert-card--danger' : excelSync.openCount > 0 ? 'dashboard-alert-card--warn' : ''}`}
            onClick={() => onNavigate('Weryfikacja', 'excel')}
            title={
              excelSync.lastSyncAt
                ? `Ostatnia synchronizacja wydań z arkuszy Excel: ${new Date(excelSync.lastSyncAt).toLocaleString('pl-PL')}${excelSync.stale ? ' — starsza niż dobę, sprawdź scenariusz Make (codziennie 20:00)' : ''}`
                : 'Brak przebiegów synchronizacji z Excelem'
            }
          >
            <RefreshCw size={22} />
            <div className="dashboard-alert-num">{excelSync.openCount}</div>
            <div className="dashboard-alert-label">
              Do wyjaśnienia (Excel)
              <div className="dashboard-alert-sub">
                {excelSync.lastSyncAt
                  ? `sync ${new Date(excelSync.lastSyncAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}${excelSync.stale ? ' ⚠' : ''}`
                  : 'brak synchronizacji'}
              </div>
            </div>
          </button>
        )}

        {leadTimeRules.length > 0 && (
          <button
            type="button"
            className={`dashboard-alert-card ${summary.overdueTotal > 0 ? 'dashboard-alert-card--warn' : ''}`}
            onClick={() => najwiecejPoTerminie && onNavigate(najwiecejPoTerminie.key)}
            title={`Niewydane zlecenia po terminie (reguły terminów z Ustawień), cała firma bez Technicznych (osobny kafel) — w sumie pary Disting Plus i zestawy Titan liczone raz:\n${poTerminie.map((c) => `${c.label}: ${c.n}`).join('\n') || 'brak'}${najwiecejPoTerminie ? `\n\nKliknięcie otwiera ${najwiecejPoTerminie.label}` : ''}`}
          >
            <Clock size={22} />
            <div className="dashboard-alert-num">{loading ? '…' : summary.overdueTotal}</div>
            <div className="dashboard-alert-label">
              Po terminie
              <div className="dashboard-alert-sub">{poTerminie.slice(0, 3).map((c) => `${c.label} ${c.n}`).join(' · ')}</div>
            </div>
          </button>
        )}

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
          title={READY_HINT}
        >
          <Truck size={22} />
          <div className="dashboard-alert-num">{loading ? '…' : summary.readyToShip}</div>
          <div className="dashboard-alert-label">Do wysłania</div>
        </button>

        <button
          type="button"
          className="dashboard-alert-card"
          onClick={() => onNavigate('Techniczne')}
          title="Otwarte (niewydane, nieanulowane) zlecenia Techniczne — liczone osobno, bo prawie nigdy nie są wydawane w programie. Nie wchodzą do „Do wysłania” ani „Po terminie”."
        >
          <Wrench size={22} />
          <div className="dashboard-alert-num">{loading ? '…' : summary.technicalOpen}</div>
          <div className="dashboard-alert-label">
            Techniczne
            {leadTimeRules.length > 0 && <div className="dashboard-alert-sub">po terminie {summary.technicalOverdue}</div>}
          </div>
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
