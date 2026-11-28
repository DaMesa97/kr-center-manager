import { useCallback, useRef, useState, type ReactNode } from 'react'

// D53: okienko PIN na telefonie (podpis etapu ZKP i ustawianie własnego PIN-u).
// askPin zwraca obietnicę: wpisany PIN albo null (Anuluj). Dialog nad innymi okienkami stanowiska.

type PinRequest = { title: string; message: string; confirmLabel: string; resolve: (v: string | null) => void }

export function useMobilePinAsk(): [
  (message: string, opts?: { title?: string; confirmLabel?: string }) => Promise<string | null>,
  ReactNode,
] {
  const [req, setReq] = useState<PinRequest | null>(null)
  const [value, setValue] = useState('')
  const reqRef = useRef<PinRequest | null>(null)

  const askPin = useCallback(
    (message: string, opts?: { title?: string; confirmLabel?: string }) =>
      new Promise<string | null>((resolve) => {
        // poprzednie, niedokończone pytanie = anulowane
        reqRef.current?.resolve(null)
        const next: PinRequest = {
          title: opts?.title ?? 'Podpis etapu ZKP — PIN',
          message,
          confirmLabel: opts?.confirmLabel ?? 'Podpisz',
          resolve,
        }
        reqRef.current = next
        setValue('')
        setReq(next)
      }),
    [],
  )

  const finish = (v: string | null) => {
    const r = reqRef.current
    reqRef.current = null
    setReq(null)
    setValue('')
    r?.resolve(v)
  }

  const dialog = req ? (
    <div className="mstation-confirm-overlay" style={{ zIndex: 250 }} onClick={() => finish(null)}>
      <div className="mstation-confirm" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="mstation-confirm-title">{req.title}</div>
        <div className="mstation-confirm-body">{req.message}</div>
        <label className="mlogin-field" style={{ marginBottom: '1rem' }}>
        <input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          maxLength={8}
          style={{ fontSize: '1.4rem', letterSpacing: '0.4em', textAlign: 'center' }}
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && value) finish(value)
          }}
          aria-label="PIN"
        />
        </label>
        <div className="mstation-confirm-actions">
          <button type="button" className="mstation-confirm-cancel" onClick={() => finish(null)}>
            Anuluj
          </button>
          <button type="button" className="mstation-confirm-ok" disabled={!value} onClick={() => finish(value)}>
            {req.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  ) : null

  return [askPin, dialog]
}
