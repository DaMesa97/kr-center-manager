import { useMemo } from 'react'
import type { Order, OrderNeedingReview } from '../types'
import type { DuplicateCandidate, DuplicateGroup } from '../lib/duplicateDetect'
import { countCompletedStages } from '../utils'
import Spinner from './Spinner'
import DataTable, { type DataTableColumn } from './DataTable'

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
  const reviewColumns = useMemo<DataTableColumn<OrderNeedingReview>[]>(
    () => [
      { key: 'idx', label: '#', render: (_o, index) => index + 1 },
      {
        key: 'number',
        label: 'Numer ZD',
        sortValue: (o) => `${o.category} ${o.order_number}`,
        render: (o) => (
          <>
            {sourceBadge(o.source)} {o.category} #{o.order_number}
          </>
        ),
      },
      {
        key: 'client',
        label: 'Klient',
        sortValue: (o) => o.client_order_number || null,
        render: (o) => (
          <>
            <div>{o.client_order_number || '—'}</div>
            <div className="orders-review-company">{o.company || '—'}</div>
          </>
        ),
      },
      { key: 'model', label: 'Model', sortValue: (o) => o.model || null, render: (o) => o.model || '—' },
      { key: 'received', label: 'Przyjęto', sortValue: (o) => o.bot_received_at, render: (o) => formatWhen(o.bot_received_at) },
      {
        key: 'warnings',
        label: 'Powody weryfikacji',
        render: (o) =>
          o.warnings.length > 0
            ? o.warnings.map((w, i) => (
                <span key={i} className="review-warning-tag" title={w}>
                  ⚠️ {w}
                </span>
              ))
            : '—',
      },
      {
        key: 'actions',
        label: 'Akcje',
        render: (o) => (
          <div className="orders-review-actions">
            <button type="button" className="btn btn-sm btn-primary" onClick={() => onEdit(o.id)}>
              Otwórz / Napraw
            </button>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => void onMarkVerified(o.id)}>
              Oznacz jako zweryfikowane
            </button>
            <button type="button" className="btn btn-sm btn-danger" onClick={() => void onCancel(o.id)}>
              Anuluj zamówienie
            </button>
          </div>
        ),
      },
    ],
    [onEdit, onMarkVerified, onCancel],
  )

  const duplicateColumns = useMemo<DataTableColumn<DuplicateGroup>[]>(
    () => [
      { key: 'idx', label: '#', render: (_g, index) => index + 1 },
      {
        key: 'client',
        label: 'Nr zam. klienta',
        sortValue: (g) => g.clientOrderNumber,
        render: (g) => (
          <>
            {g.clientOrderNumber}
            {g.matchedBy === 'tresc' && (
              <span
                className="badge badge-warning"
                title="Brak numeru zamówienia klienta — dopasowanie po produkcie (system, model, kolory, wymiary) w oknie 3 dni. Oceń ręcznie."
              >
                PO TREŚCI
              </span>
            )}
          </>
        ),
      },
      { key: 'company', label: 'Firma', sortValue: (g) => g.company, render: (g) => g.company },
      { key: 'category', label: 'Kategoria', sortValue: (g) => g.category, render: (g) => g.category },
      {
        key: 'orders',
        label: 'Zlecenia w grupie',
        render: (g) => (
          <div className="orders-review-actions">
            {g.orders.map((order) => {
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
        ),
      },
    ],
    [onEdit],
  )

  return (
    <div className="orders-review-view">
      <div className="orders-review-header">
        <h2>⚠️ Zamówienia wymagające weryfikacji</h2>
        <p>
          Zamówienia z konfiguratora (BOT) i z arkuszy Excel, które wymagają ręcznej weryfikacji przed wysłaniem do produkcji.
          Sortowane FIFO — najstarsze na górze.
        </p>
        <div className="orders-review-count">{orders.length} zamówień do sprawdzenia</div>
      </div>

      {loading ? (
        <Spinner center label="Ładowanie listy weryfikacji…" />
      ) : orders.length === 0 ? (
        <p className="no-results">🎉 Brak zamówień do weryfikacji! Wszystko czyste.</p>
      ) : (
        <DataTable
          rows={orders}
          rowKey={(o) => o.id}
          columns={reviewColumns}
          className="orders-review-table"
          rowClassName={() => 'orders-review-row'}
        />
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
        <DataTable
          rows={duplicates}
          rowKey={(g, index) => `${g.category}-${g.clientOrderNumber}-${index}`}
          columns={duplicateColumns}
          className="orders-review-table"
          rowClassName={() => 'orders-review-row'}
        />
      )}
    </div>
  )
}
