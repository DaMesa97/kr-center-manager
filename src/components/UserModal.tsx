import { createPortal } from 'react-dom'
import type { UserFormState } from '../types'
import { ROLE_LABELS, isCategoryScoped } from '../lib/permissions'
import { ZKP_ROLE_LABELS } from '../constants'
import { ZKP_POSITION_LABELS, type ZkpPosition } from '../lib/zkpCard'

// 'kierownik_firmowy' scalony z 'kierownik_produkcji' (identyczne uprawnienia)
// — nie przydzielamy go już; w kodzie zostaje dla zgodności wstecznej
const ROLE_OPTIONS = [
  'obsluga_klienta', 'pracownik_produkcji', 'magazynier',
  'kierownik_dzialu', 'kierownik_magazynu', 'kierownik_produkcji', 'admin',
]
const USER_CATEGORIES = ['STA', 'Disting', 'ST', 'Techniczne', 'Bastion', 'DrzwiWewnetrzne', 'Aluminium']

type UserModalProps = {
  open: boolean
  userModalMode: 'add' | 'edit'
  userForm: UserFormState
  userModalSaving: boolean
  onClose: () => void
  onFormChange: (patch: Partial<UserFormState>) => void
  onSave: () => void
  submitOnEnterInInput: (e: React.KeyboardEvent<HTMLElement>, action: () => void) => void
  /** role ZKP zmienia tylko admin (trigger protect_profile_privileges) */
  canEditZkpRoles: boolean
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
  canEditZkpRoles,
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
              onChange={(e) => onFormChange({ role: e.target.value })}
              disabled={userModalSaving}
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r] ?? r}</option>
              ))}
            </select>
          </label>
          {isCategoryScoped(userForm.role) ? (
            <label className="order-field-full">
              <span className="order-field-label-text">Kategorie (dostęp)</span>
              <div className="user-cat-picker">
                {USER_CATEGORIES.map((c) => {
                  const checked = userForm.categories.includes(c)
                  return (
                    <label key={c} className={`user-cat-chip ${checked ? 'user-cat-chip--on' : ''}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={userModalSaving}
                        onChange={(e) =>
                          onFormChange({
                            categories: e.target.checked
                              ? [...userForm.categories, c]
                              : userForm.categories.filter((x) => x !== c),
                          })
                        }
                      />
                      {c}
                    </label>
                  )
                })}
              </div>
              <span className="user-modal-hint">Widzi/działa tylko w zaznaczonych kategoriach.</span>
            </label>
          ) : (
            <p className="user-modal-hint">
              Ta rola ma dostęp do wszystkich kategorii (kierownicy/admin) lub bez kategorii (magazynier/obsługa).
            </p>
          )}
          {/* ZKP 5.3.2 — role w kontroli produkcji AS 75EI, niezależne od roli w aplikacji */}
          <label className="order-field-full">
            <span className="order-field-label-text">Role ZKP (AS 75EI)</span>
            <div className="user-cat-picker">
              {Object.entries(ZKP_ROLE_LABELS).map(([key, label]) => {
                const checked = userForm.zkp_roles.includes(key)
                return (
                  <label key={key} className={`user-cat-chip ${checked ? 'user-cat-chip--on' : ''}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={userModalSaving || !canEditZkpRoles}
                      onChange={(e) =>
                        onFormChange({
                          zkp_roles: e.target.checked
                            ? [...userForm.zkp_roles, key]
                            : userForm.zkp_roles.filter((x) => x !== key),
                        })
                      }
                    />
                    {label}
                  </label>
                )
              })}
            </div>
            <span className="user-modal-hint">
              {canEditZkpRoles
                ? 'Uprawnienia do zatwierdzeń w zapisach ZKP stolarki AS 75EI.'
                : 'Role ZKP może zmieniać tylko administrator.'}
            </span>
          </label>
          {/* zał. 6.1 — skład zakładu; uprawnienia do operacji nadaje osobno matryca 6.27 */}
          <label className="order-field-full">
            <span className="order-field-label-text">Stanowisko ZKP (zał. 6.1)</span>
            <select
              value={userForm.zkp_position}
              onChange={(e) => onFormChange({ zkp_position: e.target.value })}
              disabled={userModalSaving || !canEditZkpRoles}
            >
              <option value="">— brak (poza ZKP AS 75EI) —</option>
              {(Object.keys(ZKP_POSITION_LABELS) as ZkpPosition[]).map((k) => (
                <option key={k} value={k}>{ZKP_POSITION_LABELS[k]}</option>
              ))}
            </select>
            <span className="user-modal-hint">
              Kto może podpisać którą operację (IS-01…IS-06, kontrola odbiorcza, montaż) wynika z matrycy kompetencji w zakładce ZKP.
            </span>
          </label>
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
