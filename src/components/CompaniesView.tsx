import { useMemo } from 'react'
import type { Company } from '../types'
import Spinner from './Spinner'
import DataTable, { type DataTableColumn } from './DataTable'

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
  const columns = useMemo<DataTableColumn<Company>[]>(
    () => [
      { key: 'name', label: 'Nazwa', sortValue: (c) => c.name, render: (c) => c.name },
      { key: 'route_day', label: 'Dzień trasy', sortValue: (c) => c.route_day, render: (c) => c.route_day },
      { key: 'production_day', label: 'Dzień produkcji', sortValue: (c) => c.production_day, render: (c) => c.production_day },
      {
        key: 'actions',
        label: 'Akcje',
        render: (company) =>
          isManager ? (
            <div className="contractor-actions">
              <button type="button" className="btn btn-sm btn-primary" onClick={() => onEditCompany(company)}>
                Edytuj
              </button>
              <button type="button" className="btn btn-sm btn-danger" onClick={() => onDeleteCompany(company)}>
                Usuń
              </button>
            </div>
          ) : (
            <span className="contractor-actions-readonly">—</span>
          ),
      },
    ],
    [isManager, onEditCompany, onDeleteCompany],
  )

  return (
    <>
      {companiesLoading ? (
        <Spinner center label="Ładowanie kontrahentów…" />
      ) : (
        <DataTable
          rows={companies}
          rowKey={(c) => c.id}
          columns={columns}
          className="contractors-table"
          emptyText="Brak kontrahentów spełniających kryteria wyszukiwania."
        />
      )}
    </>
  )
}
