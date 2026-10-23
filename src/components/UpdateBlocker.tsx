import { useState, useEffect } from 'react'
import { AlertTriangle, Download, RefreshCw, Zap } from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BlockerState =
  | { status: 'clear' }          // brak wymaganej aktualizacji
  | { status: 'available'; version: string }
  | { status: 'downloading'; version: string; percent: number; bytesPerSecond: number; lastAt: number }
  | { status: 'downloaded'; version: string }
  | { status: 'error'; version: string; message: string }

type IpcListener = (...args: unknown[]) => void

type AppIpcRenderer = {
  on: (channel: string, listener: IpcListener) => void
  off: (channel: string, listener: IpcListener) => void
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
}

function getIpc(): AppIpcRenderer | undefined {
  return (window as Window & { ipcRenderer?: AppIpcRenderer }).ipcRenderer
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSpeed(bps: number): string {
  if (bps >= 1024 * 1024) return `${(bps / 1024 / 1024).toFixed(1)} MB/s`
  if (bps >= 1024) return `${(bps / 1024).toFixed(0)} KB/s`
  return `${bps} B/s`
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

// Pobieranie bez postępu tyle czasu = „stoi” (zerwana sieć potrafi nie dać błędu)
const STALL_MS = 60_000

// Wersja, przy której ktoś wybrał „Pracuj na obecnej wersji” — na poziomie modułu,
// bo App montuje UpdateBlocker na nowo przy każdym ekranie (logowanie → praca)
let dismissedVersion: string | null = null

function friendlyUpdateError(message: string): string {
  if (/404|Cannot find|latest\.yml/i.test(message)) return 'Plik aktualizacji jest niedostępny na serwerze (wydanie mogło jeszcze nie być gotowe).'
  if (/net::ERR_|ENOTFOUND|ETIMEDOUT|ECONNRESET|socket/i.test(message)) return 'Brak połączenia z serwerem aktualizacji.'
  if (/sha512|checksum/i.test(message)) return 'Pobrany plik jest uszkodzony.'
  return message
}

/**
 * UpdateBlocker – fullscreen overlay wymuszający aktualizację PRZED logowaniem.
 * Renderuj go jako PIERWSZE dziecko w App.tsx, przed wszelkimi early-return'ami.
 * Zwraca null gdy nie ma wymaganej aktualizacji (żadnego wpływu na UI).
 */
export default function UpdateBlocker() {
  const [state, setState] = useState<BlockerState>({ status: 'clear' })

  // Pobierz status wykryty już w main (startup check odpala się przed logowaniem)
  useEffect(() => {
    if (import.meta.env.DEV) return

    const ipc = getIpc()
    if (!ipc) return

    // Zapytaj o update wykryty przy starcie
    void ipc.invoke('updater:get-status').then((pending) => {
      const v = (pending as { version?: string } | null)?.version
      if (typeof v === 'string' && v !== dismissedVersion) setState({ status: 'available', version: v })
    })

    // Nasłuchuj na wypadek gdyby check jeszcze trwał (race condition)
    const onAvailable: IpcListener = (...args) => {
      const info = args[1] as { version: string }
      if (info.version !== dismissedVersion) setState({ status: 'available', version: info.version })
    }

    const onProgress: IpcListener = (...args) => {
      const p = args[1] as { percent: number; bytesPerSecond: number }
      setState((prev) =>
        prev.status === 'clear' || prev.status === 'error'
          ? prev
          : {
              status: 'downloading',
              version: 'version' in prev ? prev.version : '',
              percent: p.percent,
              bytesPerSecond: p.bytesPerSecond,
              lastAt: Date.now(),
            },
      )
    }

    const onError: IpcListener = (...args) => {
      const message = String(args[1] ?? 'Nieznany błąd')
      setState((prev) =>
        prev.status === 'clear' ? prev : { status: 'error', version: 'version' in prev ? prev.version : '', message },
      )
    }

    const onDownloaded: IpcListener = (...args) => {
      const info = args[1] as { version: string }
      setState({ status: 'downloaded', version: info.version })
    }

    ipc.on('update:available', onAvailable)
    ipc.on('update:progress', onProgress)
    ipc.on('update:downloaded', onDownloaded)
    ipc.on('update:error', onError)

    return () => {
      ipc.off('update:available', onAvailable)
      ipc.off('update:progress', onProgress)
      ipc.off('update:downloaded', onDownloaded)
      ipc.off('update:error', onError)
    }
  }, [])

  // Watchdog: pobieranie bez postępu przez STALL_MS → błąd z wyjściem
  const stallKey = state.status === 'downloading' ? state.lastAt : null
  useEffect(() => {
    if (stallKey == null) return
    const t = setTimeout(() => {
      setState((prev) =>
        prev.status === 'downloading' && prev.lastAt === stallKey
          ? { status: 'error', version: prev.version, message: 'Pobieranie stoi od minuty (słaby internet?).' }
          : prev,
      )
    }, STALL_MS)
    return () => clearTimeout(t)
  }, [stallKey])

  if (state.status === 'clear') return null

  const handleDownload = () => {
    const version = 'version' in state ? state.version : ''
    setState({ status: 'downloading', version, percent: 0, bytesPerSecond: 0, lastAt: Date.now() })
    void getIpc()
      ?.invoke('updater:download')
      .then((res) => {
        const r = res as { ok?: boolean; message?: string } | undefined
        if (r && r.ok === false) setState({ status: 'error', version, message: r.message ?? 'Nieznany błąd' })
      })
  }
  const handleInstall  = () => void getIpc()?.invoke('updater:install')
  // Wyjście awaryjne — tylko po błędzie. Wymuszenie wersji robi min_app_version
  // w Konfiguracji (osobny ekran w App), więc praca na starej wersji jest bezpieczna.
  const handleSkip = () => {
    dismissedVersion = 'version' in state ? state.version : null
    setState({ status: 'clear' })
  }

  return (
    <div className="update-blocker">
      <div className="update-blocker-card">
        {state.status === 'error' ? (
          <AlertTriangle size={40} className="update-blocker-icon" />
        ) : (
          <Zap size={40} className="update-blocker-icon" />
        )}

        <h2 className="update-blocker-title">
          {state.status === 'error' ? 'Aktualizacja się nie udała' : 'Wymagana aktualizacja'}
        </h2>

        {state.status === 'error' && (
          <>
            <p className="update-blocker-desc">
              {friendlyUpdateError(state.message)}
              <br />
              Możesz spróbować jeszcze raz albo pracować dalej na obecnej wersji — aktualizacja zaproponuje się przy
              następnym uruchomieniu.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-primary update-blocker-btn" onClick={handleDownload}>
                <RefreshCw size={16} />
                Spróbuj ponownie
              </button>
              <button type="button" className="btn btn-secondary update-blocker-btn" onClick={handleSkip}>
                Pracuj na obecnej wersji
              </button>
            </div>
          </>
        )}

        {state.status === 'available' && (
          <>
            <p className="update-blocker-desc">
              Dostępna nowa wersja <strong>v{state.version}</strong>.
              <br />
              Zainstaluj aktualizację, aby kontynuować.
            </p>
            <button
              type="button"
              className="btn btn-primary update-blocker-btn"
              onClick={handleDownload}
            >
              <Download size={16} />
              Pobierz i zainstaluj v{state.version}
            </button>
          </>
        )}

        {state.status === 'downloading' && (
          <>
            <p className="update-blocker-desc">
              Pobieranie… <strong>{state.percent}%</strong>
              <span className="update-blocker-speed">{formatSpeed(state.bytesPerSecond)}</span>
            </p>
            <div className="update-blocker-progress">
              <div
                className="update-blocker-progress-fill"
                style={{ width: `${state.percent}%` }}
              />
            </div>
          </>
        )}

        {state.status === 'downloaded' && (
          <>
            <p className="update-blocker-desc">
              Wersja <strong>v{state.version}</strong> jest gotowa do instalacji.
            </p>
            <button
              type="button"
              className="btn btn-success update-blocker-btn"
              onClick={handleInstall}
            >
              <RefreshCw size={16} />
              Restartuj i zainstaluj
            </button>
          </>
        )}
      </div>
    </div>
  )
}
