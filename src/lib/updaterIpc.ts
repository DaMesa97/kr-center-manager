// Wspólne dla paska i blokady aktualizacji (noc 28.11: wydzielone z dwóch identycznych kopii).
export type IpcListener = (...args: unknown[]) => void

export type AppIpcRenderer = {
  on: (channel: string, listener: IpcListener) => void
  off: (channel: string, listener: IpcListener) => void
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
}

export function getIpc(): AppIpcRenderer | undefined {
  return (window as Window & { ipcRenderer?: AppIpcRenderer }).ipcRenderer
}

/** Prędkość pobierania: „1.5 MB/s”, „300 KB/s”, „12 B/s”. */
export function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond >= 1024 * 1024) return `${(bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s`
  if (bytesPerSecond >= 1024) return `${(bytesPerSecond / 1024).toFixed(0)} KB/s`
  return `${bytesPerSecond} B/s`
}
