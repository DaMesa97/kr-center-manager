import { STATS_SUB_TABS } from '../constants'
import { CATEGORY_LABELS } from '../constants'
import type { Complaint, Order, StatsSubTab } from '../types'
import CategoryStatsDashboard from './stats/CategoryStatsDashboard'
import CategoryTrendShortages from './stats/CategoryTrendShortages'
import ComplaintsStatsDashboard from './stats/ComplaintsStatsDashboard'
import CompanyStatsView from './stats/CompanyStatsView'
import InternalDoorStatsDashboard from './stats/InternalDoorStatsDashboard'
import ProductivityView from './stats/ProductivityView'
import LeadTimeStatsView from './stats/LeadTimeStatsView'
import ConfiguratorShareView from './stats/ConfiguratorShareView'
import MonthlyConsumptionView from './warehouse/MonthlyConsumptionView'
import { useMemo, type ComponentProps } from 'react'
import { useCompanyAliases } from '../hooks/useCompanyAliases'
import { companyCanonizer } from '../lib/companyStats'

type StatsViewProps = {
  orders: Order[]
  complaints: Complaint[]
  loading: boolean
  /** błąd pobierania danych statystyk (null = OK) */
  error?: string | null
  onRetry?: () => void
  activeSubTab: StatsSubTab
  onSubTabChange: (tab: StatsSubTab) => void
  /** kierownik może scalać pisownie firm (Statystyki → Firmy → Porządek nazw) i przypisywać grupy nierozpoznanym pozycjom wewnętrznym */
  isManager?: boolean
  currentUserId?: string | null
  /** „Zużycie magazynu" — raport miesięczny, przeniesiony tu z Magazynu (porządki menu, beta.86) */
  monthlyConsumption: ComponentProps<typeof MonthlyConsumptionView>
}

const PRODUCTION_SUB_TABS = ['STA', 'Disting', 'ST', 'Techniczne', 'Bastion']

function StatsView({
  orders,
  complaints,
  loading,
  error = null,
  onRetry,
  activeSubTab,
  onSubTabChange,
  monthlyConsumption,
  isManager = false,
  currentUserId = null,
}: StatsViewProps) {
  // Warianty pisowni firm liczone razem (companyKey + company_aliases) — we wszystkich sekcjach z „top firm”
  const { rows: aliasRows, aliases, merge, remove } = useCompanyAliases()
  const canonCompany = useMemo(() => companyCanonizer(orders, aliases), [orders, aliases])
  return (
    <div
      className="warehouse-view warehouse-view--readonly"
      aria-label={`Statystyki: ${orders.length} zamówień, ${complaints.length} reklamacji`}
    >
      <div className="subtab-bar" role="tablist" aria-label="Statystyki — sekcje">
        {STATS_SUB_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeSubTab === tab}
            className={`btn btn-sm ${activeSubTab === tab ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => onSubTabChange(tab)}
          >
            {CATEGORY_LABELS[tab as keyof typeof CATEGORY_LABELS] ?? tab}
          </button>
        ))}
      </div>
      {error && !loading && (
        // testy 27.11 (runda 3): zamiast pustych wykresów / „brak danych” przy błędzie sieci lub bazy
        <div className="error-banner" role="alert" style={{ margin: '8px 0', padding: '10px 12px', border: '1px solid #fca5a5', background: '#fef2f2', color: '#991b1b', borderRadius: 6 }}>
          Nie udało się wczytać danych statystyk ({error}) — liczby poniżej mogą być niepełne.{' '}
          {onRetry && <button type="button" className="btn btn-sm btn-secondary" onClick={onRetry}>Odśwież</button>}
        </div>
      )}
      {PRODUCTION_SUB_TABS.includes(activeSubTab) && (
        <>
          <CategoryStatsDashboard category={activeSubTab} orders={orders} loading={loading} canon={canonCompany} />
          {/* Etap 25: trend (systemy / modele / kolory) i braki materiałowe z czasem oczekiwania — liczone w bazie */}
          <div className="stats-dashboard">
            <CategoryTrendShortages category={activeSubTab} />
          </div>
        </>
      )}
      {activeSubTab === 'Reklamacje' && (
        <ComplaintsStatsDashboard complaints={complaints} loading={loading} canon={canonCompany} />
      )}
      {activeSubTab === 'Firmy' && (
        <CompanyStatsView
          orders={orders}
          complaints={complaints}
          loading={loading}
          aliases={aliases}
          aliasRows={aliasRows}
          isManager={isManager}
          onMerge={(variants, canonical) => merge(variants, canonical, currentUserId)}
          onRemoveAlias={remove}
        />
      )}
      {activeSubTab === 'DrzwiWewnetrzne' && (
        <>
          {/* 27.11 (Tymek: „zniknęło top 10 firm i stare statystyki”): sekcje ze zleceń — czas realizacji, produkcja w czasie,
              status, top 10 firm, dzień tygodnia — wróciły nad statystyki sprzedaży; modele / kolory / rozmiary liczy niżej baza */}
          <CategoryStatsDashboard category="DrzwiWewnetrzne" etykieta="Drzwi wewnętrzne" tylkoZlecenia orders={orders} loading={loading} canon={canonCompany} />
          <InternalDoorStatsDashboard isManager={isManager} />
        </>
      )}
      {activeSubTab === 'Produktywność' && <ProductivityView />}
      {activeSubTab === 'Czas realizacji' && <LeadTimeStatsView />}
      {activeSubTab === 'Konfigurator' && <ConfiguratorShareView />}
      {activeSubTab === 'Zużycie magazynu' && <MonthlyConsumptionView {...monthlyConsumption} />}
    </div>
  )
}

export default StatsView
