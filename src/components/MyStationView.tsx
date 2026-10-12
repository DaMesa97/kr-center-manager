import { useMemo, useState } from 'react'
import type { Order, WorkerStage } from '../types'
import { isRushOrderSequence } from '../utils'
import { buildTasks, fieldsForStage, type MyTask } from '../lib/stationLogic'
import type { StageCompleteResult, StockReleaseRow } from '../hooks/useMyStation'
import DeleteConfirmDialog from './DeleteConfirmDialog'
import StockShortageDialog from './StockShortageDialog'
import DamageReportModal from './DamageReportModal'
import Spinner from './Spinner'
import DataTable, { type DataTableColumn } from './DataTable'
import type { ToastVariant } from '../types'

type Props = {
  currentUserId: string
  orders: Order[]
  workerStages: WorkerStage[]
  onStageComplete: (
    order: Order,
    stageKey: string,
    category: string,
    opts?: { force?: boolean },
  ) => Promise<StageCompleteResult>
  loading: boolean
  pushToast: (msg: string, variant: ToastVariant) => void
  /** zgłaszanie zniszczeń tylko dla kierownika (wyprowadza towar ze stanu) */
  isManager: boolean
}

export default function MyStationView({
  currentUserId,
  orders,
  workerStages,
  onStageComplete,
  loading,
  pushToast,
  isManager,
}: Props) {
  void currentUserId
  const [confirmTask, setConfirmTask] = useState<MyTask | null>(null)
  const [damageTask, setDamageTask] = useState<MyTask | null>(null)
  const [shortageDialog, setShortageDialog] = useState<{
    task: MyTask
    shortages: StockReleaseRow[]
  } | null>(null)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const tasks = useMemo(() => buildTasks(orders, workerStages), [orders, workerStages])
  const readyCount = tasks.filter((t) => t.readyToWork).length
  const waitingCount = tasks.length - readyCount

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
            </div>
            <div className="my-station-cell-sub">{task.order.company}</div>
          </>
        ),
      },
      {
        key: 'product',
        label: 'PRODUKT',
        sortValue: (task) => task.order.model,
        render: (task) => (
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
              ✓ Zrobione
            </button>
            {isManager && (
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
      </div>

      <DataTable
        rows={tasks}
        rowKey={taskKey}
        columns={columns}
        className="my-station-table"
        wrapperClassName="orders-table-wrapper"
        loading={loading}
        loadingText={<Spinner center label="Ładowanie…" />}
        emptyText="Brak zadań dla przypisanych etapów."
        rowClassName={(task) =>
          `my-station-row ${isRushOrderSequence(task.order.sequence) ? 'orders-table-row--priority' : ''}`
        }
        onRowClick={(task) => {
          const key = taskKey(task)
          setExpandedKey(expandedKey === key ? null : key)
        }}
        renderAfterRow={(task) => {
          if (expandedKey !== taskKey(task)) return null
          const details = fieldsForStage(task.order, task.category, task.actualStageKey)
          return (
            <tr className="my-station-details-row">
              <td colSpan={columns.length}>
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
        <DeleteConfirmDialog
          title="Oznaczyć etap jako zrobiony?"
          message={`Zamówienie nr ${confirmTask.order.order_number}, etap: ${confirmTask.stageHeader} — ${confirmTask.stageTitle}`}
          confirmLabel="Tak, oznacz jako zrobione"
          cancelLabel="Anuluj"
          tone="success"
          onConfirm={() => {
            const run = async () => {
              if (!confirmTask) return
              const task = confirmTask
              const result = await onStageComplete(task.order, task.stageKey, task.category)
              setConfirmTask(null)
              if (result.status === 'shortage') {
                setShortageDialog({ task, shortages: result.shortages })
              }
            }
            void run()
          }}
          onCancel={() => setConfirmTask(null)}
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
              const { task } = shortageDialog
              await onStageComplete(task.order, task.stageKey, task.category, { force: true })
              setShortageDialog(null)
            }
            void run()
          }}
          onCancel={() => setShortageDialog(null)}
        />
      )}
    </div>
  )
}

const taskKey = (task: MyTask) => `${task.order.id ?? task.order.order_number}-${task.stageKey}`
