import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { RECIPE_CRITERIA_FIELD_DEFS, RECIPE_PARTS } from '../../constants'
import type {
  RecipeCriterion,
  RecipeFormState,
  RecipePart,
  WarehouseComponent,
  WarehouseRecipeComponent,
} from '../../types'
import { buildRecipeAutoName, getOrderStageDefinitions } from '../../utils'
import FormInput from '../FormInput'
import SearchableSelect from '../SearchableSelect'

const RECIPE_CATEGORIES = ['STA', 'Disting', 'ST', 'Techniczne', 'Bastion'] as const

// Wartości dostępne dla pola kryterium (słownik z Konfiguracji albo lista stała)
function optionsForCriterionField(fieldKey: string, byType: Record<string, string[]>): string[] {
  const def = RECIPE_CRITERIA_FIELD_DEFS.find((d) => d.key === fieldKey)
  if (!def) return []
  if (def.options) return def.options
  if (def.dict === 'kolor_oscieznicy') {
    const ko = byType.kolor_oscieznicy
    if (ko?.length) return ko
    return byType.kolor ?? []
  }
  return byType[def.dict ?? ''] ?? []
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

  // Dynamiczne kryteria dopasowania
  const criteria = formData.criteria ?? []
  const setCriteria = (next: RecipeCriterion[]) => onChange('criteria', next)
  const usedFields = new Set(criteria.map((c) => c.field))
  const [customInputs, setCustomInputs] = useState<Record<number, string>>({})

  const addCriterion = () => setCriteria([...criteria, { field: '', values: [] }])
  const removeCriterion = (idx: number) => setCriteria(criteria.filter((_, i) => i !== idx))
  const setCriterionField = (idx: number, field: string) =>
    setCriteria(criteria.map((c, i) => (i === idx ? { field, values: [] } : c)))
  const toggleCriterionValue = (idx: number, value: string) =>
    setCriteria(
      criteria.map((c, i) =>
        i === idx
          ? {
              ...c,
              values: c.values.includes(value)
                ? c.values.filter((v) => v !== value)
                : [...c.values, value],
            }
          : c,
      ),
    )
  const addCustomValue = (idx: number) => {
    const raw = (customInputs[idx] ?? '').trim()
    if (!raw) return
    const c = criteria[idx]
    if (!c.values.includes(raw)) toggleCriterionValue(idx, raw)
    setCustomInputs((p) => ({ ...p, [idx]: '' }))
  }

  // Etapy produkcji dla kategorii — komponent wydaje się z magazynu przy
  // "Zrobione" na tym etapie; bez etapu = przy pierwszym ukończonym etapie.
  const stageDefs = getOrderStageDefinitions(formData.category)
  const noStageCount = formData.components.filter(
    (c) => c.component_id > 0 && !c.stage_key,
  ).length

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
            Kryteria dopasowania
          </h3>
          <p className="order-field-full recipe-crit-hint">
            Sam decydujesz, po czym receptura dobiera się do zlecenia. Dodaj tylko potrzebne pola —
            brak kryterium = „nie dotyczy". W jednym kryterium możesz zaznaczyć <b>kilka wartości</b>
            (wystarczy, że zlecenie pasuje do którejkolwiek).
          </p>
          <div className="order-field-full recipe-crit-list">
            {criteria.length === 0 && (
              <p className="recipe-crit-empty">
                Brak kryteriów — receptura zadziała dla <b>każdego</b> zlecenia kategorii {formData.category}.
              </p>
            )}
            {criteria.map((c, idx) => {
              const opts = optionsForCriterionField(c.field, orderModalOptionsByType)
              const extraValues = c.values.filter((v) => !opts.includes(v))
              return (
                <div key={idx} className="recipe-crit-row">
                  <div className="recipe-crit-row-head">
                    <select
                      value={c.field}
                      onChange={(e) => setCriterionField(idx, e.target.value)}
                      disabled={saving}
                    >
                      <option value="">— wybierz pole —</option>
                      {RECIPE_CRITERIA_FIELD_DEFS.filter(
                        (d) => d.key === c.field || !usedFields.has(d.key),
                      ).map((d) => (
                        <option key={d.key} value={d.key}>{d.label}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      onClick={() => removeCriterion(idx)}
                      disabled={saving}
                    >
                      Usuń
                    </button>
                  </div>
                  {c.field && (
                    <>
                      <div className="recipe-crit-values">
                        {[...opts, ...extraValues].map((v) => {
                          const on = c.values.includes(v)
                          return (
                            <label key={v} className={`user-cat-chip ${on ? 'user-cat-chip--on' : ''}`}>
                              <input
                                type="checkbox"
                                checked={on}
                                disabled={saving}
                                onChange={() => toggleCriterionValue(idx, v)}
                              />
                              {v}
                            </label>
                          )
                        })}
                        {opts.length === 0 && extraValues.length === 0 && (
                          <span className="recipe-crit-empty">Brak wartości w słowniku — dopisz własną poniżej.</span>
                        )}
                      </div>
                      <div className="recipe-crit-custom">
                        <input
                          type="text"
                          placeholder="Własna wartość spoza słownika…"
                          value={customInputs[idx] ?? ''}
                          onChange={(e) => setCustomInputs((p) => ({ ...p, [idx]: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              addCustomValue(idx)
                            }
                          }}
                          disabled={saving}
                        />
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => addCustomValue(idx)} disabled={saving}>
                          Dodaj
                        </button>
                      </div>
                      {c.values.length === 0 && (
                        <span className="recipe-crit-warn">Zaznacz co najmniej jedną wartość — puste kryterium zostanie pominięte.</span>
                      )}
                    </>
                  )}
                </div>
              )
            })}
            <button type="button" className="btn btn-sm btn-primary" onClick={addCriterion} disabled={saving}>
              + Dodaj kryterium (np. system, kolor, zaczep…)
            </button>
          </div>
          </div>

          <div className="recipe-editor-positions-section">
          <h3 className="order-field-full" style={{ margin: '0.75rem 0 0', gridColumn: '1 / -1' }}>
            Pozycje receptury
            {stageDefs.length > 0 && noStageCount > 0 && (
              <span
                style={{ marginLeft: 10, fontSize: 12, fontWeight: 500, color: '#a16207' }}
                title="Te komponenty wydadzą się z magazynu przy pierwszym ukończonym etapie zamówienia"
              >
                ⚠️ {noStageCount} bez etapu (wydanie przy pierwszym ukończonym)
              </span>
            )}
          </h3>
            <div className="recipe-editor-positions-scroll">
              <div className="table-wrapper recipe-editor-positions-wrap">
                <table
                  className="orders-table recipe-editor-positions-table"
                  style={{ width: '100%', tableLayout: 'fixed' }}
                >
                  <colgroup>
                    <col style={{ width: '40%' }} />
                    <col style={{ width: '11%' }} />
                    <col style={{ width: '21%' }} />
                    <col style={{ width: '20%' }} />
                    <col style={{ width: '8%' }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th className="recipe-editor-component-th">KOMPONENT</th>
                      <th>ILOŚĆ</th>
                      <th title="Etap produkcji, na którym komponent schodzi fizycznie z magazynu">
                        ETAP WYDANIA
                      </th>
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
                          {stageDefs.length > 0 ? (
                            <select
                              value={row.stage_key ?? ''}
                              onChange={(e) =>
                                onComponentChange(index, 'stage_key', e.target.value || null)
                              }
                              disabled={saving}
                              style={{ width: '100%' }}
                            >
                              <option value="">— pierwszy ukończony —</option>
                              {stageDefs.map((d) => (
                                <option key={d.key} value={d.key}>
                                  {d.header} — {d.title}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span
                              className="recipe-crit-empty"
                              title="Ta kategoria nie ma etapów produkcji — wydanie nastąpi przy realizacji zamówienia"
                            >
                              przy realizacji
                            </span>
                          )}
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
