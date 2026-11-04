import PrintDocumentsView from './PrintDocumentsView'
import type { CurrentUser, ToastVariant } from '../types'

type Props = {
  isManager: boolean
  currentUser: CurrentUser | null
  pushToast: (message: string, variant: ToastVariant) => void
}

/**
 * Produkcja → Etykiety i druk: gotowe dokumenty ZPL / DoP do druku na hali.
 * Edytor szablonów etykiet (konfiguracja) przeniesiony do Ustawienia → Konfiguracja
 * → Szablony etykiet (porządki menu, beta.86) — tu zostaje tylko narzędzie dla ludzi.
 */
export default function LabelsView({ isManager, currentUser, pushToast }: Props) {
  return (
    <div className="labels-view">
      <PrintDocumentsView isManager={isManager} currentUser={currentUser} pushToast={pushToast} />
    </div>
  )
}
