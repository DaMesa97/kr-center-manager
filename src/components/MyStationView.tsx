import { useMemo, useState } from 'react'
import { BASTION_STAGE_DEFS, STA_DISTING_STAGE_DEFS, ST_STAGE_DEFS, ST_TITAN_STAGE_DEFS } from '../constants'
import type { Order, StageDef, WorkerStage } from '../types'
import { isRushOrderSequence, isStTitanOrder, parseProductionStages } from '../utils'
import DeleteConfirmDialog from './DeleteConfirmDialog'

type Props = {
  currentUserId: string
  orders: Order[]
  workerStages: WorkerStage[]
  onStageComplete: (order: Order, stageKey: string, category: string) => Promise<void>
  loading: boolean
}

type MyTask = {
  order: Order
  stageKey: string
  actualStageKey: string
  category: string
  stageHeader: string
  stageTitle: string
  readyToWork: boolean
}

function buildTasks(orders: Order[], workerStages: WorkerStage[]): MyTask[] {
  const tasks: MyTask[] = []

  for (const order of orders) {
    const category = order.category ?? ''
    if (!category) continue

    const stagesForCategory = workerStages.filter((ws) => ws.category === category)
    if (stagesForCategory.length === 0) continue

    let defs: StageDef[] = []
    if (category === 'STA' || category === 'Disting') {
      defs = STA_DISTING_STAGE_DEFS
    } else if (category === 'Bastion') {
      defs = BASTION_STAGE_DEFS
    } else if (category === 'ST') {
      defs = isStTitanOrder(order) ? ST_TITAN_STAGE_DEFS : ST_STAGE_DEFS
    }

    const parsed = parseProductionStages(order.production_stages, category)

    for (const ws of stagesForCategory) {
      const hasTitanPrefix = ws.stage_key.startsWith('titan_')
      const actualKey = hasTitanPrefix ? ws.stage_key.replace('titan_', '') : ws.stage_key

      if (category === 'ST') {
        const isTitan = isStTitanOrder(order)
        if (hasTitanPrefix && !isTitan) continue
        if (!hasTitanPrefix && isTitan) continue
      }

      const def = defs.find((d) => d.key === actualKey)
      if (!def) continue

      if (parsed[actualKey] === 'T') continue

      const idx = defs.findIndex((d) => d.key === actualKey)
      const readyToWork = defs.slice(0, idx).every((d) => parsed[d.key] === 'T')

      tasks.push({
        order,
        stageKey: ws.stage_key,
        actualStageKey: actualKey,
        category,
        stageHeader: def.header,
        stageTitle: def.title ?? '',
        readyToWork,
      })
    }
  }

  tasks.sort((a, b) => {
    const aUrgent = isRushOrderSequence(a.order.sequence)
    const bUrgent = isRushOrderSequence(b.order.sequence)
    if (aUrgent !== bUrgent) return aUrgent ? -1 : 1

    if (a.readyToWork !== b.readyToWork) return a.readyToWork ? -1 : 1

    const aDate = a.order.order_date ?? ''
    const bDate = b.order.order_date ?? ''
    return aDate.localeCompare(bDate)
  })

  return tasks
}

export default function MyStationView({
  currentUserId,
  orders,
  workerStages,
  onStageComplete,
  loading,
}: Props) {
  void currentUserId
  const [confirmTask, setConfirmTask] = useState<MyTask | null>(null)
  const tasks = useMemo(() => buildTasks(orders, workerStages), [orders, workerStages])
  const readyCount = tasks.filter((t) => t.readyToWork).length
  const waitingCount = tasks.length - readyCount

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

      <div className="table-wrapper orders-table-wrapper">
        <table className="orders-table">
          <thead>
            <tr>
              <th>NR ZLECENIA</th>
              <th>FIRMA</th>
              <th>KATEGORIA</th>
              <th>MODEL</th>
              <th>ILOŚĆ</th>
              <th>ETAP</th>
              <th>STATUS</th>
              <th>UWAGI</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', padding: '2rem' }}>
                  Ładowanie…
                </td>
              </tr>
            ) : tasks.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', padding: '2rem' }}>
                  Brak zadań dla przypisanych etapów.
                </td>
              </tr>
            ) : (
              tasks.map((task) => (
                <tr
                  key={`${task.order.id ?? task.order.order_number}-${task.stageKey}`}
                  className={isRushOrderSequence(task.order.sequence) ? 'orders-table-row--priority' : ''}
                >
                  <td>{task.order.order_number}</td>
                  <td>{task.order.company}</td>
                  <td>{task.category}</td>
                  <td>{task.order.model}</td>
                  <td>{task.order.quantity}</td>
                  <td>
                    <div>
                      <strong>{task.stageHeader}</strong> — {task.stageTitle}
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm btn-success"
                      disabled={!task.readyToWork}
                      onClick={() => setConfirmTask(task)}
                    >
                      ✓ Zrobione
                    </button>
                  </td>
                  <td>
                    {task.readyToWork ? (
                      <span className="my-station-ready-badge">Gotowe do pracy</span>
                    ) : (
                      <span className="my-station-waiting-badge">Czeka na poprzednie</span>
                    )}
                  </td>
                  <td>{task.order.notes || '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {confirmTask && (
        <DeleteConfirmDialog
          title="Oznaczyć etap jako zrobiony?"
          message={`Zamówienie nr ${confirmTask.order.order_number}, etap: ${confirmTask.stageHeader} — ${confirmTask.stageTitle}`}
          confirmLabel="Tak, oznacz jako zrobione"
          cancelLabel="Anuluj"
          onConfirm={() => {
            const run = async () => {
              if (!confirmTask) return
              await onStageComplete(confirmTask.order, confirmTask.stageKey, confirmTask.category)
              setConfirmTask(null)
            }
            void run()
          }}
          onCancel={() => setConfirmTask(null)}
        />
      )}
    </div>
  )
}
