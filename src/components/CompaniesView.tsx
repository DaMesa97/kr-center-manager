import type { Company } from '../types'

type CompaniesViewProps = {
  companiesLoading: boolean
  companies: Company[]
  isManager: boolean
  onEditCompany: (company: Company) => void
  onDeleteCompany: (company: Company) => void
}

export default function CompaniesView({
  companiesLoading,
  companies,
  isManager,
  onEditCompany,
  onDeleteCompany,
}: CompaniesViewProps) {
  return (
    <>
      {companiesLoading ? (
        <p className="no-results">Ładowanie kontrahentów...</p>
      ) : (
        <div className="table-wrapper">
          <table className="orders-table contractors-table">
            <thead>
              <tr>
                <th>Nazwa</th>
                <th>Dzień trasy</th>
                <th>Dzień produkcji</th>
                <th>Akcje</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((company) => (
                <tr key={company.id}>
                  <td>{company.name}</td>
                  <td>{company.route_day}</td>
                  <td>{company.production_day}</td>
                  <td>
                    {isManager ? (
                      <div className="contractor-actions">
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          onClick={() => onEditCompany(company)}
                        >
                          Edytuj
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          onClick={() => onDeleteCompany(company)}
                        >
                          Usuń
                        </button>
                      </div>
                    ) : (
                      <span className="contractor-actions-readonly">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {companies.length === 0 && (
            <p className="no-results">Brak kontrahentów spełniających kryteria wyszukiwania.</p>
          )}
        </div>
      )}
    </>
  )
}
