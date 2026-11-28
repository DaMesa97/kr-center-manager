import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../supabaseClient'
import { fetchAllPages } from '../../lib/fetchPaged'
import { PRODUCT_CATEGORY_LABELS } from '../../constants'
import { isMrProfilOrder, isOptimaClosed } from '../../lib/optimaRo'
import {
  DOOR_FILTER_EMPTY,
  distinctValues,
  internalReservations,
  isInternalDoorComponent,
  matchesDoorFilter,
  type DoorFilter,
  type IssuedMovement,
  type OpenItem,
} from '../../lib/internalWarehouse'
import DataTable, { type DataTableColumn } from '../DataTable'
import DoorStockGrid from './DoorStockGrid'
import { buildDoorGrid } from '../../lib/doorStockGrid'
import Spinner from '../Spinner'
import type { ToastVariant, WarehouseComponent } from '../../types'
import { formatIlosc } from '../../lib/magazynFormat'

type Props = {
  components: WarehouseComponent[]
  onShowHistory: (component: WarehouseComponent) => void
  pushToast: (msg: string, variant: ToastVariant) => void
}

/** stock = suma magazynów drzwi wewnętrznych (Magazyn 1 + Magazyn 2), byWh = stan per magazyn, incoming = w drodze (wysłane ZD) */
type Row = WarehouseComponent & { stock: number; byWh: Map<number, number>; reserved: number; available: number; incoming: number; eta: string | null }
type InternalWh = { id: number; code: string; name: string }

const PAGE = 100
const fmt = formatIlosc
const CHUNK = 150

/**
 * Magazyn → Stany → Wewnętrzne: drzwi wewnętrzne (kilka tysięcy komponentów
 * z kartotek Optimy) ze stanem w magazynie wewnętrznym, rezerwacjami
 * z otwartych zleceń i dostępnym = stan − rezerwacje.
 */
export default function InternalStockView({ components, onShowHistory, pushToast }: Props) {
  const [stock, setStock] = useState<Map<number, number>>(new Map())
  // 27.11: dwa magazyny drzwi wewnętrznych (WEW1 Magazyn 1, WEW2 Magazyn 2) — stan per magazyn + suma
  const [whs, setWhs] = useState<InternalWh[]>([])
  const [byWh, setByWh] = useState<Map<number, Map<number, number>>>(new Map())
  const [incoming, setIncoming] = useState<Map<number, { qty: number; eta: string | null }>>(new Map())
  /** co pokazuje kratka w układzie jak w Excelu: suma albo jeden magazyn */
  const [pokaz, setPokaz] = useState<'suma' | number>('suma')
  const [reserved, setReserved] = useState<Map<number, number>>(new Map())
  const [openOrders, setOpenOrders] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<DoorFilter>(DOOR_FILTER_EMPTY)
  const [onlyNonZero, setOnlyNonZero] = useState(false)
  const [page, setPage] = useState(0)
  // 27.11: domyślnie układ jak w dawnym Excelu (zakładki, model + kolor, szerokość × kierunek) — „żeby się w tym odnaleźli”
  const [mode, setMode] = useState<'excel' | 'lista'>('excel')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const wq = await supabase.from('warehouses').select('id, code, name').ilike('code', 'WEW%').eq('is_active', true).order('code')
      if (wq.error) throw new Error(wq.error.message)
      const whList = (wq.data ?? []) as InternalWh[]
      const whIds = whList.map((w) => w.id)
      const st = await fetchAllPages<{ component_id: number; warehouse_id: number; quantity: number }>((from, to) =>
        supabase
          .from('warehouse_stock')
          .select('component_id, warehouse_id, quantity')
          .in('warehouse_id', whIds.length > 0 ? whIds : [-1])
          .order('id')
          .range(from, to),
      )
      if (st.error) throw new Error(st.error.message)
      // w drodze = niedostarczone pozycje wysłanych zamówień do dostawców (ZD)
      const inc = await fetchAllPages<{ r_component_id: number; r_incoming_qty: number; r_earliest_eta: string | null }>((from, to) =>
        supabase.rpc('get_incoming_stock_per_component').range(from, to),
      )
      if (inc.error) console.warn('[magazyn wewnętrzne] w drodze', inc.error.message)

      // otwarte = niewydane i nieanulowane zlecenia drzwi wewnętrznych (ręczne i z Optimy)
      // RO zrealizowane / zamknięte w Optimie (stan 3–4) nie rezerwują — tylko otwarte
      // D10 (28.11): zlecenia z RO MR Profil schodzą z osobnego magazynu MR_WEW — nie rezerwują stanu KR
      const ord = await fetchAllPages<{ id: number; extra_fields: Record<string, unknown> | null; source: string | null; optima_state: string | null; optima_key: string | null }>((from, to) =>
        supabase
          .from('orders')
          .select('id, extra_fields, source, optima_state:source_metadata->>state, optima_key:source_metadata->>optima_key')
          .eq('category', 'DrzwiWewnetrzne')
          .is('release_date', null)
          .order('id')
          .range(from, to),
      )
      if (ord.error) throw new Error(ord.error.message)
      const ids = ord.data
        .filter((o) => o.extra_fields?.cancelled !== true)
        .filter((o) => !isMrProfilOrder(o))
        .filter((o) => !isOptimaClosed({ source: o.source ?? undefined, source_metadata: { state: o.optima_state } } as Parameters<typeof isOptimaClosed>[0]))
        .map((o) => o.id)

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
      const sum = new Map<number, number>()
      const per = new Map<number, Map<number, number>>()
      for (const row of st.data) {
        const c = Number(row.component_id)
        const q = Number(row.quantity) || 0
        sum.set(c, (sum.get(c) ?? 0) + q)
        if (!per.has(c)) per.set(c, new Map())
        per.get(c)!.set(Number(row.warehouse_id), q)
      }
      setWhs(whList)
      setStock(sum)
      setByWh(per)
      setIncoming(new Map(inc.data.map((x) => [Number(x.r_component_id), { qty: Number(x.r_incoming_qty) || 0, eta: x.r_earliest_eta }])))
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
      .filter((c) => isInternalDoorComponent(c) && (c.is_active || (stock.get(c.id) ?? 0) !== 0))
      .map((c) => {
        const s = stock.get(c.id) ?? 0
        const r = reserved.get(c.id) ?? 0
        const inc = incoming.get(c.id)
        return { ...c, stock: s, byWh: byWh.get(c.id) ?? new Map(), reserved: r, available: s - r, incoming: inc?.qty ?? 0, eta: inc?.eta ?? null }
      })
      .sort((a, b) => (a.code ?? a.name).localeCompare(b.code ?? b.name, 'pl'))
  }, [components, stock, byWh, reserved, incoming])
  const ruch = (r: Row) => r.stock !== 0 || r.reserved !== 0 || r.incoming !== 0 || [...r.byWh.values()].some((q) => q !== 0)
  const ilosc = (r: Row) => (pokaz === 'suma' ? r.stock : (r.byWh.get(pokaz) ?? 0))
  const opisStanu = (r: Row) =>
    [...whs.map((w) => `${w.name}: ${fmt(r.byWh.get(w.id) ?? 0)}`), `razem: ${fmt(r.stock)}`, `rezerwacje: ${fmt(r.reserved)}`, `dostępne: ${fmt(r.available)}`,
      ...(r.incoming > 0 ? [`w drodze: ${fmt(r.incoming)}${r.eta ? ` (${r.eta})` : ''}`] : [])].join('\n')

  const models = useMemo(() => distinctValues(rows, 'door_model', filter.category), [rows, filter.category])
  const colors = useMemo(() => distinctValues(rows, 'door_color', filter.category), [rows, filter.category])
  const categories = useMemo(() => [...new Set(rows.map((r) => r.product_category))].sort(), [rows])

  const shown = useMemo(
    () => rows.filter((r) => (!onlyNonZero || ruch(r)) && matchesDoorFilter(r, filter)),
    [rows, filter, onlyNonZero],
  )
  // układ jak w Excelu: pozycje trzymane na magazynie + to, co ma stan albo rezerwację (kartoteki w tle bez ruchu pomijamy)
  const grid = useMemo(
    () =>
      mode === 'excel'
        ? buildDoorGrid(
            shown.filter((r) => r.is_stocked !== false || ruch(r)),
            (r) => r,
          )
        : [],
    [mode, shown],
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
    ...whs.map((w): DataTableColumn<Row> => ({
      key: `wh${w.id}`,
      label: w.name.toUpperCase(),
      align: 'right',
      title: `Stan: ${w.name} (${w.code})`,
      render: (r) => fmt(r.byWh.get(w.id) ?? 0),
    })),
    { key: 'stock', label: whs.length > 1 ? 'RAZEM' : 'STAN', align: 'right', title: 'Suma magazynów drzwi wewnętrznych', render: (r) => <strong>{fmt(r.stock)}</strong> },
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
      key: 'incoming',
      label: 'W DRODZE',
      align: 'right',
      title: 'Niedostarczone pozycje wysłanych zamówień do dostawców (Zamawianie → Zamówienia)',
      render: (r) => (r.incoming > 0 ? <span title={r.eta ? `najwcześniej: ${r.eta}` : undefined}>{fmt(r.incoming)}</span> : '—'),
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
        Drzwi wewnętrzne — {whs.length > 0 ? whs.map((w) => w.name).join(' + ') : 'magazyny WEW'}; razem = suma magazynów. Rezerwacje = pozycje otwartych zleceń ({openOrders}; bez RO zrealizowanych i zamkniętych w Optimie), które jeszcze nie zeszły ze stanu;
        dostępne = razem − rezerwacje; w drodze = wysłane zamówienia do dostawców. Wydanie zlecenia zdejmuje najpierw z {whs[0]?.name ?? 'Magazynu 1'}, brakujące z {whs[1]?.name ?? 'Magazynu 2'}.
        Przerzuty między magazynami: Dokumenty → Przesunięcia (MM); przyjęcia: Dokumenty → Przyjęcia (PZ); wydanie na reklamację: Dokumenty → WZ reklamacyjne.
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
          <span>Tylko ze stanem, rezerwacją lub w drodze</span>
        </label>
        <button type="button" className="btn btn-sm btn-secondary" onClick={() => void load()} disabled={loading}>
          {loading ? 'Odświeżam…' : 'Odśwież'}
        </button>
        {mode === 'excel' && whs.length > 1 && (
          <label className="day-filter" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} title="Co pokazuje kratka STAN">
            <span>Kratka:</span>
            <select value={String(pokaz)} onChange={(e) => setPokaz(e.target.value === 'suma' ? 'suma' : Number(e.target.value))}>
              <option value="suma">Razem (wszystkie magazyny)</option>
              {whs.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </label>
        )}
        <span className="door-grid-mode" role="group" aria-label="Układ">
          <button type="button" className={`btn btn-sm ${mode === 'excel' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode('excel')}>
            Jak w Excelu
          </button>
          <button type="button" className={`btn btn-sm ${mode === 'lista' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode('lista')}>
            Lista
          </button>
        </span>
      </div>
      {mode === 'excel' ? (
        <DoorStockGrid
          sheets={grid}
          emptyText={rows.length === 0 ? 'Brak komponentów drzwi wewnętrznych — zakłada je import kartotek Optimy' : 'Brak komponentów dla filtrów'}
          renderCell={(r) => (
            <button
              type="button"
              className="btn-link"
              style={{ textDecoration: 'none', fontWeight: 700 }}
              title={`${r.code ? `${r.code} — ` : ''}${r.name}\n${opisStanu(r)}\nkliknij: historia ruchów`}
              onClick={() => onShowHistory(r)}
            >
              <span className={ilosc(r) < 0 ? 'door-grid-stock-neg' : undefined}>{fmt(ilosc(r))}</span>
              {pokaz === 'suma' && whs.length > 1 && r.stock !== 0 && (
                <span className="door-grid-split">{whs.map((w) => fmt(r.byWh.get(w.id) ?? 0)).join(' + ')}</span>
              )}
              {r.reserved > 0 && <span className="door-grid-res">rez. {fmt(r.reserved)}</span>}
              {r.incoming > 0 && <span className="door-grid-inc">w drodze {fmt(r.incoming)}</span>}
            </button>
          )}
        />
      ) : (
      <>
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
      </>
      )}
    </div>
  )
}
