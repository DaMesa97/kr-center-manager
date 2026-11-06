import { useState, type RefObject } from 'react'
import Spinner from './Spinner'
import type { ExcelSyncOrderInfo, ExcelSyncState } from '../hooks/useExcelSync'

/**
 * Weryfikacja → „Do wyjaśnienia po synchronizacji z Excelem" (zgłoszenie #116).
 * Trzy zakładki: Duplikaty (ten sam wiersz Excela dopasował się do kilku zleceń),
 * Anulowane w Excelu (w arkuszu ANULOWANE, w aplikacji wciąż otwarte), Inne
 * (np. WSTRZYMANE). Akcje korzystają z istniejącej ścieżki anulowania zlecenia.
 */
type Tab = 'duplikaty' | 'anulowane' | 'inne'

type Props = {
  data: ExcelSyncState
  onOpenOrder: (orderId: number) => void
  onCancelOrder: (orderId: number) => Promise<void>
  /** do przewinięcia z kafelka na Pulpicie */
  sectionRef?: RefObject<HTMLDivElement>
}

const fmtWhen = (iso: string | null | undefined): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const sourceBadge = (source: string | null) => {
  if (source === 'bot') return <span className="badge badge-purple">BOT</span>
  if (source === 'excel') return <span className="badge badge-info">EXCEL</span>
  return <span className="badge badge-neutral">RĘCZNE</span>
}

const STOCK_LABEL: Record<string, string> = {
  reserved: 'magazyn: zarezerwowane',
  insufficient: 'magazyn: braki',
  partial_recipe: 'magazyn: częściowa receptura',
  no_recipe: 'magazyn: brak receptury',
  consumed: 'magazyn: wydane',
}

function OrderCard({
  order,
  keep,
  busyId,
  onOpen,
  onCancel,
}: {
  order: ExcelSyncOrderInfo
  keep: boolean
  busyId: number | null
  onOpen: (id: number) => void
  onCancel: (id: number) => void
}) {
  const closed = order.cancelled || !!order.release_date
  return (
    <div className={`excel-sync-card${keep ? ' excel-sync-card--keep' : ''}`}>
      <div className="excel-sync-card-head">
        {sourceBadge(order.source)}
        <strong>#{order.order_number}</strong>
        <span className="excel-sync-card-cat">{order.category}</span>
        {keep && <span className="badge badge-success" title="Zasada: zostaje zlecenie z konfiguratora">ZOSTAJE</span>}
        {order.release_date && <span className="badge badge-neutral">WYDANE {order.release_date}</span>}
      </div>
      <div className="excel-sync-card-meta">
        <span>utworzone {fmtWhen(order.created_at)}</span>
        {order.stagesTotal > 0 && (
          <span className={order.stagesDone > 0 ? 'excel-sync-progress excel-sync-progress--started' : 'excel-sync-progress'}>
            etapy {order.stagesDone}/{order.stagesTotal}
          </span>
        )}
        {order.stock_status && <span>{STOCK_LABEL[order.stock_status] ?? `magazyn: ${order.stock_status}`}</span>}
      </div>
      <div className="excel-sync-card-actions">
        <button type="button" className="btn btn-sm btn-secondary" onClick={() => onOpen(order.id)}>
          Otwórz
        </button>
        {!closed && (
          <button
            type="button"
            className="btn btn-sm btn-danger"
            disabled={busyId === order.id}
            onClick={() => onCancel(order.id)}
            title={order.stagesDone > 0 ? 'Uwaga: to zlecenie ma już postęp produkcji' : 'Anuluj zlecenie (rezerwacje wracają na magazyn)'}
          >
            {busyId === order.id ? 'Anuluję…' : 'Anuluj zlecenie'}
          </button>
        )}
      </div>
    </div>
  )
}

export default function ExcelSyncReviewSection({ data, onOpenOrder, onCancelOrder, sectionRef }: Props) {
  const [tab, setTab] = useState<Tab>('duplikaty')
  const [busyId, setBusyId] = useState<number | null>(null)

  const cancel = async (id: number) => {
    setBusyId(id)
    try {
      // istniejąca ścieżka otwiera okno potwierdzenia i kończy się asynchronicznie —
      // odświeżamy po chwili, a nie od razu
      await onCancelOrder(id)
      window.setTimeout(() => void data.refresh(), 2500)
    } finally {
      setBusyId(null)
    }
  }

  const counts: Record<Tab, number> = {
    duplikaty: data.duplicates.length,
    anulowane: data.cancelledInExcel.length,
    inne: data.other.length,
  }
  const tabBtn = (key: Tab, label: string) => (
    <button
      key={key}
      type="button"
      role="tab"
      aria-selected={tab === key}
      className={`btn btn-sm ${tab === key ? 'btn-primary' : 'btn-secondary'}`}
      onClick={() => setTab(key)}
    >
      {label}
      {counts[key] > 0 && <span className="subtab-badge">{counts[key]}</span>}
    </button>
  )

  return (
    <div ref={sectionRef} id="review-excel-sync">
      <div className="orders-review-header" style={{ marginTop: 32 }}>
        <h2>📗 Do wyjaśnienia po synchronizacji z Excelem</h2>
        <p>
          Codziennie o 20:00 automat czyta arkusze „Zamówienia *.xlsm" i zamyka zlecenia wydane w Excelu. Tu ląduje to, czego
          sam nie rozstrzygnął. Przy duplikatach zasada jest jedna: <b>zostaje zlecenie z konfiguratora (BOT), kopię
          z Excela anulujemy</b>.
        </p>
        <div className="orders-review-count">
          {data.openCount} do decyzji · ostatnia synchronizacja {fmtWhen(data.lastSyncAt)}
          {data.stale && (
            <span className="badge badge-warning" style={{ marginLeft: 8 }} title="Make synchronizuje codziennie o 20:00 — sprawdź scenariusz">
              starsza niż dobę
            </span>
          )}
          {data.runs.length > 0 && (
            <span className="excel-sync-runs" title={data.runs.map((r) => `${r.kategoria}: ${fmtWhen(r.created_at)} (${r.source ?? '?'})`).join('\n')}>
              {' '}· pliki: {data.runs.map((r) => r.kategoria).join(', ')}
            </span>
          )}
          <button type="button" className="btn btn-sm btn-secondary" style={{ marginLeft: 8 }} onClick={() => void data.refresh()} disabled={data.loading}>
            Odśwież
          </button>
        </div>
      </div>

      {data.error && <p className="form-error">Nie udało się pobrać wyników synchronizacji: {data.error}</p>}

      <div className="subtab-bar" role="tablist" aria-label="Synchronizacja z Excelem — sekcje">
        {tabBtn('duplikaty', 'Duplikaty')}
        {tabBtn('anulowane', 'Anulowane w Excelu')}
        {tabBtn('inne', 'Inne')}
      </div>

      {data.loading && data.runs.length === 0 ? (
        <Spinner center label="Czytam wyniki synchronizacji…" />
      ) : tab === 'duplikaty' ? (
        data.duplicates.length === 0 ? (
          <p className="no-results">🎉 Brak nierozstrzygniętych duplikatów.</p>
        ) : (
          <div className="excel-sync-groups">
            {data.duplicates.map((g) => {
              const keepId = g.orders.find((o) => o.source === 'bot')?.id ?? null
              return (
                <div key={g.key} className="excel-sync-group">
                  <div className="excel-sync-group-head">
                    <strong>Excel: {g.excel_row}</strong>
                    <span>{g.category}</span>
                    <span>{g.company ?? '—'}</span>
                    <span>{g.model ?? '—'}</span>
                    {g.wydanie && <span className="badge badge-neutral">wydanie w Excelu: {g.wydanie}</span>}
                    <span className="excel-sync-group-hint">{g.orders.length} zleceń w aplikacji na jeden wiersz arkusza</span>
                  </div>
                  <div className="excel-sync-cards">
                    {g.orders.map((o) => (
                      <OrderCard key={o.id} order={o} keep={o.id === keepId} busyId={busyId} onOpen={onOpenOrder} onCancel={(id) => void cancel(id)} />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )
      ) : tab === 'anulowane' ? (
        data.cancelledInExcel.length === 0 ? (
          <p className="no-results">🎉 Nic — wszystko anulowane w Excelu jest też anulowane tutaj.</p>
        ) : (
          <div className="excel-sync-groups">
            {data.cancelledInExcel.map((it) => (
              <div key={`${it.category}-${it.id}`} className="excel-sync-group">
                <div className="excel-sync-group-head">
                  <strong>Excel: {it.excel_row ?? '—'}</strong>
                  <span className="badge badge-danger">w arkuszu: {it.wydanie ?? 'ANULOWANE'}</span>
                  <span>dopasowanie: {it.how ?? '—'}</span>
                </div>
                <div className="excel-sync-cards">
                  {it.order ? (
                    <OrderCard order={it.order} keep={false} busyId={busyId} onOpen={onOpenOrder} onCancel={(id) => void cancel(id)} />
                  ) : (
                    <div className="excel-sync-card">
                      <strong>#{it.order_number}</strong> {it.category} · {it.company ?? '—'} · {it.model ?? '—'}
                      <div className="excel-sync-card-actions">
                        <button type="button" className="btn btn-sm btn-secondary" onClick={() => onOpenOrder(it.id)}>Otwórz</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      ) : data.other.length === 0 ? (
        <p className="no-results">🎉 Brak innych rozbieżności.</p>
      ) : (
        <div className="excel-sync-groups">
          {data.other.map((it) => (
            <div key={`${it.category}-${it.id}`} className="excel-sync-group">
              <div className="excel-sync-group-head">
                <strong>Excel: {it.excel_row ?? '—'}</strong>
                <span className="badge badge-warning">w arkuszu: {it.wydanie ?? '—'}</span>
                <span>dopasowanie: {it.how ?? '—'}</span>
                <span className="excel-sync-group-hint">automat nie wie, co z tym zrobić — zdecyduj w zleceniu</span>
              </div>
              <div className="excel-sync-cards">
                {it.order ? (
                  <OrderCard order={it.order} keep={false} busyId={busyId} onOpen={onOpenOrder} onCancel={(id) => void cancel(id)} />
                ) : (
                  <div className="excel-sync-card">
                    <strong>#{it.order_number}</strong> {it.category} · {it.company ?? '—'} · {it.model ?? '—'}
                    <div className="excel-sync-card-actions">
                      <button type="button" className="btn btn-sm btn-secondary" onClick={() => onOpenOrder(it.id)}>Otwórz</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
