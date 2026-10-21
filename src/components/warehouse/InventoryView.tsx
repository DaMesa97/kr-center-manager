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
      .select('id, session_id, component_id, system_qty, counted_qty, notes, warehouse_components ( name, unit, code )')
      .eq('session_id', sessionId)
      .order('id', { ascending: true })
      .range(from, to),
  )
  if (error) return { lines: [], error: error.message }
  return {
    error: null,
    lines: data.map((l) => {
      const wc = l.warehouse_components as { name?: string; unit?: string; code?: string | null } | null
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
      }
    }),
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
  const [draftCounts, setDraftCounts] = useState<Record<number, string>>({})
  const [saving, setSaving] = useState<Set<number>>(new Set())
  const [failed, setFailed] = useState<Set<number>>(new Set()) // pozycje, których zapis się NIE udał
  const [addComponentId, setAddComponentId] = useState<Record<number, string>>({}) // session_id -> component_id
  const [adding, setAdding] = useState<number | null>(null) // session_id
  const [closeReview, setCloseReview] = useState<SessionWithLines | null>(null)

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

  const handleOpenSession = async (warehouseId: number) => {
    setOpening(warehouseId)
    try {
      const { error } = await supabase.rpc('open_inventory_session', {
        p_notes: (newNotes[warehouseId] ?? '').trim() || null,
        p_warehouse_id: warehouseId,
      })
      if (error) { pushToast(`Błąd: ${error.message}`, 'error'); return }
      pushToast('Sesja inwentaryzacyjna otwarta', 'success')
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
      setCloseReview({ session: sd.session, lines })
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
    generateInventorySheet(sd.session, sd.lines)
  }

  const handleExportPastPdf = async (session: InventorySession & { warehouse_id: number | null }) => {
    const { lines, error } = await fetchLines(session.id)
    if (error) { pushToast(`Nie pobrano pozycji spisu: ${error}`, 'error'); return }
    generateInventorySheet(session, lines)
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
  const lineColumns = useMemo((): DataTableColumn<InventoryLine>[] => [
    {
      key: 'lp',
      label: 'Lp.',
      align: 'center',
      thStyle: { width: '3rem' },
      tdStyle: { color: '#94a3b8', fontSize: '0.8rem' },
      render: (_line, i) => i + 1,
    },
    {
      key: 'name',
      label: 'Nazwa komponentu',
      render: (line) => (
        <div className="inventory-component-name">
          {line.component_name}
          {line.component_code && <span className="inventory-component-code">{line.component_code}</span>}
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
      render: (line) => (
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
            onChange={(e) => handleCountChange(line.id, e.target.value)}
          />
          {saving.has(line.id) && <span className="inventory-saving-dot" title="Zapisywanie…">●</span>}
          {failed.has(line.id) && !saving.has(line.id) && (
            <span style={{ color: '#dc2626', fontSize: '0.75rem', fontWeight: 700 }} title="Nie zapisano">!</span>
          )}
        </div>
      ),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [draftCounts, saving, failed])

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
        const filledCount = sd?.lines.filter((l) => l.counted_qty != null).length ?? 0
        const totalCount = sd?.lines.length ?? 0
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
                  </div>
                  <div className="inventory-header-actions">
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

                <DataTable
                  rows={sd.lines}
                  rowKey={(line) => line.id}
                  columns={lineColumns}
                  className="inventory-table"
                />

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
