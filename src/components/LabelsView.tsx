import { useState } from 'react'
import PrintDocumentsView from './PrintDocumentsView'
import LabelTemplatesEditor from './LabelTemplatesEditor'
import type { CurrentUser, ToastVariant } from '../types'

type Props = {
  isManager: boolean
  currentUser: CurrentUser | null
  pushToast: (message: string, variant: ToastVariant) => void
}

export default function LabelsView({ isManager, currentUser, pushToast }: Props) {
  const [sub, setSub] = useState<'docs' | 'templates'>('docs')

  return (
    <div className="labels-view">
      <div className="subtab-bar" role="tablist" aria-label="Etykiety">
        <button
          type="button"
          className={`btn btn-sm ${sub === 'docs' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setSub('docs')}
        >
          Dokumenty (ZPL / DoP)
        </button>
        <button
          type="button"
          className={`btn btn-sm ${sub === 'templates' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setSub('templates')}
        >
          Szablony etykiet (dynamiczne)
        </button>
      </div>

      {sub === 'docs' ? (
        <PrintDocumentsView isManager={isManager} currentUser={currentUser} pushToast={pushToast} />
      ) : (
        <LabelTemplatesEditor isManager={isManager} pushToast={pushToast} />
      )}
    </div>
  )
}
