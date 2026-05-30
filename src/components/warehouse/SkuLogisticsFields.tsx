import { useMemo } from 'react'
import type { Supplier } from '../../types'

type Props = {
  supplierId: number | null
  setSupplierId: (id: number | null) => void
  unitsPerPallet: number | ''
  setUnitsPerPallet: (n: number | '') => void
  palletsPerFullTir: number | ''
  setPalletsPerFullTir: (n: number | '') => void
  minStockLevel: number | ''
  setMinStockLevel: (n: number | '') => void
  targetStockLevel: number | ''
  setTargetStockLevel: (n: number | '') => void
  suppliers: Supplier[]
}

export default function SkuLogisticsFields({
  supplierId,
  setSupplierId,
  unitsPerPallet,
  setUnitsPerPallet,
  palletsPerFullTir,
  setPalletsPerFullTir,
  minStockLevel,
  setMinStockLevel,
  targetStockLevel,
  setTargetStockLevel,
  suppliers,
}: Props) {
  const activeSuppliers = useMemo(
    () =>
      [...suppliers]
        .filter((s) => s.is_active)
        .sort((a, b) => a.name.localeCompare(b.name, 'pl')),
    [suppliers],
  )

  const showTargetWarning =
    targetStockLevel !== '' &&
    minStockLevel !== '' &&
    Number(targetStockLevel) <= Number(minStockLevel)

  return (
    <div className="order-field-full sku-logistics-section">
      <h3>Logistyka i zamawianie</h3>
      <div className="order-form-grid order-form-grid--sta">
        <label className="order-field-full">
          <span className="order-field-label-text">Dostawca</span>
          <select
            value={supplierId ?? ''}
            onChange={(e) => setSupplierId(e.target.value === '' ? null : Number(e.target.value))}
          >
            <option value="">(brak)</option>
            {activeSuppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="order-field-label-text">Min. poziom stocku</span>
          <input
            type="number"
            min={0}
            placeholder="np. 5"
            value={minStockLevel}
            onChange={(e) => setMinStockLevel(e.target.value === '' ? '' : Math.max(0, Number(e.target.value) || 0))}
          />
          <small className="sku-logistics-helper">
            Próg ostrzeżenia. Gdy stock spadnie poniżej, system zasugeruje zamówienie.
          </small>
        </label>

        <label>
          <span className="order-field-label-text">Docelowy poziom stocku</span>
          <input
            type="number"
            min={0}
            placeholder="np. 20"
            value={targetStockLevel}
            onChange={(e) => setTargetStockLevel(e.target.value === '' ? '' : Math.max(0, Number(e.target.value) || 0))}
          />
          <small className="sku-logistics-helper">
            Po zamówieniu stock powinien wrócić do tego poziomu.
          </small>
          {showTargetWarning && (
            <small className="sku-logistics-helper" style={{ color: '#b91c1c' }}>
              Docelowy musi być większy niż minimum.
            </small>
          )}
        </label>

        <label>
          <span className="order-field-label-text">Sztuki na palecie</span>
          <input
            type="number"
            min={1}
            placeholder="np. 24"
            value={unitsPerPallet}
            onChange={(e) =>
              setUnitsPerPallet(e.target.value === '' ? '' : Math.max(1, Number(e.target.value) || 1))
            }
          />
          <small className="sku-logistics-helper">
            Ile sztuk tego SKU mieści się na 1 palecie. Wpisz tylko jeśli SKU jeździ paletami.
          </small>
        </label>

        <label>
          <span className="order-field-label-text">Palety na pełny TIR</span>
          <input
            type="number"
            min={1}
            placeholder="np. 11"
            value={palletsPerFullTir}
            onChange={(e) =>
              setPalletsPerFullTir(e.target.value === '' ? '' : Math.max(1, Number(e.target.value) || 1))
            }
          />
          <small className="sku-logistics-helper">
            Ile palet tego SKU składa się na pełny TIR. Zostaw puste, jeśli SKU jeździ kurierem (np.
            klamki).
          </small>
        </label>
      </div>
    </div>
  )
}
