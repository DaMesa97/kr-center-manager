import { createPortal } from 'react-dom'
import type { ConfigOptionRecord } from '../types'

type ConfigOptionModalProps = {
  open: boolean
  editingConfigOption: ConfigOptionRecord | null
  configOptionForm: { value: string; sort_order: number }
  configAddStep: 'value' | 'dimensions'
  selectedConfigDictType: string
  pendingRozmiarValue: string
  dimensionModalForm: { width_mm: number; height_mm: number }
  isConfigOptionSaving: boolean
  onClose: () => void
  onFormChange: (patch: Partial<{ value: string; sort_order: number }>) => void
  onDimensionModalFormChange: (patch: Partial<{ width_mm: number; height_mm: number }>) => void
  onSave: () => void
  onSaveRozmiar: () => void
  onBackToValue: () => void
  submitOnEnterInInput: (e: React.KeyboardEvent<HTMLElement>, action: () => void) => void
}

export default function ConfigOptionModal({
  open,
  editingConfigOption,
  configOptionForm,
  configAddStep,
  selectedConfigDictType,
  pendingRozmiarValue,
  dimensionModalForm,
  isConfigOptionSaving,
  onClose,
  onFormChange,
  onDimensionModalFormChange,
  onSave,
  onSaveRozmiar,
  onBackToValue,
  submitOnEnterInInput,
}: ConfigOptionModalProps) {
  if (!open) return null

  return createPortal(
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      onClick={() => {
        if (isConfigOptionSaving) return
        onClose()
      }}
    >
      <div className="order-modal order-modal--config-option" onClick={(e) => e.stopPropagation()}>
        <div className="order-modal-header">
          <h2>{editingConfigOption === null ? 'Dodaj wartość' : 'Edytuj wartość'}</h2>
          <button
            type="button"
            className="btn btn-icon btn-ghost"
            onClick={() => {
              if (isConfigOptionSaving) return
              onClose()
            }}
          >
            X
          </button>
        </div>
        {configAddStep === 'dimensions' && selectedConfigDictType === 'rozmiar' ? (
          <div className="config-dimension-step">
            <p>
              Podaj wymiary dla rozmiaru <strong>{pendingRozmiarValue}</strong>
            </p>
            <div className="complaint-fields-grid">
              <div className="complaint-field">
                <label>Szerokość (mm) *</label>
                <input
                  type="number"
                  value={dimensionModalForm.width_mm || ''}
                  onChange={(e) =>
                    onDimensionModalFormChange({
                      width_mm: parseInt(e.target.value) || 0,
                    })
                  }
                  placeholder="np. 1020"
                  autoFocus
                />
              </div>
              <div className="complaint-field">
                <label>Wysokość STD (mm) *</label>
                <input
                  type="number"
                  value={dimensionModalForm.height_mm === 0 ? '' : dimensionModalForm.height_mm}
                  onChange={(e) =>
                    onDimensionModalFormChange({
                      height_mm: parseInt(e.target.value) || 0,
                    })
                  }
                  placeholder="np. 2080"
                />
              </div>
            </div>
            <div className="complaint-modal-footer" style={{ padding: '12px 0 0' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onBackToValue}
              >
                Wróć
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={!dimensionModalForm.width_mm || !dimensionModalForm.height_mm}
                onClick={() => void onSaveRozmiar()}
              >
                Zapisz rozmiar
              </button>
            </div>
          </div>
        ) : (
          <div
            className="order-form-grid order-form-grid--sta"
            onKeyDown={(e) => submitOnEnterInInput(e, () => void onSave())}
          >
            <label className="order-field-full">
              <span className="order-field-label-text">Wartość</span>
              <input
                type="text"
                value={configOptionForm.value}
                onChange={(e) => onFormChange({ value: e.target.value })}
                disabled={isConfigOptionSaving}
              />
            </label>
            <label className="order-field-full">
              <span className="order-field-label-text">Kolejność</span>
              <input
                type="number"
                value={configOptionForm.sort_order}
                onChange={(e) =>
                  onFormChange({ sort_order: Number(e.target.value) || 0 })
                }
                disabled={isConfigOptionSaving}
              />
            </label>
          </div>
        )}
        <div className="order-form-actions">
          {!(configAddStep === 'dimensions' && selectedConfigDictType === 'rozmiar') && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={onSave}
              disabled={isConfigOptionSaving}
            >
              {isConfigOptionSaving ? 'Zapisywanie...' : 'Zapisz'}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
