import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../supabaseClient'
import { generateInventorySheet } from '../../utils/inventoryPdfGenerator'
import Spinner from '../Spinner'
import DataTable, { type DataTableColumn } from '../DataTable'
import type { CurrentUser, InventoryLine, InventorySession, ToastVariant, Warehouse, WarehouseComponent } from '../../types'
import { isManagerRole } from '../../lib/permissions'
import { fetchAllPages } from '../../lib/fetchPaged'
import { inventoryReview, parseCountInput } from '../../lib/inventory'
import { DOOR_FILTER_EMPTY, distinctValues, isDoorCategory, matchesDoorFilter, sortInventoryLines, type DoorFilter } from '../../lib/internalWarehouse'
import { buildDoorGrid } from '../../lib/doorStockGrid'
import DoorStockGrid from './DoorStockGrid'
import { PRODUCT_CATEGORY_LABELS } from '../../constants'

/** pozycji spisu na stronę — magazyn wewnętrzne ma kilka tysięcy komponentów z kartotek Optimy */
const INV_PAGE = 100

/** excel = magazyn wewnętrzne ułożony jak dawny Excel i kartka PDF (27.11); domyślnie dla spisu z drzwiami wewnętrznymi */
type LinesView = DoorFilter & { onlyCounted: boolean; page: number; showBackground: boolean; excel: boolean }
const LINES_VIEW_EMPTY: LinesView = { ...DOOR_FILTER_EMPTY, onlyCounted: false, page: 0, showBackground: false, excel: true }

/** atrybuty pozycji spisu dla układu jak w Excelu */
const lineGridAttrs = (l: InventoryLine) => ({
  name: l.component_name,
  product_category: l.component_category,
  door_model: l.component_door_model,
  door_color: l.component_door_color,
  door_size: l.component_door_size,
  door_direction: l.component_door_direction,
})

/** Pozycja liczy się do spisu: trzymamy ją na magazynie (is_stocked) albo ktoś ją już policzył. Kartoteki w tle
 *  (is_stocked = false, towar na zamówienie) widać tylko po włączeniu „Kartoteki w tle” — nie idą do postępu, kartki ani zamknięcia. */
const naSpisie = (l: InventoryLine) => l.component_is_stocked !== false || l.counted_qty != null

type Props = {
  pushToast: (msg: string, variant: ToastVariant) => void
  currentUser: CurrentUser | null
  /** aktywne komponenty (do „Dodaj pozycję” spoza listy spisu) */
  components?: WarehouseComponent[]
}

type PastSession = InventorySession & { warehouse_id: number | null; warehouse_name?: string }

type SessionWithLines = {
  session: InventorySession & { warehouse_id: number | null }
  lines: InventoryLine[]
}

type LinesResult = { lines: InventoryLine[]; error: string | null }

async function fetchLines(sessionId: number): Promise<LinesResult> {
  const { data, error } = await fetchAllPages<Record<string, unknown>>((from, to) =>
    supabase
      .from('inventory_lines')
      .select('id, session_id, component_id, system_qty, counted_qty, notes, warehouse_components ( name, unit, code, product_category, door_model, door_color, door_size, door_direction, is_stocked )')
      .eq('session_id', sessionId)
      .order('id', { ascending: true })
      .range(from, to),
  )
  if (error) return { lines: [], error: error.message }
  return {
    error: null,
    lines: sortInventoryLines(data.map((l) => {
      const wc = l.warehouse_components as {
        name?: string; unit?: string; code?: string | null; product_category?: string | null
        door_model?: string | null; door_color?: string | null; door_size?: string | null; door_direction?: string | null
        is_stocked?: boolean | null
      } | null
      return {
        id: l.id as number,
        session_id: l.session_id as number,
        component_id: l.component_id as number,
        system_qty: Number(l.system_qty ?? 0),
        counted_qty: l.counted_qty != null ? Number(l.counted_qty) : null,
        notes: l.notes as string | null,
        component_name: wc?.name ?? `#${String(l.component_id)}`,
        component_unit: wc?.unit ?? '',
        component_code: wc?.code ?? null,
        component_category: wc?.product_category ?? null,
        component_door_model: wc?.door_model ?? null,
        component_door_color: wc?.door_color ?? null,
        component_door_size: wc?.door_size ?? null,
        component_door_direction: wc?.door_direction ?? null,
        component_is_stocked: wc ? wc.is_stocked !== false : true,
      }
    })),
    // kartoteki w tle (is_stocked = false) zostają w danych, ale poza spisem (naSpisie) — widać je po włączeniu filtra
    // magazyn wewnętrzny: skrzydła, ościeżnice, klamki, akcesoria, osłonki — w grupie po nazwie
  }
}

export default function InventoryView({ pushToast, currentUser, components = [] }: Props) {
  const [loading, setLoading] = useState(false)
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [openSessions, setOpenSessions] = useState<SessionWithLines[]>([])
  const [pastSessions, setPastSessions] = useState<PastSession[]>([])
  const [opening, setOpening] = useState<number | null>(null) // warehouse_id otwierany
  const [closing, setClosing] = useState<number | null>(null) // session_id zamykany / przygotowywany
  const [newNotes, setNewNotes] = useState<Record<number, string>>({})
  const [showOpenForm, setShowOpenForm] = useState<number | null>(null) // warehouse_id
  // D14: przy otwieraniu spisu — od razu wstrzymać PZ / MM na tym magazynie (zalecane, gdy liczenie zaraz rusza)
  const [lockOnOpen, setLockOnOpen] = useState(true)
  const [lockBusy, setLockBusy] = useState<number | null>(null) // session_id
  const [draftCounts, setDraftCounts] = useState<Record<number, string>>({})
  const [saving, setSaving] = useState<Set<number>>(new Set())
  const [failed, setFailed] = useState<Set<number>>(new Set()) // pozycje, których zapis się NIE udał
  const [addComponentId, setAddComponentId] = useState<Record<number, string>>({}) // session_id -> component_id
  const [adding, setAdding] = useState<number | null>(null) // session_id
  const [closeReview, setCloseReview] = useState<SessionWithLines | null>(null)
  // wyszukiwarka / filtry / strona — osobno dla każdej otwartej sesji
  const [linesView, setLinesView] = useState<Record<number, LinesView>>({})
  const viewOf = (sessionId: number) => linesView[sessionId] ?? LINES_VIEW_EMPTY
  const patchView = (sessionId: number, patch: Partial<LinesView>) =>
    setLinesView((prev) => ({ ...prev, [sessionId]: { ...(prev[sessionId] ?? LINES_VIEW_EMPTY), ...patch } }))
  // Enter na ostatniej pozycji strony → następna strona, kursor na pierwszą pozycję
  const pendingFocus = useRef<number | null>(null)
  const pageCountRef = useRef<Record<number, number>>({})

  const saveTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({})
  // Zapisy w locie (per pozycja, łańcuchowane — kolejne wpisy tej samej pozycji nie wyprzedzają się)
  const inFlight = useRef<Map<number, Promise<boolean>>>(new Map())
  // Lustra stanu dla callbacków (debounce / flush czytają NAJNOWSZE wartości)
  const draftsRef = useRef<Record<number, string>>({})
  const failedRef = useRef<Set<number>>(new Set())
  const linesRef = useRef<Map<number, InventoryLine>>(new Map())

  const isManager = isManagerRole(currentUser?.role)

  useEffect(() => {
    const m = new Map<number, InventoryLine>()
    for (const sd of openSessions) for (const l of sd.lines) m.set(l.id, l)
    linesRef.current = m
  }, [openSessions])

  const markFailed = useCallback((lineId: number, isFailed: boolean) => {
    if (isFailed) failedRef.current.add(lineId)
    else failedRef.current.delete(lineId)
    setFailed(new Set(failedRef.current))
  }, [])

  const applyLines = useCallback((sessionId: number, lines: InventoryLine[]) => {
    setOpenSessions((prev) => prev.map((sd) => (sd.session.id === sessionId ? { ...sd, lines } : sd)))
    // drafty z bazy tylko dla pozycji bez niezapisanej edycji
    const drafts: Record<number, string> = {}
    for (const l of lines) {
      if (saveTimers.current[l.id] || failedRef.current.has(l.id)) continue
      drafts[l.id] = l.counted_qty != null ? String(l.counted_qty) : ''
    }
    draftsRef.current = { ...draftsRef.current, ...drafts }
    setDraftCounts((prev) => ({ ...prev, ...drafts }))
  }, [])

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const { data: whData, error: whErr } = await supabase
        .from('warehouses')
        .select('id, code, name, is_active')
        .eq('is_active', true)
        .order('name')
      if (whErr) {
        pushToast(`Błąd pobierania magazynów: ${whErr.message}`, 'error')
        return
      }
      setWarehouses((whData ?? []) as Warehouse[])

      const { data: openData, error: openErr } = await supabase
        .from('inventory_sessions')
        .select('*')
        .eq('status', 'open')
        .order('created_at', { ascending: false })
      if (openErr) {
        pushToast(`Błąd pobierania sesji inwentaryzacji: ${openErr.message}`, 'error')
        return
      }

      const open: SessionWithLines[] = []
      const drafts: Record<number, string> = {}
      for (const s of (openData ?? []) as Array<InventorySession & { warehouse_id: number | null }>) {
        const { lines, error } = await fetchLines(s.id)
        if (error) {
          pushToast(`Błąd pobierania pozycji spisu: ${error}`, 'error')
          return
        }
        for (const l of lines) {
          if (saveTimers.current[l.id] || failedRef.current.has(l.id)) continue
          drafts[l.id] = l.counted_qty != null ? String(l.counted_qty) : ''
        }
        open.push({ session: s, lines })
      }
      draftsRef.current = { ...draftsRef.current, ...drafts }
      setDraftCounts((prev) => ({ ...prev, ...drafts }))
      setOpenSessions(open)

      const { data: closed, error: closedErr } = await supabase
        .from('inventory_sessions')
        .select('*, warehouses ( name )')
        .eq('status', 'closed')
        .order('counted_date', { ascending: false })
        .limit(20)
      if (closedErr) {
        pushToast(`Błąd pobierania historii inwentaryzacji: ${closedErr.message}`, 'error')
        return
      }
      setPastSessions(
        ((closed ?? []) as Array<Record<string, unknown>>).map((s) => ({
          ...(s as unknown as InventorySession & { warehouse_id: number | null }),
          warehouse_name: (s.warehouses as { name?: string } | null)?.name ?? '—',
        })),
      )
    } finally {
      setLoading(false)
    }
  }, [pushToast])

  useEffect(() => { void fetchData() }, [fetchData])

  // Zapis jednej pozycji. Błąd = toast + pozycja oznaczona na czerwono (NIE udajemy zapisu).
  const saveLine = useCallback(async (lineId: number, raw: string): Promise<boolean> => {
    const name = linesRef.current.get(lineId)?.component_name ?? `pozycja #${lineId}`
    const parsed = parseCountInput(raw)
    if (!parsed.ok) {
      markFailed(lineId, true)
      pushToast(`Nieprawidłowa ilość „${raw}” (${name}) — nie zapisano`, 'error')
      return false
    }
    setSaving((prev) => new Set(prev).add(lineId))
    // RPC stempluje system_qty stanem z CHWILI liczenia tej pozycji —
    // snapshot z otwarcia sesji liczył podwójnie ruchy zrobione w trakcie spisu
    const { error } = await supabase.rpc('record_inventory_count_line', {
      p_line_id: lineId,
      p_counted: parsed.value,
    })
    setSaving((prev) => { const s = new Set(prev); s.delete(lineId); return s })
    if (error) {
      markFailed(lineId, true)
      pushToast(`Nie zapisano liczenia (${name}): ${error.message}`, 'error')
      return false
    }
    markFailed(lineId, false)
    setOpenSessions((prev) => prev.map((sd) => ({
      ...sd,
      lines: sd.lines.map((l) => (l.id === lineId ? { ...l, counted_qty: parsed.value } : l)),
    })))
    return true
  }, [markFailed, pushToast])

  const runSave = useCallback((lineId: number, raw: string): Promise<boolean> => {
    const prev = inFlight.current.get(lineId) ?? Promise.resolve(true)
    const p: Promise<boolean> = prev.then(() => saveLine(lineId, raw))
    inFlight.current.set(lineId, p)
    void p.finally(() => {
      if (inFlight.current.get(lineId) === p) inFlight.current.delete(lineId)
    })
    return p
  }, [saveLine])

  const scheduleLineSave = useCallback((lineId: number) => {
    if (saveTimers.current[lineId]) clearTimeout(saveTimers.current[lineId])
    saveTimers.current[lineId] = setTimeout(() => {
      // Usuń SWÓJ wpis z rejestru timerów — bez tego flush przy zamykaniu
      // sesji wysyłał ponownie KAŻDĄ kiedykolwiek edytowaną pozycję i
      // stemplował jej system_qty stanem z chwili zamknięcia (fałszywe korekty)
      delete saveTimers.current[lineId]
      void runSave(lineId, draftsRef.current[lineId] ?? '')
    }, 800)
  }, [runSave])

  const handleCountChange = (lineId: number, value: string) => {
    draftsRef.current = { ...draftsRef.current, [lineId]: value }
    setDraftCounts((prev) => ({ ...prev, [lineId]: value }))
    scheduleLineSave(lineId)
  }

  // Zapisz wszystko, co czeka w debounce, ponów nieudane i poczekaj na zapisy w locie.
  // false = coś się nie zapisało (toast już poszedł).
  const flushPending = useCallback(async (): Promise<boolean> => {
    const ids = new Set<number>([...Object.keys(saveTimers.current).map(Number), ...failedRef.current])
    for (const id of ids) {
      if (saveTimers.current[id]) {
        clearTimeout(saveTimers.current[id])
        delete saveTimers.current[id]
      }
      void runSave(id, draftsRef.current[id] ?? '')
    }
    const results = await Promise.all([...inFlight.current.values()])
    return results.every(Boolean) && failedRef.current.size === 0
  }, [runSave])

  // D14: włącz / zdejmij blokadę PZ i MM dla otwartego spisu (rpc ustaw_blokade_spisu; baza bez migracji → 'unsupported')
  const setSessionLock = async (sessionId: number, on: boolean): Promise<'ok' | 'unsupported' | 'error'> => {
    const { error } = await supabase.rpc('ustaw_blokade_spisu', { p_session_id: sessionId, p_blokada: on })
    if (!error) return 'ok'
    if (error.code === 'PGRST202') return 'unsupported'
    console.error('ustaw_blokade_spisu', error)
    return 'error'
  }

  const handleToggleLock = async (sd: SessionWithLines) => {
    const on = !sd.session.blokada_ruchow
    setLockBusy(sd.session.id)
    try {
      const res = await setSessionLock(sd.session.id, on)
      if (res === 'ok') {
        pushToast(on ? 'PZ i MM na tym magazynie wstrzymane do zamknięcia spisu' : 'Blokada PZ / MM zdjęta', 'success')
        await fetchData()
      } else {
        pushToast(res === 'unsupported' ? 'Blokada PZ / MM będzie dostępna po aktualizacji bazy' : 'Nie zmieniono blokady — spróbuj jeszcze raz', 'error')
      }
    } finally {
      setLockBusy(null)
    }
  }

  const handleOpenSession = async (warehouseId: number) => {
    setOpening(warehouseId)
    try {
      const { data: newId, error } = await supabase.rpc('open_inventory_session', {
        p_notes: (newNotes[warehouseId] ?? '').trim() || null,
        p_warehouse_id: warehouseId,
      })
      if (error) { pushToast(`Błąd: ${error.message}`, 'error'); return }
      const sessionId = Number(newId)
      if (lockOnOpen && Number.isFinite(sessionId) && sessionId > 0) {
        const lock = await setSessionLock(sessionId, true)
        pushToast(
          lock === 'ok'
            ? 'Sesja inwentaryzacyjna otwarta — PZ i MM na tym magazynie wstrzymane do zamknięcia spisu'
            : lock === 'unsupported'
              ? 'Sesja inwentaryzacyjna otwarta (blokada PZ / MM będzie dostępna po aktualizacji bazy)'
              : 'Sesja otwarta, ale blokady PZ / MM nie włączono — spróbuj przełącznikiem przy sesji',
          lock === 'error' ? 'error' : 'success',
        )
      } else {
        pushToast('Sesja inwentaryzacyjna otwarta', 'success')
      }
      setShowOpenForm(null)
      setNewNotes((prev) => ({ ...prev, [warehouseId]: '' }))
      await fetchData()
    } finally {
      setOpening(null)
    }
  }

  const handleAddLine = async (sessionId: number) => {
    const componentId = Number(addComponentId[sessionId] ?? '')
    if (!componentId) { pushToast('Wybierz komponent do dopisania', 'error'); return }
    setAdding(sessionId)
    try {
      const { error } = await supabase.rpc('add_inventory_line', {
        p_session_id: sessionId,
        p_component_id: componentId,
      })
      if (error) { pushToast(`Nie dodano pozycji: ${error.message}`, 'error'); return }
      const { lines, error: linesErr } = await fetchLines(sessionId)
      if (linesErr) { pushToast(`Pozycja dodana, ale nie odświeżono listy: ${linesErr}`, 'error'); return }
      applyLines(sessionId, lines)
      setAddComponentId((prev) => ({ ...prev, [sessionId]: '' }))
      pushToast('Pozycja dopisana do spisu', 'success')
    } finally {
      setAdding(null)
    }
  }

  // Krok 1: zapisz zaległe liczenia, pobierz AKTUALNE linie z bazy i pokaż różnice
  // (kierownik widzi listę ZANIM korekty się zaksięgują — literówka nie wjeżdża w stany;
  // różnice z bazy, nie z pamięci — ktoś mógł liczyć równolegle na drugim stanowisku)
  const handleCloseSession = async (sd: SessionWithLines) => {
    setClosing(sd.session.id)
    try {
      const allSaved = await flushPending()
      if (!allSaved) {
        pushToast('Nie wszystkie liczenia się zapisały (pola na czerwono) — popraw je przed zamknięciem', 'error')
        return
      }
      const { lines, error } = await fetchLines(sd.session.id)
      if (error) { pushToast(`Nie pobrano aktualnych pozycji spisu: ${error}`, 'error'); return }
      applyLines(sd.session.id, lines)
      setCloseReview({ session: sd.session, lines: lines.filter(naSpisie) })
    } finally {
      setClosing(null)
    }
  }

  // Krok 2: zatwierdzone → księguj (korekty INW + przeliczenie braków zleceń w bazie)
  const handleConfirmClose = async (sd: SessionWithLines) => {
    setCloseReview(null)
    setClosing(sd.session.id)
    try {
      const allSaved = await flushPending()
      if (!allSaved) {
        pushToast('Nie wszystkie liczenia się zapisały — zamknięcie przerwane', 'error')
        return
      }
      const { error } = await supabase.rpc('close_inventory_session', { p_session_id: sd.session.id })
      if (error) { pushToast(`Błąd zamknięcia: ${error.message}`, 'error'); return }
      pushToast('Inwentaryzacja zamknięta — korekty stanów zaksięgowane, braki zleceń przeliczone', 'success')
      await fetchData()
    } finally {
      setClosing(null)
    }
  }

  const review = useMemo(
    () => (closeReview ? inventoryReview(closeReview.lines) : { diffs: [], uncounted: 0 }),
    [closeReview],
  )

  const handleExportPdf = (sd: SessionWithLines) => {
    generateInventorySheet(sd.session, sd.lines.filter(naSpisie), undefined, warehouses.find((w) => w.id === sd.session.warehouse_id)?.name)
  }

  const handleExportPastPdf = async (session: InventorySession & { warehouse_id: number | null }) => {
    const { lines, error } = await fetchLines(session.id)
    if (error) { pushToast(`Nie pobrano pozycji spisu: ${error}`, 'error'); return }
    generateInventorySheet(session, lines.filter(naSpisie), undefined, warehouses.find((w) => w.id === session.warehouse_id)?.name)
  }

  const activeComponentsSorted = useMemo(
    () =>
      components
        .filter((c) => c.is_active)
        .sort((a, b) => (a.code ?? a.name).localeCompare(b.code ?? b.name, 'pl')),
    [components],
  )

  // ŚLEPY SPIS: bez stanu systemowego i różnicy — liczący wpisuje to, co widzi
  // na półce; różnice zobaczy kierownik przy zatwierdzaniu zamknięcia
  // #88: podświetlenie całego wiersza, w którym stoi kursor — przy liczeniu z kartki
  // łatwo zgubić, który komponent się wpisuje
  const [activeLineId, setActiveLineId] = useState<number | null>(null)

  const lineNo = useMemo(() => {
    const m = new Map<number, number>()
    // numeracja jak na kartce do liczenia (tylko pozycje spisu; kartoteki w tle bez numeru)
    for (const sd of openSessions) sd.lines.filter(naSpisie).forEach((l, i) => m.set(l.id, i + 1))
    return m
  }, [openSessions])

  useEffect(() => {
    if (pendingFocus.current == null) return
    const sessionId = pendingFocus.current
    pendingFocus.current = null
    document.querySelector<HTMLInputElement>(`input[data-inv-session="${sessionId}"]`)?.focus()
  })

  // Enter = następna pozycja (szybkie wpisywanie z kartki); na końcu strony — kolejna strona
  const focusNextCount = (sessionId: number, current: HTMLInputElement) => {
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>(`input[data-inv-session="${sessionId}"]`))
    const idx = inputs.indexOf(current)
    if (idx >= 0 && idx < inputs.length - 1) {
      inputs[idx + 1].focus()
      inputs[idx + 1].select()
      return
    }
    const v = viewOf(sessionId)
    if (v.page < (pageCountRef.current[sessionId] ?? 1) - 1) {
      pendingFocus.current = sessionId
      patchView(sessionId, { page: v.page + 1 })
    }
  }

  const lineColumns = useMemo((): DataTableColumn<InventoryLine>[] => [
    {
      key: 'lp',
      label: 'Lp.',
      align: 'center',
      thStyle: { width: '3rem' },
      tdStyle: { color: '#94a3b8', fontSize: '0.8rem' },
      render: (line) => lineNo.get(line.id) ?? '',
    },
    {
      key: 'name',
      label: 'Nazwa komponentu',
      render: (line) => (
        <div className="inventory-component-name">
          {line.component_name}
          {line.component_code && <span className="inventory-component-code">{line.component_code}</span>}
          {(line.component_door_model || line.component_door_color || line.component_door_size) && (
            <span className="inventory-component-attrs">
              {[line.component_door_model, line.component_door_color, line.component_door_size, line.component_door_direction].filter(Boolean).join(' · ')}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'unit',
      label: 'J.m.',
      align: 'center',
      thStyle: { width: '5rem' },
      tdStyle: { color: '#64748b', fontSize: '0.85rem' },
      render: (line) => line.component_unit,
    },
    {
      key: 'counted',
      label: 'Policzono',
      align: 'center',
      thStyle: { width: '10rem' },
      render: (line) => renderCountInput(line),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [draftCounts, saving, failed, lineNo])

  function renderCountInput(line: InventoryLine) {
    return (
        <div className="inventory-input-wrap">
          <input
            type="number"
            className={`inventory-count-input${saving.has(line.id) ? ' inventory-count-input--saving' : ''}`}
            style={failed.has(line.id) ? { borderColor: '#dc2626', background: '#fef2f2' } : undefined}
            title={failed.has(line.id) ? 'Nie zapisano — popraw wartość lub spróbuj ponownie' : undefined}
            value={draftCounts[line.id] ?? ''}
            min={0}
            step="0.001"
            placeholder="—"
            data-inv-session={line.session_id}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              focusNextCount(line.session_id, e.currentTarget)
            }}
            onChange={(e) => handleCountChange(line.id, e.target.value)}
            onFocus={() => setActiveLineId(line.id)}
            onBlur={() => setActiveLineId((cur) => (cur === line.id ? null : cur))}
          />
          {saving.has(line.id) && <span className="inventory-saving-dot" title="Zapisywanie…">●</span>}
          {failed.has(line.id) && !saving.has(line.id) && (
            <span style={{ color: '#dc2626', fontSize: '0.75rem', fontWeight: 700 }} title="Nie zapisano">!</span>
          )}
        </div>
    )
  }

  const historyColumns = useMemo((): DataTableColumn<PastSession>[] => [
    { key: 'warehouse', label: 'Magazyn', render: (s) => <strong>{s.warehouse_name}</strong> },
    { key: 'date', label: 'Data liczenia', render: (s) => s.counted_date },
    {
      key: 'closed',
      label: 'Zamknięta',
      tdStyle: { color: '#64748b', fontSize: '0.85rem' },
      render: (s) => (s.closed_at ? new Date(s.closed_at).toLocaleDateString('pl-PL') : '—'),
    },
    { key: 'notes', label: 'Uwagi', tdStyle: { color: '#64748b', fontSize: '0.85rem' }, render: (s) => s.notes ?? '—' },
    {
      key: 'pdf',
      label: 'PDF',
      align: 'center',
      render: (s) => (
        <button type="button" className="btn btn-sm btn-secondary" onClick={() => void handleExportPastPdf(s)}>
          ↓ PDF
        </button>
      ),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [])

  if (loading) return <Spinner center label="Ładowanie danych inwentaryzacji…" />

  return (
    <div className="inventory-view">

      {/* ── Aktywne sesje per magazyn ── */}
      {warehouses.map((wh) => {
        const sd = openSessions.find((s) => s.session.warehouse_id === wh.id)
        const spis = sd ? sd.lines.filter(naSpisie) : []
        const tlo = sd ? sd.lines.length - spis.length : 0
        const filledCount = spis.filter((l) => l.counted_qty != null).length
        const totalCount = spis.length
        const inSession = sd ? new Set(sd.lines.map((l) => l.component_id)) : null
        const addable = inSession ? activeComponentsSorted.filter((c) => !inSession.has(c.id)) : []

        return (
          <div key={wh.id} className="inventory-warehouse-section">
            <div className="inventory-warehouse-header">
              <span className="inventory-warehouse-name">{wh.name}</span>
              {sd ? (
                <span className="inventory-status-badge inventory-status-badge--open">● Otwarta</span>
              ) : (
                <span className="inventory-status-badge inventory-status-badge--none">Brak sesji</span>
              )}
            </div>

            {/* Otwarta sesja */}
            {sd && (
              <>
                <div className="inventory-header">
                  <div className="inventory-header-info">
                    <strong>Data liczenia: {sd.session.counted_date}</strong>
                    {sd.session.notes && <span className="inventory-notes-text">{sd.session.notes}</span>}
                    {sd.session.blokada_ruchow === true && (
                      <span className="inventory-notes-text" style={{ color: '#b45309', fontWeight: 600 }}>
                        PZ i MM na tym magazynie wstrzymane do zamknięcia spisu
                      </span>
                    )}
                  </div>
                  <div className="inventory-header-actions">
                    {isManager && typeof sd.session.blokada_ruchow === 'boolean' && (
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        onClick={() => void handleToggleLock(sd)}
                        disabled={lockBusy === sd.session.id}
                        title="Liczysz teraz? Wstrzymaj przyjęcia i przesunięcia, żeby dostawa w trakcie liczenia nie zniknęła w korekcie spisu."
                      >
                        {lockBusy === sd.session.id ? 'Zapisywanie…' : sd.session.blokada_ruchow ? 'Zdejmij blokadę PZ / MM' : 'Wstrzymaj PZ i MM'}
                      </button>
                    )}
                    <button type="button" className="btn btn-sm btn-secondary" onClick={() => handleExportPdf(sd)}>
                      ↓ PDF (kartka do liczenia)
                    </button>
                    {isManager && (
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={() => void handleCloseSession(sd)}
                        disabled={closing === sd.session.id}
                      >
                        {closing === sd.session.id ? 'Zamykanie…' : 'Zamknij — pokaż różnice'}
                      </button>
                    )}
                  </div>
                </div>

                <div className="inventory-progress">
                  <div className="inventory-progress-bar-wrap">
                    <div
                      className="inventory-progress-bar-fill"
                      style={{ width: `${totalCount > 0 ? (filledCount / totalCount) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="inventory-progress-label">
                    {filledCount} / {totalCount} pozycji
                  </span>
                </div>

                <InventoryLinesFilters
                  lines={sd.lines}
                  view={viewOf(sd.session.id)}
                  backgroundCount={tlo}
                  onChange={(patch) => patchView(sd.session.id, { ...patch, page: 0 })}
                />
                {(() => {
                  const v = viewOf(sd.session.id)
                  const base = v.showBackground ? sd.lines : spis
                  const shown = base.filter((l) => {
                    if (v.onlyCounted) {
                      const p = parseCountInput(draftCounts[l.id] ?? '')
                      if (!p.ok || p.value == null || p.value <= 0) return false
                    }
                    return matchesDoorFilter(
                      {
                        code: l.component_code, name: l.component_name, product_category: l.component_category,
                        door_model: l.component_door_model, door_color: l.component_door_color,
                        door_size: l.component_door_size, door_direction: l.component_door_direction,
                      },
                      v,
                    )
                  })
                  const doorSpis = sd.lines.some((l) => isDoorCategory(l.component_category))
                  const przelacznik = doorSpis && (
                    <div className="door-grid-mode" role="group" aria-label="Układ spisu" style={{ margin: '4px 0 8px' }}>
                      <button type="button" className={`btn btn-sm ${v.excel ? 'btn-primary' : 'btn-secondary'}`} onClick={() => patchView(sd.session.id, { excel: true })}>
                        Jak na kartce (Excel)
                      </button>
                      <button type="button" className={`btn btn-sm ${!v.excel ? 'btn-primary' : 'btn-secondary'}`} onClick={() => patchView(sd.session.id, { excel: false })}>
                        Lista
                      </button>
                    </div>
                  )
                  if (doorSpis && v.excel) {
                    // układ jak na kartce PDF: Enter idzie po kolei w zakładce (blok po bloku, LEWA → PRAWA)
                    pageCountRef.current[sd.session.id] = 1
                    return (
                      <>
                        {przelacznik}
                        <DoorStockGrid
                          sheets={buildDoorGrid(shown, lineGridAttrs)}
                          cellWidth={76}
                          emptyText={sd.lines.length === 0 ? 'Brak pozycji w spisie' : 'Brak pozycji dla wybranych filtrów'}
                          renderCell={(line) => (
                            <span title={`${line.component_code ? `${line.component_code} — ` : ''}${line.component_name ?? ''}`}>
                              {renderCountInput(line)}
                            </span>
                          )}
                        />
                        <p className="muted" style={{ fontSize: '0.8rem' }}>{shown.length} pozycji · Enter = następna kratka</p>
                      </>
                    )
                  }
                  const pageCount = Math.max(1, Math.ceil(shown.length / INV_PAGE))
                  pageCountRef.current[sd.session.id] = pageCount
                  const page = Math.min(v.page, pageCount - 1)
                  const pageRows = shown.slice(page * INV_PAGE, (page + 1) * INV_PAGE)
                  return (
                    <>
                      {przelacznik}
                      <DataTable
                        rows={pageRows}
                        rowKey={(line) => line.id}
                        columns={lineColumns}
                        className="inventory-table"
                        emptyText={sd.lines.length === 0 ? 'Brak pozycji w spisie' : 'Brak pozycji dla wybranych filtrów'}
                        rowClassName={(line) => [line.id === activeLineId ? 'inventory-row--active' : '', naSpisie(line) ? '' : 'inventory-row--background'].filter(Boolean).join(' ') || undefined}
                      />
                      <div className="inventory-pager">
                        <span className="muted">
                          {shown.length === base.length ? `${shown.length} pozycji` : `${shown.length} z ${base.length} pozycji`}
                          {pageCount > 1 && ` · strona ${page + 1} z ${pageCount}`}
                          {' · Enter = następna pozycja'}
                        </span>
                        {pageCount > 1 && (
                          <span className="inventory-pager-buttons">
                            <button type="button" className="btn btn-sm btn-secondary" disabled={page === 0} onClick={() => patchView(sd.session.id, { page: 0 })}>«</button>
                            <button type="button" className="btn btn-sm btn-secondary" disabled={page === 0} onClick={() => patchView(sd.session.id, { page: page - 1 })}>‹ Poprzednia</button>
                            <button type="button" className="btn btn-sm btn-secondary" disabled={page >= pageCount - 1} onClick={() => patchView(sd.session.id, { page: page + 1 })}>Następna ›</button>
                            <button type="button" className="btn btn-sm btn-secondary" disabled={page >= pageCount - 1} onClick={() => patchView(sd.session.id, { page: pageCount - 1 })}>»</button>
                          </span>
                        )}
                      </div>
                    </>
                  )
                })()}

                {/* Dopisanie pozycji spoza listy (towar znaleziony na półce, nowy komponent) */}
                {addable.length > 0 && (
                  <div className="inventory-open-form" style={{ marginTop: 8 }}>
                    <label className="form-label">
                      Dodaj pozycję spoza listy
                      <select
                        className="form-input"
                        value={addComponentId[sd.session.id] ?? ''}
                        onChange={(e) => setAddComponentId((prev) => ({ ...prev, [sd.session.id]: e.target.value }))}
                      >
                        <option value="">— wybierz komponent —</option>
                        {addable.map((c) => (
                          <option key={c.id} value={String(c.id)}>
                            {c.code ? `${c.code} — ${c.name}` : c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="inventory-open-form-actions">
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={() => void handleAddLine(sd.session.id)}
                        disabled={adding === sd.session.id || !addComponentId[sd.session.id]}
                      >
                        {adding === sd.session.id ? 'Dodawanie…' : '+ Dodaj pozycję'}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Brak sesji — formularz otwierania */}
            {!sd && isManager && (
              <div className="inventory-no-session-inline">
                {showOpenForm !== wh.id ? (
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => setShowOpenForm(wh.id)}>
                    + Otwórz inwentaryzację
                  </button>
                ) : (
                  <div className="inventory-open-form">
                    <label className="form-label">
                      Uwagi (opcjonalnie)
                      <input
                        type="text"
                        className="form-input"
                        value={newNotes[wh.id] ?? ''}
                        onChange={(e) => setNewNotes((prev) => ({ ...prev, [wh.id]: e.target.value }))}
                        placeholder={`np. Inwentaryzacja ${wh.name} czerwiec 2026`}
                      />
                    </label>
                    <label className="form-label" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input type="checkbox" checked={lockOnOpen} onChange={(e) => setLockOnOpen(e.target.checked)} />
                      Wstrzymaj PZ i MM na tym magazynie do zamknięcia spisu (otwórz spis tuż PRZED liczeniem)
                    </label>
                    <div className="inventory-open-form-actions">
                      <button type="button" className="btn btn-sm btn-secondary" onClick={() => setShowOpenForm(null)}>
                        Anuluj
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={() => void handleOpenSession(wh.id)}
                        disabled={opening === wh.id}
                      >
                        {opening === wh.id ? 'Otwieranie…' : 'Otwórz sesję'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}

      {/* ── Historia ── */}
      {pastSessions.length > 0 && (
        <div className="inventory-history">
          <h3 className="inventory-section-title">Historia inwentaryzacji</h3>
          <DataTable
            rows={pastSessions}
            rowKey={(s) => s.id}
            columns={historyColumns}
            className="inventory-history-table"
            wrapped={false}
          />
        </div>
      )}

      {/* ── Zatwierdzenie różnic przed zaksięgowaniem korekt ── */}
      {closeReview &&
        createPortal(
          <div className="confirm-dialog-overlay" role="presentation" onClick={() => setCloseReview(null)}>
            <div
              className="confirm-dialog-card shortage-dialog-card"
              role="alertdialog"
              aria-modal="true"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="confirm-dialog-title">Zatwierdź inwentaryzację</h2>
              <p className="shortage-dialog-subtitle">
                Magazyn{' '}
                <strong>
                  {warehouses.find((w) => w.id === closeReview.session.warehouse_id)?.name ?? '—'}
                </strong>{' '}
                · {closeReview.session.counted_date}
              </p>

              {review.diffs.length === 0 ? (
                <p className="shortage-dialog-hint">
                  Wszystkie policzone pozycje zgadzają się ze stanem systemu — żadnych korekt.
                </p>
              ) : (
                <div className="shortage-dialog-list" style={{ borderColor: '#bfdbfe', background: '#eff6ff' }}>
                  {review.diffs.map(({ line, counted, diff }) => (
                    <div key={line.id} className="shortage-dialog-row">
                      <div className="shortage-dialog-name">
                        {line.component_name}
                        <span className="shortage-dialog-wh">
                          system {line.system_qty} → policzono {counted}
                        </span>
                      </div>
                      <div className="shortage-dialog-qty">
                        <span
                          style={{
                            fontWeight: 700,
                            color: diff > 0 ? '#15803d' : '#b91c1c',
                          }}
                        >
                          {diff > 0 ? `+${diff}` : diff}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <p className="shortage-dialog-hint">
                Korekt do zaksięgowania: <strong>{review.diffs.length}</strong>
                {review.uncounted > 0 && (
                  <>
                    {' '}· <span style={{ color: '#b45309' }}>
                      {review.uncounted} pozycji NIEPOLICZONYCH — zostaną pominięte (bez korekty)
                    </span>
                  </>
                )}
              </p>

              <div className="confirm-dialog-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setCloseReview(null)}>
                  Wróć do liczenia
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => void handleConfirmClose(closeReview)}
                >
                  Zatwierdź i zaksięguj ({review.diffs.length})
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}

/** Wyszukiwarka i filtry spisu (kod, nazwa, model, kolor, rozmiar; kategoria / model / kolor; tylko z ilością > 0). */
function InventoryLinesFilters({
  lines,
  view,
  backgroundCount,
  onChange,
}: {
  lines: InventoryLine[]
  view: LinesView
  /** pozycje sesji z kartotek w tle (is_stocked = false, niepoliczone) — ukryte, dopóki nie włączysz filtra */
  backgroundCount: number
  onChange: (patch: Partial<LinesView>) => void
}) {
  const attrs = useMemo(
    () =>
      lines.map((l) => ({
        product_category: l.component_category,
        door_model: l.component_door_model,
        door_color: l.component_door_color,
      })),
    [lines],
  )
  const categories = useMemo(
    () => [...new Set(lines.map((l) => l.component_category).filter((c): c is string => !!c))].sort(),
    [lines],
  )
  const models = useMemo(() => distinctValues(attrs, 'door_model', view.category), [attrs, view.category])
  const colors = useMemo(() => distinctValues(attrs, 'door_color', view.category), [attrs, view.category])
  return (
    <div className="inventory-filters">
      <input
        type="text"
        className="search-input"
        placeholder="Szukaj: kod, nazwa, model, kolor, rozmiar…"
        value={view.q}
        onChange={(e) => onChange({ q: e.target.value })}
      />
      {categories.length > 1 && (
        <select value={view.category} onChange={(e) => onChange({ category: e.target.value, model: '', color: '' })} title="Kategoria">
          <option value="">Wszystkie kategorie</option>
          {categories.map((c) => (
            <option key={c} value={c}>{PRODUCT_CATEGORY_LABELS[c] ?? c}</option>
          ))}
        </select>
      )}
      {models.length > 0 && (
        <select value={view.model} onChange={(e) => onChange({ model: e.target.value })} title="Model">
          <option value="">Wszystkie modele</option>
          {models.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      )}
      {colors.length > 0 && (
        <select value={view.color} onChange={(e) => onChange({ color: e.target.value })} title="Kolor">
          <option value="">Wszystkie kolory</option>
          {colors.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      )}
      <label className="orders-filter-checkbox">
        <input type="checkbox" checked={view.onlyCounted} onChange={(e) => onChange({ onlyCounted: e.target.checked })} />
        <span>Tylko z ilością &gt; 0</span>
      </label>
      {backgroundCount > 0 && (
        <label className="orders-filter-checkbox" title="Kartoteki „w tle” (towar na zamówienie, is_stocked = nie) — poza spisem; włącz, żeby je zobaczyć i ewentualnie policzyć">
          <input type="checkbox" checked={view.showBackground} onChange={(e) => onChange({ showBackground: e.target.checked })} />
          <span>Kartoteki w tle ({backgroundCount})</span>
        </label>
      )}
    </div>
  )
}
