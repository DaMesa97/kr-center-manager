import { useMemo } from 'react'
import { createPortal } from 'react-dom'
import type { MmFormState, MmItem, Warehouse, WarehouseComponent } from '../../types'
import SearchableSelect from '../SearchableSelect'

type MmFormModalProps = {
  open: boolean
  mode: 'create'
  formData: MmFormState
  warehouses: Warehouse[]
  components: WarehouseComponent[]
  onChange: (field: keyof MmFormState, value: unknown) => void
  onItemChange: (index: number, field: keyof MmItem, value: unknown) => void
  onAddItem: () => void
  onRemoveItem: (index: number) => void
  onSave: () => Promise<void>
  onClose: () => void
  saving: boolean
}

function componentOptionLabel(c: WarehouseComponent): string {
  return `${c.code} — ${c.name} (${c.unit})`
}

function MmFormModal({
  open,
  mode,
  formData,
  warehouses,
  components,
  onChange,
  onItemChange,
  onAddItem,
  onRemoveItem,
  onSave,
  onClose,
  saving,
}: MmFormModalProps) {
  const componentOptions = useMemo(
    () => components.map((c) => componentOptionLabel(c)),
    [components],
  )

  const optionToId = useMemo(() => {
    const m = new Map<string, number>()
    components.forEach((c) => {
      m.set(componentOptionLabel(c), c.id)
    })
    return m
  }, [components])

  const idToOption = useMemo(() => {
    const m = new Map<number, string>()
    components.forEach((c) => {
      m.set(c.id, componentOptionLabel(c))
    })
    return m
  }, [components])

  const warehousesSorted = useMemo(
    () => [...warehouses].sort((a, b) => a.code.localeCompare(b.code)),
    [warehouses],
  )

  if (!open) return null

  const title = mode === 'create' ? 'Nowe przesunięcie (MM)' : 'Przesunięcie (MM)'

  return createPortal(
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      onClick={() => {
        if (saving) return
        onClose()
      }}
    >
      <div
        className="order-modal order-modal--sta recipe-editor-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="order-modal-header">
          <h2>{title}</h2>
          <button type="button" className="btn btn-icon btn-ghost" onClick={onClose} disabled={saving}>
            X
          </button>
        </div>

        <div className="recipe-editor-modal-body">
          <div className="order-form-grid order-form-grid--sta recipe-editor-modal-form-top">
            <h3 className="order-field-full" style={{ margin: '0.5rem 0 0', gridColumn: '1 / -1' }}>
              Dokument
            </h3>
            <label className="order-field-full">
              <span className="order-field-label-text">Magazyn źródłowy</span>
              <select
                value={formData.warehouse_from_id ?? ''}
                onChange={(e) =>
                  onChange('warehouse_from_id', e.target.value === '' ? null : Number(e.target.value))
                }
                disabled={saving}
              >
                <option value="">— wybierz magazyn —</option>
                {warehousesSorted.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code} — {w.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="order-field-full">
              <span className="order-field-label-text">Magazyn docelowy</span>
              <select
                value={formData.warehouse_to_id ?? ''}
                onChange={(e) =>
                  onChange('warehouse_to_id', e.target.value === '' ? null : Number(e.target.value))
                }
                disabled={saving}
              >
                <option value="">— wybierz magazyn —</option>
                {warehousesSorted.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code} — {w.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="order-field-full">
              <span className="order-field-label-text">Numer dokumentu</span>
              <input
                type="text"
                value={formData.reference_doc}
                onChange={(e) => onChange('reference_doc', e.target.value)}
                disabled={saving}
                placeholder="Automatyczny jeśli puste"
              />
            </label>
            <label className="order-field-full">
              <span className="order-field-label-text">Uwagi</span>
              <textarea
                value={formData.notes}
                onChange={(e) => onChange('notes', e.target.value)}
                disabled={saving}
                rows={3}
                style={{ width: '100%', resize: 'vertical' }}
              />
            </label>
          </div>

          <div className="recipe-editor-positions-section">
            <h3 className="order-field-full" style={{ margin: '0.75rem 0 0', gridColumn: '1 / -1' }}>
              Pozycje
            </h3>
            <div className="recipe-editor-positions-scroll">
              <div className="table-wrapper recipe-editor-positions-wrap">
                <table
                  className="orders-table recipe-editor-positions-table"
                  style={{ width: '100%', tableLayout: 'fixed' }}
                >
                  <colgroup>
                    <col style={{ width: '55%' }} />
                    <col style={{ width: '15%' }} />
                    <col style={{ width: '22%' }} />
                    <col style={{ width: '8%' }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th className="recipe-editor-component-th">KOMPONENT</th>
                      <th>ILOŚĆ</th>
                      <th>UWAGI</th>
                      <th className="recipe-editor-actions-th">AKCJA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {formData.items.map((row, index) => {
                      const selectValue =
                        row.component_id > 0 ? (idToOption.get(row.component_id) ?? '') : ''
                      return (
                        <tr key={index}>
                          <td className="recipe-editor-component-cell">
                            <SearchableSelect
                              value={selectValue}
                              onChange={(val) => {
                                const id = optionToId.get(val) ?? 0
                                onItemChange(index, 'component_id', id)
                              }}
                              options={componentOptions}
                              placeholder="— wybierz komponent —"
                              disabled={saving}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              min={0}
                              step={0.001}
                              value={Number.isFinite(row.quantity) ? row.quantity : 0}
                              onChange={(e) =>
                                onItemChange(index, 'quantity', parseFloat(e.target.value) || 0)
                              }
                              disabled={saving}
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              value={row.notes ?? ''}
                              onChange={(e) => onItemChange(index, 'notes', e.target.value)}
                              disabled={saving}
                            />
                          </td>
                          <td className="recipe-editor-actions-td">
                            <button
                              type="button"
                              className="btn btn-sm btn-danger"
                              onClick={() => onRemoveItem(index)}
                              disabled={saving}
                            >
                              Usuń
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <button
              type="button"
              className="btn btn-success"
              style={{ marginTop: 10 }}
              onClick={onAddItem}
              disabled={saving}
            >
              + Dodaj pozycję
            </button>
          </div>
        </div>

        <div className="order-form-actions">
          <button type="button" className="btn btn-primary" onClick={() => void onSave()} disabled={saving}>
            {saving ? 'Zapisywanie…' : 'Zapisz'}
          </button>
          <button type="button" className="btn btn-sm btn-primary" onClick={onClose} disabled={saving}>
            Anuluj
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default MmFormModal
