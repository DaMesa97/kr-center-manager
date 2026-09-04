import { Fragment, useMemo, useState } from 'react'
import { RECIPE_PARTS } from '../../constants'
import type { RecipePart, WarehouseRecipe } from '../../types'
import { supabase } from '../../supabaseClient'
import { getOrderStageDefinitions } from '../../utils'
import Spinner from '../Spinner'

const RECIPE_CATEGORY_FILTER_VALUES = ['STA', 'Disting', 'ST', 'Techniczne', 'Bastion'] as const

const CATEGORY_COLORS: Record<string, string> = {
  STA: '#9b1c1c',
  Disting: '#0369a1',
  ST: '#15803d',
  Techniczne: '#a16207',
  Bastion: '#6d28d9',
}

function displayCell(value: string | null | undefined): string {
  const t = value?.trim()
  return t ? t : '—'
}

function partLabel(part: RecipePart): string {
  return RECIPE_PARTS.find((p) => p.value === part)?.label ?? part
}

type RecipeComponentLine = {
  id: number
  component_id: number
  quantity: number
  stage_key: string | null
  notes: string | null
  code: string
  name: string
  unit: string
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
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [componentsCache, setComponentsCache] = useState<Record<number, RecipeComponentLine[]>>({})
  const [componentsLoadingId, setComponentsLoadingId] = useState<number | null>(null)

  const toggleExpand = (recipeId: number) => {
    if (expandedId === recipeId) {
      setExpandedId(null)
      return
    }
    setExpandedId(recipeId)
    if (componentsCache[recipeId]) return
    setComponentsLoadingId(recipeId)
    void (async () => {
      const { data, error } = await supabase
        .from('warehouse_recipe_components')
        .select('id, component_id, quantity, stage_key, notes, warehouse_components(code, name, unit)')
        .eq('recipe_id', recipeId)
      setComponentsLoadingId(null)
      if (error) {
        console.error(error)
        return
      }
      const lines = ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
        const wc = r.warehouse_components as
          | { code?: string; name?: string; unit?: string }
          | Array<{ code?: string; name?: string; unit?: string }>
          | null
        const c = Array.isArray(wc) ? wc[0] : wc
        return {
          id: r.id as number,
          component_id: r.component_id as number,
          quantity: Number(r.quantity),
          stage_key: (r.stage_key as string | null) ?? null,
          notes: (r.notes as string | null) ?? null,
          code: c?.code ?? '',
          name: c?.name ?? `#${r.component_id}`,
          unit: c?.unit ?? '',
        } as RecipeComponentLine
      })
      lines.sort((a, b) => a.name.localeCompare(b.name, 'pl'))
      setComponentsCache((prev) => ({ ...prev, [recipeId]: lines }))
    })()
  }

  const stageHeaderFor = (category: string, stageKey: string | null): string => {
    if (!stageKey) return 'pierwszy ukończony'
    const def = getOrderStageDefinitions(category).find((d) => d.key === stageKey)
    return def ? def.header : stageKey
  }

  const filteredRecipes = useMemo(() => {
    const q = search.trim().toLowerCase()
    return recipes.filter((r) => {
      if (categoryFilter && r.category !== categoryFilter) return false
      if (partFilter && r.part !== partFilter) return false
      if (!q) return true
      const hay = [r.name, r.model, r.wing_color, r.frame_color]
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
          <span>Część</span>
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
        <span style={{ alignSelf: 'center', fontSize: 13, color: 'var(--color-text-muted, #64748b)' }}>
          Receptur: <strong>{filteredRecipes.length}</strong>
        </span>
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
        <Spinner center label="Ładowanie receptur…" />
      ) : (
        <div className="table-wrapper">
          <table className="orders-table" style={{ tableLayout: 'fixed', width: '100%' }}>
            <colgroup>
              <col style={{ width: '46%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '8%' }} />
              {isManager && <col style={{ width: '22%' }} />}
            </colgroup>
            <thead>
              <tr>
                <th>NAZWA (kryteria dopasowania)</th>
                <th>KATEGORIA</th>
                <th>CZĘŚĆ</th>
                <th title="Liczba pozycji — kliknij wiersz, aby zobaczyć skład">POZYCJI</th>
                {isManager && <th>AKCJE</th>}
              </tr>
            </thead>
            <tbody>
              {filteredRecipes.map((row) => {
                const expanded = expandedId === row.id
                const lines = componentsCache[row.id]
                return (
                  <Fragment key={row.id}>
                    <tr
                      className={row.is_active ? '' : 'recipe-row--deleted'}
                      style={{ cursor: 'pointer' }}
                      onClick={() => toggleExpand(row.id)}
                      title="Kliknij, aby zobaczyć skład receptury"
                    >
                      <td
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={row.name ?? ''}
                      >
                        <span style={{ marginRight: 6 }}>{expanded ? '▾' : '▸'}</span>
                        {displayCell(row.name)}
                      </td>
                      <td>
                        <span
                          style={{
                            color: CATEGORY_COLORS[row.category] ?? 'inherit',
                            fontWeight: 700,
                          }}
                        >
                          {displayCell(row.category)}
                        </span>
                      </td>
                      <td>{partLabel(row.part)}</td>
                      <td>{row.components_count ?? 0}</td>
                      {isManager && (
                        <td onClick={(e) => e.stopPropagation()}>
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
                    {expanded && (
                      <tr>
                        <td colSpan={isManager ? 5 : 4} style={{ background: 'var(--color-bg-muted, #f8fafc)', padding: '8px 16px' }}>
                          {componentsLoadingId === row.id && !lines ? (
                            <Spinner center label="Ładowanie składu…" />
                          ) : !lines || lines.length === 0 ? (
                            <em style={{ color: 'var(--color-text-muted, #64748b)' }}>
                              Receptura nie ma pozycji.
                            </em>
                          ) : (
                            <table style={{ width: '100%', fontSize: '0.85rem', borderCollapse: 'collapse' }}>
                              <thead>
                                <tr style={{ textAlign: 'left', color: 'var(--color-text-muted, #64748b)' }}>
                                  <th style={{ padding: '2px 8px', fontWeight: 600 }}>KOMPONENT</th>
                                  <th style={{ padding: '2px 8px', fontWeight: 600, width: 90 }}>ILOŚĆ</th>
                                  <th style={{ padding: '2px 8px', fontWeight: 600, width: 140 }}>ETAP WYDANIA</th>
                                  <th style={{ padding: '2px 8px', fontWeight: 600 }}>UWAGI</th>
                                </tr>
                              </thead>
                              <tbody>
                                {lines.map((l) => (
                                  <tr key={l.id} style={{ borderTop: '1px solid var(--color-border, #e2e8f0)' }}>
                                    <td style={{ padding: '4px 8px' }}>
                                      {l.name}
                                      {l.code && !l.name.toUpperCase().includes(l.code.toUpperCase()) ? ` (${l.code})` : ''}
                                    </td>
                                    <td style={{ padding: '4px 8px' }}>
                                      {l.quantity} {l.unit}
                                    </td>
                                    <td style={{ padding: '4px 8px' }}>{stageHeaderFor(row.category, l.stage_key)}</td>
                                    <td style={{ padding: '4px 8px', color: 'var(--color-text-muted, #64748b)' }}>
                                      {l.notes ?? ''}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
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
