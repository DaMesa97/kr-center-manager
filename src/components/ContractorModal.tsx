import { createPortal } from 'react-dom'
import { PRODUCTION_DAYS } from '../constants'
import type { Company, ContractorFormData } from '../types'

type ContractorModalProps = {
  open: boolean
  editingCompany: Company | null
  contractorFormData: ContractorFormData
  isContractorSaving: boolean
  onClose: () => void
  onChange: (field: keyof ContractorFormData, value: string) => void
  onSave: () => void
  submitOnEnterInInput: (e: React.KeyboardEvent<HTMLElement>, action: () => void) => void
}

export default function ContractorModal({
  open,
  editingCompany,
  contractorFormData,
  isContractorSaving,
  onClose,
  onChange,
  onSave,
  submitOnEnterInInput,
}: ContractorModalProps) {
  if (!open) return null

  return createPortal(
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div className="order-modal" onClick={(e) => e.stopPropagation()}>
        <div className="order-modal-header">
          <h2>{editingCompany === null ? 'Dodaj kontrahenta' : 'Edytuj kontrahenta'}</h2>
          <button className="btn btn-icon btn-ghost" onClick={onClose}>
            X
          </button>
        </div>
        <div
          className="order-form-grid"
          onKeyDown={(e) => submitOnEnterInInput(e, () => void onSave())}
        >
          <label>
            Nazwa
            <input
              type="text"
              value={contractorFormData.name}
              onChange={(event) => onChange('name', event.target.value)}
            />
          </label>
          <label>
            Miasto
            <input
              type="text"
              value={contractorFormData.city}
              onChange={(event) => onChange('city', event.target.value)}
            />
          </label>
          <label>
            Dzień trasy
            <select
              value={contractorFormData.route_day}
              onChange={(event) => onChange('route_day', event.target.value)}
            >
              {PRODUCTION_DAYS.map((day) => (
                <option key={`route-${day}`}>{day}</option>
              ))}
            </select>
          </label>
          <label>
            Dzień produkcji
            <select
              value={contractorFormData.production_day}
              onChange={(event) => onChange('production_day', event.target.value)}
            >
              {PRODUCTION_DAYS.map((day) => (
                <option key={`production-${day}`}>{day}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="order-form-actions">
          <button
            className="btn btn-primary"
            onClick={onSave}
            disabled={isContractorSaving}
          >
            {isContractorSaving ? 'Zapisywanie...' : 'Zapisz'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
