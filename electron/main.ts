import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import net from 'node:net'
import * as Sentry from '@sentry/electron/main'

let appVersion = '0.0.0'
try {
  const pkgPath =
    process.env.NODE_ENV === 'development'
      ? path.join(process.cwd(), 'package.json')
      : path.join(process.resourcesPath, 'app.asar', 'package.json')

  const pkgRaw = readFileSync(pkgPath, 'utf-8')
  appVersion = JSON.parse(pkgRaw).version
} catch (err) {
  console.warn('Cannot read package.json version:', err)
}

const SENTRY_DSN =
  process.env.VITE_SENTRY_DSN ||
  'https://509918f5057a3e1664e1f17422c5c471@o4511441047060480.ingest.de.sentry.io/4511441050533968'

Sentry.init({
  dsn: SENTRY_DSN,
  release: `kr-center@${appVersion}`,
  environment: process.env.NODE_ENV === 'development' ? 'development' : 'production',
  tracesSampleRate: 0,
})

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null

// ---------------------------------------------------------------------------
// Auto-updater
// ---------------------------------------------------------------------------

autoUpdater.autoDownload = false        // pół-auto: najpierw pytamy usera
autoUpdater.autoInstallOnAppQuit = true // instaluj cicho przy zamknięciu po pobraniu

// Zapamiętaj wykryty update — renderer może zapytać o niego po zamontowaniu
let pendingUpdate: { version: string } | null = null

function setupAutoUpdater(mainWin: BrowserWindow) {
  // --- eventy od electron-updater → renderer ---

  autoUpdater.on('checking-for-update', () => {
    mainWin.webContents.send('update:checking')
  })

  autoUpdater.on('update-available', (info) => {
    pendingUpdate = { version: info.version }
    mainWin.webContents.send('update:available', {
      version: info.version,
      releaseDate: info.releaseDate,
    })
  })

  autoUpdater.on('update-not-available', () => {
    mainWin.webContents.send('update:not-available')
  })

  autoUpdater.on('download-progress', (progress) => {
    mainWin.webContents.send('update:progress', {
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond,
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    mainWin.webContents.send('update:downloaded', {
      version: info.version,
    })
  })

  autoUpdater.on('error', (err) => {
    // "No published versions" = repo istnieje ale nie ma jeszcze żadnego release'a
    // To nie jest błąd dla usera — traktuj jak "brak aktualizacji"
    const isNoReleases =
      err.message.includes('No published versions') ||
      err.message.includes('net::ERR_') ||
      err.message.includes('ENOTFOUND')

    if (isNoReleases) {
      console.info('[AutoUpdater] no releases found or network issue — silently ignoring')
      return
    }

    mainWin.webContents.send('update:error', err.message)
    Sentry.captureException(err, { tags: { context: 'auto-updater' } })
    console.error('[AutoUpdater] error:', err)
  })

  // --- IPC od renderera → autoUpdater ---

  ipcMain.handle('updater:check', async () => {
    try {
      const result = await autoUpdater.checkForUpdates()
      const newVersion = result?.updateInfo?.version
      // Porównaj z aktualną wersją — nie raportuj "dostępna" jeśli ta sama
      if (newVersion && newVersion !== app.getVersion()) {
        return { status: 'available', version: newVersion }
      }
      return { status: 'uptodate' }
    } catch (err) {
      const msg = (err as Error).message
      // Brak releases / błąd sieci → traktuj jako "brak aktualizacji"
      if (
        msg.includes('No published versions') ||
        msg.includes('net::ERR_') ||
        msg.includes('ENOTFOUND') ||
        msg.includes('404')
      ) {
        return { status: 'uptodate' }
      }
      console.error('[AutoUpdater] check failed:', err)
      return { status: 'error', message: msg }
    }
  })

  ipcMain.handle('updater:download', async () => {
    try {
      await autoUpdater.downloadUpdate()
    } catch (err) {
      console.error('[AutoUpdater] download failed:', err)
    }
  })

  ipcMain.handle('updater:install', () => {
    // false = nie czeka na wszystkie okna, true = restartuje
    autoUpdater.quitAndInstall(true, true)  // true = silent (bez okna instalatora), true = restart po instalacji
  })

  // Renderer może zapytać o wykryty update (np. zaraz po zalogowaniu)
  ipcMain.handle('updater:get-status', () => pendingUpdate)

  // Sprawdź od razu przy starcie — electron-updater sam ignoruje dev-mode
  autoUpdater.checkForUpdates().catch((err: Error) => {
    const msg = err.message
    if (
      msg.includes('No published versions') ||
      msg.includes('net::ERR_') ||
      msg.includes('ENOTFOUND') ||
      msg.includes('404')
    ) {
      console.info('[AutoUpdater] startup check: no releases / network issue — skipping')
    } else {
      console.warn('[AutoUpdater] startup check error:', msg)
    }
  })
}

// ---------------------------------------------------------------------------
// Druk etykiet
// ---------------------------------------------------------------------------

function setupPrinting(mainWin: BrowserWindow) {
  // Lista drukarek widocznych w systemie/sieci (dla etykiet HTML przez driver)
  ipcMain.handle('printers:list', async () => {
    try {
      const printers = await mainWin.webContents.getPrintersAsync()
      return printers.map((p) => ({
        name: p.name,
        displayName: p.displayName,
        isDefault: p.isDefault,
        status: p.status,
      }))
    } catch (err) {
      console.error('[Print] getPrinters error:', err)
      return []
    }
  })

  // Druk etykiety HTML (dynamiczne) — ukryte okno renderuje HTML i drukuje na wybraną drukarkę.
  // widthMm/heightMm → rozmiar etykiety (Electron pageSize w mikronach: 1mm = 1000µm).
  ipcMain.handle(
    'label:printHtml',
    async (
      _e,
      args: { html: string; deviceName?: string; copies?: number; widthMm?: number; heightMm?: number },
    ) => {
      const { html, deviceName, copies = 1, widthMm, heightMm } = args
      const printWin = new BrowserWindow({ show: false, webPreferences: { offscreen: false } })
      try {
        await printWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
        const pageSize =
          widthMm && heightMm
            ? { width: Math.round(widthMm * 1000), height: Math.round(heightMm * 1000) }
            : undefined
        const result = await new Promise<{ success: boolean; failureReason?: string }>((resolve) => {
          printWin.webContents.print(
            {
              silent: true,
              printBackground: true,
              deviceName: deviceName || undefined,
              copies: Math.max(1, copies),
              margins: { marginType: 'none' },
              ...(pageSize ? { pageSize } : {}),
            },
            (success, failureReason) => resolve({ success, failureReason }),
          )
        })
        return result
      } catch (err) {
        return { success: false, failureReason: (err as Error).message }
      } finally {
        if (!printWin.isDestroyed()) printWin.close()
      }
    },
  )

  // Druk ZPL (statyczne DoP) — surowy ZPL prosto do Zebry po TCP (domyślnie port 9100).
  ipcMain.handle(
    'label:printZpl',
    async (_e, args: { ip: string; port?: number; zpl: string; copies?: number }) => {
      const { ip, port = 9100, zpl, copies = 1 } = args
      if (!ip || !zpl) return { success: false, error: 'Brak IP drukarki lub treści ZPL' }
      // Każda kopia = osobny blok ZPL (przewidywalne, niezależne od ^PQ w pliku)
      const body = zpl.repeat(Math.max(1, copies))
      return await new Promise<{ success: boolean; error?: string }>((resolve) => {
        const socket = new net.Socket()
        let settled = false
        const done = (res: { success: boolean; error?: string }) => {
          if (settled) return
          settled = true
          socket.destroy()
          resolve(res)
        }
        socket.setTimeout(7000)
        socket.connect(port, ip, () => {
          socket.write(body, 'utf8', () => socket.end())
        })
        socket.on('close', () => done({ success: true }))
        socket.on('error', (err) => done({ success: false, error: err.message }))
        socket.on('timeout', () => done({ success: false, error: 'Przekroczono czas połączenia z drukarką' }))
      })
    },
  )
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

function createWindow() {
  const iconPath = path.join(process.env.APP_ROOT ?? '', 'public', 'icon.ico')

  win = new BrowserWindow({
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', new Date().toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }

  // Uruchom auto-updater po stworzeniu okna
  setupAutoUpdater(win)
  // Handlery druku etykiet
  setupPrinting(win)
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(createWindow)
