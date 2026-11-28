import PrintDocumentsView from './PrintDocumentsView'
import type { CurrentUser, ToastVariant } from '../types'
import { canEditPrintTemplates } from '../lib/permissions'

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
      {/* D59: dodawanie / edycja / usuwanie dokumentów druku tylko admin / superadmin; druk — wszyscy */}
      <PrintDocumentsView
        isManager={isManager && canEditPrintTemplates(currentUser?.role)}
        currentUser={currentUser}
        pushToast={pushToast}
      />
    </div>
  )
}
