import { useState, useEffect } from 'react'
import { Download, RefreshCw, Zap } from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BlockerState =
  | { status: 'clear' }          // brak wymaganej aktualizacji
  | { status: 'available'; version: string }
  | { status: 'downloading'; percent: number; bytesPerSecond: number }
  | { status: 'downloaded'; version: string }

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
      if (pending && typeof (pending as { version?: string }).version === 'string') {
        setState({ status: 'available', version: (pending as { version: string }).version })
      }
    })

    // Nasłuchuj na wypadek gdyby check jeszcze trwał (race condition)
    const onAvailable: IpcListener = (...args) => {
      const info = args[1] as { version: string }
      setState({ status: 'available', version: info.version })
    }

    const onProgress: IpcListener = (...args) => {
      const p = args[1] as { percent: number; bytesPerSecond: number }
      setState({ status: 'downloading', percent: p.percent, bytesPerSecond: p.bytesPerSecond })
    }

    const onDownloaded: IpcListener = (...args) => {
      const info = args[1] as { version: string }
      setState({ status: 'downloaded', version: info.version })
    }

    ipc.on('update:available', onAvailable)
    ipc.on('update:progress', onProgress)
    ipc.on('update:downloaded', onDownloaded)

    return () => {
      ipc.off('update:available', onAvailable)
      ipc.off('update:progress', onProgress)
      ipc.off('update:downloaded', onDownloaded)
    }
  }, [])

  if (state.status === 'clear') return null

  const handleDownload = () => void getIpc()?.invoke('updater:download')
  const handleInstall  = () => void getIpc()?.invoke('updater:install')

  return (
    <div className="update-blocker">
      <div className="update-blocker-card">
        <Zap size={40} className="update-blocker-icon" />

        <h2 className="update-blocker-title">Wymagana aktualizacja</h2>

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
