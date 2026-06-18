// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import { useEffect } from 'react'
import { EDITABLE_CATEGORIES, PRODUCTION_DAYS, type EditableCategory } from '../constants'
import SearchableConfigSelect from './SearchableConfigSelect'
import CompanyAutocomplete from './CompanyAutocomplete'
import FormInput from './FormInput'
import { getBotMetadata, getBotWarnings, isBotOrder } from '../utils/botOrder'
import { findBestCompanyMatch, isCompanyInBase } from '../utils'

type OrderFormModalProps = Record<string, unknown>

function OrderFormModal(props: OrderFormModalProps) {
  const {
    activeTab,
    usesStructuredOrderForm,
    onRequestClose,
    onPrintLabel,
    editingOrderId,
    editingOrderBaseline,
    newOrderFormNumber,
    submitOnEnterInInput,
    handleSaveOrder,
    staFormData,
    orderFormErrors,
    setHighlightedIndex,
    setOrderFormErrors,
    handleStaFormChange,
    showCompanyDropdown,
    setShowCompanyDropdown,
    filteredStaCompanies,
    handleCompanyAutocompleteKeyDown,
    handleStaCompanySelect,
    highlightedIndex,
    orderModalOptionsByType,
    isFieldValueExcluded,
    exclusions,
    staExclusionFormData,
    availableProfiles,
    calcExtensionDims,
    dimensionMap,
    isExtSideActive,
    getExtQty,
    setExtQty,
    stFormData,
    isStTitanSystemLabel,
    filteredStCompanies,
    handleStCompanySelect,
    handleStFormChange,
    stExclusionFormData,
    techniczneFormData,
    filteredTechniczneCompanies,
    handleTechniczneCompanySelect,
    handleTechniczneFormChange,
    techniczneExclusionFormData,
    bastionFormData,
    bastionFrameOptions,
    filteredBastionCompanies,
    handleBastionCompanySelect,
    handleBastionFormChange,
    bastionExclusionFormData,
    filteredCompanies,
    handleCompanySelect,
    formData,
    handleFormChange,
    legacyExclusionFormData,
    isSaving,
    onDuplicate,
    allCompanies,
    onSaveCompanyAlias,
    onCreateCompany,
  } = props

  // Ostrzeżenie o niedopasowanej firmie (gł. zamówienia z BOT-a) — tylko przy edycji/weryfikacji
  const companies = (allCompanies ?? []) as Array<{ name: string; production_day?: string; route_day?: string }>
  const renderCompanyMatchWarning = (
    companyValue: string,
    applyMatch: (name: string, productionDay: string) => void,
  ) => {
    if (editingOrderId === null) return null
    if (!companyValue || !companyValue.trim()) return null
    if (isCompanyInBase(companyValue, companies)) return null
    const match = findBestCompanyMatch(companyValue, companies)
    return (
      <div className="company-match-warning order-field-full--keep">
        <span className="company-match-warning-text">
          ⚠️ Firma „{companyValue}" nie jest rozpoznana w bazie kontrahentów — dzień trasy i dane logistyczne mogą się nie wyświetlać.
        </span>
        {match && (
          <button
            type="button"
            className="btn btn-sm btn-secondary company-match-btn"
            onClick={() => {
              // Zapamiętaj parę (nazwa z BOT → nazwa z bazy) na przyszłość
              if (typeof onSaveCompanyAlias === 'function') {
                void onSaveCompanyAlias(companyValue, match.name)
              }
              applyMatch(match.name, match.production_day ?? '')
            }}
          >
            Dopasuj do: {match.name}
          </button>
        )}
        {typeof onCreateCompany === 'function' && (
          <button
            type="button"
            className="btn btn-sm btn-primary company-match-btn"
            onClick={() => void onCreateCompany(companyValue)}
            title="Dodaj tę firmę do bazy kontrahentów"
          >
            + Utwórz kontrahenta „{companyValue}"
          </button>
        )}
      </div>
    )
  }

  const isFrameRegulated =
    bastionFormData?.frame_type?.toUpperCase().includes('REGULOWANA') ||
    bastionFormData?.frame_type?.toUpperCase().includes('REGULOWAN')

  useEffect(() => {
    if (!isFrameRegulated && bastionFormData.frame_range) {
      handleBastionFormChange('frame_range', '')
    }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bastionFormData.frame_type])

  useEffect(() => {
    if (activeTab !== 'Bastion') return
    const frameOption = bastionFrameOptions.find((o) => o.value === bastionFormData.frame_type)
    const multiplier = frameOption?.label_multiplier ?? 1
    const qty = Math.max(1, bastionFormData.quantity || 1)
    const labelQty = multiplier * qty
    if (labelQty !== bastionFormData.label_qty) {
      handleBastionFormChange('label_qty', labelQty)
    }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeTab,
    bastionFormData.frame_type,
    bastionFormData.quantity,
    bastionFormData.label_qty,
    bastionFrameOptions,
  ])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onRequestClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onRequestClose])

  const renderCategoryField = (categoryValue: string, onChange: (value: string) => void) => {
    const hasUnknownCategory =
      !!categoryValue && !EDITABLE_CATEGORIES.includes(categoryValue as EditableCategory)
    return (
      <label className="order-field-full order-field-full--keep">
        <span className="order-field-label-text">Kategoria</span>
        <select
          className="order-field-select"
          value={categoryValue ?? ''}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">— Wybierz —</option>
          {EDITABLE_CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {cat === 'DrzwiWewnetrzne' ? 'Drzwi wewnętrzne' : cat}
            </option>
          ))}
          {hasUnknownCategory && (
            <option value={categoryValue} style={{ color: 'red' }}>
              ⚠️ {categoryValue} (fikcyjna — wybierz właściwą)
            </option>
          )}
        </select>
      </label>
    )
  }

  return (
          <div className="modal-overlay" role="dialog" aria-modal="true" onClick={onRequestClose}>
            <div
              className={`order-modal ${usesStructuredOrderForm ? 'order-modal--sta' : ''}`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="order-modal-header">
                <h2>
                  {editingOrderId !== null
                    ? `Edytuj zamówienie ${editingOrderBaseline?.order_number ?? ''}`
                    : usesStructuredOrderForm
                      ? `Nowe zamówienie (${activeTab})${newOrderFormNumber ? ` - nr ${newOrderFormNumber}` : ''}`
                      : newOrderFormNumber
                        ? `Nowe zamówienie - nr ${newOrderFormNumber}`
                        : 'Nowe zamówienie'}
                </h2>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {editingOrderId !== null && onPrintLabel && (
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      onClick={() => onPrintLabel(editingOrderBaseline)}
                      title="Drukuj etykietę dla tego zlecenia"
                    >
                      🏷️ Drukuj etykietę
                    </button>
                  )}
                  <button className="btn btn-icon btn-ghost" onClick={onRequestClose}>
                    X
                  </button>
                </div>
              </div>
                            {isBotOrder(editingOrderBaseline) && (() => {
                const meta = getBotMetadata(editingOrderBaseline)
                const warnings = getBotWarnings(editingOrderBaseline)
                return (
                  <section className="bot-origin-section">
                    <h3>🤖 Pochodzenie</h3>
                    <div className="bot-origin-grid">
                      <div>
                        <strong>Źródło:</strong> Konfigurator online (BOT)
                      </div>
                      {meta?.receivedAt && (
                        <div>
                          <strong>Przyjęto:</strong> {new Date(meta.receivedAt).toLocaleString('pl-PL')}
                        </div>
                      )}
                      {meta?.ipAddress && (
                        <div>
                          <strong>IP:</strong> {meta.ipAddress}
                        </div>
                      )}
                      {meta?.apiKeyId !== undefined && (
                        <div>
                          <strong>API key:</strong> #{meta.apiKeyId}
                        </div>
                      )}
                    </div>

                    {warnings.length > 0 && (
                      <div className="bot-warnings-box">
                        <strong>⚠️ Ostrzeżenia walidacji:</strong>
                        <ul>
                          {warnings.map((w, i) => (
                            <li key={i}>{w}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {meta?.rawPayload && (
                      <details className="bot-raw-payload">
                        <summary>📦 Pełen payload z konfiguratora (raw)</summary>
                        <pre className="raw-payload-pre">{JSON.stringify(meta.rawPayload, null, 2)}</pre>
                      </details>
                    )}
                  </section>
                )
              })()}

              {activeTab === 'STA' || activeTab === 'Disting' ? (
                <>
                  {/* Wykonawca — na górze, mocno widoczny */}
                  <div className="wykonawca-picker">
                    <span className="wykonawca-picker-label">Wykonawca</span>
                    <div className="wykonawca-picker-buttons">
                      {[
                        { value: 'Center', color: '#9b1c1c' },
                        { value: 'Profil', color: '#16a34a' },
                        { value: 'WZ',     color: '#0369a1' },
                      ].map((opt) => {
                        const active = staFormData.wykonawca === opt.value
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            className="wykonawca-picker-btn"
                            style={{
                              background: active ? opt.color : 'transparent',
                              color: active ? '#fff' : opt.color,
                              borderColor: opt.color,
                            }}
                            onClick={() => handleStaFormChange('wykonawca', active ? '' : opt.value)}
                          >
                            {opt.value}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                <div
                  className="order-form-grid order-form-grid--sta"
                  onKeyDown={(e) => submitOnEnterInInput(e, () => void handleSaveOrder())}
                >
                  <label className="order-field-full order-field-full--keep">
                    <span className="order-field-label-text">Numer zlecenia</span>
                    <input readOnly className="input-readonly" value={staFormData.order_number} />
                  </label>
                  {renderCategoryField(staFormData.category ?? '', (value) =>
                    handleStaFormChange('category', value),
                  )}
                  <div className="order-field-full--keep" style={{ display: 'contents' }}>
                    <CompanyAutocomplete
                      inputId="sta-order-company-input"
                      value={staFormData.company}
                      filteredCompanies={filteredStaCompanies}
                      showDropdown={showCompanyDropdown}
                      highlightedIndex={highlightedIndex}
                      hasError={orderFormErrors.includes('company')}
                      onChange={(v) => handleStaFormChange('company', v)}
                      onSelect={handleStaCompanySelect}
                      onFocus={() => setShowCompanyDropdown(true)}
                      onKeyDown={handleCompanyAutocompleteKeyDown(
                        filteredStaCompanies,
                        handleStaCompanySelect,
                      )}
                      onHighlightChange={setHighlightedIndex}
                      onClearError={() =>
                        setOrderFormErrors((prev) => prev.filter((e) => e !== 'company'))
                      }
                    />
                  </div>

                  {renderCompanyMatchWarning(staFormData.company, (name, prodDay) => {
                    handleStaFormChange('company', name)
                    if (prodDay) handleStaFormChange('production_day', prodDay)
                  })}

                  <label className="order-field-full">
                    <span className="order-field-label-text">Dzień produkcji</span>
                    <input readOnly className="input-readonly" value={staFormData.production_day} />
                  </label>

                  <SearchableConfigSelect
                    label="System"
                    fieldKey="system"
                    value={staFormData.system}
                    onChange={(v) => handleStaFormChange('system', v)}
                    options={orderModalOptionsByType.system ?? []}
                    placeholder="— wybierz —"
                    errors={orderFormErrors}
                    onClearError={(fieldKey) =>
                      setOrderFormErrors((prev) => prev.filter((e) => e !== fieldKey))
                    }
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, staExclusionFormData, 'system', opt)
                    }
                  />
                  <SearchableConfigSelect
                    label="Model drzwi"
                    fieldKey="model"
                    value={staFormData.model}
                    onChange={(v) => handleStaFormChange('model', v)}
                    options={orderModalOptionsByType.model ?? []}
                    placeholder="— wybierz —"
                    errors={orderFormErrors}
                    onClearError={(fieldKey) =>
                      setOrderFormErrors((prev) => prev.filter((e) => e !== fieldKey))
                    }
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, staExclusionFormData, 'model', opt)
                    }
                  />
                  <SearchableConfigSelect
                    label="Kolor skrzydła"
                    fieldKey="wing_color"
                    value={staFormData.wing_color}
                    onChange={(v) => handleStaFormChange('wing_color', v)}
                    options={orderModalOptionsByType.kolor ?? []}
                    placeholder="— wybierz —"
                    errors={orderFormErrors}
                    onClearError={(fieldKey) =>
                      setOrderFormErrors((prev) => prev.filter((e) => e !== fieldKey))
                    }
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, staExclusionFormData, 'wing_color', opt)
                    }
                  />
                  <SearchableConfigSelect
                    label="Kolor ościeżnicy"
                    fieldKey="frame_color"
                    value={staFormData.frame_color}
                    onChange={(v) => handleStaFormChange('frame_color', v)}
                    options={orderModalOptionsByType.kolor ?? []}
                    placeholder="— wybierz —"
                    errors={orderFormErrors}
                    onClearError={(fieldKey) =>
                      setOrderFormErrors((prev) => prev.filter((e) => e !== fieldKey))
                    }
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, staExclusionFormData, 'frame_color', opt)
                    }
                  />
                  <SearchableConfigSelect
                    label="Kolor progu"
                    fieldKey="threshold_color"
                    value={staFormData.threshold_color}
                    onChange={(v) => handleStaFormChange('threshold_color', v)}
                    options={orderModalOptionsByType.kolor_progu ?? []}
                    placeholder="— wybierz —"
                    errors={orderFormErrors}
                    onClearError={(fieldKey) =>
                      setOrderFormErrors((prev) => prev.filter((e) => e !== fieldKey))
                    }
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, staExclusionFormData, 'threshold_color', opt)
                    }
                  />
                  <SearchableConfigSelect
                    label="Szerokość"
                    fieldKey="width"
                    value={staFormData.width}
                    onChange={(v) => handleStaFormChange('width', v)}
                    options={orderModalOptionsByType.rozmiar ?? []}
                    placeholder="— wybierz —"
                    errors={orderFormErrors}
                    onClearError={(fieldKey) =>
                      setOrderFormErrors((prev) => prev.filter((e) => e !== fieldKey))
                    }
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, staExclusionFormData, 'width', opt)
                    }
                  />

                  <SearchableConfigSelect
                    label="Kierunek"
                    fieldKey="direction"
                    value={staFormData.direction}
                    onChange={(v) => handleStaFormChange('direction', v)}
                    options={['LEWE', 'PRAWE']}
                    placeholder="— wybierz —"
                    errors={orderFormErrors}
                    onClearError={(fieldKey) =>
                      setOrderFormErrors((prev) => prev.filter((e) => e !== fieldKey))
                    }
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, staExclusionFormData, 'direction', opt)
                    }
                  />

                  <SearchableConfigSelect
                    label="Wysokość"
                    fieldKey="height"
                    value={staFormData.height}
                    onChange={(v) => handleStaFormChange('height', v)}
                    options={orderModalOptionsByType.wysokosc ?? []}
                    placeholder="— wybierz —"
                    errors={orderFormErrors}
                    onClearError={(fieldKey) =>
                      setOrderFormErrors((prev) => prev.filter((e) => e !== fieldKey))
                    }
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, staExclusionFormData, 'height', opt)
                    }
                  />

                  <SearchableConfigSelect
                    label="Otwieranie"
                    fieldKey="opening"
                    value={staFormData.opening}
                    onChange={(v) => handleStaFormChange('opening', v)}
                    options={['ONZ', 'ODW']}
                    placeholder="— wybierz —"
                    errors={orderFormErrors}
                    onClearError={(fieldKey) =>
                      setOrderFormErrors((prev) => prev.filter((e) => e !== fieldKey))
                    }
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, staExclusionFormData, 'opening', opt)
                    }
                  />

                  <SearchableConfigSelect
                    label="Szklenie"
                    fieldKey="glazing"
                    value={staFormData.glazing}
                    onChange={(v) => handleStaFormChange('glazing', v)}
                    options={orderModalOptionsByType.szklenie ?? []}
                    placeholder="— wybierz —"
                    errors={orderFormErrors}
                    onClearError={(fieldKey) =>
                      setOrderFormErrors((prev) => prev.filter((e) => e !== fieldKey))
                    }
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, staExclusionFormData, 'glazing', opt)
                    }
                  />
                  <SearchableConfigSelect
                    label="Panel dekoracyjny"
                    value={staFormData.decorative_panel}
                    onChange={(v) => handleStaFormChange('decorative_panel', v)}
                    options={orderModalOptionsByType.panel ?? []}
                    placeholder="— wybierz —"
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, staExclusionFormData, 'decorative_panel', opt)
                    }
                  />

                  <label className="order-field-full order-field-full--keep">
                    <span className="order-field-label-text">Naświetle górne (mm)</span>
                    <div className="order-inline-pair">
                      <input
                        type="text"
                        readOnly
                        value={staFormData.top_light_w_mm || '—'}
                        className="order-field-readonly-computed"
                        title="Obliczane automatycznie na podstawie rozmiaru drzwi, dostawek i poszerzeń"
                      />
                      <input
                        type="number"
                        placeholder="Wysokość"
                        value={staFormData.top_light_h_mm}
                        onChange={(e) => handleStaFormChange('top_light_h_mm', e.target.value)}
                      />
                    </div>
                  </label>

                  <SearchableConfigSelect
                    label="Szklenie naświetla górnego"
                    fieldKey="top_light_glazing"
                    value={staFormData.top_light_glazing}
                    onChange={(v) => handleStaFormChange('top_light_glazing', v)}
                    options={orderModalOptionsByType.szklenie_dostawki ?? []}
                    placeholder="— wybierz —"
                    disabled={!staFormData.top_light_h_mm?.toString().trim()}
                    errors={orderFormErrors}
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, staExclusionFormData, 'top_light_glazing', opt)
                    }
                  />

                  <div className="order-field-full order-field-full--keep">
                    <span className="order-field-label-text">Dostawka boczna A (mm)</span>
                    <div className="order-field-row">
                      <input
                        type="number"
                        placeholder="Szerokość A"
                        value={staFormData.side_panel_a_w_mm}
                        onChange={(e) => handleStaFormChange('side_panel_a_w_mm', e.target.value)}
                      />
                      <input
                        type="text"
                        readOnly
                        placeholder="Wysokość"
                        value={staFormData.side_panel_h_mm || '—'}
                        className="order-field-readonly-computed"
                        title="Obliczana automatycznie z wysokości drzwi"
                      />
                    </div>
                  </div>

                  <SearchableConfigSelect
                    label="Szklenie dostawki A"
                    fieldKey="side_panel_a_glazing"
                    value={staFormData.side_panel_a_glazing}
                    onChange={(v) => handleStaFormChange('side_panel_a_glazing', v)}
                    options={orderModalOptionsByType.szklenie_dostawki ?? []}
                    placeholder="— wybierz —"
                    disabled={!staFormData.side_panel_a_w_mm.trim()}
                    errors={orderFormErrors}
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, staExclusionFormData, 'side_panel_a_glazing', opt)
                    }
                  />

                  <div className="order-field-full order-field-full--keep">
                    <span className="order-field-label-text">Dostawka boczna B (mm)</span>
                    <div className="order-field-row">
                      <input
                        type="number"
                        placeholder="Szerokość B"
                        value={staFormData.side_panel_b_w_mm}
                        onChange={(e) => handleStaFormChange('side_panel_b_w_mm', e.target.value)}
                      />
                      <input
                        type="text"
                        readOnly
                        placeholder="Wysokość"
                        value={staFormData.side_panel_h_mm || '—'}
                        className="order-field-readonly-computed"
                        title="Wspólna wysokość dostawek (taka sama jak A)"
                      />
                    </div>
                  </div>

                  <SearchableConfigSelect
                    label="Szklenie dostawki B"
                    fieldKey="side_panel_b_glazing"
                    value={staFormData.side_panel_b_glazing}
                    onChange={(v) => handleStaFormChange('side_panel_b_glazing', v)}
                    options={orderModalOptionsByType.szklenie ?? []}
                    placeholder="— wybierz —"
                    disabled={!staFormData.side_panel_b_w_mm.trim()}
                    errors={orderFormErrors}
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, staExclusionFormData, 'side_panel_b_glazing', opt)
                    }
                  />

                  <div className="order-field-full order-field-full--keep">
                    <span className="order-field-label-text">Poszerzenie ościeżnicy</span>
                    <table className="extension-table">
                      <thead>
                        <tr>
                          <th>Strona</th>
                          {availableProfiles.map((w) => (
                            <th key={w}>Ilość {w}mm</th>
                          ))}
                          <th>Wymiar (mm)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {([
                          {
                            key: 'a',
                            label: 'A — przeciwzawiasowa',
                            dim: calcExtensionDims(
                              staFormData.width,
                              staFormData.height,
                              activeTab,
                              dimensionMap,
                            ).sideDim,
                          },
                          {
                            key: 'b',
                            label: 'B — zawiasowa',
                            dim: calcExtensionDims(
                              staFormData.width,
                              staFormData.height,
                              activeTab,
                              dimensionMap,
                            ).sideDim,
                          },
                          {
                            key: 'top',
                            label: 'Góra',
                            dim: calcExtensionDims(
                              staFormData.width,
                              staFormData.height,
                              activeTab,
                              dimensionMap,
                            ).topDim,
                          },
                        ] as const).map(({ key, label, dim }) => {
                          return (
                            <tr
                              key={key}
                              className={isExtSideActive(staFormData.extension_qtys, key) ? 'extension-row--active' : ''}
                            >
                              <td className="extension-col-label">{label}</td>
                              {availableProfiles.map((w) => {
                                return (
                                  <td className="extension-col-qty" key={`${key}-${w}`}>
                                    <input
                                      type="number"
                                      min={0}
                                      max={10}
                                      value={getExtQty(staFormData.extension_qtys, key, w)}
                                      className="extension-qty-input"
                                      onChange={(e) =>
                                        handleStaFormChange(
                                          'extension_qtys',
                                          setExtQty(
                                            staFormData.extension_qtys,
                                            key,
                                            w,
                                            Math.max(0, parseInt(e.target.value) || 0),
                                          ),
                                        )
                                      }
                                    />
                                  </td>
                                )
                              })}
                              <td className="extension-col-dim">
                                {isExtSideActive(staFormData.extension_qtys, key) && dim ? (
                                  <span className="extension-dim-badge">{dim} mm</span>
                                ) : (
                                  <span className="extension-col-empty">—</span>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>

                  <SearchableConfigSelect
                    label="Wizjer"
                    value={staFormData.peephole}
                    onChange={(v) => handleStaFormChange('peephole', v)}
                    options={orderModalOptionsByType.wizjer ?? []}
                    placeholder="— wybierz —"
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, staExclusionFormData, 'peephole', opt)
                    }
                  />
                  <SearchableConfigSelect
                    label="Okucia"
                    fieldKey="hardware"
                    value={staFormData.hardware}
                    onChange={(v) => handleStaFormChange('hardware', v)}
                    options={orderModalOptionsByType.okucia ?? []}
                    placeholder="— wybierz —"
                    errors={orderFormErrors}
                    onClearError={(fieldKey) =>
                      setOrderFormErrors((prev) => prev.filter((e) => e !== fieldKey))
                    }
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, staExclusionFormData, 'hardware', opt)
                    }
                  />
                  <SearchableConfigSelect
                    label="Pochwyt"
                    fieldKey="handle"
                    value={staFormData.handle}
                    onChange={(v) => handleStaFormChange('handle', v)}
                    options={orderModalOptionsByType.pochwyt ?? []}
                    placeholder="— wybierz —"
                    errors={orderFormErrors}
                    onClearError={(fieldKey) =>
                      setOrderFormErrors((prev) => prev.filter((e) => e !== fieldKey))
                    }
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, staExclusionFormData, 'handle', opt)
                    }
                  />
                  <SearchableConfigSelect
                    label="Osłonki"
                    value={staFormData.oslonki}
                    onChange={(v) => handleStaFormChange('oslonki', v)}
                    options={orderModalOptionsByType.oslonki ?? []}
                    placeholder="— wybierz —"
                  />
                  <SearchableConfigSelect
                    label="Zaczep"
                    value={staFormData.zaczep}
                    onChange={(v) => handleStaFormChange('zaczep', v)}
                    options={orderModalOptionsByType.zaczep ?? []}
                    placeholder="— wybierz —"
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, staExclusionFormData, 'electric_strike', opt)
                    }
                  />

                  <FormInput
                    label="Ilość"
                    type="number"
                    value={staFormData.quantity}
                    onChange={(v) =>
                      handleStaFormChange('quantity', Math.max(1, Number(v) || 1))
                    }
                  />

                  <div className="order-field-full--keep" style={{ display: 'contents' }}>
                    <FormInput
                      label="Uwagi"
                      type="textarea"
                      rows={3}
                      value={staFormData.notes}
                      onChange={(v) => handleStaFormChange('notes', v)}
                    />
                  </div>

                  <FormInput
                    label="Numer zamówienia klienta"
                    value={staFormData.client_order_number}
                    onChange={(v) => handleStaFormChange('client_order_number', v)}
                  />

                </div>
                </>
              ) : activeTab === 'ST' ? (
                <div
                  className="order-form-grid order-form-grid--sta"
                  onKeyDown={(e) => submitOnEnterInInput(e, () => void handleSaveOrder())}
                >
                  <label className="order-field-full">
                    <span className="order-field-label-text">Numer zlecenia</span>
                    <input readOnly className="input-readonly" value={stFormData.order_number} />
                  </label>
                  {renderCategoryField(stFormData.category ?? '', (value) =>
                    handleStFormChange('category', value),
                  )}
                  {(String(stFormData.sta_ref ?? '').trim() !== '' ||
                    isStTitanSystemLabel(stFormData.system)) && (
                    <label className="order-field-full">
                      <span className="order-field-label-text">Numer zamówienia STA (powiązanie)</span>
                      <input readOnly className="input-readonly" value={stFormData.sta_ref} />
                    </label>
                  )}
                  <CompanyAutocomplete
                    inputId="st-order-company-input"
                    value={stFormData.company}
                    filteredCompanies={filteredStCompanies}
                    showDropdown={showCompanyDropdown}
                    highlightedIndex={highlightedIndex}
                    hasError={orderFormErrors.includes('company')}
                    onChange={(v) => handleStFormChange('company', v)}
                    onSelect={handleStCompanySelect}
                    onFocus={() => setShowCompanyDropdown(true)}
                    onKeyDown={handleCompanyAutocompleteKeyDown(
                      filteredStCompanies,
                      handleStCompanySelect,
                    )}
                    onHighlightChange={setHighlightedIndex}
                    onClearError={() =>
                      setOrderFormErrors((prev) => prev.filter((e) => e !== 'company'))
                    }
                  />

                  <label className="order-field-full">
                    <span className="order-field-label-text">Dzień produkcji</span>
                    <input readOnly className="input-readonly" value={stFormData.production_day} />
                  </label>

                  <SearchableConfigSelect
                    label="System"
                    fieldKey="system"
                    value={stFormData.system}
                    onChange={(v) => handleStFormChange('system', v)}
                    options={orderModalOptionsByType.system ?? []}
                    placeholder="— wybierz —"
                    errors={orderFormErrors}
                    onClearError={(fieldKey) =>
                      setOrderFormErrors((prev) => prev.filter((e) => e !== fieldKey))
                    }
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, stExclusionFormData, 'system', opt)
                    }
                  />
                  <SearchableConfigSelect
                    label="Model drzwi"
                    fieldKey="model"
                    value={stFormData.model}
                    onChange={(v) => handleStFormChange('model', v)}
                    options={orderModalOptionsByType.model ?? []}
                    placeholder="— wybierz —"
                    errors={orderFormErrors}
                    onClearError={(fieldKey) =>
                      setOrderFormErrors((prev) => prev.filter((e) => e !== fieldKey))
                    }
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, stExclusionFormData, 'model', opt)
                    }
                  />
                  <SearchableConfigSelect
                    label="Kolor"
                    fieldKey="wing_color"
                    value={stFormData.wing_color}
                    onChange={(v) => handleStFormChange('wing_color', v)}
                    options={orderModalOptionsByType.kolor ?? []}
                    placeholder="— wybierz —"
                    errors={orderFormErrors}
                    onClearError={(fieldKey) =>
                      setOrderFormErrors((prev) => prev.filter((e) => e !== fieldKey))
                    }
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, stExclusionFormData, 'wing_color', opt)
                    }
                  />
                  <SearchableConfigSelect
                    label="Kolor progu"
                    value={stFormData.threshold_color}
                    onChange={(v) => handleStFormChange('threshold_color', v)}
                    options={orderModalOptionsByType.kolor_progu ?? []}
                    placeholder="— wybierz —"
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, stExclusionFormData, 'threshold_color', opt)
                    }
                  />
                  <SearchableConfigSelect
                    label="Szerokość"
                    fieldKey="width"
                    value={stFormData.width}
                    onChange={(v) => handleStFormChange('width', v)}
                    options={orderModalOptionsByType.rozmiar ?? []}
                    placeholder="— wybierz —"
                    errors={orderFormErrors}
                    onClearError={(fieldKey) =>
                      setOrderFormErrors((prev) => prev.filter((e) => e !== fieldKey))
                    }
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, stExclusionFormData, 'width', opt)
                    }
                  />

                  <SearchableConfigSelect
                    label="Kierunek"
                    fieldKey="direction"
                    value={stFormData.direction}
                    onChange={(v) => handleStFormChange('direction', v)}
                    options={['LEWE', 'PRAWE']}
                    placeholder="— wybierz —"
                    errors={orderFormErrors}
                    onClearError={(fieldKey) =>
                      setOrderFormErrors((prev) => prev.filter((e) => e !== fieldKey))
                    }
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, stExclusionFormData, 'direction', opt)
                    }
                  />

                  <SearchableConfigSelect
                    label="Wysokość"
                    fieldKey="height"
                    value={stFormData.height}
                    onChange={(v) => handleStFormChange('height', v)}
                    options={orderModalOptionsByType.wysokosc ?? []}
                    placeholder="— wybierz —"
                    errors={orderFormErrors}
                    onClearError={(fieldKey) =>
                      setOrderFormErrors((prev) => prev.filter((e) => e !== fieldKey))
                    }
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, stExclusionFormData, 'height', opt)
                    }
                  />

                  <SearchableConfigSelect
                    label="Otwieranie"
                    fieldKey="opening"
                    value={stFormData.opening}
                    onChange={(v) => handleStFormChange('opening', v)}
                    options={['ONZ', 'ODW']}
                    placeholder="— wybierz —"
                    errors={orderFormErrors}
                    onClearError={(fieldKey) =>
                      setOrderFormErrors((prev) => prev.filter((e) => e !== fieldKey))
                    }
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, stExclusionFormData, 'opening', opt)
                    }
                  />

                  <SearchableConfigSelect
                    label="Szklenie"
                    fieldKey="glazing"
                    value={stFormData.glazing}
                    onChange={(v) => handleStFormChange('glazing', v)}
                    options={orderModalOptionsByType.szklenie ?? []}
                    placeholder="— wybierz —"
                    errors={orderFormErrors}
                    onClearError={(fieldKey) =>
                      setOrderFormErrors((prev) => prev.filter((e) => e !== fieldKey))
                    }
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, stExclusionFormData, 'glazing', opt)
                    }
                  />
                  <SearchableConfigSelect
                    label="Wizjer"
                    value={stFormData.peephole}
                    onChange={(v) => handleStFormChange('peephole', v)}
                    options={orderModalOptionsByType.wizjer ?? []}
                    placeholder="— wybierz —"
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, stExclusionFormData, 'peephole', opt)
                    }
                  />
                  <SearchableConfigSelect
                    label="Okucia"
                    fieldKey="hardware"
                    value={stFormData.hardware}
                    onChange={(v) => handleStFormChange('hardware', v)}
                    options={orderModalOptionsByType.okucia ?? []}
                    placeholder="— wybierz —"
                    errors={orderFormErrors}
                    onClearError={(fieldKey) =>
                      setOrderFormErrors((prev) => prev.filter((e) => e !== fieldKey))
                    }
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, stExclusionFormData, 'hardware', opt)
                    }
                  />
                  <SearchableConfigSelect
                    label="Próg Technic"
                    value={stFormData.extension}
                    onChange={(v) => handleStFormChange('extension', v)}
                    options={orderModalOptionsByType.prog ?? []}
                    placeholder="— wybierz —"
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, stExclusionFormData, 'extension', opt)
                    }
                  />
                  <SearchableConfigSelect
                    label="Pochwyt"
                    fieldKey="handle"
                    value={stFormData.handle}
                    onChange={(v) => handleStFormChange('handle', v)}
                    options={orderModalOptionsByType.pochwyt ?? []}
                    placeholder="— wybierz —"
                    errors={orderFormErrors}
                    onClearError={(fieldKey) =>
                      setOrderFormErrors((prev) => prev.filter((e) => e !== fieldKey))
                    }
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, stExclusionFormData, 'handle', opt)
                    }
                  />

                  <FormInput
                    label="Ilość"
                    type="number"
                    value={stFormData.quantity}
                    onChange={(v) =>
                      handleStFormChange('quantity', Math.max(1, Number(v) || 1))
                    }
                  />

                  <FormInput
                    label="Uwagi"
                    type="textarea"
                    rows={3}
                    value={stFormData.notes}
                    onChange={(v) => handleStFormChange('notes', v)}
                  />

                  <FormInput
                    label="Numer zamówienia klienta"
                    value={stFormData.client_order_number}
                    onChange={(v) => handleStFormChange('client_order_number', v)}
                  />
                </div>
              ) : activeTab === 'Techniczne' ? (
                <div
                  className="order-form-grid order-form-grid--sta"
                  onKeyDown={(e) => submitOnEnterInInput(e, () => void handleSaveOrder())}
                >
                  <label className="order-field-full">
                    <span className="order-field-label-text">Numer zlecenia</span>
                    <input readOnly className="input-readonly" value={techniczneFormData.order_number} />
                  </label>
                  {renderCategoryField(techniczneFormData.category ?? '', (value) =>
                    handleTechniczneFormChange('category', value),
                  )}
                  <CompanyAutocomplete
                    inputId="tech-order-company-input"
                    value={techniczneFormData.company}
                    filteredCompanies={filteredTechniczneCompanies}
                    showDropdown={showCompanyDropdown}
                    highlightedIndex={highlightedIndex}
                    hasError={orderFormErrors.includes('company')}
                    onChange={(v) => handleTechniczneFormChange('company', v)}
                    onSelect={handleTechniczneCompanySelect}
                    onFocus={() => setShowCompanyDropdown(true)}
                    onKeyDown={handleCompanyAutocompleteKeyDown(
                      filteredTechniczneCompanies,
                      handleTechniczneCompanySelect,
                    )}
                    onHighlightChange={setHighlightedIndex}
                    onClearError={() =>
                      setOrderFormErrors((prev) => prev.filter((e) => e !== 'company'))
                    }
                  />

                  <label className="order-field-full">
                    <span className="order-field-label-text">Dzień produkcji</span>
                    <input readOnly className="input-readonly" value={techniczneFormData.production_day} />
                  </label>

                  <SearchableConfigSelect
                    label="System"
                    fieldKey="system"
                    value={techniczneFormData.system}
                    onChange={(v) => handleTechniczneFormChange('system', v)}
                    options={orderModalOptionsByType.system ?? []}
                    placeholder="— wybierz —"
                    errors={orderFormErrors}
                    onClearError={(fieldKey) =>
                      setOrderFormErrors((prev) => prev.filter((e) => e !== fieldKey))
                    }
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, techniczneExclusionFormData, 'system', opt)
                    }
                  />
                  <SearchableConfigSelect
                    label="Model"
                    fieldKey="model"
                    value={techniczneFormData.model}
                    onChange={(v) => handleTechniczneFormChange('model', v)}
                    options={orderModalOptionsByType.model ?? []}
                    placeholder="— wybierz —"
                    errors={orderFormErrors}
                    onClearError={(fieldKey) =>
                      setOrderFormErrors((prev) => prev.filter((e) => e !== fieldKey))
                    }
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, techniczneExclusionFormData, 'model', opt)
                    }
                  />
                  <SearchableConfigSelect
                    label="Kolor"
                    fieldKey="wing_color"
                    value={techniczneFormData.wing_color}
                    onChange={(v) => handleTechniczneFormChange('wing_color', v)}
                    options={orderModalOptionsByType.kolor ?? []}
                    placeholder="— wybierz —"
                    errors={orderFormErrors}
                    onClearError={(fieldKey) =>
                      setOrderFormErrors((prev) => prev.filter((e) => e !== fieldKey))
                    }
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, techniczneExclusionFormData, 'wing_color', opt)
                    }
                  />
                  <SearchableConfigSelect
                    label="Próg"
                    value={techniczneFormData.threshold_color}
                    onChange={(v) => handleTechniczneFormChange('threshold_color', v)}
                    options={orderModalOptionsByType.kolor_progu ?? []}
                    placeholder="— wybierz —"
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, techniczneExclusionFormData, 'threshold_color', opt)
                    }
                  />
                  <SearchableConfigSelect
                    label="Szerokość"
                    fieldKey="width"
                    value={techniczneFormData.width}
                    onChange={(v) => handleTechniczneFormChange('width', v)}
                    options={orderModalOptionsByType.rozmiar ?? []}
                    placeholder="— wybierz —"
                    errors={orderFormErrors}
                    onClearError={(fieldKey) =>
                      setOrderFormErrors((prev) => prev.filter((e) => e !== fieldKey))
                    }
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, techniczneExclusionFormData, 'width', opt)
                    }
                  />

                  <SearchableConfigSelect
                    label="Kierunek"
                    fieldKey="direction"
                    value={techniczneFormData.direction}
                    onChange={(v) => handleTechniczneFormChange('direction', v)}
                    options={['LEWE', 'PRAWE']}
                    placeholder="— wybierz —"
                    errors={orderFormErrors}
                    onClearError={(fieldKey) =>
                      setOrderFormErrors((prev) => prev.filter((e) => e !== fieldKey))
                    }
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, techniczneExclusionFormData, 'direction', opt)
                    }
                  />

                  <SearchableConfigSelect
                    label="Otwieranie"
                    fieldKey="opening"
                    value={techniczneFormData.opening}
                    onChange={(v) => handleTechniczneFormChange('opening', v)}
                    options={['ONZ', 'ODW']}
                    placeholder="— wybierz —"
                    errors={orderFormErrors}
                    onClearError={(fieldKey) =>
                      setOrderFormErrors((prev) => prev.filter((e) => e !== fieldKey))
                    }
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, techniczneExclusionFormData, 'opening', opt)
                    }
                  />

                  <SearchableConfigSelect
                    label="Wysokość"
                    fieldKey="height"
                    value={techniczneFormData.height}
                    onChange={(v) => handleTechniczneFormChange('height', v)}
                    options={orderModalOptionsByType.wysokosc ?? []}
                    placeholder="— wybierz —"
                    errors={orderFormErrors}
                    onClearError={(fieldKey) =>
                      setOrderFormErrors((prev) => prev.filter((e) => e !== fieldKey))
                    }
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, techniczneExclusionFormData, 'height', opt)
                    }
                  />
                  <SearchableConfigSelect
                    label="Szklenie"
                    value={techniczneFormData.glazing}
                    onChange={(v) => handleTechniczneFormChange('glazing', v)}
                    options={orderModalOptionsByType.szklenie ?? []}
                    placeholder="— wybierz —"
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, techniczneExclusionFormData, 'glazing', opt)
                    }
                  />
                  <SearchableConfigSelect
                    label="Okucia"
                    value={techniczneFormData.hardware}
                    onChange={(v) => handleTechniczneFormChange('hardware', v)}
                    options={orderModalOptionsByType.okucia ?? []}
                    placeholder="— wybierz —"
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, techniczneExclusionFormData, 'hardware', opt)
                    }
                  />
                  <SearchableConfigSelect
                    label="Pochwyt"
                    value={techniczneFormData.handle}
                    onChange={(v) => handleTechniczneFormChange('handle', v)}
                    options={orderModalOptionsByType.pochwyt ?? []}
                    placeholder="— wybierz —"
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, techniczneExclusionFormData, 'handle', opt)
                    }
                  />
                  <SearchableConfigSelect
                    label="Wizjer"
                    value={techniczneFormData.peephole}
                    onChange={(v) => handleTechniczneFormChange('peephole', v)}
                    options={orderModalOptionsByType.wizjer ?? []}
                    placeholder="— wybierz —"
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, techniczneExclusionFormData, 'peephole', opt)
                    }
                  />

                  <FormInput
                    label="Ilość"
                    type="number"
                    value={techniczneFormData.quantity}
                    onChange={(v) =>
                      handleTechniczneFormChange('quantity', Math.max(1, Number(v) || 1))
                    }
                  />

                  <FormInput
                    label="Uwagi"
                    type="textarea"
                    rows={3}
                    value={techniczneFormData.notes}
                    onChange={(v) => handleTechniczneFormChange('notes', v)}
                  />

                  <FormInput
                    label="Numer zamówienia klienta"
                    value={techniczneFormData.client_order_number}
                    onChange={(v) => handleTechniczneFormChange('client_order_number', v)}
                  />
                </div>
              ) : activeTab === 'Bastion' ? (
                <div
                  className="order-form-grid order-form-grid--sta"
                  onKeyDown={(e) => submitOnEnterInInput(e, () => void handleSaveOrder())}
                >
                  <label className="order-field-full">
                    <span className="order-field-label-text">Numer zlecenia</span>
                    <input readOnly className="input-readonly" value={bastionFormData.order_number} />
                  </label>
                  {renderCategoryField(bastionFormData.category ?? '', (value) =>
                    handleBastionFormChange('category', value),
                  )}
                  <CompanyAutocomplete
                    inputId="bastion-order-company-input"
                    value={bastionFormData.company}
                    filteredCompanies={filteredBastionCompanies}
                    showDropdown={showCompanyDropdown}
                    highlightedIndex={highlightedIndex}
                    hasError={orderFormErrors.includes('company')}
                    onChange={(v) => handleBastionFormChange('company', v)}
                    onSelect={handleBastionCompanySelect}
                    onFocus={() => setShowCompanyDropdown(true)}
                    onKeyDown={handleCompanyAutocompleteKeyDown(
                      filteredBastionCompanies,
                      handleBastionCompanySelect,
                    )}
                    onHighlightChange={setHighlightedIndex}
                    onClearError={() =>
                      setOrderFormErrors((prev) => prev.filter((e) => e !== 'company'))
                    }
                  />

                  <label className="order-field-full">
                    <span className="order-field-label-text">Dzień produkcji</span>
                    <input readOnly className="input-readonly" value={bastionFormData.production_day} />
                  </label>

                  <SearchableConfigSelect
                    label="Kolekcja"
                    value={bastionFormData.collection}
                    onChange={(v) => handleBastionFormChange('collection', v)}
                    options={orderModalOptionsByType.kolekcja ?? []}
                    placeholder="— wybierz —"
                  />

                  <SearchableConfigSelect
                    label="System"
                    fieldKey="system"
                    value={bastionFormData.system}
                    onChange={(v) => handleBastionFormChange('system', v)}
                    options={orderModalOptionsByType.system ?? []}
                    placeholder="— wybierz —"
                    errors={orderFormErrors}
                    onClearError={(fieldKey) =>
                      setOrderFormErrors((prev) => prev.filter((e) => e !== fieldKey))
                    }
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, bastionExclusionFormData, 'system', opt)
                    }
                  />
                  <SearchableConfigSelect
                    label="Model"
                    fieldKey="model"
                    value={bastionFormData.model}
                    onChange={(v) => handleBastionFormChange('model', v)}
                    options={orderModalOptionsByType.model ?? []}
                    placeholder="— wybierz —"
                    errors={orderFormErrors}
                    onClearError={(fieldKey) =>
                      setOrderFormErrors((prev) => prev.filter((e) => e !== fieldKey))
                    }
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, bastionExclusionFormData, 'model', opt)
                    }
                  />

                  <SearchableConfigSelect
                    label="Kolor skrzydła"
                    fieldKey="wing_color"
                    value={bastionFormData.wing_color}
                    onChange={(v) => handleBastionFormChange('wing_color', v)}
                    options={orderModalOptionsByType.kolor ?? []}
                    placeholder="— wybierz —"
                    errors={orderFormErrors}
                    onClearError={(fieldKey) =>
                      setOrderFormErrors((prev) => prev.filter((e) => e !== fieldKey))
                    }
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, bastionExclusionFormData, 'wing_color', opt)
                    }
                  />

                  <SearchableConfigSelect
                    label="Kolor ościeżnicy"
                    fieldKey="frame_color"
                    value={bastionFormData.frame_color}
                    onChange={(v) => handleBastionFormChange('frame_color', v)}
                    options={orderModalOptionsByType.kolor_oscieznicy ?? orderModalOptionsByType.kolor ?? []}
                    placeholder="— wybierz —"
                    errors={orderFormErrors}
                    onClearError={(fieldKey) =>
                      setOrderFormErrors((prev) => prev.filter((e) => e !== fieldKey))
                    }
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, bastionExclusionFormData, 'frame_color', opt)
                    }
                  />

                  <SearchableConfigSelect
                    label="Ościeżnica/Zabudowa"
                    value={bastionFormData.frame_type}
                    onChange={(v) => handleBastionFormChange('frame_type', v)}
                    options={orderModalOptionsByType.oscieznica ?? []}
                    placeholder="— wybierz —"
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, bastionExclusionFormData, 'decorative_panel', opt)
                    }
                  />

                  {isFrameRegulated && (
                    <SearchableConfigSelect
                      label="Zakres ościeżnicy"
                      value={bastionFormData.frame_range}
                      onChange={(v) => handleBastionFormChange('frame_range', v)}
                      options={orderModalOptionsByType.zakres ?? []}
                      placeholder="— wybierz —"
                    />
                  )}

                  <SearchableConfigSelect
                    label="Kolor progu"
                    fieldKey="threshold_color"
                    value={bastionFormData.threshold_color}
                    onChange={(v) => handleBastionFormChange('threshold_color', v)}
                    options={orderModalOptionsByType.kolor_progu ?? []}
                    placeholder="— wybierz —"
                    errors={orderFormErrors}
                    onClearError={(fieldKey) =>
                      setOrderFormErrors((prev) => prev.filter((e) => e !== fieldKey))
                    }
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, bastionExclusionFormData, 'threshold_color', opt)
                    }
                  />
                  <SearchableConfigSelect
                    label="Szerokość"
                    fieldKey="width"
                    value={bastionFormData.width}
                    onChange={(v) => handleBastionFormChange('width', v)}
                    options={orderModalOptionsByType.rozmiar ?? []}
                    placeholder="— wybierz —"
                    errors={orderFormErrors}
                    onClearError={(fieldKey) =>
                      setOrderFormErrors((prev) => prev.filter((e) => e !== fieldKey))
                    }
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, bastionExclusionFormData, 'width', opt)
                    }
                  />

                  <SearchableConfigSelect
                    label="Kierunek"
                    fieldKey="direction"
                    value={bastionFormData.direction}
                    onChange={(v) => handleBastionFormChange('direction', v)}
                    options={['LEWE', 'PRAWE']}
                    placeholder="— wybierz —"
                    errors={orderFormErrors}
                    onClearError={(fieldKey) =>
                      setOrderFormErrors((prev) => prev.filter((e) => e !== fieldKey))
                    }
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, bastionExclusionFormData, 'direction', opt)
                    }
                  />

                  <SearchableConfigSelect
                    label="Wysokość"
                    fieldKey="height"
                    value={bastionFormData.height}
                    onChange={(v) => handleBastionFormChange('height', v)}
                    options={orderModalOptionsByType.wysokosc ?? []}
                    placeholder="— wybierz —"
                    errors={orderFormErrors}
                    onClearError={(fieldKey) =>
                      setOrderFormErrors((prev) => prev.filter((e) => e !== fieldKey))
                    }
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, bastionExclusionFormData, 'height', opt)
                    }
                  />

                  <SearchableConfigSelect
                    label="Otwieranie"
                    fieldKey="opening"
                    value={bastionFormData.opening}
                    onChange={(v) => handleBastionFormChange('opening', v)}
                    options={['ONZ', 'ONW']}
                    placeholder="— wybierz —"
                    errors={orderFormErrors}
                    onClearError={(fieldKey) =>
                      setOrderFormErrors((prev) => prev.filter((e) => e !== fieldKey))
                    }
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, bastionExclusionFormData, 'opening', opt)
                    }
                  />

                  <SearchableConfigSelect
                    label="Lacobel/Szklenie"
                    fieldKey="glazing"
                    value={bastionFormData.glazing}
                    onChange={(v) => handleBastionFormChange('glazing', v)}
                    options={orderModalOptionsByType.szklenie ?? []}
                    placeholder="— wybierz —"
                    errors={orderFormErrors}
                    onClearError={(fieldKey) =>
                      setOrderFormErrors((prev) => prev.filter((e) => e !== fieldKey))
                    }
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, bastionExclusionFormData, 'glazing', opt)
                    }
                  />

                  <SearchableConfigSelect
                    label="Wizjer/zamek"
                    value={bastionFormData.peephole}
                    onChange={(v) => handleBastionFormChange('peephole', v)}
                    options={orderModalOptionsByType.wizjer ?? []}
                    placeholder="— wybierz —"
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, bastionExclusionFormData, 'peephole', opt)
                    }
                  />
                  <SearchableConfigSelect
                    label="Okucia"
                    fieldKey="hardware"
                    value={bastionFormData.hardware}
                    onChange={(v) => handleBastionFormChange('hardware', v)}
                    options={orderModalOptionsByType.okucia ?? []}
                    placeholder="— wybierz —"
                    errors={orderFormErrors}
                    onClearError={(fieldKey) =>
                      setOrderFormErrors((prev) => prev.filter((e) => e !== fieldKey))
                    }
                    isOptionDisabled={(opt) =>
                      isFieldValueExcluded(exclusions, activeTab, bastionExclusionFormData, 'hardware', opt)
                    }
                  />

                  <FormInput
                    label="Ilość"
                    type="number"
                    value={bastionFormData.quantity}
                    onChange={(v) =>
                      handleBastionFormChange(
                        'quantity',
                        Math.max(1, Number(v) || 1),
                      )
                    }
                  />

                  <label className="order-field-full">
                    <span className="order-field-label-text">Ilość etykiet (automatycznie)</span>
                    <input
                      readOnly
                      className="input-readonly"
                      value={bastionFormData.label_qty || 0}
                      title="Obliczane: mnożnik ościeżnicy × ilość drzwi"
                    />
                  </label>

                  <label className="order-field-full order-field-checkbox">
                    <span className="order-field-label-text">PROMO</span>
                    <input
                      type="checkbox"
                      checked={bastionFormData.is_promo}
                      onChange={(e) => handleBastionFormChange('is_promo', e.target.checked)}
                    />
                  </label>

                  <FormInput
                    label="Uwagi"
                    type="textarea"
                    rows={3}
                    value={bastionFormData.notes}
                    onChange={(v) => handleBastionFormChange('notes', v)}
                  />

                  <FormInput
                    label="Uwagi 2"
                    type="textarea"
                    rows={3}
                    value={bastionFormData.notes_2}
                    onChange={(v) => handleBastionFormChange('notes_2', v)}
                  />

                  <FormInput
                    label="Numer zamówienia klienta"
                    value={bastionFormData.client_order_number}
                    onChange={(v) => handleBastionFormChange('client_order_number', v)}
                  />
                </div>
              ) : (
                <div
                  className="order-form-grid"
                  onKeyDown={(e) => submitOnEnterInInput(e, () => void handleSaveOrder())}
                >
                  <label className="order-field-full">
                    <span className="order-field-label-text">Numer zlecenia</span>
                    <input readOnly className="input-readonly" value={formData.order_number} />
                  </label>
                  {renderCategoryField(formData.category ?? '', (value) => handleFormChange('category', value))}
                  <div className="company-field-block">
                    <label className="order-field-label-text" htmlFor="legacy-order-company-input">
                      FIRMA
                    </label>
                    <div className="company-autocomplete">
                      <input
                        id="legacy-order-company-input"
                        type="text"
                        autoComplete="off"
                        value={formData.company}
                        onFocus={() => setShowCompanyDropdown(true)}
                        onChange={(event) => {
                          setHighlightedIndex(-1)
                          handleFormChange('company', event.target.value)
                          setShowCompanyDropdown(true)
                        }}
                        onKeyDown={handleCompanyAutocompleteKeyDown(
                          filteredCompanies,
                          handleCompanySelect,
                        )}
                      />
                      {showCompanyDropdown && filteredCompanies.length > 0 && (
                        <div className="company-dropdown" role="listbox">
                          {filteredCompanies.map((item, index) => (
                            <button
                              key={`${item.name}-${item.production_day}`}
                              type="button"
                              className={
                                highlightedIndex === index
                                  ? 'company-option autocomplete-item autocomplete-item--highlighted'
                                  : 'company-option autocomplete-item'
                              }
                              role="option"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => handleCompanySelect(item)}
                            >
                              {item.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <label>
                    DATA
                    <input
                      type="date"
                      value={formData.order_date}
                      onChange={(event) => handleFormChange('order_date', event.target.value)}
                    />
                  </label>
                  <label>
                    PRODUKCJA
                    <select
                      value={formData.production_day}
                      onChange={(event) => handleFormChange('production_day', event.target.value)}
                    >
                      {PRODUCTION_DAYS.map((day) => (
                        <option key={day} value={day}>
                          {day}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    ILOŚĆ
                    <input
                      type="number"
                      min={1}
                      value={formData.quantity}
                      onChange={(event) => handleFormChange('quantity', event.target.value)}
                    />
                  </label>
                  <label>
                    KOLEJNOŚĆ
                    <input
                      type="text"
                      value={formData.sequence}
                      onChange={(event) => handleFormChange('sequence', event.target.value)}
                    />
                  </label>
                  <label>
                    SYSTEM
                    <select
                      value={formData.system}
                      onChange={(event) => handleFormChange('system', event.target.value)}
                    >
                      <option>NORMAL</option>
                      <option>NORMAL PLUS</option>
                      <option>DISTING</option>
                      <option>DISTING PLUS</option>
                      <option>GUARD RC3</option>
                      <option>CORE</option>
                    </select>
                  </label>
                  <label>
                    MODEL
                    <input
                      type="text"
                      value={formData.model}
                      onChange={(event) => handleFormChange('model', event.target.value)}
                    />
                  </label>
                  <label>
                    KOLOR SKRZYDŁA
                    <input
                      type="text"
                      value={formData.wing_color}
                      onChange={(event) => handleFormChange('wing_color', event.target.value)}
                    />
                  </label>
                  <label>
                    KOLOR OŚCIEŻNICY
                    <input
                      type="text"
                      value={formData.frame_color}
                      onChange={(event) => handleFormChange('frame_color', event.target.value)}
                    />
                  </label>
                  <label>
                    KOLOR PROGU
                    <input
                      type="text"
                      value={formData.threshold_color}
                      onChange={(event) => handleFormChange('threshold_color', event.target.value)}
                    />
                  </label>
                  <label>
                    SZEROKOŚĆ
                    <input
                      type="text"
                      value={formData.width}
                      onChange={(event) => handleFormChange('width', event.target.value)}
                    />
                  </label>
                  <label>
                    KIERUNEK
                    <select
                      value={formData.direction}
                      onChange={(event) => handleFormChange('direction', event.target.value)}
                    >
                      {['LEWE', 'PRAWE'].map((option) => {
                        const excluded = isFieldValueExcluded(
                          exclusions,
                          activeTab,
                          legacyExclusionFormData,
                          'direction',
                          option,
                        )
                        return (
                          <option
                            key={option}
                            value={option}
                            disabled={excluded}
                            style={excluded ? { color: '#9ca3af' } : undefined}
                          >
                            {option}
                          </option>
                        )
                      })}
                    </select>
                  </label>
                  <label>
                    OTWIERANIE
                    <select
                      value={formData.opening}
                      onChange={(event) => handleFormChange('opening', event.target.value)}
                    >
                      <option>ONZ</option>
                      <option>ODW</option>
                    </select>
                  </label>
                  <label>
                    WYSOKOŚĆ
                    <input
                      type="text"
                      value={formData.height}
                      onChange={(event) => handleFormChange('height', event.target.value)}
                    />
                  </label>
                  <label>
                    SZKLENIE
                    <input
                      type="text"
                      value={formData.glazing}
                      onChange={(event) => handleFormChange('glazing', event.target.value)}
                    />
                  </label>
                  <label>
                    OKUCIA
                    <input
                      type="text"
                      value={formData.hardware}
                      onChange={(event) => handleFormChange('hardware', event.target.value)}
                    />
                  </label>
                  <label className="full-width">
                    UWAGI
                    <textarea
                      rows={3}
                      value={formData.notes}
                      onChange={(event) => handleFormChange('notes', event.target.value)}
                    />
                  </label>
                  <label>
                    WPISAŁ
                    <input
                      type="text"
                      value={formData.entered_by}
                      onChange={(event) => handleFormChange('entered_by', event.target.value)}
                    />
                  </label>
                </div>
              )}

              <div className="order-form-actions">
                {editingOrderId !== null && typeof onDuplicate === 'function' && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => onDuplicate()}
                    disabled={isSaving}
                    title="Utwórz nowe zamówienie z tymi samymi parametrami"
                  >
                    📋 Duplikuj
                  </button>
                )}
                <button className="btn btn-primary" onClick={handleSaveOrder} disabled={isSaving}>
                  {isSaving
                    ? 'Zapisywanie...'
                    : editingOrderId !== null
                      ? 'Zapisz zmiany'
                      : usesStructuredOrderForm
                        ? 'Dodaj'
                        : 'Zapisz zamówienie'}
                </button>
              </div>
            </div>
          </div>
  )
}

export default OrderFormModal
