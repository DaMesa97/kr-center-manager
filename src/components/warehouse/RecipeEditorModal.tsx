import { useMemo } from 'react'
import { createPortal } from 'react-dom'
import { RECIPE_PARTS } from '../../constants'
import type { RecipeFormState, RecipePart, WarehouseComponent, WarehouseRecipeComponent } from '../../types'
import { buildRecipeAutoName } from '../../utils'
import FormInput from '../FormInput'
import SearchableConfigSelect from '../SearchableConfigSelect'
import SearchableSelect from '../SearchableSelect'

type RecipeMatchFieldKey =
  | 'system'
  | 'model'
  | 'wing_color'
  | 'frame_color'
  | 'width'
  | 'direction'
  | 'glazing'
  | 'decorative_panel'
  | 'hardware'
  | 'handle'
  | 'peephole'
  | 'electric_strike'

const RECIPE_MATCH_FIELDS: Record<RecipePart, readonly RecipeMatchFieldKey[]> = {
  wing: ['system', 'model', 'wing_color', 'width', 'direction'],
  frame: ['system', 'frame_color', 'width'],
  hardware: ['system'],
  fittings: ['hardware'],
  handle: ['handle'],
  peephole: ['peephole'],
  electric_strike: ['electric_strike'],
  glazing: ['system', 'model', 'glazing'],
  decorative_panel: ['model', 'decorative_panel'],
  other: [],
}

const MATCH_FIELD_LABELS: Record<RecipeMatchFieldKey, string> = {
  system: 'System',
  model: 'Model',
  wing_color: 'Kolor skrzydła',
  frame_color: 'Kolor ościeżnicy',
  width: 'Rozmiar',
  direction: 'Kierunek',
  glazing: 'Szklenie',
  decorative_panel: 'Panel dekoracyjny',
  hardware: 'Okucia',
  handle: 'Pochwyt',
  peephole: 'Wizjer',
  electric_strike: 'Elektrozaczep',
}

const RECIPE_CATEGORIES = ['STA', 'Disting', 'ST', 'Techniczne', 'Bastion'] as const

const DIRECTION_OPTIONS = ['PRAWE', 'LEWE'] as const

const MATCH_FIELD_OPTION_TYPE: Record<Exclude<RecipeMatchFieldKey, 'direction'>, string> = {
  system: 'system',
  model: 'model',
  wing_color: 'kolor',
  frame_color: 'kolor_oscieznicy',
  width: 'rozmiar',
  glazing: 'szklenie',
  decorative_panel: 'panel',
  hardware: 'okucia',
  handle: 'pochwyt',
  peephole: 'wizjer',
  electric_strike: 'zaczep',
}

function optionsForMatchField(
  field: RecipeMatchFieldKey,
  byType: Record<string, string[]>,
): string[] {
  if (field === 'direction') return [...DIRECTION_OPTIONS]
  if (field === 'frame_color') {
    const ko = byType.kolor_oscieznicy
    if (ko?.length) return ko
    return byType.kolor ?? []
  }
  const typ = MATCH_FIELD_OPTION_TYPE[field]
  return byType[typ] ?? []
}

function componentOptionLabel(c: WarehouseComponent): string {
  return `${c.code} — ${c.name} (${c.unit})`
}

type RecipeEditorModalProps = {
  open: boolean
  mode: 'create' | 'edit'
  formData: RecipeFormState
  warehouseComponents: WarehouseComponent[]
  onChange: (field: keyof RecipeFormState, value: unknown) => void
  onComponentChange: (index: number, field: keyof WarehouseRecipeComponent, value: unknown) => void
  onAddComponent: () => void
  onRemoveComponent: (index: number) => void
  onSave: () => Promise<void>
  onClose: () => void
  saving: boolean
  orderModalOptionsByType: Record<string, string[]>
}

function RecipeEditorModal({
  open,
  mode,
  formData,
  warehouseComponents,
  onChange,
  onComponentChange,
  onAddComponent,
  onRemoveComponent,
  onSave,
  onClose,
  saving,
  orderModalOptionsByType,
}: RecipeEditorModalProps) {
  const componentOptions = useMemo(
    () => warehouseComponents.map((c) => componentOptionLabel(c)),
    [warehouseComponents],
  )

  const optionToId = useMemo(() => {
    const m = new Map<string, number>()
    warehouseComponents.forEach((c) => {
      m.set(componentOptionLabel(c), c.id)
    })
    return m
  }, [warehouseComponents])

  const idToOption = useMemo(() => {
    const m = new Map<number, string>()
    warehouseComponents.forEach((c) => {
      m.set(c.id, componentOptionLabel(c))
    })
    return m
  }, [warehouseComponents])

  const matchFields = RECIPE_MATCH_FIELDS[formData.part]

  if (!open) return null

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
          <h2>{mode === 'create' ? 'Nowa receptura' : 'Edycja receptury'}</h2>
          <button type="button" className="btn btn-icon btn-ghost" onClick={onClose} disabled={saving}>
            X
          </button>
        </div>

        <div className="recipe-editor-modal-body">
          <div className="order-form-grid order-form-grid--sta recipe-editor-modal-form-top">
          <h3 className="order-field-full" style={{ margin: '0.5rem 0 0', gridColumn: '1 / -1' }}>
            Podstawowe
          </h3>
          <FormInput
            label="Nazwa (automatyczna)"
            value={buildRecipeAutoName(formData)}
            onChange={() => {}}
            readOnly
            disabled={saving}
            title="Nazwa generowana z atrybutów"
          />
          <label className="order-field-full">
            <span className="order-field-label-text">Kategoria</span>
            <select
              value={formData.category}
              onChange={(e) => onChange('category', e.target.value)}
              disabled={saving}
            >
              {RECIPE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="order-field-full">
            <span className="order-field-label-text">Część</span>
            <select
              value={formData.part}
              onChange={(e) => onChange('part', e.target.value as RecipePart)}
              disabled={saving}
            >
              {RECIPE_PARTS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="order-field-full" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={formData.is_active}
              onChange={(e) => onChange('is_active', e.target.checked)}
              disabled={saving}
            />
            <span className="order-field-label-text">Aktywna</span>
          </label>

          <h3 className="order-field-full" style={{ margin: '0.75rem 0 0', gridColumn: '1 / -1' }}>
            Atrybuty dopasowania
          </h3>
          {matchFields.length === 0 ? (
            <p className="order-field-full" style={{ margin: 0, color: '#666' }}>
              Brak pól dopasowania dla wybranej części.
            </p>
          ) : (
            <div
              className="recipe-editor-match-attrs-grid"
              style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}
            >
              {matchFields.map((key) => {
                if (key === 'direction') {
                  return (
                    <label key={key} className="order-field-full">
                      <span className="order-field-label-text">{MATCH_FIELD_LABELS[key]}</span>
                      <SearchableSelect
                        value={formData.direction}
                        onChange={(v) => onChange('direction', v)}
                        options={[...DIRECTION_OPTIONS]}
                        placeholder="— wybierz —"
                        disabled={saving}
                      />
                    </label>
                  )
                }
                const opts = optionsForMatchField(key, orderModalOptionsByType)
                return (
                  <SearchableConfigSelect
                    key={key}
                    label={MATCH_FIELD_LABELS[key]}
                    value={formData[key] as string}
                    options={opts}
                    onChange={(v) => onChange(key, v)}
                    disabled={saving}
                  />
                )
              })}
            </div>
          )}
          </div>

          <div className="recipe-editor-positions-section">
          <h3 className="order-field-full" style={{ margin: '0.75rem 0 0', gridColumn: '1 / -1' }}>
            Pozycje receptury
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
                  {formData.components.map((row, index) => {
                    const selectValue =
                      row.component_id > 0 ? (idToOption.get(row.component_id) ?? '') : ''
                    return (
                      <tr key={index}>
                        <td className="recipe-editor-component-cell">
                          <SearchableSelect
                            value={selectValue}
                            onChange={(val) => {
                              const id = optionToId.get(val) ?? 0
                              onComponentChange(index, 'component_id', id)
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
                              onComponentChange(index, 'quantity', parseFloat(e.target.value) || 0)
                            }
                            disabled={saving}
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            value={row.notes ?? ''}
                            onChange={(e) => onComponentChange(index, 'notes', e.target.value)}
                            disabled={saving}
                          />
                        </td>
                        <td className="recipe-editor-actions-td">
                          <button
                            type="button"
                            className="btn btn-sm btn-danger"
                            onClick={() => onRemoveComponent(index)}
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
              onClick={onAddComponent}
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

export default RecipeEditorModal
