import { PRODUCTION_DAYS } from '../constants'

type OrdersFiltersProps = {
  searchTerm: string
  selectedProductionDay: string
  hideCompletedOrders: boolean
  showCancelledOrders: boolean
  sourceFilter: 'all' | 'manual' | 'bot'
  sourceFilterCounts: { all: number; manual: number; bot: number }
  showSourceFilter: boolean
  onSearchChange: (v: string) => void
  onDayChange: (v: string) => void
  onHideCompletedChange: (v: boolean) => void
  onShowCancelledChange: (v: boolean) => void
  onSourceFilterChange: (v: 'all' | 'manual' | 'bot') => void
}

export default function OrdersFilters({
  searchTerm,
  selectedProductionDay,
  hideCompletedOrders,
  showCancelledOrders,
  sourceFilter,
  sourceFilterCounts,
  showSourceFilter,
  onSearchChange,
  onDayChange,
  onHideCompletedChange,
  onShowCancelledChange,
  onSourceFilterChange,
}: OrdersFiltersProps) {
  return (
    <div className="orders-filters">
      <input
        type="text"
        className="search-input"
        placeholder="Wyszukaj po numerze, firmie, systemie, modelu lub kolorze..."
        value={searchTerm}
        onChange={(event) => onSearchChange(event.target.value)}
      />
      <select
        className="day-filter"
        value={selectedProductionDay}
        onChange={(event) => onDayChange(event.target.value)}
      >
        <option>Wszystkie dni</option>
        {PRODUCTION_DAYS.map((day) => (
          <option key={day}>{day}</option>
        ))}
      </select>
      <div className="orders-filter-checkbox-row">
        <label className="orders-filter-checkbox">
          <input
            type="checkbox"
            checked={hideCompletedOrders}
            onChange={(event) => onHideCompletedChange(event.target.checked)}
          />
          <span>Ukryj zrealizowane</span>
        </label>
        <label className="orders-filter-checkbox">
          <input
            type="checkbox"
            checked={showCancelledOrders}
            onChange={(e) => onShowCancelledChange(e.target.checked)}
          />
          <span>Pokaż anulowane</span>
        </label>
      </div>
      {showSourceFilter && (
        <div className="alerts-filter-pills">
          <button
            type="button"
            className={`alerts-filter-pill ${sourceFilter === 'all' ? 'alerts-filter-pill--active' : ''}`}
            onClick={() => onSourceFilterChange('all')}
          >
            Wszystkie <span className="alerts-filter-pill-count">{sourceFilterCounts.all}</span>
          </button>
          <button
            type="button"
            className={`alerts-filter-pill ${sourceFilter === 'manual' ? 'alerts-filter-pill--active' : ''}`}
            onClick={() => onSourceFilterChange('manual')}
          >
            📝 Manualne <span className="alerts-filter-pill-count">{sourceFilterCounts.manual}</span>
          </button>
          <button
            type="button"
            className={`alerts-filter-pill ${sourceFilter === 'bot' ? 'alerts-filter-pill--active' : ''}`}
            onClick={() => onSourceFilterChange('bot')}
          >
            🤖 Z konfiguratora <span className="alerts-filter-pill-count">{sourceFilterCounts.bot}</span>
          </button>
        </div>
      )}
    </div>
  )
}
