import { Fragment, type Dispatch, type SetStateAction } from 'react'
import { CONFIG_DICTIONARIES, CONFIG_FORM_CATEGORIES, EXCLUSION_FIELD_LABELS } from '../constants'
import type {
  CompanySettings,
  ConfigExclusion,
  ConfigFormCategory,
  ConfigOptionRecord,
  ConfigSubTab,
  DimensionMap,
  GlassAllowance,
  Supplier,
} from '../types'
import SearchableSelect from './SearchableSelect'
import SuppliersConfigView from './config/SuppliersConfigView'
import CompanySettingsView from './config/CompanySettingsView'

type ExclusionFormState = {
  category: string
  source_field: string
  source_values: string[]
  target_field: string
  target_value: string
}

type DimensionMapFormState = {
  category: string
  dimension_code: string
  width_mm: number
  height_mm: number
}

type ExtensionProfileFormState = {
  category: string
  profile_width_mm: number
}

type ConfigViewProps = {
  activeConfigSubTab: ConfigSubTab
  setActiveConfigSubTab: Dispatch<SetStateAction<ConfigSubTab>>
  isManager: boolean
  selectedConfigCategory: ConfigFormCategory
  setSelectedConfigCategory: Dispatch<SetStateAction<ConfigFormCategory>>
  selectedConfigDictKey: string
  setSelectedConfigDictKey: Dispatch<SetStateAction<string>>
  configDictionariesForCategory: { key: string; label: string; category: ConfigFormCategory; type: string }[]
  selectedConfigDict: { key: string; label: string; category: ConfigFormCategory; type: string }
  openAddConfigOption: () => void
  configOptionsLoading: boolean
  configOptionsList: ConfigOptionRecord[]
  draggedItemId: number | string | null
  setDraggedItemId: Dispatch<SetStateAction<number | string | null>>
  dragOverItemId: number | string | null
  setDragOverItemId: Dispatch<SetStateAction<number | string | null>>
  handleReorderConfigOptions: (newList: ConfigOptionRecord[]) => void | Promise<void>
  openEditConfigOption: (row: ConfigOptionRecord) => void
  handleDeleteConfigOption: (row: ConfigOptionRecord) => void | Promise<void>
  onToggleDefault: (option: ConfigOptionRecord, checked: boolean) => void
  onUpdateLabelMultiplier: (row: ConfigOptionRecord, value: number | null) => void
  onUpdateAddToBatch: (row: ConfigOptionRecord, checked: boolean) => void
  exclusionForm: ExclusionFormState
  setExclusionForm: Dispatch<SetStateAction<ExclusionFormState>>
  exclusionSourceFilter: string
  setExclusionSourceFilter: Dispatch<SetStateAction<string>>
  availableSourceValues: string[]
  getOptionsForField: (category: string, field: string) => string[]
  handleSaveExclusion: () => void | Promise<void>
  activeExclusionCategory: string
  setActiveExclusionCategory: Dispatch<SetStateAction<string>>
  exclusions: ConfigExclusion[]
  exclusionSearch: string
  setExclusionSearch: Dispatch<SetStateAction<string>>
  searchedExclusions: ConfigExclusion[]
  groupedFilteredExclusions: [string, ConfigExclusion[]][]
  handleDeleteExclusionGroup: (
    category: string,
    sourceField: string,
    sourceValue: string,
  ) => void | Promise<void>
  handleDeleteExclusion: (id: number) => void | Promise<void>
  dimensionMapForm: DimensionMapFormState
  setDimensionMapForm: Dispatch<SetStateAction<DimensionMapFormState>>
  availableCodes: string[]
  handleSaveDimensionMap: () => void | Promise<void>
  dimensionMap: DimensionMap[]
  handleDeleteDimensionMap: (id: number) => void | Promise<void>
  extensionProfileForm: ExtensionProfileFormState
  setExtensionProfileForm: Dispatch<SetStateAction<ExtensionProfileFormState>>
  handleSaveExtensionProfile: () => void | Promise<void>
  extensionProfileWidths: { category: string; profile_width_mm: number }[]
  handleUpdateExtensionProfileWidth: (category: string, width: number) => void | Promise<void>
  handleDeleteExtensionProfile: (category: string) => void | Promise<void>
  glassAllowances: GlassAllowance[]
  handleUpdateGlassAllowance: (
    id: number,
    field: 'allowance_w_mm' | 'allowance_h_mm',
    value: number,
  ) => void | Promise<void>
  suppliers: Supplier[]
  suppliersLoading: boolean
  onCreateSupplier: () => void
  onEditSupplier: (supplier: Supplier) => void
  onToggleSupplierActive: (supplier: Supplier) => Promise<void>
  companySettings: CompanySettings | null
  companySettingsLoading: boolean
  onCompanySettingsSaved: () => void
  pushToast: (message: string, variant: 'success' | 'error' | 'info') => void
}

export default function ConfigView({
  activeConfigSubTab,
  setActiveConfigSubTab,
  isManager,
  selectedConfigCategory,
  setSelectedConfigCategory,
  selectedConfigDictKey,
  setSelectedConfigDictKey,
  configDictionariesForCategory,
  selectedConfigDict,
  openAddConfigOption,
  configOptionsLoading,
  configOptionsList,
  draggedItemId,
  setDraggedItemId,
  dragOverItemId,
  setDragOverItemId,
  handleReorderConfigOptions,
  openEditConfigOption,
  handleDeleteConfigOption,
  onToggleDefault,
  onUpdateLabelMultiplier,
  onUpdateAddToBatch,
  exclusionForm,
  setExclusionForm,
  exclusionSourceFilter,
  setExclusionSourceFilter,
  availableSourceValues,
  getOptionsForField,
  handleSaveExclusion,
  activeExclusionCategory,
  setActiveExclusionCategory,
  exclusions,
  exclusionSearch,
  setExclusionSearch,
  searchedExclusions,
  groupedFilteredExclusions,
  handleDeleteExclusionGroup,
  handleDeleteExclusion,
  dimensionMapForm,
  setDimensionMapForm,
  availableCodes,
  handleSaveDimensionMap,
  dimensionMap,
  handleDeleteDimensionMap,
  extensionProfileForm,
  setExtensionProfileForm,
  handleSaveExtensionProfile,
  extensionProfileWidths,
  handleUpdateExtensionProfileWidth,
  handleDeleteExtensionProfile,
  glassAllowances,
  handleUpdateGlassAllowance,
  suppliers,
  suppliersLoading,
  onCreateSupplier,
  onEditSupplier,
  onToggleSupplierActive,
  companySettings,
  companySettingsLoading,
  onCompanySettingsSaved,
  pushToast,
}: ConfigViewProps) {
  const isBastionFrameDict =
    selectedConfigCategory === 'Bastion' && selectedConfigDict?.type === 'oscieznica'

  return (
    <>
      <div className="subtab-bar">
        <button
          type="button"
          className={`btn btn-sm ${activeConfigSubTab === 'Słowniki' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveConfigSubTab('Słowniki')}
        >
          Słowniki
        </button>
        <button
          type="button"
          className={`btn btn-sm ${activeConfigSubTab === 'Wykluczenia' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveConfigSubTab('Wykluczenia')}
        >
          Wykluczenia
        </button>
        <button
          type="button"
          className={`btn btn-sm ${activeConfigSubTab === 'Słownik wymiarów' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveConfigSubTab('Słownik wymiarów')}
        >
          Słownik wymiarów
        </button>
        <button
          type="button"
          className={`btn btn-sm ${activeConfigSubTab === 'Naddatki szyb (naświetla)' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveConfigSubTab('Naddatki szyb (naświetla)')}
        >
          Naddatki szyb (naświetla)
        </button>
        <button
          type="button"
          className={`btn btn-sm ${activeConfigSubTab === 'Dostawcy' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveConfigSubTab('Dostawcy')}
        >
          Dostawcy
        </button>
        {isManager && (
          <button
            type="button"
            className={`btn btn-sm ${activeConfigSubTab === 'Dane firmy' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveConfigSubTab('Dane firmy')}
          >
            Dane firmy
          </button>
        )}
      </div>
      {activeConfigSubTab === 'Słowniki' && (
        <div className="config-layout">
          <aside className="config-sidebar" aria-label="Słowniki konfiguracji">
            <label className="config-sidebar-category">
              <span className="config-sidebar-category-label">Kategoria</span>
              <select
                className="config-category-select"
                value={selectedConfigCategory}
                onChange={(e) => {
                  const cat = e.target.value as ConfigFormCategory
                  setSelectedConfigCategory(cat)
                  const list = CONFIG_DICTIONARIES.filter((d) => d.category === cat)
                  if (list[0]) {
                    setSelectedConfigDictKey(list[0].key)
                  }
                }}
              >
                {CONFIG_FORM_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </label>
            {configDictionariesForCategory.map((d) => (
              <button
                key={d.key}
                type="button"
                className={`config-sidebar-item ${selectedConfigDictKey === d.key ? 'active' : ''}`}
                onClick={() => setSelectedConfigDictKey(d.key)}
              >
                {d.label}
              </button>
            ))}
          </aside>
          <div className="config-main">
            <div className="config-main-header">
              <h2 className="config-main-title">
                {selectedConfigCategory} — {selectedConfigDict.label}
              </h2>
              <button type="button" className="btn btn-success" onClick={openAddConfigOption}>
                Dodaj wartość
              </button>
            </div>
            {configOptionsLoading ? (
              <p className="no-results">Ładowanie wartości...</p>
            ) : (
              <div className="table-wrapper config-table-wrap">
                <table className="orders-table contractors-table config-options-table">
                  <thead>
                    <tr>
                      <th />
                      <th>Wartość</th>
                      <th className="col-sort-order">Kolejność</th>
                      <th>Domyślne</th>
                      {isBastionFrameDict && <th>Etykiety</th>}
                      {isBastionFrameDict && <th>Dodawaj do partii</th>}
                      <th>Akcje</th>
                    </tr>
                  </thead>
                  <tbody>
                    {configOptionsList.map((row) => (
                      <tr
                        key={String(row.id)}
                        draggable
                        onDragStart={() => setDraggedItemId(row.id)}
                        onDragOver={(e) => {
                          e.preventDefault()
                          setDragOverItemId(row.id)
                        }}
                        onDragEnd={() => {
                          if (
                            draggedItemId === null ||
                            dragOverItemId === null ||
                            draggedItemId === dragOverItemId
                          ) {
                            setDraggedItemId(null)
                            setDragOverItemId(null)
                            return
                          }
                          const newList = [...configOptionsList]
                          const draggedIndex = newList.findIndex((i) => i.id === draggedItemId)
                          const dropIndex = newList.findIndex((i) => i.id === dragOverItemId)
                          const [removed] = newList.splice(draggedIndex, 1)
                          newList.splice(dropIndex, 0, removed)
                          setDraggedItemId(null)
                          setDragOverItemId(null)
                          void handleReorderConfigOptions(newList)
                        }}
                        className={[
                          draggedItemId === row.id ? 'config-row--dragging' : '',
                          dragOverItemId === row.id ? 'config-row--drag-over' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      >
                        <td className="config-drag-handle">⠿</td>
                        <td>{row.value}</td>
                        <td className="col-sort-order">{row.sort_order}</td>
                        <td>
                          <input
                            type="checkbox"
                            checked={!!row.is_default}
                            onChange={(e) => onToggleDefault(row, e.target.checked)}
                          />
                        </td>
                        {isBastionFrameDict && (
                          <td>
                            <input
                              type="number"
                              min={0}
                              className="extension-qty-input"
                              value={row.label_multiplier ?? ''}
                              onChange={(e) =>
                                onUpdateLabelMultiplier(
                                  row,
                                  e.target.value === '' ? null : parseInt(e.target.value) || 0,
                                )
                              }
                            />
                          </td>
                        )}
                        {isBastionFrameDict && (
                          <td>
                            <input
                              type="checkbox"
                              checked={!!row.add_to_batch}
                              onChange={(e) => onUpdateAddToBatch(row, e.target.checked)}
                            />
                          </td>
                        )}
                        <td>
                          <div className="contractor-actions">
                            <button
                              type="button"
                              className="btn btn-sm btn-primary"
                              onClick={() => openEditConfigOption(row)}
                            >
                              Edytuj
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-danger"
                              onClick={() => handleDeleteConfigOption(row)}
                            >
                              Usuń
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {configOptionsList.length === 0 && (
                  <p className="no-results">Brak wartości w tym słowniku. Dodaj pierwszą pozycję.</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      {activeConfigSubTab === 'Wykluczenia' && isManager && (
        <div className="exclusions-section">
          <h3 className="exclusions-title">Wykluczenia pól</h3>

          <div className="exclusion-form">
            <div className="exclusion-form-row">
              <select
                value={exclusionForm.category}
                onChange={(e) => setExclusionForm((p) => ({ ...p, category: e.target.value }))}
              >
                {['STA', 'Disting', 'ST', 'Techniczne', 'Bastion'].map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>

              <select
                value={exclusionForm.source_field}
                onChange={(e) => {
                  setExclusionSourceFilter('')
                  setExclusionForm((p) => ({
                    ...p,
                    source_field: e.target.value,
                    source_values: [],
                  }))
                }}
              >
                <option value="">— pole źródłowe —</option>
                {Object.entries(EXCLUSION_FIELD_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>

              <div className="exclusion-multiselect">
                <input
                  type="text"
                  placeholder="Filtruj wartości..."
                  className="exclusion-filter-input"
                  value={exclusionSourceFilter}
                  onChange={(e) => setExclusionSourceFilter(e.target.value)}
                  disabled={!exclusionForm.source_field}
                />
                <div className="exclusion-collection-btns">
                  {[
                    'OTELLO',
                    'NICOLO',
                    'TORINO',
                    'VENTO',
                    'EZIO',
                    'LIBERTO',
                    'MARIO',
                    'FIGARO',
                    'ASTRE',
                    'PARMA',
                    'OLIVIO',
                    'VISTO',
                    'G-',
                  ].map((prefix) => {
                    const matching = availableSourceValues.filter((v) => v.startsWith(prefix))
                    if (matching.length === 0) return null
                    return (
                      <button
                        key={prefix}
                        type="button"
                        className="exclusion-collection-btn"
                        onClick={() => {
                          setExclusionForm((p) => ({
                            ...p,
                            source_values: [...new Set([...p.source_values, ...matching])],
                          }))
                        }}
                      >
                        {prefix} ({matching.length})
                      </button>
                    )
                  })}
                </div>
                <div className="exclusion-checkbox-list">
                  {availableSourceValues
                    .filter((v) => v.toLowerCase().includes(exclusionSourceFilter.toLowerCase()))
                    .map((val) => (
                      <label key={val} className="exclusion-checkbox-item">
                        <input
                          type="checkbox"
                          checked={exclusionForm.source_values.includes(val)}
                          onChange={(e) => {
                            setExclusionForm((p) => ({
                              ...p,
                              source_values: e.target.checked
                                ? [...p.source_values, val]
                                : p.source_values.filter((v) => v !== val),
                            }))
                          }}
                        />
                        {val}
                      </label>
                    ))}
                </div>
                {exclusionForm.source_values.length > 0 && (
                  <div className="exclusion-selected-count">
                    Zaznaczono: {exclusionForm.source_values.length}
                    <button
                      type="button"
                      onClick={() => setExclusionForm((p) => ({ ...p, source_values: [] }))}
                    >
                      Wyczyść
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="exclusion-form-row exclusion-form-row--target">
              <span className="exclusion-arrow">→ wyklucza →</span>

              <select
                value={exclusionForm.target_field}
                onChange={(e) =>
                  setExclusionForm((p) => ({
                    ...p,
                    target_field: e.target.value,
                    target_value: '',
                  }))
                }
              >
                <option value="">— pole docelowe —</option>
                {Object.entries(EXCLUSION_FIELD_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>

              <select
                value={exclusionForm.target_value}
                onChange={(e) => setExclusionForm((p) => ({ ...p, target_value: e.target.value }))}
                disabled={!exclusionForm.target_field}
              >
                <option value="">— wartość docelowa —</option>
                {exclusionForm.target_field &&
                  getOptionsForField(exclusionForm.category, exclusionForm.target_field).map(
                    (val: string) => (
                      <option key={val} value={val}>
                        {val}
                      </option>
                    ),
                  )}
              </select>

              <button
                type="button"
                onClick={() => void handleSaveExclusion()}
                disabled={
                  !exclusionForm.source_field ||
                  exclusionForm.source_values.length === 0 ||
                  !exclusionForm.target_field ||
                  !exclusionForm.target_value
                }
              >
                Dodaj wykluczenie
              </button>
            </div>
          </div>

          <div className="exclusion-category-filter">
            {['STA', 'Disting', 'ST', 'Techniczne', 'Bastion'].map((cat) => (
              <button
                key={cat}
                type="button"
                className={`btn btn-sm ${activeExclusionCategory === cat ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => {
                  setActiveExclusionCategory(cat)
                  setExclusionSearch('')
                }}
              >
                {cat} ({exclusions.filter((e) => e.category === cat).length})
              </button>
            ))}
          </div>

          <input
            type="text"
            className="search-input exclusion-search-input"
            placeholder="Szukaj wykluczeń (pole, wartość)..."
            value={exclusionSearch}
            onChange={(e) => setExclusionSearch(e.target.value)}
          />

          <table className="orders-table exclusions-table">
            <thead>
              <tr>
                <th>Kategoria</th>
                <th>Jeżeli pole</th>
                <th>Ma wartość</th>
                <th>To wyklucz</th>
                <th>Wartość</th>
                {isManager && <th>Akcje</th>}
              </tr>
            </thead>
            <tbody>
              {searchedExclusions.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: '#888' }}>
                    Brak wykluczeń
                  </td>
                </tr>
              ) : (
                groupedFilteredExclusions.map(([key, items]) => (
                  <Fragment key={key}>
                    <tr className="exclusion-group-header">
                      <td colSpan={5}>
                        <strong>
                          {EXCLUSION_FIELD_LABELS[items[0].source_field] ?? items[0].source_field}
                        </strong>
                        {' = '}
                        <span>{items[0].source_value}</span>
                        <span className="exclusion-group-count">({items.length} wykluczeń)</span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          onClick={() =>
                            void handleDeleteExclusionGroup(
                              activeExclusionCategory,
                              items[0].source_field,
                              items[0].source_value,
                            )
                          }
                        >
                          Usuń grupę
                        </button>
                      </td>
                    </tr>
                    {items.map((ex) => (
                      <tr key={ex.id} className="exclusion-item-row">
                        <td colSpan={2} />
                        <td>→</td>
                        <td>{EXCLUSION_FIELD_LABELS[ex.target_field] ?? ex.target_field}</td>
                        <td>{ex.target_value}</td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-sm btn-danger"
                            onClick={() => void handleDeleteExclusion(ex.id!)}
                          >
                            Usuń
                          </button>
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
      {activeConfigSubTab === 'Słownik wymiarów' && isManager && (
        <div className="exclusions-section">
          <h3 className="exclusions-title">Słownik wymiarów</h3>

          <div className="extension-map-form">
            <select
              value={dimensionMapForm.category}
              onChange={(e) => setDimensionMapForm((p) => ({ ...p, category: e.target.value }))}
            >
              {['STA', 'Disting', 'ST', 'Techniczne', 'Bastion'].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <div className="extension-map-dimension-code">
              <SearchableSelect
                value={dimensionMapForm.dimension_code}
                onChange={(v) => setDimensionMapForm((p) => ({ ...p, dimension_code: v }))}
                options={availableCodes}
                placeholder="— wybierz rozmiar —"
              />
            </div>
            <input
              type="number"
              placeholder="Szerokość (mm)"
              value={dimensionMapForm.width_mm || ''}
              onChange={(e) =>
                setDimensionMapForm((p) => ({
                  ...p,
                  width_mm: parseInt(e.target.value) || 0,
                }))
              }
            />
            <input
              type="number"
              placeholder="Wysokość STD (mm)"
              value={dimensionMapForm.height_mm === 0 ? '' : dimensionMapForm.height_mm}
              onChange={(e) =>
                setDimensionMapForm((p) => ({
                  ...p,
                  height_mm: parseInt(e.target.value) || 0,
                }))
              }
            />
            <button
              type="button"
              onClick={() => void handleSaveDimensionMap()}
              disabled={!dimensionMapForm.dimension_code}
            >
              Dodaj
            </button>
          </div>

          <table className="orders-table exclusions-table">
            <thead>
              <tr>
                <th>Kategoria</th>
                <th>Kod</th>
                <th>Szerokość (mm)</th>
                <th>Wysokość (mm)</th>
                {isManager && <th>Akcje</th>}
              </tr>
            </thead>
            <tbody>
              {dimensionMap.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: '#888' }}>
                    Brak wpisów
                  </td>
                </tr>
              ) : (
                dimensionMap.map((row) => (
                  <tr key={row.id}>
                    <td>{row.category}</td>
                    <td>{row.dimension_code}</td>
                    <td>{row.width_mm} mm</td>
                    <td>{row.height_mm} mm</td>
                    {isManager && (
                      <td>
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          onClick={() => void handleDeleteDimensionMap(row.id)}
                        >
                          Usuń
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>

          <h3 className="exclusions-title" style={{ marginTop: '1.5rem' }}>
            Rozmiary profili poszerzeń
          </h3>
          <div className="extension-map-form">
            <select
              value={extensionProfileForm.category}
              onChange={(e) =>
                setExtensionProfileForm((p) => ({ ...p, category: e.target.value }))
              }
            >
              {['STA', 'Disting', 'ST', 'Techniczne', 'Bastion'].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input
              type="number"
              placeholder="Szerokość profilu (mm)"
              value={extensionProfileForm.profile_width_mm || ''}
              onChange={(e) =>
                setExtensionProfileForm((p) => ({
                  ...p,
                  profile_width_mm: parseInt(e.target.value) || 0,
                }))
              }
              style={{ width: 180 }}
            />
            <button
              type="button"
              onClick={() => void handleSaveExtensionProfile()}
              disabled={!extensionProfileForm.profile_width_mm}
            >
              Dodaj
            </button>
          </div>
          <table className="orders-table exclusions-table">
            <thead>
              <tr>
                <th>Kategoria</th>
                <th>Szerokość profilu (mm)</th>
                {isManager && <th>Akcje</th>}
              </tr>
            </thead>
            <tbody>
              {extensionProfileWidths.map((p) => (
                <tr key={p.category}>
                  <td>{p.category}</td>
                  <td>
                    <input
                      type="number"
                      className="extension-qty-input"
                      value={p.profile_width_mm}
                      onChange={(e) =>
                        void handleUpdateExtensionProfileWidth(
                          p.category,
                          parseInt(e.target.value) || 0,
                        )
                      }
                    />
                  </td>
                  {isManager && (
                    <td>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={() => void handleDeleteExtensionProfile(p.category)}
                      >
                        Usuń
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {activeConfigSubTab === 'Naddatki szyb (naświetla)' && isManager && (
        <div className="exclusions-section">
          <h3 className="exclusions-title">Naddatki szyb</h3>
          <table className="orders-table exclusions-table">
            <thead>
              <tr>
                <th>Kategoria</th>
                <th>Element</th>
                <th>Naddatek szer. (mm)</th>
                <th>Naddatek wys. (mm)</th>
                {isManager && <th>Akcje</th>}
              </tr>
            </thead>
            <tbody>
              {glassAllowances.map((a) => (
                <tr key={a.id}>
                  <td>{a.category}</td>
                  <td>{a.element === 'top_light' ? 'Naświetle górne' : 'Dostawka boczna'}</td>
                  <td>
                    <input
                      type="number"
                      className="extension-qty-input"
                      value={a.allowance_w_mm}
                      onChange={(e) =>
                        void handleUpdateGlassAllowance(
                          a.id,
                          'allowance_w_mm',
                          parseInt(e.target.value) || 0,
                        )
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      className="extension-qty-input"
                      value={a.allowance_h_mm}
                      onChange={(e) =>
                        void handleUpdateGlassAllowance(
                          a.id,
                          'allowance_h_mm',
                          parseInt(e.target.value) || 0,
                        )
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {activeConfigSubTab === 'Dostawcy' && (
        <SuppliersConfigView
          suppliers={suppliers}
          loading={suppliersLoading}
          isManager={isManager}
          onCreate={onCreateSupplier}
          onEdit={onEditSupplier}
          onToggleActive={onToggleSupplierActive}
        />
      )}
      {activeConfigSubTab === 'Dane firmy' && isManager && (
        <CompanySettingsView
          companySettings={companySettings}
          loading={companySettingsLoading}
          isManager={isManager}
          onSaved={onCompanySettingsSaved}
          pushToast={pushToast}
        />
      )}
    </>
  )
}
