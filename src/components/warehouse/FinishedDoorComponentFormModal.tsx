import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ConfigOptionRecord, Supplier, WarehouseComponent } from '../../types'
import { supabase } from '../../supabaseClient'
import SearchableConfigSelect from '../SearchableConfigSelect'
import SkuLogisticsFields from './SkuLogisticsFields'

type Mode = 'add' | 'edit'

type DoorCategory =
  | 'door_wing'
  | 'door_frame_simple'
  | 'door_frame_adjustable'
  | 'door_handle'
  | 'door_hinge_cover'

type Props = {
  open: boolean
  mode: Mode
  initialComponent?: WarehouseComponent | null
  onClose: () => void
  onSaved: () => void
  configOptions: ConfigOptionRecord[]
  suppliers: Supplier[]
}

function slugifyCodePart(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
}

function FinishedDoorComponentFormModal({
  open,
  mode,
  initialComponent,
  onClose,
  onSaved,
  configOptions,
  suppliers,
}: Props) {
  const [productCategory, setProductCategory] = useState<DoorCategory>('door_wing')
  const [wingModel, setWingModel] = useState('')
  const [handleModel, setHandleModel] = useState('')
  const [size, setSize] = useState('')
  const [frameCode, setFrameCode] = useState('')
  const [handleShield, setHandleShield] = useState('')
  const [direction, setDirection] = useState<'L' | 'P'>('L')
  const [color, setColor] = useState('')
  const [handleColor, setHandleColor] = useState('')
  const [hingeCoverColor, setHingeCoverColor] = useState('')
  const [code, setCode] = useState('')
  const [unit, setUnit] = useState('szt')
  const [supplierId, setSupplierId] = useState<number | null>(null)
  const [unitsPerPallet, setUnitsPerPallet] = useState<number | ''>('')
  const [palletsPerFullTir, setPalletsPerFullTir] = useState<number | ''>('')
  const [minStockLevel, setMinStockLevel] = useState<number | ''>('')
  const [targetStockLevel, setTargetStockLevel] = useState<number | ''>('')
  const [saving, setSaving] = useState(false)

  const wingModelOptions = useMemo(
    () =>
      configOptions
        .filter((o) => o.category === 'Wewnetrzne' && o.type === 'model')
        .map((o) => o.value),
    [configOptions],
  )
  const doorColorOptions = useMemo(
    () =>
      configOptions
        .filter((o) => o.category === 'Wewnetrzne' && o.type === 'kolor')
        .map((o) => o.value),
    [configOptions],
  )
  const sizeOptions = useMemo(
    () =>
      configOptions
        .filter((o) => o.category === 'Wewnetrzne' && o.type === 'rozmiar')
        .map((o) => o.value),
    [configOptions],
  )
  const handleShieldOptions = useMemo(
    () =>
      configOptions
        .filter((o) => o.category === 'Wewnetrzne' && o.type === 'szyld')
        .map((o) => o.value),
    [configOptions],
  )
  const handleModelOptions = useMemo(
    () =>
      configOptions
        .filter((o) => o.category === 'Wewnetrzne' && o.type === 'model_klamki')
        .map((o) => o.value),
    [configOptions],
  )
  const handleColorOptions = useMemo(
    () =>
      configOptions
        .filter((o) => o.category === 'Wewnetrzne' && o.type === 'kolor_klamki')
        .map((o) => o.value),
    [configOptions],
  )
  const hingeCoverColorOptions = useMemo(
    () =>
      configOptions
        .filter((o) => o.category === 'Wewnetrzne' && o.type === 'kolor_oslonki')
        .map((o) => o.value),
    [configOptions],
  )
  const frameCodeOptions = useMemo(
    () =>
      configOptions
        .filter((o) => o.category === 'Wewnetrzne' && o.type === 'frame_code')
        .map((o) => o.value),
    [configOptions],
  )

  useEffect(() => {
    if (open && mode === 'edit' && initialComponent) {
      const sourceCategory = initialComponent.product_category
      const sourceFrameType = initialComponent.door_frame_type
      if (sourceCategory === 'door_frame' && sourceFrameType === 'simple') {
        setProductCategory('door_frame_simple')
      } else if (sourceCategory === 'door_frame' && sourceFrameType === 'adjustable') {
        setProductCategory('door_frame_adjustable')
      } else {
        setProductCategory(sourceCategory as DoorCategory)
      }
      setWingModel(initialComponent.door_model ?? '')
      setHandleModel(initialComponent.door_model ?? '')
      setSize(initialComponent.door_size ?? '')
      setFrameCode(initialComponent.door_frame_code ?? '')
      setHandleShield(initialComponent.door_handle_shield ?? '')
      setDirection((initialComponent.door_direction ?? 'L') as 'L' | 'P')
      setColor(initialComponent.door_color ?? '')
      setHandleColor(initialComponent.door_color ?? '')
      setHingeCoverColor(initialComponent.door_color ?? '')
      setCode(initialComponent.code ?? '')
      setUnit(initialComponent.unit ?? 'szt')
      setSupplierId(initialComponent.supplier_id ?? null)
      setUnitsPerPallet(initialComponent.units_per_pallet ?? '')
      setPalletsPerFullTir(initialComponent.pallets_per_full_tir ?? '')
      setMinStockLevel(initialComponent.min_stock_level ?? '')
      setTargetStockLevel(initialComponent.target_stock_level ?? '')
    } else if (open && mode === 'add') {
      setProductCategory('door_wing')
      setWingModel('')
      setHandleModel('')
      setSize('')
      setFrameCode('')
      setHandleShield('')
      setDirection('L')
      setColor('')
      setHandleColor('')
      setHingeCoverColor('')
      setCode('')
      setUnit('szt')
      setSupplierId(null)
      setUnitsPerPallet('')
      setPalletsPerFullTir('')
      setMinStockLevel('')
      setTargetStockLevel('')
    }
  }, [open, mode, initialComponent])

  const generatedName = useMemo(() => {
    if (productCategory === 'door_wing') {
      return ['Skrzydło', wingModel, color, size, direction]
        .filter(Boolean)
        .join(' ')
    }
    if (productCategory === 'door_frame_simple') {
      return ['Ościeżnica prosta', color, size, direction].filter(Boolean).join(' ')
    }
    if (productCategory === 'door_frame_adjustable') {
      return ['Ościeżnica regulowana', frameCode, color, size, direction]
        .filter(Boolean)
        .join(' ')
    }
    if (productCategory === 'door_handle') {
      return ['Klamka', handleModel, handleColor, handleShield].filter(Boolean).join(' ')
    }
    if (productCategory === 'door_hinge_cover') {
      return ['Osłonka', hingeCoverColor].filter(Boolean).join(' ')
    }
    return ''
  }, [productCategory, wingModel, color, size, direction, frameCode, handleModel, handleColor, handleShield, hingeCoverColor])

  const handleSave = async () => {
    if (productCategory === 'door_wing' && (!wingModel || !color || !size || !direction)) {
      window.alert('Skrzydło wymaga: model, kolor, rozmiar i kierunek.')
      return
    }
    if (productCategory === 'door_frame_simple' && (!color || !size || !direction)) {
      window.alert('Ościeżnica prosta wymaga: kolor, rozmiar i kierunek.')
      return
    }
    if (productCategory === 'door_frame_adjustable' && (!frameCode || !color || !size || !direction)) {
      window.alert('Ościeżnica regulowana wymaga: typ regulacji, kolor, rozmiar i kierunek.')
      return
    }
    if (productCategory === 'door_handle' && (!handleModel || !handleColor || !handleShield)) {
      window.alert('Klamka wymaga: model, kolor i szyld.')
      return
    }
    if (productCategory === 'door_hinge_cover' && !hingeCoverColor) {
      window.alert('Osłonka wymaga: kolor.')
      return
    }

    setSaving(true)

    const payloadProductCategory = productCategory.startsWith('door_frame') ? 'door_frame' : productCategory
    const payloadFrameType =
      productCategory === 'door_frame_simple'
        ? 'simple'
        : productCategory === 'door_frame_adjustable'
          ? 'adjustable'
          : null

    const payloadModel = productCategory === 'door_wing' ? wingModel : productCategory === 'door_handle' ? handleModel : null
    const payloadColor =
      productCategory === 'door_hinge_cover'
        ? hingeCoverColor
        : productCategory === 'door_handle'
          ? handleColor
          : color

    const manualCode = code.trim()
    let finalCode = manualCode
    if (!finalCode) {
      const slug = slugifyCodePart(generatedName || '')
      const codeBase = (slug ? `DW-${slug}` : 'DW-KOMPONENT').slice(0, 64)
      const { data: existingRows, error: codeFetchError } = await supabase
        .from('warehouse_components')
        .select('code')
        .ilike('code', `${codeBase}%`)
      if (codeFetchError) {
        setSaving(false)
        window.alert(`Błąd pobierania kodów: ${codeFetchError.message}`)
        return
      }
      const existingCodes = new Set(
        (existingRows ?? [])
          .map((row) => String((row as { code?: string | null }).code ?? '').trim())
          .filter(Boolean),
      )
      finalCode = codeBase
      let idx = 2
      while (existingCodes.has(finalCode)) {
        finalCode = `${codeBase}-${idx}`
        idx += 1
      }
    }

    const payload = {
      name: generatedName,
      code: finalCode,
      unit,
      is_active: true,
      product_category: payloadProductCategory,
      door_model: payloadModel || null,
      door_size:
        productCategory === 'door_wing' ||
        productCategory === 'door_frame_simple' ||
        productCategory === 'door_frame_adjustable'
          ? size || null
          : null,
      door_direction:
        productCategory === 'door_wing' ||
        productCategory === 'door_frame_simple' ||
        productCategory === 'door_frame_adjustable'
          ? direction
          : null,
      door_color: payloadColor || null,
      door_frame_type: payloadFrameType,
      door_frame_code: productCategory === 'door_frame_adjustable' ? frameCode || null : null,
      door_handle_shield: productCategory === 'door_handle' ? handleShield || null : null,
      supplier_id: supplierId,
      units_per_pallet: unitsPerPallet === '' ? null : Number(unitsPerPallet),
      pallets_per_full_tir: palletsPerFullTir === '' ? null : Number(palletsPerFullTir),
      min_stock_level: minStockLevel === '' ? null : Number(minStockLevel),
      target_stock_level: targetStockLevel === '' ? null : Number(targetStockLevel),
    }

    if (mode === 'add') {
      const { error } = await supabase.from('warehouse_components').insert(payload)
      if (error) {
        setSaving(false)
        window.alert(`Błąd: ${error.message}`)
        return
      }
    } else {
      const { error } = await supabase
        .from('warehouse_components')
        .update(payload)
        .eq('id', initialComponent!.id)
      if (error) {
        setSaving(false)
        window.alert(`Błąd: ${error.message}`)
        return
      }
    }

    setSaving(false)
    onSaved()
    onClose()
  }

  if (!open) return null

  return createPortal(
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="order-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 600 }}>
        <div className="order-modal-header">
          <h2>{mode === 'add' ? 'Dodaj drzwi wewnętrzne' : 'Edytuj pozycję'}</h2>
          <button type="button" className="btn btn-icon btn-ghost" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="order-form-grid order-form-grid--sta">
          <label className="order-field-full">
            <span className="order-field-label-text">Typ pozycji</span>
            <select
              value={productCategory}
              onChange={(e) => setProductCategory(e.target.value as DoorCategory)}
              disabled={mode === 'edit'}
            >
              <option value="door_wing">Skrzydło wewnętrzne</option>
              <option value="door_frame_simple">Ościeżnica prosta</option>
              <option value="door_frame_adjustable">Ościeżnica regulowana</option>
              <option value="door_handle">Klamka</option>
              <option value="door_hinge_cover">Osłonka na zawias</option>
            </select>
          </label>
          {productCategory === 'door_wing' && (
            <>
              <SearchableConfigSelect
                label="Model"
                value={wingModel}
                onChange={setWingModel}
                options={wingModelOptions}
                placeholder="np. Maleo 02"
              />
              <SearchableConfigSelect
                label="Kolor"
                value={color}
                onChange={setColor}
                options={doorColorOptions}
                placeholder="np. Jesion szary"
              />
              <SearchableConfigSelect
                label="Rozmiar"
                value={size}
                onChange={setSize}
                options={sizeOptions}
                placeholder="np. 80"
              />
              <label>
                <span className="order-field-label-text">Kierunek</span>
                <select value={direction} onChange={(e) => setDirection(e.target.value as 'L' | 'P')}>
                  <option value="L">L (lewe)</option>
                  <option value="P">P (prawe)</option>
                </select>
              </label>
            </>
          )}

          {productCategory === 'door_frame_simple' && (
            <>
              <SearchableConfigSelect
                label="Kolor"
                value={color}
                onChange={setColor}
                options={doorColorOptions}
                placeholder="np. Jesion szary"
              />
              <SearchableConfigSelect
                label="Rozmiar"
                value={size}
                onChange={setSize}
                options={sizeOptions}
                placeholder="np. 80"
              />
              <label>
                <span className="order-field-label-text">Kierunek</span>
                <select value={direction} onChange={(e) => setDirection(e.target.value as 'L' | 'P')}>
                  <option value="L">L (lewe)</option>
                  <option value="P">P (prawe)</option>
                </select>
              </label>
            </>
          )}

          {productCategory === 'door_frame_adjustable' && (
            <>
              <SearchableConfigSelect
                label="Typ regulacji"
                value={frameCode}
                onChange={setFrameCode}
                options={frameCodeOptions}
                placeholder="np. OR-2 100-140"
              />
              <SearchableConfigSelect
                label="Kolor"
                value={color}
                onChange={setColor}
                options={doorColorOptions}
                placeholder="np. Jesion szary"
              />
              <SearchableConfigSelect
                label="Rozmiar"
                value={size}
                onChange={setSize}
                options={sizeOptions}
                placeholder="np. 80"
              />
              <label>
                <span className="order-field-label-text">Kierunek</span>
                <select value={direction} onChange={(e) => setDirection(e.target.value as 'L' | 'P')}>
                  <option value="L">L (lewe)</option>
                  <option value="P">P (prawe)</option>
                </select>
              </label>
            </>
          )}

          {productCategory === 'door_handle' && (
            <>
              <SearchableConfigSelect
                label="Model klamki"
                value={handleModel}
                onChange={setHandleModel}
                options={handleModelOptions}
                placeholder="np. Verona"
              />
              <SearchableConfigSelect
                label="Kolor klamki"
                value={handleColor}
                onChange={setHandleColor}
                options={handleColorOptions}
                placeholder="np. chrom satyna"
              />
              <SearchableConfigSelect
                label="Szyld"
                value={handleShield}
                onChange={setHandleShield}
                options={handleShieldOptions}
                placeholder="np. KLUCZ"
              />
            </>
          )}

          {productCategory === 'door_hinge_cover' && (
            <SearchableConfigSelect
              label="Kolor osłonki"
              value={hingeCoverColor}
              onChange={setHingeCoverColor}
              options={hingeCoverColorOptions}
              placeholder="np. srebrny"
            />
          )}

          <label className="order-field-full">
            <span className="order-field-label-text">Kod (opcjonalnie)</span>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="auto"
            />
          </label>

          <label className="order-field-full">
            <span className="order-field-label-text">Jednostka</span>
            <input type="text" value={unit} onChange={(e) => setUnit(e.target.value)} />
          </label>

          <div className="order-field-full" style={{ background: '#f9fafb', padding: 8, borderRadius: 4 }}>
            <strong>Nazwa:</strong> {generatedName || '(brak)'}
          </div>

          <SkuLogisticsFields
            supplierId={supplierId}
            setSupplierId={setSupplierId}
            unitsPerPallet={unitsPerPallet}
            setUnitsPerPallet={setUnitsPerPallet}
            palletsPerFullTir={palletsPerFullTir}
            setPalletsPerFullTir={setPalletsPerFullTir}
            minStockLevel={minStockLevel}
            setMinStockLevel={setMinStockLevel}
            targetStockLevel={targetStockLevel}
            setTargetStockLevel={setTargetStockLevel}
            suppliers={suppliers}
          />
        </div>

        <div className="order-form-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={saving}
          >
            Anuluj
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Zapisywanie...' : 'Zapisz'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default FinishedDoorComponentFormModal
