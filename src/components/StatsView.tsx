import { STATS_SUB_TABS } from '../constants'
import { CATEGORY_LABELS } from '../constants'
import type { Complaint, InternalDoorItem, Order, StatsSubTab } from '../types'
import CategoryStatsDashboard from './stats/CategoryStatsDashboard'
import ComplaintsStatsDashboard from './stats/ComplaintsStatsDashboard'
import InternalDoorStatsDashboard from './stats/InternalDoorStatsDashboard'

type StatsViewProps = {
  orders: Order[]
  complaints: Complaint[]
  internalDoorItems: InternalDoorItem[]
  loading: boolean
  internalDoorItemsLoading: boolean
  activeSubTab: StatsSubTab
  onSubTabChange: (tab: StatsSubTab) => void
}

function StatsView({
  orders,
  complaints,
  internalDoorItems,
  loading,
  internalDoorItemsLoading,
  activeSubTab,
  onSubTabChange,
}: StatsViewProps) {
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
      {['STA', 'Disting', 'ST', 'Techniczne', 'Bastion'].includes(activeSubTab) && (
        <CategoryStatsDashboard category={activeSubTab} orders={orders} loading={loading} />
      )}
      {activeSubTab === 'Reklamacje' && (
        <ComplaintsStatsDashboard complaints={complaints} loading={loading} />
      )}
      {activeSubTab === 'DrzwiWewnetrzne' && (
        <InternalDoorStatsDashboard
          orders={orders.filter((o) => o.category === 'DrzwiWewnetrzne')}
          internalDoorItems={internalDoorItems}
          loading={loading}
          itemsLoading={internalDoorItemsLoading}
        />
      )}
    </div>
  )
}

export default StatsView
