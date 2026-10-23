import { useEffect, useMemo, useState } from 'react'
import type { AluPosition, Complaint, Order, WorkerStage } from '../types'
import { isRushOrderSequence, orderRouteMark } from '../utils'
import { aluDetailFields, aluTaskKey, buildAluTasks } from '../lib/aluStation'
import {
  buildComplaintTasks,
  buildTasks,
  fieldsForStage,
  isTaskShownByDefault,
  sortTasks,
  workersForTask,
  type MyTask,
  type StationWorker,
} from '../lib/stationLogic'
import type { StageCompleteResult, StockReleaseRow } from '../hooks/useMyStation'
import StageWorkerConfirmDialog from './StageWorkerConfirmDialog'
import StockShortageDialog from './StockShortageDialog'
import DamageReportModal from './DamageReportModal'
import Spinner from './Spinner'
import DataTable, { type DataTableColumn } from './DataTable'
import type { ToastVariant } from '../types'

/** Wiersz tabeli stanowiska: nagłówek sekcji etapu albo zadanie */
type StationRow =
  | { kind: 'header'; key: string; label: string; count: number; ready: number }
  | { kind: 'task'; task: MyTask }

type Props = {
  currentUserId: string
  orders: Order[]
  complaints: Complaint[]
  workerStages: WorkerStage[]
  /** Przypisania WSZYSTKICH pracowników + profile — kafelki "kto zrobił" */
  allWorkerStages: WorkerStage[]
  stationProfiles: Array<{ id: string; initials: string | null; full_name: string | null }>
  onStageComplete: (
    order: Order,
    stageKey: string,
    category: string,
    opts?: { force?: boolean; markInitials?: string },
  ) => Promise<StageCompleteResult>
  onComplaintStageComplete: (task: MyTask, markInitials?: string) => Promise<StageCompleteResult>
  /** Aluminium: pozycje otwartych zleceń alu (etapy per pozycja/sztuka) */
  aluPositionsByOrder: Record<number, AluPosition[]>
  /** Aluminium: jedno kliknięcie = jedna sztuka pozycji na etapie */
  onAluStageClick: (task: MyTask, markInitials?: string) => Promise<boolean>
  /** „Cofnij” tuż po oznaczeniu (pomyłka) — etap + zwrot wydanego towaru */
  onStageUndo: (task: MyTask) => Promise<boolean>
  loading: boolean
  pushToast: (msg: string, variant: ToastVariant) => void
  /** zgłaszanie zniszczeń tylko dla kierownika (wyprowadza towar ze stanu) */
  isManager: boolean
}

export default function MyStationView({
  currentUserId,
  orders,
  complaints,
  workerStages,
  allWorkerStages,
  stationProfiles,
  onStageComplete,
  onComplaintStageComplete,
  aluPositionsByOrder,
  onAluStageClick,
  onStageUndo,
  loading,
  pushToast,
  isManager,
}: Props) {
  void currentUserId
  const [confirmTask, setConfirmTask] = useState<MyTask | null>(null)
  const [confirmSaving, setConfirmSaving] = useState(false)
  const [damageTask, setDamageTask] = useState<MyTask | null>(null)
  const [shortageDialog, setShortageDialog] = useState<{
    task: MyTask
    shortages: StockReleaseRow[]
    markInitials?: string
  } | null>(null)
  // Ostatnio wybrana osoba na tym komputerze — podświetlona podpowiedź
  const [lastWorkerId, setLastWorkerId] = useState<string | null>(() => {
    try {
      return localStorage.getItem('stationLastWorkerId')
    } catch {
      return null
    }
  })
  const rememberWorker = (w: StationWorker | null) => {
    if (!w) return
    setLastWorkerId(w.id)
    try {
      localStorage.setItem('stationLastWorkerId', w.id)
    } catch {
      /* prywatny tryb — trudno */
    }
  }
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  // Ostatnio oznaczone zadanie — pasek „Cofnij” przez UNDO_MS (pomyłka w hali)
  const [lastDone, setLastDone] = useState<{ task: MyTask; initials?: string } | null>(null)
  const [undoing, setUndoing] = useState(false)
  useEffect(() => {
    if (!lastDone) return
    const t = setTimeout(() => setLastDone(null), UNDO_MS)
    return () => clearTimeout(t)
  }, [lastDone])
  const tasks = useMemo(
    () => [
      ...sortTasks([...buildTasks(orders, workerStages), ...buildComplaintTasks(complaints, workerStages)]),
      // aluminium osobno: własna kolejność (termin → zlecenie → pozycja → etap)
      ...buildAluTasks(orders, aluPositionsByOrder, workerStages),
    ],
    [orders, complaints, workerStages, aluPositionsByOrder],
  )
  const readyCount = tasks.filter((t) => t.readyToWork).length
  const waitingCount = tasks.length - readyCount

  // Czekające na wcześniejszy etap domyślnie schowane (wybór zapamiętany na komputerze)
  const [showWaiting, setShowWaiting] = useState<boolean>(() => {
    try {
      return localStorage.getItem('stationShowWaiting') === '1'
    } catch {
      return false
    }
  })
  const toggleShowWaiting = () => {
    const next = !showWaiting
    setShowWaiting(next)
    try {
      localStorage.setItem('stationShowWaiting', next ? '1' : '0')
    } catch {
      /* ignore */
    }
  }
  const shownTasks = useMemo(
    () => (showWaiting ? tasks : tasks.filter(isTaskShownByDefault)),
    [tasks, showWaiting],
  )
  const hiddenCount = tasks.length - shownTasks.length

  // ── Grupowanie po etapie ──────────────────────────────────────────
  // Kto ma kilka etapów (np. składa skrzydła E3 i pakuje E5), widział je
  // wymieszane jedno pod drugim — prosta droga do oznaczenia złego etapu.
  // Sekcje per etap + chipy filtra (wybór zapamiętany na tym komputerze).
  const groups = useMemo(() => {
    const catOrder = ['STA', 'Disting', 'ST', 'Techniczne', 'Bastion', 'DrzwiWewnetrzne', 'Aluminium']
    const multiCat = new Set(shownTasks.map((t) => t.category)).size > 1
    const map = new Map<string, { label: string; category: string; header: string; tasks: MyTask[] }>()
    for (const t of shownTasks) {
      const key = `${t.category}|${t.stageKey}`
      const g = map.get(key) ?? {
        label: `${multiCat ? `${t.category} · ` : ''}${t.stageHeader} — ${t.stageTitle}`,
        category: t.category,
        header: t.stageHeader,
        tasks: [],
      }
      g.tasks.push(t)
      map.set(key, g)
    }
    return Array.from(map.entries())
      .map(([key, g]) => ({ key, ...g }))
      .sort(
        (a, b) =>
          catOrder.indexOf(a.category) - catOrder.indexOf(b.category) ||
          a.header.localeCompare(b.header, 'pl', { numeric: true }),
      )
  }, [shownTasks])

  const [stageFilter, setStageFilter] = useState<string>(() => {
    try {
      return localStorage.getItem('stationStageFilter') ?? 'all'
    } catch {
      return 'all'
    }
  })
  const setStageFilterPersist = (v: string) => {
    setStageFilter(v)
    try {
      localStorage.setItem('stationStageFilter', v)
    } catch {
      /* ignore */
    }
  }
  const activeFilter = stageFilter !== 'all' && groups.some((g) => g.key === stageFilter) ? stageFilter : 'all'

  const rows = useMemo<StationRow[]>(() => {
    const visible = activeFilter === 'all' ? groups : groups.filter((g) => g.key === activeFilter)
    const out: StationRow[] = []
    for (const g of visible) {
      // nagłówek sekcji tylko gdy jest co rozdzielać
      if (activeFilter === 'all' && groups.length > 1) {
        out.push({
          kind: 'header',
          key: g.key,
          label: g.label,
          count: g.tasks.length,
          ready: g.tasks.filter((t) => t.readyToWork).length,
        })
      }
      for (const t of g.tasks) out.push({ kind: 'task', task: t })
    }
    return out
  }, [groups, activeFilter])

  const columns = useMemo<DataTableColumn<MyTask>[]>(
    () => [
      {
        // numer + firma w jednej komórce — tabela mieści się bez przewijania w bok
        key: 'nr',
        label: 'ZLECENIE',
        sortValue: (task) => task.order.order_number,
        render: (task) => (
          <>
            <div className="my-station-cell-main">
              <span className="my-station-expand-icon">{expandedKey === taskKey(task) ? '▾' : '▸'}</span>{' '}
              {task.order.order_number}
              {orderRouteMark(task.order) && (
                <span
                  className={`route-mark-chip route-mark-chip--${orderRouteMark(task.order).toLowerCase()}`}
                  title={orderRouteMark(task.order) === 'XX' ? 'Plan wydań: na magazyn DZIŚ' : 'Plan wydań: na magazyn JUTRO'}
                >
                  {orderRouteMark(task.order)}
                </span>
              )}
              {task.isComplaint && (
                <span
                  className="bot-badge bot-badge--review bot-badge--table"
                  title={`Zadanie z reklamacji ${task.complaintNumber ?? ''}`}
                >
                  REKLAMACJA
                </span>
              )}
            </div>
            <div className="my-station-cell-sub">
              {task.order.company}
              {task.isComplaint && task.complaintNumber ? ` · ${task.complaintNumber}` : ''}
            </div>
          </>
        ),
      },
      {
        key: 'product',
        label: 'PRODUKT',
        sortValue: (task) => task.order.model,
        render: (task) =>
          task.alu ? (
            <>
              <div className="my-station-cell-main">
                poz. {task.alu.posNo} · {task.alu.position.description || task.alu.position.system}
              </div>
              <div className="my-station-cell-sub">
                {task.alu.position.system} · {task.alu.done}/{task.alu.quantity} szt. z tym etapem
              </div>
            </>
          ) : (
            <>
              <div className="my-station-cell-main">{task.order.model}</div>
              <div className="my-station-cell-sub">
                {task.category} · {task.order.quantity} szt.
              </div>
            </>
          ),
      },
      {
        key: 'stage',
        label: 'ETAP',
        render: (task) => (
          <>
            <div>
              <strong>{task.stageHeader}</strong> — {task.stageTitle}
            </div>
            <button
              type="button"
              className="btn btn-sm btn-success"
              disabled={!task.readyToWork}
              onClick={(e) => {
                e.stopPropagation()
                setConfirmTask(task)
              }}
            >
              {task.alu ? `✓ Sztuka ${Math.min(task.alu.done + 1, task.alu.quantity)}/${task.alu.quantity}` : '✓ Zrobione'}
            </button>
            {isManager && !task.isComplaint && !task.alu && (
              <>
                {' '}
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  title="Zgłoś zniszczony komponent (drugi gatunek) — zdejmie z magazynu sztuki wzięte na poprawkę"
                  onClick={(e) => {
                    e.stopPropagation()
                    setDamageTask(task)
                  }}
                >
                  ⚠️
                </button>
              </>
            )}
          </>
        ),
      },
      {
        key: 'status',
        label: 'STATUS',
        sortValue: (task) => (task.readyToWork ? 0 : 1),
        render: (task) =>
          task.readyToWork ? (
            <span className="my-station-ready-badge">Gotowe do pracy</span>
          ) : (
            <span className="my-station-waiting-badge">Czeka na poprzednie</span>
          ),
      },
      { key: 'notes', label: 'UWAGI', tdClassName: 'my-station-notes', render: (task) => task.order.notes || '—' },
    ],
    [expandedKey, isManager],
  )

  // Kolumny na wierszach sekcyjnych — BEZ sortValue: kolejka jest jedna
  // (gotowe→pilne→data), a klik w nagłówek po cichu ją przestawiał
  const rowColumns = useMemo<DataTableColumn<StationRow>[]>(
    () =>
      columns.map((c) => ({
        key: c.key,
        label: c.label,
        tdClassName: typeof c.tdClassName === 'string' ? c.tdClassName : undefined,
        render: (r: StationRow, i: number) => (r.kind === 'task' ? c.render(r.task, i) : null),
      })),
    [columns],
  )

  return (
    <div className="my-station-view">
      <div className="my-station-meta">
        <div>
          Do zrobienia: <strong>{tasks.length}</strong>
        </div>
        <div>
          Gotowe do pracy: <strong>{readyCount}</strong>
        </div>
        <div>
          Czeka: <strong>{waitingCount}</strong>
        </div>
        {(hiddenCount > 0 || showWaiting) && waitingCount > 0 && (
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={toggleShowWaiting}
            title="Zadania czekające na wcześniejszy etap (bez X/XX — te są zawsze widoczne)"
          >
            {showWaiting ? 'Ukryj czekające' : `⏳ Pokaż czekające (${hiddenCount})`}
          </button>
        )}
      </div>

      {lastDone && (
        <div className="station-undo-bar" role="status">
          <span>
            Oznaczono: <strong>{lastDone.task.stageHeader}</strong>
            {lastDone.task.isComplaint ? ' reklamacji ' : ' zlecenia '}
            <strong>{lastDone.task.isComplaint ? lastDone.task.complaintNumber : lastDone.task.order.order_number}</strong>
            {lastDone.initials ? ` (${lastDone.initials})` : ''}
          </span>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            disabled={undoing}
            onClick={() => {
              const run = async () => {
                setUndoing(true)
                try {
                  if (await onStageUndo(lastDone.task)) setLastDone(null)
                } finally {
                  setUndoing(false)
                }
              }
              void run()
            }}
          >
            {undoing ? 'Cofam…' : 'Cofnij'}
          </button>
        </div>
      )}

      {groups.length > 1 && (
        <div className="station-stage-chips">
          <button
            type="button"
            className={`station-stage-chip ${activeFilter === 'all' ? 'station-stage-chip--active' : ''}`}
            onClick={() => setStageFilterPersist('all')}
          >
            Wszystkie ({shownTasks.length})
          </button>
          {groups.map((g) => (
            <button
              key={g.key}
              type="button"
              className={`station-stage-chip ${activeFilter === g.key ? 'station-stage-chip--active' : ''}`}
              onClick={() => setStageFilterPersist(g.key)}
            >
              {g.label} ({g.tasks.length})
            </button>
          ))}
        </div>
      )}

      <DataTable
        rows={rows}
        rowKey={(r) => (r.kind === 'header' ? `h-${r.key}` : taskKey(r.task))}
        columns={rowColumns}
        className="my-station-table"
        wrapperClassName="orders-table-wrapper"
        loading={loading}
        loadingText={<Spinner center label="Ładowanie…" />}
        emptyText={
          hiddenCount > 0 ? (
            <>
              Nic gotowego do pracy (czekające na wcześniejsze etapy: {hiddenCount}).{' '}
              <button type="button" className="btn btn-sm btn-secondary" onClick={toggleShowWaiting}>
                Pokaż czekające
              </button>
            </>
          ) : (
            'Brak zadań dla przypisanych etapów.'
          )
        }
        renderRow={(r) => {
          if (r.kind !== 'header') return undefined
          return (
            <tr className="my-station-group-row">
              <td colSpan={rowColumns.length}>
                <span className="my-station-group-label">{r.label}</span>
                <span className="my-station-group-counts">
                  gotowe {r.ready} / {r.count}
                </span>
              </td>
            </tr>
          )
        }}
        rowClassName={(r) =>
          r.kind === 'task'
            ? `my-station-row ${isRushOrderSequence(r.task.order.sequence) ? 'orders-table-row--priority' : ''}`
            : undefined
        }
        onRowClick={(r) => {
          if (r.kind !== 'task') return
          const key = taskKey(r.task)
          setExpandedKey(expandedKey === key ? null : key)
        }}
        renderAfterRow={(r) => {
          if (r.kind !== 'task') return null
          const task = r.task
          if (expandedKey !== taskKey(task)) return null
          const details = task.alu
            ? aluDetailFields(task.alu.position, task.order, task.stageKey)
            : fieldsForStage(task.order, task.category, task.actualStageKey)
          return (
            <tr className="my-station-details-row">
              <td colSpan={rowColumns.length}>
                <div className="my-station-details">
                  {details.length === 0 ? (
                    <span className="my-station-details-empty">Brak dodatkowych szczegółów dla tego etapu.</span>
                  ) : (
                    details.map((f) => (
                      <div key={f.label} className="my-station-detail-item">
                        <span className="my-station-detail-label">{f.label}</span>
                        <span className="my-station-detail-value">{f.value}</span>
                      </div>
                    ))
                  )}
                </div>
              </td>
            </tr>
          )
        }}
      />

      {confirmTask && (
        <StageWorkerConfirmDialog
          title="Oznaczyć etap jako zrobiony?"
          message={
            confirmTask.alu
              ? `Zlecenie ${confirmTask.order.order_number}, pozycja ${confirmTask.alu.posNo} (${confirmTask.alu.position.description}) — ${confirmTask.stageTitle}: sztuka ${Math.min(confirmTask.alu.done + 1, confirmTask.alu.quantity)} z ${confirmTask.alu.quantity}`
              : confirmTask.isComplaint
                ? `REKLAMACJA ${confirmTask.complaintNumber ?? ''} (zlecenie ${confirmTask.order.order_number}), etap: ${confirmTask.stageHeader} — ${confirmTask.stageTitle}`
                : `Zamówienie nr ${confirmTask.order.order_number}, etap: ${confirmTask.stageHeader} — ${confirmTask.stageTitle}`
          }
          workers={workersForTask(confirmTask, allWorkerStages, stationProfiles)}
          lastWorkerId={lastWorkerId}
          saving={confirmSaving}
          onConfirm={(worker) => {
            if (confirmSaving) return
            const run = async () => {
              if (!confirmTask) return
              const task = confirmTask
              setConfirmSaving(true)
              try {
                rememberWorker(worker)
                const markInitials = worker?.initials
                const result: StageCompleteResult = task.alu
                  ? (await onAluStageClick(task, markInitials)) ? { status: 'ok' } : { status: 'error' }
                  : task.isComplaint
                    ? await onComplaintStageComplete(task, markInitials)
                    : await onStageComplete(task.order, task.stageKey, task.category, { markInitials })
                setConfirmTask(null)
                if (result.status === 'shortage') {
                  setShortageDialog({ task, shortages: result.shortages, markInitials })
                } else if (result.status === 'ok') {
                  setLastDone({ task, initials: markInitials })
                }
              } finally {
                setConfirmSaving(false)
              }
            }
            void run()
          }}
          onCancel={() => {
            if (!confirmSaving) setConfirmTask(null)
          }}
        />
      )}

      <DamageReportModal
        open={damageTask !== null}
        onClose={() => setDamageTask(null)}
        pushToast={pushToast}
        orderId={damageTask?.order.id ?? null}
        orderNumber={String(damageTask?.order.order_number ?? '') || null}
        stageKey={damageTask ? damageTask.actualStageKey : null}
        stageLabel={damageTask ? `${damageTask.stageHeader} — ${damageTask.stageTitle}` : null}
      />

      {shortageDialog && (
        <StockShortageDialog
          stageHeader={shortageDialog.task.stageHeader}
          stageTitle={shortageDialog.task.stageTitle}
          orderNumber={String(shortageDialog.task.order.order_number ?? '')}
          shortages={shortageDialog.shortages}
          onForce={() => {
            const run = async () => {
              if (!shortageDialog) return
              const { task, markInitials } = shortageDialog
              const res = await onStageComplete(task.order, task.stageKey, task.category, { force: true, markInitials })
              setShortageDialog(null)
              if (res.status === 'ok') setLastDone({ task, initials: markInitials })
            }
            void run()
          }}
          onCancel={() => setShortageDialog(null)}
        />
      )}
    </div>
  )
}

const UNDO_MS = 60_000

// Prefiks dla reklamacji — mają własną numerację id i mogłyby kolidować z zamówieniami
const taskKey = (task: MyTask) =>
  task.alu ? aluTaskKey(task) :
  `${task.isComplaint ? 'r' : ''}${task.order.id ?? task.order.order_number}-${task.stageKey}`
