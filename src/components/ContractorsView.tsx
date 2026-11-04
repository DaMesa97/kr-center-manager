import { useState, type ComponentProps } from 'react'
import CompaniesView from './CompaniesView'
import SuppliersConfigView from './config/SuppliersConfigView'

/**
 * Ustawienia → Kontrahenci (porządki menu, beta.86): jedna lista firm z dwiema
 * zakładkami — Klienci (dni tras, aliasy nazw, dane logistyczne) i Dostawcy
 * (magazyn, zamówienia do dostawców). Wcześniej klienci siedzieli w grupie
 * Magazyn, a dostawcy jako podzakładka Konfiguracji.
 */
type Sub = 'Klienci' | 'Dostawcy'

type Props = {
  searchTerm: string
  onSearchTermChange: (value: string) => void
  companies: ComponentProps<typeof CompaniesView>
  suppliers: ComponentProps<typeof SuppliersConfigView>
}

export default function ContractorsView({ searchTerm, onSearchTermChange, companies, suppliers }: Props) {
  const [sub, setSub] = useState<Sub>('Klienci')
  const tab = (key: Sub, count: number) => (
    <button
      key={key}
      type="button"
      role="tab"
      aria-selected={sub === key}
      className={`btn btn-sm ${sub === key ? 'btn-primary' : 'btn-secondary'}`}
      onClick={() => setSub(key)}
    >
      {key}
      {count > 0 && <span className="subtab-badge">{count}</span>}
    </button>
  )

  return (
    <div className="contractors-view">
      <div className="subtab-bar" role="tablist" aria-label="Kontrahenci — sekcje">
        {tab('Klienci', companies.companies.length)}
        {tab('Dostawcy', suppliers.suppliers.length)}
      </div>
      {sub === 'Klienci' ? (
        <>
          <div className="orders-filters">
            <input
              type="text"
              className="search-input"
              placeholder="Wyszukaj kontrahenta po nazwie..."
              value={searchTerm}
              onChange={(event) => onSearchTermChange(event.target.value)}
            />
          </div>
          <CompaniesView {...companies} />
        </>
      ) : (
        <SuppliersConfigView {...suppliers} />
      )}
    </div>
  )
}
