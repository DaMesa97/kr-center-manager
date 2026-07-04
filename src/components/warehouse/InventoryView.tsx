import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../supabaseClient'
import { generateInventorySheet } from '../../utils/inventoryPdfGenerator'
import Spinner from '../Spinner'
import type { CurrentUser, InventoryLine, InventorySession, ToastVariant, Warehouse } from '../../types'
import { isManagerRole } from '../../lib/permissions'

type Props = {
  pushToast: (msg: string, variant: ToastVariant) => void
  currentUser: CurrentUser | null
}

type SessionWithLines = {
  session: InventorySession & { warehouse_id: number | null }
  lines: InventoryLine[]
}

export default function InventoryView({ pushToast, currentUser }: Props) {
  const [loading, setLoading] = useState(false)
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [openSessions, setOpenSessions] = useState<SessionWithLines[]>([])
  const [pastSessions, setPastSessions] = useState<(InventorySession & { warehouse_id: number | null; warehouse_name?: string })[]>([])
  const [opening, setOpening] = useState<number | null>(null) // warehouse_id otwierany
  const [closing, setClosing] = useState<number | null>(null) // session_id zamykany
  const [newNotes, setNewNotes] = useState<Record<number, string>>({})
  const [showOpenForm, setShowOpenForm] = useState<number | null>(null) // warehouse_id
  const [draftCounts, setDraftCounts] = useState<Record<number, string>>({})
  const [saving, setSaving] = useState<Set<number>>(new Set())
  const saveTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({})

  const isManager = isManagerRole(currentUser?.role)

  const fetchLines = async (sessionId: number): Promise<InventoryLine[]> => {
    const { data } = await supabase
      .from('inventory_lines')
      .select('id, session_id, component_id, system_qty, counted_qty, notes, warehouse_components ( name, unit, code )')
      .eq('session_id', sessionId)
      .order('id', { ascending: true })
    return ((data ?? []) as Array<Record<string, unknown>>).map((l) => {
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
    })
  }

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      // Magazyny
      const { data: whData } = await supabase
        .from('warehouses')
        .select('id, code, name, is_active')
        .eq('is_active', true)
        .order('name')
      setWarehouses((whData ?? []) as Warehouse[])

      // Otwarte sesje
      const { data: openData } = await supabase
        .from('inventory_sessions')
        .select('*')
        .eq('status', 'open')
        .order('created_at', { ascending: false })

      const open: SessionWithLines[] = []
      for (const s of (openData ?? []) as Array<InventorySession & { warehouse_id: number | null }>) {
        const lines = await fetchLines(s.id)
        const drafts: Record<number, string> = {}
        for (const l of lines) {
          if (l.counted_qty != null) drafts[l.id] = String(l.counted_qty)
        }
        setDraftCounts((prev) => ({ ...prev, ...drafts }))
        open.push({ session: s, lines })
      }
      setOpenSessions(open)

      // Zamknięte sesje z nazwą magazynu
      const { data: closed } = await supabase
        .from('inventory_sessions')
        .select('*, warehouses ( name )')
        .eq('status', 'closed')
        .order('counted_date', { ascending: false })
        .limit(20)

      setPastSessions(
        ((closed ?? []) as Array<Record<string, unknown>>).map((s) => ({
          ...(s as unknown as InventorySession & { warehouse_id: number | null }),
          warehouse_name: (s.warehouses as { name?: string } | null)?.name ?? '—',
        })),
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchData() }, [fetchData])

  const scheduleLineSave = useCallback((lineId: number, value: string) => {
    if (saveTimers.current[lineId]) clearTimeout(saveTimers.current[lineId])
    saveTimers.current[lineId] = setTimeout(async () => {
      setSaving((prev) => new Set(prev).add(lineId))
      const parsed = value.trim() === '' ? null : Number(value.replace(',', '.'))
      await supabase
        .from('inventory_lines')
        .update({ counted_qty: isNaN(parsed as number) ? null : parsed })
        .eq('id', lineId)
      setSaving((prev) => { const s = new Set(prev); s.delete(lineId); return s })
      setOpenSessions((prev) => prev.map((sd) => ({
        ...sd,
        lines: sd.lines.map((l) =>
          l.id === lineId
            ? { ...l, counted_qty: isNaN(parsed as number) ? null : (parsed as number) }
            : l,
        ),
      })))
    }, 800)
  }, [])

  const handleCountChange = (lineId: number, value: string) => {
    setDraftCounts((prev) => ({ ...prev, [lineId]: value }))
    scheduleLineSave(lineId, value)
  }

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

  const handleCloseSession = async (sd: SessionWithLines) => {
    const whName = warehouses.find((w) => w.id === sd.session.warehouse_id)?.name ?? 'magazyn'
    const confirmed = window.confirm(
      `Zamknąć sesję dla magazynu "${whName}" z dnia ${sd.session.counted_date}?\n\n` +
      `Korekty stanów zostaną wygenerowane dla pozycji z wpisaną ilością.`,
    )
    if (!confirmed) return
    setClosing(sd.session.id)
    try {
      // Flush — zapisz wartości czekające w debounce zanim zamkniemy sesję
      const pendingIds = Object.keys(saveTimers.current).map(Number)
      if (pendingIds.length > 0) {
        for (const id of pendingIds) {
          if (saveTimers.current[id]) {
            clearTimeout(saveTimers.current[id])
            delete saveTimers.current[id]
          }
        }
        await Promise.all(
          pendingIds.map((id) => {
            const raw = draftCounts[id]
            const parsed = raw == null || raw.trim() === '' ? null : Number(raw.replace(',', '.'))
            return supabase
              .from('inventory_lines')
              .update({ counted_qty: parsed != null && isNaN(parsed) ? null : parsed })
              .eq('id', id)
          }),
        )
      }
      const { error } = await supabase.rpc('close_inventory_session', { p_session_id: sd.session.id })
      if (error) { pushToast(`Błąd zamknięcia: ${error.message}`, 'error'); return }
      pushToast('Inwentaryzacja zamknięta — korekty stanów wygenerowane', 'success')
      await fetchData()
    } finally {
      setClosing(null)
    }
  }

  const handleExportPdf = (sd: SessionWithLines) => {
    generateInventorySheet(sd.session, sd.lines)
  }

  const handleExportPastPdf = async (session: InventorySession & { warehouse_id: number | null }) => {
    const lines = await fetchLines(session.id)
    generateInventorySheet(session, lines)
  }

  if (loading) return <Spinner center label="Ładowanie danych inwentaryzacji…" />

  return (
    <div className="inventory-view">

      {/* ── Aktywne sesje per magazyn ── */}
      {warehouses.map((wh) => {
        const sd = openSessions.find((s) => s.session.warehouse_id === wh.id)
        const filledCount = sd?.lines.filter((l) => l.counted_qty != null).length ?? 0
        const totalCount = sd?.lines.length ?? 0
        const diffCount = sd?.lines.filter((l) => l.counted_qty != null && l.counted_qty !== l.system_qty).length ?? 0

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
                        {closing === sd.session.id ? 'Zamykanie…' : 'Zamknij i zatwierdź korekty'}
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
                    {diffCount > 0 && <> · <strong className="inventory-diff-count">{diffCount} rozbieżności</strong></>}
                  </span>
                </div>

                <div className="table-wrapper">
                  <table className="orders-table inventory-table">
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'center', width: '3rem' }}>Lp.</th>
                        <th>Nazwa komponentu</th>
                        <th style={{ textAlign: 'center', width: '5rem' }}>J.m.</th>
                        <th style={{ textAlign: 'center', width: '8rem' }}>Stan systemu</th>
                        <th style={{ textAlign: 'center', width: '10rem' }}>Policzono</th>
                        <th style={{ textAlign: 'center', width: '7rem' }}>Różnica</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sd.lines.map((line, i) => {
                        const draft = draftCounts[line.id] ?? ''
                        const draftNum = draft.trim() === '' ? null : Number(draft.replace(',', '.'))
                        const diff = draftNum != null && !isNaN(draftNum) ? draftNum - line.system_qty : null
                        const hasDiff = diff != null && diff !== 0
                        return (
                          <tr key={line.id} className={hasDiff ? 'inventory-row--diff' : ''}>
                            <td style={{ textAlign: 'center', color: '#94a3b8', fontSize: '0.8rem' }}>{i + 1}</td>
                            <td>
                              <div className="inventory-component-name">
                                {line.component_name}
                                {line.component_code && <span className="inventory-component-code">{line.component_code}</span>}
                              </div>
                            </td>
                            <td style={{ textAlign: 'center', color: '#64748b', fontSize: '0.85rem' }}>{line.component_unit}</td>
                            <td style={{ textAlign: 'center', fontWeight: 500 }}>{line.system_qty}</td>
                            <td style={{ textAlign: 'center' }}>
                              <div className="inventory-input-wrap">
                                <input
                                  type="number"
                                  className={`inventory-count-input${saving.has(line.id) ? ' inventory-count-input--saving' : ''}`}
                                  value={draft}
                                  min={0}
                                  step="0.001"
                                  placeholder="—"
                                  onChange={(e) => handleCountChange(line.id, e.target.value)}
                                />
                                {saving.has(line.id) && <span className="inventory-saving-dot" title="Zapisywanie…">●</span>}
                              </div>
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              {diff != null && !isNaN(diff) ? (
                                <span className={`inventory-diff-badge ${diff > 0 ? 'inventory-diff-badge--plus' : diff < 0 ? 'inventory-diff-badge--minus' : 'inventory-diff-badge--zero'}`}>
                                  {diff > 0 ? `+${diff}` : diff}
                                </span>
                              ) : <span style={{ color: '#cbd5e1' }}>—</span>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
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
          <table className="orders-table inventory-history-table">
            <thead>
              <tr>
                <th>Magazyn</th>
                <th>Data liczenia</th>
                <th>Zamknięta</th>
                <th>Uwagi</th>
                <th style={{ textAlign: 'center' }}>PDF</th>
              </tr>
            </thead>
            <tbody>
              {pastSessions.map((s) => (
                <tr key={s.id}>
                  <td><strong>{s.warehouse_name}</strong></td>
                  <td>{s.counted_date}</td>
                  <td style={{ color: '#64748b', fontSize: '0.85rem' }}>
                    {s.closed_at ? new Date(s.closed_at).toLocaleDateString('pl-PL') : '—'}
                  </td>
                  <td style={{ color: '#64748b', fontSize: '0.85rem' }}>{s.notes ?? '—'}</td>
                  <td style={{ textAlign: 'center' }}>
                    <button type="button" className="btn btn-sm btn-secondary" onClick={() => void handleExportPastPdf(s)}>
                      ↓ PDF
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
