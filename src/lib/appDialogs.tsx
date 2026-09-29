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

type Listener = () => void

const state: { confirm: ConfirmRequest | null; alert: AlertRequest | null } = {
  confirm: null,
  alert: null,
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

  return (
    <>
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
