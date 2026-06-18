import { useState } from 'react'
import { AlertTriangle, X, ChevronRight } from 'lucide-react'

type Props = {
  overdueCount: number
  warningCount?: number
  onNavigateToShipping: () => void
}

/**
 * Globalny pasek ostrzeżenia o przeterminowanych / opóźnionych zamówieniach.
 * Renderowany między AppHeader a głównym contentem — widoczny dla managera.
 * Odpada po kliknięciu X, wraca po odświeżeniu lub gdy zmieni się count.
 */
export default function OverdueBanner({ overdueCount, warningCount = 0, onNavigateToShipping }: Props) {
  const [dismissed, setDismissed] = useState(false)

  const total = overdueCount + warningCount
  if (total === 0 || dismissed) return null

  const buildText = () => {
    const parts: string[] = []
    if (overdueCount > 0) {
      const label =
        overdueCount === 1
          ? '1 zamówienie przeterminowane'
          : overdueCount < 5
            ? `${overdueCount} zamówienia przeterminowane`
            : `${overdueCount} zamówień przeterminowanych`
      parts.push(label)
    }
    if (warningCount > 0) {
      const label =
        warningCount === 1
          ? '1 zbliża się do terminu'
          : `${warningCount} zbliża się do terminu`
      parts.push(label)
    }
    return parts.join(' · ')
  }

  return (
    <div
      className={`overdue-banner${overdueCount > 0 ? ' overdue-banner--critical' : ' overdue-banner--warning'}`}
      role="alert"
    >
      <AlertTriangle size={15} className="overdue-banner-icon" />
      <span className="overdue-banner-text">
        <strong>{buildText()}</strong>
        {overdueCount > 0 && ' — produkcja powinna była już zostać ukończona'}
      </span>
      <button
        type="button"
        className="btn btn-sm overdue-banner-btn"
        onClick={onNavigateToShipping}
      >
        Przejdź do Wysyłki
        <ChevronRight size={13} />
      </button>
      <button
        type="button"
        className="overdue-banner-dismiss"
        onClick={() => setDismissed(true)}
        aria-label="Zamknij"
        title="Ukryj do odświeżenia"
      >
        <X size={13} />
      </button>
    </div>
  )
}
