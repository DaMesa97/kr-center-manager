import { useCallback, useEffect, useState } from 'react'
import { PRODUCT_CATEGORY_LABELS } from '../../constants'
import { BACKGROUND_PAGE, fetchBackgroundComponents, setComponentsStocked } from '../../lib/warehouseStocked'
import DataTable, { type DataTableColumn } from '../DataTable'
import Spinner from '../Spinner'
import type { ToastVariant, WarehouseComponent } from '../../types'

type Props = {
  canEdit: boolean
  pushToast: (message: string, variant: ToastVariant) => void
  /** po przestawieniu na „trzymamy” — odśwież listę komponentów na magazynie */
  onChanged: () => void | Promise<void>
}

const DOOR_CATS = ['door_wing', 'door_frame', 'door_handle', 'door_accessory', 'door_hinge_cover'] as const

/**
 * Magazyn → Komponenty → „Pokaż kartoteki w tle”: komponenty is_stocked = false
 * (kartoteki z Optimy, towar na zamówienie). Ładowane stronami po 100 z serwera
 * z wyszukiwarką — jest ich kilka tysięcy i przybywa.
 */
export default function BackgroundComponentsPanel({ canEdit, pushToast, onChanged }: Props) {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [category, setCategory] = useState('')
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<WarehouseComponent[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300)
    return () => clearTimeout(t)
  }, [query])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetchBackgroundComponents({ query: debounced, category, page })
      setRows(r.rows)
      setTotal(r.total)
    } catch (e) {
      pushToast(`Nie wczytano kartotek w tle: ${e instanceof Error ? e.message : String(e)}`, 'error')
    } finally {
      setLoading(false)
    }
  }, [debounced, category, page, pushToast])

  useEffect(() => {
    void load()
  }, [load])
  useEffect(() => {
    setPage(0)
    setSelected(new Set())
  }, [debounced, category])

  const stock = async (ids: number[]) => {
    if (ids.length === 0) return
    setBusy(true)
    try {
      const n = await setComponentsStocked(ids, true)
      pushToast(`Na magazynie: ${n} ${n === 1 ? 'komponent' : 'komponentów'} — pojawią się w inwentaryzacji i wydaniach`, 'success')
      setSelected(new Set())
      await Promise.all([load(), onChanged()])
    } catch (e) {
      pushToast(`Nie zmieniono: ${e instanceof Error ? e.message : String(e)}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const pageCount = Math.max(1, Math.ceil(total / BACKGROUND_PAGE))
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id))

  const columns: DataTableColumn<WarehouseComponent>[] = [
    ...(canEdit
      ? [
          {
            key: 'sel',
            label: (
              <input
                type="checkbox"
                checked={allOnPage}
                onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
                aria-label="Zaznacz wszystkie na stronie"
              />
            ),
            stopRowClick: true,
            render: (r: WarehouseComponent) => (
              <input
                type="checkbox"
                checked={selected.has(r.id)}
                onChange={(e) =>
                  setSelected((prev) => {
                    const n = new Set(prev)
                    if (e.target.checked) n.add(r.id)
                    else n.delete(r.id)
                    return n
                  })
                }
                aria-label={`Zaznacz ${r.name}`}
              />
            ),
          } as DataTableColumn<WarehouseComponent>,
        ]
      : []),
    { key: 'code', label: 'KOD', render: (r) => <span className="optima-code">{r.code || '—'}</span> },
    { key: 'name', label: 'NAZWA', render: (r) => r.name },
    { key: 'cat', label: 'KATEGORIA', render: (r) => PRODUCT_CATEGORY_LABELS[r.product_category] ?? r.product_category },
    {
      key: 'stocked',
      label: 'NA MAGAZYNIE',
      render: (r) =>
        canEdit ? (
          <button type="button" className="stocked-toggle" disabled={busy} onClick={() => void stock([r.id])} title="Przestaw na: trzymamy na magazynie">
            <span className="stocked-badge stocked-badge--no">NIE</span> → TAK
          </button>
        ) : (
          <span className="stocked-badge stocked-badge--no">NIE</span>
        ),
    },
  ]

  return (
    <div className="background-components">
      <p className="muted" style={{ marginTop: 0 }}>
        Kartoteki w tle — towar na zamówienie, bez stanu: nie ma ich w inwentaryzacji, a wydanie zlecenia ich nie zdejmuje. Przestaw na
        „TAK”, jeśli trzymacie je na półce.
      </p>
      <div className="inventory-filters">
        <input type="text" className="search-input" placeholder="Szukaj: kod albo nazwa (każde słowo)…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select value={category} onChange={(e) => setCategory(e.target.value)} title="Kategoria">
          <option value="">Wszystkie kategorie</option>
          {DOOR_CATS.map((c) => (
            <option key={c} value={c}>{PRODUCT_CATEGORY_LABELS[c] ?? c}</option>
          ))}
        </select>
        {canEdit && selected.size > 0 && (
          <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void stock([...selected])}>
            Ustaw: trzymamy na magazynie ({selected.size})
          </button>
        )}
      </div>
      {loading && rows.length === 0 ? (
        <Spinner center label="Wczytywanie kartotek w tle…" />
      ) : (
        <DataTable rows={rows} rowKey={(r) => r.id} columns={columns} wrapperClassName="orders-table-wrapper" emptyText="Brak kartotek w tle dla tych filtrów" />
      )}
      <div className="inventory-pager">
        <span className="muted">
          {total.toLocaleString('pl-PL')} kartotek w tle{pageCount > 1 && ` · strona ${page + 1} z ${pageCount}`}
          {loading && rows.length > 0 && ' · wczytuję…'}
        </span>
        {pageCount > 1 && (
          <span className="inventory-pager-buttons">
            <button type="button" className="btn btn-sm btn-secondary" disabled={page === 0} onClick={() => setPage(0)}>«</button>
            <button type="button" className="btn btn-sm btn-secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>‹ Poprzednia</button>
            <button type="button" className="btn btn-sm btn-secondary" disabled={page >= pageCount - 1} onClick={() => setPage(page + 1)}>Następna ›</button>
            <button type="button" className="btn btn-sm btn-secondary" disabled={page >= pageCount - 1} onClick={() => setPage(pageCount - 1)}>»</button>
          </span>
        )}
      </div>
    </div>
  )
}
