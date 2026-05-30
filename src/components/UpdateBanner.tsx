import { useState, useEffect } from 'react'
import { Download, RefreshCw, X, Zap, AlertTriangle } from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available'; version: string }
  | { status: 'downloading'; percent: number; bytesPerSecond: number }
  | { status: 'downloaded'; version: string }
  | { status: 'error'; message: string }

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

function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond >= 1024 * 1024) return `${(bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s`
  if (bytesPerSecond >= 1024) return `${(bytesPerSecond / 1024).toFixed(0)} KB/s`
  return `${bytesPerSecond} B/s`
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function UpdateBanner() {
  const [state, setState] = useState<UpdateState>({ status: 'idle' })
  const [dismissed, setDismissed] = useState(false)

  // Sprawdź aktualizacje 3s po zalogowaniu (po zamontowaniu komponentu)
  useEffect(() => {
    if (import.meta.env.DEV) return  // tylko w produkcji
    const timer = setTimeout(() => {
      void getIpc()?.invoke('updater:check')
    }, 3000)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    const ipc = getIpc()
    if (!ipc) return

    const onChecking: IpcListener = () => setState({ status: 'checking' })

    const onAvailable: IpcListener = (...args) => {
      const info = args[1] as { version: string }
      setState({ status: 'available', version: info.version })
      setDismissed(false)
    }

    const onNotAvailable: IpcListener = () => setState({ status: 'idle' })

    const onProgress: IpcListener = (...args) => {
      const progress = args[1] as { percent: number; bytesPerSecond: number }
      setState({ status: 'downloading', percent: progress.percent, bytesPerSecond: progress.bytesPerSecond })
    }

    const onDownloaded: IpcListener = (...args) => {
      const info = args[1] as { version: string }
      setState({ status: 'downloaded', version: info.version })
    }

    const onError: IpcListener = (...args) => {
      const msg = String(args[1])
      // Sieć niedostępna / brak releases — cicho ignoruj
      if (
        msg.includes('No published versions') ||
        msg.includes('net::ERR_') ||
        msg.includes('ENOTFOUND') ||
        msg.includes('404')
      ) {
        setState({ status: 'idle' })
        return
      }
      setState({ status: 'error', message: msg })
    }

    ipc.on('update:checking', onChecking)
    ipc.on('update:available', onAvailable)
    ipc.on('update:not-available', onNotAvailable)
    ipc.on('update:progress', onProgress)
    ipc.on('update:downloaded', onDownloaded)
    ipc.on('update:error', onError)

    return () => {
      ipc.off('update:checking', onChecking)
      ipc.off('update:available', onAvailable)
      ipc.off('update:not-available', onNotAvailable)
      ipc.off('update:progress', onProgress)
      ipc.off('update:downloaded', onDownloaded)
      ipc.off('update:error', onError)
    }
  }, [])

  const handleDownload = () => void getIpc()?.invoke('updater:download')
  const handleInstall = () => void getIpc()?.invoke('updater:install')
  const handleCheckManual = () => {
    setState({ status: 'checking' })
    void getIpc()?.invoke('updater:check')
  }

  if (state.status === 'idle' || state.status === 'checking') return null
  if (dismissed && state.status !== 'downloading' && state.status !== 'downloaded') return null

  return (
    <div className="update-banner" role="status" aria-live="polite">
      {state.status === 'available' && (
        <>
          <Zap size={14} className="update-banner-icon" />
          <span className="update-banner-text">
            Dostępna aktualizacja <strong>v{state.version}</strong>
          </span>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={handleDownload}
            style={{ marginLeft: 'auto' }}
          >
            <Download size={13} />
            Pobierz
          </button>
          <button
            type="button"
            className="update-banner-dismiss"
            onClick={() => setDismissed(true)}
            title="Przypomnij przy następnym uruchomieniu"
            aria-label="Odrzuć"
          >
            <X size={13} />
          </button>
        </>
      )}

      {state.status === 'downloading' && (
        <>
          <Download size={14} className="update-banner-icon update-banner-icon--spin" />
          <span className="update-banner-text">
            Pobieranie aktualizacji… {state.percent}%
            <span className="update-banner-speed">{formatSpeed(state.bytesPerSecond)}</span>
          </span>
          <div
            className="update-progress-bar"
            role="progressbar"
            aria-valuenow={state.percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="update-progress-fill" style={{ width: `${state.percent}%` }} />
          </div>
        </>
      )}

      {state.status === 'downloaded' && (
        <>
          <Zap size={14} className="update-banner-icon update-banner-icon--ready" />
          <span className="update-banner-text">
            Aktualizacja <strong>v{state.version}</strong> gotowa do instalacji
          </span>
          <button
            type="button"
            className="btn btn-sm btn-success"
            onClick={handleInstall}
            style={{ marginLeft: 'auto' }}
          >
            <RefreshCw size={13} />
            Restartuj i zainstaluj
          </button>
        </>
      )}

      {state.status === 'error' && (
        <>
          <AlertTriangle size={14} className="update-banner-icon update-banner-icon--error" />
          <span className="update-banner-text update-banner-text--error">
            Błąd aktualizacji: {state.message}
          </span>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={handleCheckManual}
            style={{ marginLeft: 'auto' }}
          >
            Spróbuj ponownie
          </button>
          <button
            type="button"
            className="update-banner-dismiss"
            onClick={() => setDismissed(true)}
            aria-label="Zamknij"
          >
            <X size={13} />
          </button>
        </>
      )}
    </div>
  )
}
