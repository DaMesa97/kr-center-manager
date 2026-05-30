import type { DbProfileRow } from '../types'

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
  return (
    <>
      {profilesLoading ? (
        <p className="no-results">Ładowanie użytkowników...</p>
      ) : (
        <div className="table-wrapper">
          <table className="orders-table contractors-table users-table">
            <thead>
              <tr>
                <th>Imię i nazwisko</th>
                <th>Inicjały</th>
                <th>Rola</th>
                <th>Dział</th>
                <th>Akcje</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((row) => (
                <tr key={row.id}>
                  <td>{row.full_name}</td>
                  <td>{row.initials}</td>
                  <td>{getRoleLabel(row.role)}</td>
                  <td>{getDepartmentLabel(row.department, row.role)}</td>
                  <td>
                    <div className="contractor-actions">
                      {row.role === 'worker' && (
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          onClick={() => onManageWorkerStages(row)}
                        >
                          Etapy produkcji
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={() => onEditUser(row)}
                      >
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {profiles.length === 0 && <p className="no-results">Brak użytkowników w bazie.</p>}
        </div>
      )}
    </>
  )
}
