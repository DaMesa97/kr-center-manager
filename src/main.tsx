import React from 'react'
import ReactDOM from 'react-dom/client'
import * as Sentry from '@sentry/electron/renderer'
import packageJson from '../package.json'
import App from './App.tsx'
import './index.css'

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,

  release: `kr-center@${packageJson.version}`,

  environment: import.meta.env.PROD ? 'production' : 'development',

  tracesSampleRate: 0,

  beforeSend(event, hint) {
    const error = hint.originalException as Error | undefined

    if (error?.message?.includes('ResizeObserver loop')) return null
    if (error?.message?.includes('Non-Error promise rejection')) return null
    if (error?.stack?.includes('chrome-extension://')) return null
    if (error?.stack?.includes('moz-extension://')) return null

    if (!import.meta.env.PROD) {
      console.error('[Sentry capture]', event, hint)
    }

    return event
  },

  denyUrls: [
    /chrome-extension:\/\//,
    /moz-extension:\/\//,
    /vite\/dist\/client/,
  ],
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

window.ipcRenderer?.on('main-process-message', (_event, message) => {
  console.log(message)
})
