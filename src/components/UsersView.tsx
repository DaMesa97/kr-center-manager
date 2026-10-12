import { useMemo } from 'react'
import type { DbProfileRow } from '../types'
import Spinner from './Spinner'
import DataTable, { type DataTableColumn } from './DataTable'

type UsersViewProps = {
  profilesLoading: boolean
  profiles: DbProfileRow[]
  currentUserId?: string
  onEditUser: (row: DbProfileRow) => void
  onDeleteUser: (row: DbProfileRow) => void
  onManageWorkerStages: (row: DbProfileRow) => void
  getRoleLabel: (role: string) => string
  getDepartmentLabel: (department: string, role: string) => string
}

export default function UsersView({
  profilesLoading,
  profiles,
  currentUserId,
  onEditUser,
  onDeleteUser,
  onManageWorkerStages,
  getRoleLabel,
  getDepartmentLabel,
}: UsersViewProps) {
  const columns = useMemo<DataTableColumn<DbProfileRow>[]>(() => {
    const deptText = (row: DbProfileRow) =>
      row.categories && row.categories.length > 0
        ? row.categories.join(', ')
        : getDepartmentLabel(row.department, row.role)
    return [
      { key: 'full_name', label: 'Imię i nazwisko', sortValue: (r) => r.full_name, render: (r) => r.full_name },
      { key: 'initials', label: 'Inicjały', sortValue: (r) => r.initials, render: (r) => r.initials },
      { key: 'role', label: 'Rola', sortValue: (r) => getRoleLabel(r.role), render: (r) => getRoleLabel(r.role) },
      { key: 'department', label: 'Kategorie / Dział', sortValue: deptText, render: deptText },
      {
        key: 'actions',
        label: 'Akcje',
        render: (row) => (
          <div className="contractor-actions">
            {(row.role === 'pracownik_produkcji' || row.role === 'worker') && (
              <button type="button" className="btn btn-sm btn-primary" onClick={() => onManageWorkerStages(row)}>
                Etapy produkcji
              </button>
            )}
            <button type="button" className="btn btn-sm btn-primary" onClick={() => onEditUser(row)}>
              Edytuj
            </button>
            <button
              type="button"
              className="btn btn-sm btn-danger"
              onClick={() => onDeleteUser(row)}
              disabled={row.id === currentUserId}
              title={row.id === currentUserId ? 'Nie można usunąć własnego konta' : undefined}
            >
              Usuń
            </button>
          </div>
        ),
      },
    ]
  }, [currentUserId, onEditUser, onDeleteUser, onManageWorkerStages, getRoleLabel, getDepartmentLabel])

  return (
    <>
      {profilesLoading ? (
        <Spinner center label="Ładowanie użytkowników…" />
      ) : (
        <DataTable
          rows={profiles}
          rowKey={(r) => r.id}
          columns={columns}
          className="contractors-table users-table"
          emptyText="Brak użytkowników w bazie."
        />
      )}
    </>
  )
}
