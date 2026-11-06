import { useState } from 'react'
import { supabase } from '../supabaseClient'
import type { ToastVariant } from '../types'

/**
 * Zmiana własnego hasła (zgłoszenie #78). Do tej pory hasło nadawał tylko admin
 * lub kierownik działu przy resecie; użytkownik sam nie mógł. Supabase:
 * auth.updateUser({ password }) na bieżącej sesji — bez starego hasła, bo
 * sesja jest dowodem tożsamości (tak samo jak reset przez link).
 */
type Props = {
  onClose: () => void
  pushToast?: (message: string, variant: ToastVariant) => void
}

const MIN_LEN = 8

export default function ChangePasswordModal({ onClose, pushToast }: Props) {
  const [pwd, setPwd] = useState('')
  const [pwd2, setPwd2] = useState('')
  const [show, setShow] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setError(null)
    if (pwd.length < MIN_LEN) {
      setError(`Hasło musi mieć co najmniej ${MIN_LEN} znaków.`)
      return
    }
    if (pwd !== pwd2) {
      setError('Hasła się różnią.')
      return
    }
    setSaving(true)
    try {
      const { error: err } = await supabase.auth.updateUser({ password: pwd })
      if (err) {
        setError(err.message === 'New password should be different from the old password.'
          ? 'Nowe hasło musi się różnić od obecnego.'
          : `Nie udało się zmienić hasła: ${err.message}`)
        return
      }
      pushToast?.('Hasło zmienione. Przy następnym logowaniu użyj nowego.', 'success')
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={() => !saving && onClose()}>
      <div className="order-modal order-modal--narrow" onClick={(e) => e.stopPropagation()}>
        <div className="order-modal-header">
          <h2>Zmień hasło</h2>
          <button type="button" className="btn btn-icon btn-ghost" onClick={onClose} disabled={saving} aria-label="Zamknij">
            X
          </button>
        </div>
        <form
          className="order-form-grid"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <label className="order-field-full">
            <span className="order-field-label-text">Nowe hasło (min. {MIN_LEN} znaków)</span>
            <input
              type={show ? 'text' : 'password'}
              className="form-input"
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              autoComplete="new-password"
              autoFocus
            />
          </label>
          <label className="order-field-full">
            <span className="order-field-label-text">Powtórz nowe hasło</span>
            <input
              type={show ? 'text' : 'password'}
              className="form-input"
              value={pwd2}
              onChange={(e) => setPwd2(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <label className="order-field-full" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
            <span>Pokaż hasło</span>
          </label>
          {error && <p className="form-error order-field-full">{error}</p>}
          <div className="order-field-full" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
              Anuluj
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Zapisuję…' : 'Zmień hasło'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
