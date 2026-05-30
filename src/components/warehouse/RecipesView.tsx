import { useMemo, useState } from 'react'
import { RECIPE_PARTS } from '../../constants'
import type { RecipePart, WarehouseRecipe } from '../../types'

const RECIPE_CATEGORY_FILTER_VALUES = ['STA', 'Disting', 'ST', 'Techniczne', 'Bastion'] as const

function displayCell(value: string | null | undefined): string {
  const t = value?.trim()
  return t ? t : '—'
}

function partLabel(part: RecipePart): string {
  return RECIPE_PARTS.find((p) => p.value === part)?.label ?? part
}

type RecipesViewProps = {
  isManager: boolean
  recipes: WarehouseRecipe[]
  loading: boolean
  onCreate: () => void
  onEdit: (recipe: WarehouseRecipe) => void
  onDelete: (id: number) => Promise<void>
  onToggleActive: (id: number, active: boolean) => Promise<void>
  showDeleted: boolean
  onToggleShowDeleted: (show: boolean) => void
  onRestore: (id: number) => Promise<void>
}

function RecipesView({
  isManager,
  recipes,
  loading,
  onCreate,
  onEdit,
  onDelete,
  onToggleActive,
  showDeleted,
  onToggleShowDeleted,
  onRestore,
}: RecipesViewProps) {
  const [categoryFilter, setCategoryFilter] = useState<string>('')
  const [partFilter, setPartFilter] = useState<'' | RecipePart>('')
  const [search, setSearch] = useState('')

  const filteredRecipes = useMemo(() => {
    const q = search.trim().toLowerCase()
    return recipes.filter((r) => {
      if (categoryFilter && r.category !== categoryFilter) return false
      if (partFilter && r.part !== partFilter) return false
      if (!q) return true
      const hay = [
        r.name,
        r.model,
        r.wing_color,
        r.frame_color,
      ]
        .map((x) => (x ?? '').toLowerCase())
        .join(' ')
      return hay.includes(q)
    })
  }, [recipes, categoryFilter, partFilter, search])

  return (
    <>
      <div className="orders-filters" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <label className="day-filter" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span>Kategoria</span>
          <select
            className="day-filter"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="">Wszystkie</option>
            {RECIPE_CATEGORY_FILTER_VALUES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="day-filter" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span>Part</span>
          <select
            className="day-filter"
            value={partFilter}
            onChange={(e) => setPartFilter((e.target.value || '') as '' | RecipePart)}
          >
            <option value="">Wszystkie</option>
            {RECIPE_PARTS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <input
          type="text"
          className="search-input"
          placeholder="Szukaj po nazwie, modelu, kolorze…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: 220, flex: '1 1 200px' }}
        />
        {isManager && (
          <label className="filter-checkbox">
            <input
              type="checkbox"
              checked={showDeleted}
              onChange={(e) => onToggleShowDeleted(e.target.checked)}
            />
            Pokaż usunięte
          </label>
        )}
        {isManager && (
          <button type="button" className="btn btn-success" onClick={onCreate}>
            Nowa receptura
          </button>
        )}
      </div>
      {loading ? (
        <p className="no-results">Ładowanie receptur…</p>
      ) : (
        <div className="table-wrapper">
          <table className="orders-table">
            <thead>
              <tr>
                <th>NAZWA</th>
                <th>KATEGORIA</th>
                <th>PART</th>
                <th>SYSTEM</th>
                <th>MODEL</th>
                <th>KOLOR SKRZ.</th>
                <th>KOLOR OŚĆ.</th>
                <th>ROZMIAR</th>
                <th>KIERUNEK</th>
                <th>POZYCJI</th>
                {isManager && <th>AKCJE</th>}
              </tr>
            </thead>
            <tbody>
              {filteredRecipes.map((row) => (
                <tr key={row.id} className={row.is_active ? '' : 'recipe-row--deleted'}>
                  <td>{displayCell(row.name)}</td>
                  <td>{displayCell(row.category)}</td>
                  <td>{partLabel(row.part)}</td>
                  <td>{displayCell(row.system)}</td>
                  <td>{displayCell(row.model)}</td>
                  <td>{displayCell(row.wing_color)}</td>
                  <td>{displayCell(row.frame_color)}</td>
                  <td>{displayCell(row.width)}</td>
                  <td>{displayCell(row.direction)}</td>
                  <td>{row.components_count ?? 0}</td>
                  {isManager && (
                    <td>
                      <div className="contractor-actions">
                        {row.is_active ? (
                          <>
                            <button
                              type="button"
                              className="btn btn-sm btn-primary"
                              onClick={() => onEdit(row)}
                            >
                              Edytuj
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-primary"
                              onClick={() => void onToggleActive(row.id, false)}
                            >
                              Wyłącz
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-danger"
                              onClick={() => void onDelete(row.id)}
                            >
                              Usuń
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-sm btn-primary"
                            onClick={() => void onRestore(row.id)}
                          >
                            Przywróć
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {filteredRecipes.length === 0 && (
            <p className="no-results">Brak receptur spełniających kryteria.</p>
          )}
        </div>
      )}
    </>
  )
}

export default RecipesView
