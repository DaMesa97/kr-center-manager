import { useEffect, useMemo, useRef } from 'react'
import type { ErpErrorRow, Order, OrderNeedingReview } from '../types'
import { fmtErpDate } from '../lib/erpStatus'
import type { DuplicateCandidate, DuplicateGroup } from '../lib/duplicateDetect'
import { countCompletedStages } from '../utils'
import Spinner from './Spinner'
import DataTable, { type DataTableColumn } from './DataTable'
import ExcelSyncReviewSection from './ExcelSyncReviewSection'
import type { ExcelSyncState } from '../hooks/useExcelSync'

/** sekcja, do której przewinąć po wejściu z kafelka Pulpitu (#115) */
export type ReviewFocus = 'review' | 'excel' | 'erp' | 'duplicates'

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
  /** zlecenia z erp_status = NIEPOMYŚLNY (RO w Optimie nie powstało) — najnowsze na górze */
  erpErrors: ErpErrorRow[]
  onOpenErpOrder: (orderId: number) => void
  /** „Ponów wysyłkę do Optimy" (kierownik) */
  onRetryErp: (row: ErpErrorRow) => void
  retryingErpId: number | null
  /** wyniki synchronizacji wydań z Excela (#116) */
  excelSync: ExcelSyncState
  /** anulowanie zlecenia po id — ta sama ścieżka co w tabelach (rezerwacje wracają) */
  onCancelOrderById: (orderId: number) => Promise<void>
  /** po wejściu z Pulpitu: przewiń do sekcji */
  focusSection?: ReviewFocus | null
  onFocusConsumed?: () => void
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

export default function OrdersNeedingReviewView({
  orders,
  loading,
  onEdit,
  onMarkVerified,
  onCancel,
  duplicates,
  erpErrors,
  onOpenErpOrder,
  onRetryErp,
  retryingErpId,
  excelSync,
  onCancelOrderById,
  focusSection,
  onFocusConsumed,
}: Props) {
  const excelRef = useRef<HTMLDivElement>(null)
  const erpRef = useRef<HTMLDivElement>(null)
  const duplicatesRef = useRef<HTMLDivElement>(null)

  // #115: kafelek na Pulpicie prowadził na górę Weryfikacji — teraz przewija do sekcji
  useEffect(() => {
    if (!focusSection || loading) return
    const target =
      focusSection === 'excel' ? excelRef.current
      : focusSection === 'erp' ? erpRef.current
      : focusSection === 'duplicates' ? duplicatesRef.current
      : null
    const t = window.setTimeout(() => {
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' })
      else window.scrollTo({ top: 0, behavior: 'smooth' })
      onFocusConsumed?.()
    }, 60)
    return () => window.clearTimeout(t)
  }, [focusSection, loading, onFocusConsumed])

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

  const erpColumns = useMemo<DataTableColumn<ErpErrorRow>[]>(
    () => [
      {
        key: 'order_number',
        label: 'Zlecenie',
        sortValue: (r) => r.order_number,
        render: (r) => (
          <button type="button" className="btn-link" onClick={() => onOpenErpOrder(r.id)} title="Otwórz zlecenie">
            <strong>{r.order_number}</strong>
          </button>
        ),
      },
      { key: 'category', label: 'Kategoria', sortValue: (r) => r.category, render: (r) => r.category },
      { key: 'company', label: 'Firma', sortValue: (r) => r.company ?? '', render: (r) => r.company ?? '—' },
      { key: 'client_order_number', label: 'Nr zam. klienta', sortValue: (r) => r.client_order_number ?? '', render: (r) => r.client_order_number ?? '—' },
      {
        key: 'erp_error',
        label: 'Błąd z Optimy',
        sortValue: (r) => r.erp_error ?? '',
        render: (r) => <span className="erp-error-text">{r.erp_error?.trim() || 'Make nie podał treści błędu'}</span>,
      },
      { key: 'erp_updated_at', label: 'Kiedy', sortValue: (r) => r.erp_updated_at ?? '', render: (r) => fmtErpDate(r.erp_updated_at) },
      {
        key: 'actions',
        label: 'Akcje',
        render: (r) => (
          <div className="contractor-actions">
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => onOpenErpOrder(r.id)}>
              Otwórz
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={retryingErpId === r.id}
              onClick={() => onRetryErp(r)}
              title="Wyślij zlecenie jeszcze raz do Make, żeby założył RO w Optimie (najpierw usuń przyczynę błędu)"
            >
              {retryingErpId === r.id ? 'Wysyłanie…' : '↻ Ponów wysyłkę'}
            </button>
          </div>
        ),
      },
    ],
    [onOpenErpOrder, onRetryErp, retryingErpId],
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

      <ExcelSyncReviewSection
        data={excelSync}
        onOpenOrder={onOpenErpOrder}
        onCancelOrder={onCancelOrderById}
        sectionRef={excelRef}
      />

      <div className="orders-review-header" style={{ marginTop: 32 }} ref={erpRef} id="review-erp">
        <h2>🧾 Błędy ERP (Optima)</h2>
        <p>
          Zamówienia z konfiguratora, dla których Make nie zdołał założyć RO w Optimie (najczęściej: brak towaru
          w kartotece Optimy). Najnowsze na górze. Poprawia się to w Airtable — interfejs „Błędy automatyzacji (Optima)"
          i przycisk „Ponów wysyłkę"; po udanej wysyłce status sam zniknie z tej listy.
        </p>
        <div className="orders-review-count">{erpErrors.length} zleceń z błędem</div>
      </div>

      {erpErrors.length === 0 ? (
        <p className="no-results">🎉 Brak błędów ERP — wszystkie RO założone.</p>
      ) : (
        <DataTable
          rows={erpErrors}
          rowKey={(r) => r.id}
          columns={erpColumns}
          className="orders-review-table"
          rowClassName={() => 'orders-review-row'}
        />
      )}

      <div className="orders-review-header" style={{ marginTop: 32 }} ref={duplicatesRef} id="review-duplicates">
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
