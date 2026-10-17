import { useEffect, useState } from 'react'
import DeleteConfirmDialog from '../components/DeleteConfirmDialog'

// Zamienniki natywnych window.alert / window.confirm.
//
// POWÓD (zgłoszenia #49 i #56 Dawida): natywne dialogi w Electronie na
// Windows potrafią odebrać oknu fokus klawiatury — po zamknięciu dialogu
// wszystkie pola tekstowe są martwe aż do restartu aplikacji (znany bug
// Electrona). Dlatego w apce NIE używamy window.alert/confirm — tylko
// appAlert / appConfirm, renderowane jako nasze modale.

type ConfirmRequest = {
  message: string
  title?: string
  confirmLabel?: string
  resolve: (ok: boolean) => void
}

type AlertRequest = {
  message: string
  resolve: () => void
}

type PromptRequest = {
  message: string
  title?: string
  confirmLabel?: string
  inputType?: 'text' | 'password'
  resolve: (value: string | null) => void
}

type Listener = () => void

const state: { confirm: ConfirmRequest | null; alert: AlertRequest | null; prompt: PromptRequest | null } = {
  confirm: null,
  alert: null,
  prompt: null,
}
let notify: Listener | null = null

/** Potwierdzenie tak/nie — zamiennik window.confirm (Promise<boolean>). */
export function appConfirm(
  message: string,
  opts?: { title?: string; confirmLabel?: string },
): Promise<boolean> {
  return new Promise((resolve) => {
    state.confirm = { message, title: opts?.title, confirmLabel: opts?.confirmLabel, resolve }
    notify?.()
  })
}

/** Komunikat z przyciskiem OK — zamiennik window.alert. */
export function appAlert(message: string): Promise<void> {
  return new Promise((resolve) => {
    state.alert = { message, resolve }
    notify?.()
  })
}

/** Pytanie o wartość tekstową — zamiennik window.prompt (null = anulowano). */
export function appPrompt(
  message: string,
  opts?: { title?: string; confirmLabel?: string; inputType?: 'text' | 'password' },
): Promise<string | null> {
  return new Promise((resolve) => {
    state.prompt = {
      message,
      title: opts?.title,
      confirmLabel: opts?.confirmLabel,
      inputType: opts?.inputType ?? 'text',
      resolve,
    }
    notify?.()
  })
}

function PromptDialog({ req, onClose }: { req: PromptRequest; onClose: () => void }) {
  const [value, setValue] = useState('')
  const finish = (v: string | null) => {
    onClose()
    req.resolve(v)
  }
  return (
    <div className="confirm-dialog-overlay" role="presentation" onClick={() => finish(null)}>
      <div className="confirm-dialog-card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <p className="confirm-dialog-message">
          <strong>{req.title ?? 'Podaj wartość'}</strong>
          <br />
          {req.message}
        </p>
        <input
          type={req.inputType}
          className="search-input"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') finish(value)
            if (e.key === 'Escape') finish(null)
          }}
          style={{ width: '100%', marginBottom: 12 }}
        />
        <div className="confirm-dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={() => finish(null)}>
            Anuluj
          </button>
          <button type="button" className="btn btn-primary" onClick={() => finish(value)}>
            {req.confirmLabel ?? 'OK'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Host dialogów — montowany RAZ w App. */
export function AppDialogHost() {
  const [, setTick] = useState(0)

  useEffect(() => {
    notify = () => setTick((t) => t + 1)
    return () => {
      notify = null
    }
  }, [])

  const confirmReq = state.confirm
  const alertReq = state.alert
  const promptReq = state.prompt

  return (
    <>
      {promptReq && (
        <PromptDialog
          req={promptReq}
          onClose={() => {
            state.prompt = null
            setTick((t) => t + 1)
          }}
        />
      )}
      {confirmReq && (
        <DeleteConfirmDialog
          title={confirmReq.title ?? 'Potwierdzenie'}
          message={confirmReq.message}
          confirmLabel={confirmReq.confirmLabel ?? 'Tak'}
          cancelLabel="Anuluj"
          onConfirm={() => {
            state.confirm = null
            setTick((t) => t + 1)
            confirmReq.resolve(true)
          }}
          onCancel={() => {
            state.confirm = null
            setTick((t) => t + 1)
            confirmReq.resolve(false)
          }}
        />
      )}
      {alertReq && (
        <div
          className="confirm-dialog-overlay"
          role="presentation"
          onClick={() => {
            state.alert = null
            setTick((t) => t + 1)
            alertReq.resolve()
          }}
        >
          <div
            className="confirm-dialog-card"
            role="alertdialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="confirm-dialog-icon-wrap" aria-hidden>
              <span className="confirm-dialog-icon-warning">ℹ️</span>
            </div>
            <p className="confirm-dialog-message">{alertReq.message}</p>
            <div className="confirm-dialog-actions">
              <button
                type="button"
                className="btn btn-primary"
                autoFocus
                onClick={() => {
                  state.alert = null
                  setTick((t) => t + 1)
                  alertReq.resolve()
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
