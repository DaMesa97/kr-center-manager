import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { appAlert, appConfirm } from '../lib/appDialogs'
import { releaseFailureWhat } from '../lib/stockReleaseFailure'
import { getOrderStageDefinitions } from '../utils'
import DataTable, { type DataTableColumn } from './DataTable'

/**
 * Weryfikacja → „Magazyn do sprawdzenia” (D41, 28.11): zlecenia, przy których etap / wydanie się zapisało,
 * ale zdjęcie z magazynu (WZ) nie poszło. „Ponów zdjęcie” woła to samo zdjęcie z wymuszeniem,
 * „Sprawdzone” zamyka wpis bez ruchu (np. korekta zrobiona ręcznie).
 * Baza bez migracji 20261128030100 (brak funkcji) → sekcja się nie pokazuje.
 */
type Row = {
  r_id: number
  r_order_id: number
  r_order_number: string | null
  r_category: string | null
  r_company: string | null
  r_kind: string
  r_stage_key: string | null
  r_error: string | null
  r_source: string | null
  r_created_at: string
  r_updated_at: string | null
  r_created_by_name: string | null
  r_release_date: string | null
}

const fmtWhen = (iso: string | null | undefined): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function stageLabel(category: string | null, key: string | null): string | null {
  if (!key) return null
  const def = getOrderStageDefinitions(category ?? '').find((d) => d.key === key)
  return def?.header ?? key
}

export default function StockReleaseFailuresSection({ onOpenOrder }: { onOpenOrder: (orderId: number) => void }) {
  const [rows, setRows] = useState<Row[]>([])
  const [available, setAvailable] = useState(true)
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('lista_bledow_zdjecia_magazynu')
    if (error) {
      // brak migracji (PGRST202) albo brak uprawnień — sekcji nie pokazujemy
      if (error.code !== 'PGRST202') console.error('lista_bledow_zdjecia_magazynu', error)
      setAvailable(false)
      return
    }
    setAvailable(true)
    setRows((data ?? []) as Row[])
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const resolve = useCallback(
    async (row: Row, retry: boolean) => {
      if (!retry) {
        const ok = await appConfirm(
          `Zamknąć wpis bez ruchu w magazynie? Zrób tak tylko, gdy stan zlecenia ${row.r_order_number ?? row.r_order_id} jest już poprawiony inaczej.`,
          { title: 'Sprawdzone', confirmLabel: 'Zamknij wpis' },
        )
        if (!ok) return
      }
      setBusyId(row.r_id)
      const { data, error } = await supabase.rpc('rozwiaz_blad_zdjecia_magazynu', { p_id: row.r_id, p_retry: retry })
      setBusyId(null)
      if (error) {
        void appAlert(`Nie udało się: ${error.message}`)
        return
      }
      const d = (data ?? {}) as { status?: string; wydano_pozycji?: number; mimo_braku?: number }
      if (retry) {
        const n = Number(d.wydano_pozycji ?? 0)
        const minus = Number(d.mimo_braku ?? 0)
        void appAlert(
          n > 0
            ? `Zdjęto z magazynu ${n} poz.${minus > 0 ? ` (w tym ${minus} mimo braku — stan na minusie)` : ''}.`
            : 'Nie było już nic do zdjęcia (rezerwacje rozliczone wcześniej). Wpis zamknięty.',
        )
      }
      await load()
    },
    [load],
  )

  if (!available) return null

  const columns: DataTableColumn<Row>[] = [
    {
      key: 'order',
      label: 'Zlecenie',
      sortValue: (r) => `${r.r_category ?? ''} ${r.r_order_number ?? ''}`,
      render: (r) => (
        <>
          <button type="button" className="btn btn-link" onClick={() => onOpenOrder(r.r_order_id)}>
            {r.r_category} #{r.r_order_number ?? r.r_order_id}
          </button>
          {r.r_company && <div className="orders-review-company">{r.r_company}</div>}
        </>
      ),
    },
    {
      key: 'what',
      label: 'Co się nie zdjęło',
      sortValue: (r) => r.r_kind,
      render: (r) => releaseFailureWhat(r.r_kind, stageLabel(r.r_category, r.r_stage_key)),
    },
    { key: 'error', label: 'Błąd', render: (r) => <span style={{ fontSize: '0.8rem' }}>{r.r_error || '—'}</span> },
    {
      key: 'when',
      label: 'Kiedy / kto',
      sortValue: (r) => r.r_updated_at ?? r.r_created_at,
      render: (r) => (
        <>
          <div>{fmtWhen(r.r_updated_at ?? r.r_created_at)}</div>
          <div className="orders-review-company">{[r.r_created_by_name, r.r_source].filter(Boolean).join(' · ') || '—'}</div>
        </>
      ),
    },
    {
      key: 'actions',
      label: '',
      render: (r) => (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-sm btn-primary" disabled={busyId != null} onClick={() => void resolve(r, true)}>
            {busyId === r.r_id ? 'Zdejmuję…' : 'Ponów zdjęcie'}
          </button>
          <button type="button" className="btn btn-sm btn-secondary" disabled={busyId != null} onClick={() => void resolve(r, false)}>
            Sprawdzone
          </button>
        </div>
      ),
    },
  ]

  return (
    <>
      <div className="orders-review-header" style={{ marginTop: 32 }} id="review-stock-release">
        <h2>📦 Magazyn do sprawdzenia</h2>
        <p>
          Etap albo wydanie zapisało się, ale zdjęcie z magazynu (WZ) nie poszło — np. zerwane łącze. Rezerwacje tych
          zleceń wiszą. „Ponów zdjęcie” zdejmuje towar tak, jak zrobiłby to etap (także poniżej zera — towar już zużyty),
          „Sprawdzone” zamyka wpis bez ruchu.
        </p>
        <div className="orders-review-count">{rows.length} do sprawdzenia</div>
      </div>
      {rows.length === 0 ? (
        <p className="no-results">🎉 Wszystkie zdjęcia z magazynu poszły.</p>
      ) : (
        <DataTable rows={rows} rowKey={(r) => r.r_id} columns={columns} className="orders-review-table" rowClassName={() => 'orders-review-row'} />
      )}
    </>
  )
}
