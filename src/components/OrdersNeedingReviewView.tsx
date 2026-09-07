import type { Order, OrderNeedingReview } from '../types'
import type { DuplicateCandidate, DuplicateGroup } from '../lib/duplicateDetect'
import { countCompletedStages } from '../utils'
import Spinner from './Spinner'

// Licznik etapów przy zleceniu w grupie dubli — kopia z postępem produkcji
// powinna ZOSTAĆ, anuluje się tę bez postępu. Kategorie bez etapów → brak licznika.
const stageCounter = (order: DuplicateCandidate): { label: string; started: boolean } | null => {
  const { completed, total } = countCompletedStages(order as Order)
  if (total === 0) return null
  return { label: `${completed}/${total}`, started: completed > 0 }
}

type Props = {
  orders: OrderNeedingReview[]
  loading: boolean
  onEdit: (orderId: number) => void
  onMarkVerified: (orderId: number) => Promise<void>
  onCancel: (orderId: number) => Promise<void>
  duplicates: DuplicateGroup[]
}

const sourceBadge = (source: string | null | undefined) => {
  if (source === 'bot') return <span className="badge badge-purple">BOT</span>
  if (source === 'excel') return <span className="badge badge-info">EXCEL</span>
  return <span className="badge badge-neutral">RĘCZNE</span>
}

const formatWhen = (value: string | null): string => {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const absolute = date.toLocaleString('pl-PL')
  const diffMs = Date.now() - date.getTime()
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays > 0) return `${absolute} (${diffDays} dni temu)`
  if (diffHours > 0) return `${absolute} (${diffHours} godz. temu)`
  const diffMinutes = Math.max(Math.floor(diffMs / (1000 * 60)), 0)
  return `${absolute} (${diffMinutes} min temu)`
}

export default function OrdersNeedingReviewView({ orders, loading, onEdit, onMarkVerified, onCancel, duplicates }: Props) {
  return (
    <div className="orders-review-view">
      <div className="orders-review-header">
        <h2>⚠️ Zamówienia wymagające weryfikacji</h2>
        <p>
          Zamówienia z konfiguratora online, które wymagają ręcznej weryfikacji przed wysłaniem do produkcji.
          Sortowane FIFO — najstarsze na górze.
        </p>
        <div className="orders-review-count">{orders.length} zamówień do sprawdzenia</div>
      </div>

      {loading ? (
        <Spinner center label="Ładowanie listy weryfikacji…" />
      ) : orders.length === 0 ? (
        <p className="no-results">🎉 Brak zamówień do weryfikacji! Wszystko czyste.</p>
      ) : (
        <div className="table-wrapper">
          <table className="orders-table orders-review-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Numer ZD</th>
                <th>Klient</th>
                <th>Model</th>
                <th>Przyjęto</th>
                <th>Powody weryfikacji</th>
                <th>Akcje</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order, index) => (
                <tr key={order.id} className="orders-review-row">
                  <td>{index + 1}</td>
                  <td>
                    {order.category} #{order.order_number}
                  </td>
                  <td>
                    <div>{order.client_order_number || '—'}</div>
                    <div className="orders-review-company">{order.company || '—'}</div>
                  </td>
                  <td>{order.model || '—'}</td>
                  <td>{formatWhen(order.bot_received_at)}</td>
                  <td>
                    {order.warnings.length > 0 ? (
                      order.warnings.map((w, i) => (
                        <span key={i} className="review-warning-tag" title={w}>
                          ⚠️ {w}
                        </span>
                      ))
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    <div className="orders-review-actions">
                      <button type="button" className="btn btn-sm btn-primary" onClick={() => onEdit(order.id)}>
                        Otwórz / Napraw
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={() => void onMarkVerified(order.id)}
                      >
                        Oznacz jako zweryfikowane
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={() => void onCancel(order.id)}
                      >
                        Anuluj zamówienie
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="orders-review-header" style={{ marginTop: 32 }}>
        <h2>🔁 Podejrzane duble</h2>
        <p>
          Zlecenia o tym samym numerze zamówienia klienta, firmie i kategorii, z których co najmniej jedno
          przyszło z konfiguratora (BOT). Najczęstsza przyczyna: to samo zamówienie weszło i przez API,
          i przez Excel. Sprawdź parę i anuluj nadmiarowe zlecenie w jego tabeli.
        </p>
        <div className="orders-review-count">{duplicates.length} podejrzanych grup</div>
      </div>

      {duplicates.length === 0 ? (
        <p className="no-results">🎉 Brak podejrzanych dubli.</p>
      ) : (
        <div className="table-wrapper">
          <table className="orders-table orders-review-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Nr zam. klienta</th>
                <th>Firma</th>
                <th>Kategoria</th>
                <th>Zlecenia w grupie</th>
              </tr>
            </thead>
            <tbody>
              {duplicates.map((group, index) => (
                <tr key={`${group.category}-${group.clientOrderNumber}-${index}`} className="orders-review-row">
                  <td>{index + 1}</td>
                  <td>{group.clientOrderNumber}</td>
                  <td>{group.company}</td>
                  <td>{group.category}</td>
                  <td>
                    <div className="orders-review-actions">
                      {group.orders.map((order) => {
                        const stages = stageCounter(order)
                        return (
                          <button
                            key={order.id}
                            type="button"
                            className="btn btn-sm btn-secondary"
                            title={`${order.model || ''} ${order.width || ''}×${order.height || ''} — otwórz zlecenie`}
                            onClick={() => order.id !== undefined && onEdit(order.id)}
                          >
                            {sourceBadge(order.source)} #{order.order_number}
                            {stages && (
                              <span
                                className={stages.started ? 'badge badge-warning' : 'badge badge-success'}
                                title={stages.started ? 'Ma postęp produkcji — ta kopia powinna zostać' : 'Bez postępu — bezpieczna do anulowania'}
                              >
                                {stages.label} etap.
                              </span>
                            )}
                          </button>
                        )
                      })}
                    </div>
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
