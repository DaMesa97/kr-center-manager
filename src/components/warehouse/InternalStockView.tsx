import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../supabaseClient'
import { fetchAllPages } from '../../lib/fetchPaged'
import { PRODUCT_CATEGORY_LABELS } from '../../constants'
import {
  DOOR_FILTER_EMPTY,
  INTERNAL_WAREHOUSE_ID,
  distinctValues,
  internalReservations,
  isDoorComponent,
  matchesDoorFilter,
  type DoorFilter,
  type IssuedMovement,
  type OpenItem,
} from '../../lib/internalWarehouse'
import DataTable, { type DataTableColumn } from '../DataTable'
import Spinner from '../Spinner'
import type { ToastVariant, WarehouseComponent } from '../../types'

type Props = {
  components: WarehouseComponent[]
  onShowHistory: (component: WarehouseComponent) => void
  pushToast: (msg: string, variant: ToastVariant) => void
}

type Row = WarehouseComponent & { stock: number; reserved: number; available: number }

const PAGE = 100
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3))))
const CHUNK = 150

/**
 * Magazyn → Stany → Wewnętrzne: drzwi wewnętrzne (kilka tysięcy komponentów
 * z kartotek Optimy) ze stanem w magazynie wewnętrznym, rezerwacjami
 * z otwartych zleceń i dostępnym = stan − rezerwacje.
 */
export default function InternalStockView({ components, onShowHistory, pushToast }: Props) {
  const [stock, setStock] = useState<Map<number, number>>(new Map())
  const [reserved, setReserved] = useState<Map<number, number>>(new Map())
  const [openOrders, setOpenOrders] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<DoorFilter>(DOOR_FILTER_EMPTY)
  const [onlyNonZero, setOnlyNonZero] = useState(false)
  const [page, setPage] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const st = await fetchAllPages<{ component_id: number; quantity: number }>((from, to) =>
        supabase
          .from('warehouse_stock')
          .select('component_id, quantity')
          .eq('warehouse_id', INTERNAL_WAREHOUSE_ID)
          .order('component_id')
          .range(from, to),
      )
      if (st.error) throw new Error(st.error.message)

      // otwarte = niewydane i nieanulowane zlecenia drzwi wewnętrznych (ręczne i z Optimy)
      const ord = await fetchAllPages<{ id: number; extra_fields: Record<string, unknown> | null }>((from, to) =>
        supabase
          .from('orders')
          .select('id, extra_fields')
          .eq('category', 'DrzwiWewnetrzne')
          .is('release_date', null)
          .order('id')
          .range(from, to),
      )
      if (ord.error) throw new Error(ord.error.message)
      const ids = ord.data.filter((o) => o.extra_fields?.cancelled !== true).map((o) => o.id)

      const items: OpenItem[] = []
      const moves: IssuedMovement[] = []
      for (let i = 0; i < ids.length; i += CHUNK) {
        const part = ids.slice(i, i + CHUNK)
        const [it, mv] = await Promise.all([
          fetchAllPages<OpenItem & { id: number }>((from, to) =>
            supabase
              .from('order_internal_door_items')
              .select('id, order_id, component_id, quantity')
              .in('order_id', part)
              .not('component_id', 'is', null)
              .order('id')
              .range(from, to),
          ),
          fetchAllPages<IssuedMovement & { id: number }>((from, to) =>
            supabase
              .from('warehouse_movements')
              .select('id, order_id, component_id, movement_type, quantity')
              .in('order_id', part)
              .in('movement_type', ['WZ', 'ZWR'])
              .order('id')
              .range(from, to),
          ),
        ])
        if (it.error) throw new Error(it.error.message)
        if (mv.error) throw new Error(mv.error.message)
        items.push(...it.data)
        moves.push(...mv.data)
      }
      setStock(new Map(st.data.map((r) => [Number(r.component_id), Number(r.quantity) || 0])))
      setReserved(internalReservations(items, moves))
      setOpenOrders(ids.length)
    } catch (e) {
      console.error('[magazyn wewnętrzne] stany/rezerwacje', e)
      pushToast(`Nie wczytano stanów magazynu wewnętrznego: ${e instanceof Error ? e.message : String(e)}`, 'error')
    } finally {
      setLoading(false)
    }
  }, [pushToast])

  useEffect(() => {
    void load()
  }, [load])

  const rows = useMemo<Row[]>(() => {
    return components
      .filter(isDoorComponent)
      .map((c) => {
        const s = stock.get(c.id) ?? 0
        const r = reserved.get(c.id) ?? 0
        return { ...c, stock: s, reserved: r, available: s - r }
      })
      .sort((a, b) => (a.code ?? a.name).localeCompare(b.code ?? b.name, 'pl'))
  }, [components, stock, reserved])

  const models = useMemo(() => distinctValues(rows, 'door_model', filter.category), [rows, filter.category])
  const colors = useMemo(() => distinctValues(rows, 'door_color', filter.category), [rows, filter.category])
  const categories = useMemo(() => [...new Set(rows.map((r) => r.product_category))].sort(), [rows])

  const shown = useMemo(
    () => rows.filter((r) => (!onlyNonZero || r.stock !== 0 || r.reserved !== 0) && matchesDoorFilter(r, filter)),
    [rows, filter, onlyNonZero],
  )
  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE))
  const curPage = Math.min(page, pageCount - 1)
  const pageRows = shown.slice(curPage * PAGE, (curPage + 1) * PAGE)
  const setF = (patch: Partial<DoorFilter>) => {
    setFilter((f) => ({ ...f, ...patch }))
    setPage(0)
  }

  const columns: DataTableColumn<Row>[] = [
    { key: 'code', label: 'KOD', render: (r) => <span className="optima-code">{r.code || '—'}</span> },
    { key: 'name', label: 'NAZWA', render: (r) => r.name },
    { key: 'cat', label: 'KATEGORIA', render: (r) => PRODUCT_CATEGORY_LABELS[r.product_category] ?? r.product_category },
    { key: 'model', label: 'MODEL', render: (r) => r.door_model || '—' },
    { key: 'color', label: 'KOLOR', render: (r) => r.door_color || '—' },
    { key: 'size', label: 'ROZMIAR', render: (r) => [r.door_size, r.door_direction].filter(Boolean).join(' ') || '—' },
    { key: 'stock', label: 'STAN', align: 'right', render: (r) => fmt(r.stock) },
    {
      key: 'reserved',
      label: 'REZERWACJE',
      align: 'right',
      title: 'Ilość z pozycji otwartych zleceń (niewydanych, nieanulowanych), która jeszcze nie zeszła z magazynu',
      render: (r) => (r.reserved > 0 ? fmt(r.reserved) : '—'),
    },
    {
      key: 'available',
      label: 'DOSTĘPNE',
      align: 'right',
      title: 'Stan − rezerwacje',
      render: (r) => <strong style={r.available < 0 ? { color: '#c62828' } : undefined}>{fmt(r.available)}</strong>,
    },
    {
      key: 'history',
      label: '',
      stopRowClick: true,
      render: (r) => (
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => onShowHistory(r)} title="Historia ruchów">
          Historia
        </button>
      ),
    },
  ]

  if (loading && stock.size === 0 && reserved.size === 0) return <Spinner center label="Wczytywanie magazynu wewnętrznego…" />

  return (
    <div className="internal-stock-view">
      <p className="muted" style={{ marginTop: 0 }}>
        Magazyn wewnętrzne — drzwi wewnętrzne. Rezerwacje = pozycje otwartych zleceń ({openOrders}), które jeszcze nie zeszły ze stanu;
        dostępne = stan − rezerwacje. Pozycje bez komponentu (kod z Optimy niepowiązany) nie rezerwują niczego.
      </p>
      <div className="inventory-filters">
        <input
          type="text"
          className="search-input"
          placeholder="Szukaj: kod, nazwa, model, kolor, rozmiar…"
          value={filter.q}
          onChange={(e) => setF({ q: e.target.value })}
        />
        <select value={filter.category} onChange={(e) => setF({ category: e.target.value, model: '', color: '' })} title="Kategoria">
          <option value="">Wszystkie kategorie</option>
          {categories.map((c) => (
            <option key={c} value={c}>{PRODUCT_CATEGORY_LABELS[c] ?? c}</option>
          ))}
        </select>
        {models.length > 0 && (
          <select value={filter.model} onChange={(e) => setF({ model: e.target.value })} title="Model">
            <option value="">Wszystkie modele</option>
            {models.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        )}
        {colors.length > 0 && (
          <select value={filter.color} onChange={(e) => setF({ color: e.target.value })} title="Kolor">
            <option value="">Wszystkie kolory</option>
            {colors.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        )}
        <label className="orders-filter-checkbox">
          <input type="checkbox" checked={onlyNonZero} onChange={(e) => { setOnlyNonZero(e.target.checked); setPage(0) }} />
          <span>Tylko ze stanem lub rezerwacją</span>
        </label>
        <button type="button" className="btn btn-sm btn-secondary" onClick={() => void load()} disabled={loading}>
          {loading ? 'Odświeżam…' : 'Odśwież'}
        </button>
      </div>
      <DataTable
        rows={pageRows}
        rowKey={(r) => r.id}
        columns={columns}
        wrapperClassName="orders-table-wrapper"
        emptyText={rows.length === 0 ? 'Brak komponentów drzwi wewnętrznych — zakłada je import kartotek Optimy' : 'Brak komponentów dla filtrów'}
      />
      <div className="inventory-pager">
        <span className="muted">
          {shown.length === rows.length ? `${rows.length} komponentów` : `${shown.length} z ${rows.length} komponentów`}
          {pageCount > 1 && ` · strona ${curPage + 1} z ${pageCount}`}
        </span>
        {pageCount > 1 && (
          <span className="inventory-pager-buttons">
            <button type="button" className="btn btn-sm btn-secondary" disabled={curPage === 0} onClick={() => setPage(0)}>«</button>
            <button type="button" className="btn btn-sm btn-secondary" disabled={curPage === 0} onClick={() => setPage(curPage - 1)}>‹ Poprzednia</button>
            <button type="button" className="btn btn-sm btn-secondary" disabled={curPage >= pageCount - 1} onClick={() => setPage(curPage + 1)}>Następna ›</button>
            <button type="button" className="btn btn-sm btn-secondary" disabled={curPage >= pageCount - 1} onClick={() => setPage(pageCount - 1)}>»</button>
          </span>
        )}
      </div>
    </div>
  )
}
