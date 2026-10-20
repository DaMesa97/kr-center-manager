import { Component, type ErrorInfo, type ReactNode } from 'react'
import * as Sentry from '@sentry/electron/renderer'

type Props = { children: ReactNode }
type State = { error: Error | null }

// Ostatnia linia obrony: nieobsłużony błąd renderu nie zostawia stanowiska
// z białym ekranem bez wyjścia — pokazujemy komunikat i przycisk przeładowania.
// console.error trafia do errors.log (main.ts łapie konsolę renderera),
// a Sentry dostaje pełny stack komponentów.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
    try {
      Sentry.captureException(error, { extra: { componentStack: info.componentStack } })
    } catch {
      /* Sentry nie może wywrócić ekranu awaryjnego */
    }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="app-crash">
        <div className="app-crash-box">
          <div className="app-crash-title">Coś poszło nie tak 😿</div>
          <div className="app-crash-msg">
            Aplikacja napotkała nieoczekiwany błąd. Szczegóły zapisały się w logu
            (Pomoc → „Pokaż log błędów"). Przeładuj aplikację — niezapisane zmiany
            w otwartym formularzu mogły przepaść, reszta danych jest bezpieczna w bazie.
          </div>
          <div className="app-crash-detail">{String(this.state.error.message ?? this.state.error)}</div>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            Przeładuj aplikację
          </button>
        </div>
      </div>
    )
  }
}
