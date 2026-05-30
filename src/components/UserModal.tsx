import { createPortal } from 'react-dom'
import type { UserFormState } from '../types'

type UserModalProps = {
  open: boolean
  userModalMode: 'add' | 'edit'
  userForm: UserFormState
  userModalSaving: boolean
  onClose: () => void
  onFormChange: (patch: Partial<UserFormState>) => void
  onSave: () => void
  submitOnEnterInInput: (e: React.KeyboardEvent<HTMLElement>, action: () => void) => void
}

export default function UserModal({
  open,
  userModalMode,
  userForm,
  userModalSaving,
  onClose,
  onFormChange,
  onSave,
  submitOnEnterInInput,
}: UserModalProps) {
  if (!open) return null

  return createPortal(
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="order-modal user-management-modal" onClick={(e) => e.stopPropagation()}>
        <div className="order-modal-header">
          <h2>{userModalMode === 'add' ? 'Dodaj użytkownika' : 'Edytuj użytkownika'}</h2>
          <button type="button" className="btn btn-icon btn-ghost" onClick={onClose}>
            X
          </button>
        </div>
        <div
          className="order-form-grid order-form-grid--sta"
          onKeyDown={(e) => submitOnEnterInInput(e, () => void onSave())}
        >
          {userModalMode === 'add' && (
            <label className="order-field-full">
              <span className="order-field-label-text">Nazwa użytkownika (login)</span>
              <input
                type="text"
                autoComplete="off"
                value={userForm.username}
                onChange={(e) => onFormChange({ username: e.target.value })}
                disabled={userModalSaving}
                placeholder="np. jan.kowalski"
              />
            </label>
          )}
          {userModalMode === 'edit' && (
            <p className="user-modal-hint">Loginu nie można zmienić.</p>
          )}
          <label className="order-field-full">
            <span className="order-field-label-text">Imię i nazwisko</span>
            <input
              type="text"
              value={userForm.full_name}
              onChange={(e) => onFormChange({ full_name: e.target.value })}
              disabled={userModalSaving}
            />
          </label>
          <label className="order-field-full">
            <span className="order-field-label-text">Inicjały (max 3 znaki)</span>
            <input
              type="text"
              maxLength={3}
              value={userForm.initials}
              onChange={(e) => onFormChange({ initials: e.target.value.slice(0, 3) })}
              disabled={userModalSaving}
            />
          </label>
          {userModalMode === 'add' && (
            <label className="order-field-full">
              <span className="order-field-label-text">Hasło</span>
              <input
                type="password"
                autoComplete="new-password"
                value={userForm.password}
                onChange={(e) => onFormChange({ password: e.target.value })}
                disabled={userModalSaving}
              />
            </label>
          )}
          <label className="order-field-full">
            <span className="order-field-label-text">Rola</span>
            <select
              value={userForm.role}
              onChange={(e) => {
                const role =
                  e.target.value === 'manager'
                    ? 'manager'
                    : e.target.value === 'sprzedawca'
                      ? 'sprzedawca'
                      : 'worker'
                onFormChange({
                  role,
                  ...(role !== 'manager' && userForm.role === 'manager'
                    ? { department: 'all' as const }
                    : {}),
                })
              }}
              disabled={userModalSaving}
            >
              <option value="worker">Pracownik</option>
              <option value="sprzedawca">Sprzedawca</option>
              <option value="manager">Kierownik</option>
            </select>
          </label>
          {userForm.role !== 'manager' ? (
            <label className="order-field-full">
              <span className="order-field-label-text">Dział</span>
              <select
                value={userForm.department}
                onChange={(e) => {
                  const v = e.target.value
                  onFormChange({
                    department:
                      (v === 'bastion'
                        ? 'bastion'
                        : v === 'stalowe'
                          ? 'stalowe'
                          : v === 'magazyn'
                            ? 'magazyn'
                            : 'all') as UserFormState['department'],
                  })
                }}
                disabled={userModalSaving}
              >
                <option value="all">KR CENTER</option>
                <option value="bastion">Bastion</option>
                <option value="stalowe">Stalowe</option>
                <option value="magazyn">Magazyn</option>
              </select>
            </label>
          ) : (
            <p className="user-modal-hint">
              Kierownik ma dostęp do wszystkich działów (w bazie: dział = wszystkie).
            </p>
          )}
        </div>
        <div className="order-form-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void onSave()}
            disabled={userModalSaving}
          >
            {userModalSaving ? 'Zapisywanie...' : 'Zapisz'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
