import { PRODUCTION_DAYS } from '../constants'

const WYKONAWCA_OPTIONS = [
  { value: 'Center', label: 'CENTER', color: '#9b1c1c' },
  { value: 'Profil', label: 'PROFIL', color: '#16a34a' },
  { value: 'WZ', label: 'WZ', color: '#0369a1' },
]

type OrdersFiltersProps = {
  searchTerm: string
  selectedProductionDay: string
  hideCompletedOrders: boolean
  showCancelledOrders: boolean
  sourceFilter: 'all' | 'manual' | 'bot'
  sourceFilterCounts: { all: number; manual: number; bot: number }
  showSourceFilter: boolean
  wykonawcaFilter: string[]
  showWykonawcaFilter: boolean
  onSearchChange: (v: string) => void
  onDayChange: (v: string) => void
  onHideCompletedChange: (v: boolean) => void
  onShowCancelledChange: (v: boolean) => void
  onSourceFilterChange: (v: 'all' | 'manual' | 'bot') => void
  onWykonawcaFilterChange: (vals: string[]) => void
}

export default function OrdersFilters({
  searchTerm,
  selectedProductionDay,
  hideCompletedOrders,
  showCancelledOrders,
  wykonawcaFilter,
  showWykonawcaFilter,
  onSearchChange,
  onDayChange,
  onHideCompletedChange,
  onShowCancelledChange,
  onWykonawcaFilterChange,
}: OrdersFiltersProps) {

  const toggleWykonawca = (val: string) => {
    if (wykonawcaFilter.includes(val)) {
      onWykonawcaFilterChange(wykonawcaFilter.filter((v) => v !== val))
    } else {
      onWykonawcaFilterChange([...wykonawcaFilter, val])
    }
  }

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

      {showWykonawcaFilter && (
        <div className="wykonawca-filter-row">
          <span className="wykonawca-filter-label">Wykonawca:</span>
          {WYKONAWCA_OPTIONS.map((opt) => {
            const active = wykonawcaFilter.includes(opt.value)
            return (
              <button
                key={opt.value}
                type="button"
                className="wykonawca-filter-pill"
                style={{
                  background: active ? opt.color : 'transparent',
                  color: active ? '#fff' : opt.color,
                  borderColor: opt.color,
                }}
                onClick={() => toggleWykonawca(opt.value)}
              >
                {opt.label}
              </button>
            )
          })}
          {wykonawcaFilter.length > 0 && (
            <button
              type="button"
              className="wykonawca-filter-clear"
              onClick={() => onWykonawcaFilterChange([])}
            >
              ✕ Wszystkie
            </button>
          )}
        </div>
      )}

    </div>
  )
}
