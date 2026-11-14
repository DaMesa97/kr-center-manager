// =====================================================================
// CRM → „Kontakty” (brief pkt 20): WSZYSCY klienci z crm.leady, nie tylko z zadaniem.
// Szukanie (nazwa, telefon, e-mail, miejscowość), filtry (status, kanał, etykieta,
// „bez zadania”), sort domyślnie po ostatniej aktywności. Klik = karta klienta.
// =====================================================================
import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, Search } from 'lucide-react'
import type { ToastVariant } from '../../types'
import { CRM_AKCJA, CRM_KANAL, CRM_LEAD_STATUS, CRM_OFERTA_RODZAJ, CRM_OFERTA_STATUS } from '../../types/crm'
import { fetchKontakty, type CrmError, type CrmKontaktRow } from '../../hooks/useCrm'
import { useEtykiety } from '../../hooks/useEtykiety'
import { EtykietyRow, KanalBadge } from './CrmEtykiety'
import DataTable, { type DataTableColumn } from '../DataTable'
import Spinner from '../Spinner'

type Props = {
  pushToast: (message: string, variant: ToastVariant) => void
  onOpenLead: (id: string) => void
  onOpenOferta: (id: string) => void
}

const fmtPln = (v: number | null | undefined): string =>
  v == null ? '—' : `${Number(v).toLocaleString('pl-PL', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} zł`
const fmtDateTime = (iso: string | null | undefined): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}
const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' })
}
const leadName = (l: CrmKontaktRow) => (l.nazwa || l.telefon || l.email || 'Klient bez nazwy').trim()
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const aktywnosc = (l: CrmKontaktRow) => (l.ostatnia_rozmowa_at && l.ostatnia_rozmowa_at > l.updated_at ? l.ostatnia_rozmowa_at : l.updated_at) || l.created_at

export default function CrmKontaktyScreen({ pushToast, onOpenLead, onOpenOferta }: Props) {
  const [rows, setRows] = useState<CrmKontaktRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<CrmError | null>(null)
  const etyk = useEtykiety()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [kanal, setKanal] = useState('')
  const [etykieta, setEtykieta] = useState('')
  const [bezZadania, setBezZadania] = useState(false)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    const r = await fetchKontakty()
    setError(r.error)
    if (!r.error) setRows(r.data)
    setLoading(false)
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const nq = norm(q.trim())
    const digits = q.replace(/\D/g, '')
    return rows
      .filter((l) => {
        if (status && (l.status ?? '') !== status) return false
        if (kanal && (l.zrodlo ?? '') !== kanal) return false
        if (etykieta && !(l.etykiety ?? []).includes(etykieta)) return false
        if (bezZadania && l.nastepna_akcja) return false
        if (!nq) return true
        const hay = norm([l.nazwa, l.email, l.miejscowosc].filter(Boolean).join(' '))
        if (hay.includes(nq)) return true
        if (digits.length >= 3 && (l.telefon ?? '').replace(/\D/g, '').includes(digits)) return true
        return false
      })
      .sort((a, b) => aktywnosc(b).localeCompare(aktywnosc(a)))
  }, [rows, q, status, kanal, etykieta, bezZadania])

  const columns = useMemo<DataTableColumn<CrmKontaktRow>[]>(
    () => [
      {
        key: 'klient',
        label: 'Klient',
        sortValue: (r) => leadName(r),
        render: (r) => (
          <button type="button" className="crm-link" onClick={() => onOpenLead(r.id)} title="Karta klienta: dane, historia, oferty">
            <b>{leadName(r)}</b>
            {r.nazwa && r.telefon ? <span className="crm-muted"> · {r.telefon}</span> : null}
          </button>
        ),
      },
      { key: 'miejscowosc', label: 'Miejscowość', sortValue: (r) => r.miejscowosc ?? '', render: (r) => r.miejscowosc || '—' },
      { key: 'kanal', label: 'Kanał', sortValue: (r) => r.zrodlo ?? '', render: (r) => <KanalBadge zrodlo={r.zrodlo} /> },
      { key: 'status', label: 'Status', sortValue: (r) => r.status ?? '', render: (r) => CRM_LEAD_STATUS[r.status ?? ''] ?? r.status ?? '—' },
      {
        key: 'etykiety',
        label: 'Etykiety',
        sortValue: (r) => (r.etykiety ?? []).join(','),
        stopRowClick: true,
        render: (r) => (
          <EtykietyRow leadId={r.id} slugi={r.etykiety} slownik={etyk.mapa} compact pushToast={pushToast} onChanged={(slugi) => setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, etykiety: slugi } : x)))} />
        ),
      },
      { key: 'aktywnosc', label: 'Ostatnia aktywność', sortValue: (r) => aktywnosc(r), render: (r) => fmtDateTime(aktywnosc(r)) },
      {
        key: 'zadanie',
        label: 'Zadanie',
        sortValue: (r) => r.nastepna_akcja ?? '',
        render: (r) =>
          r.nastepna_akcja ? (
            <span title={r.akcja_opis ?? undefined}>
              {CRM_AKCJA[r.nastepna_akcja]?.icon} {CRM_AKCJA[r.nastepna_akcja]?.label ?? r.nastepna_akcja}
              {r.nastepny_krok ? <span className="crm-muted"> · {fmtDate(r.nastepny_krok)}</span> : null}
            </span>
          ) : (
            <span className="crm-muted">—</span>
          ),
      },
      {
        key: 'oferta',
        label: 'Ostatnia oferta',
        sortValue: (r) => r.ostatnia_oferta?.created_at ?? '',
        stopRowClick: true,
        render: (r) => {
          const o = r.ostatnia_oferta
          if (!o) return <span className="crm-muted">—</span>
          const kwota = o.rodzaj === 'oficjalna' ? o.brutto : o.cena_razem
          const st = CRM_OFERTA_STATUS[o.status]
          return (
            <button type="button" className="crm-link" onClick={() => onOpenOferta(o.id)} title={CRM_OFERTA_RODZAJ[o.rodzaj ?? 'sklep']?.title}>
              {o.rodzaj === 'oficjalna' && o.numer ? `nr ${o.numer}` : `v${o.wersja}`} · {fmtPln(kwota)}
              {st ? <span className={`crm-status ${st.cls}`}> {st.label}</span> : null}
            </button>
          )
        },
      },
    ],
    [onOpenLead, onOpenOferta, etyk.mapa, pushToast],
  )

  const etykietyLista = [...etyk.mapa.values()].filter((e) => e.aktywna)

  return (
    <div className="crm-screen crm-kontakty">
      <div className="crm-toolbar">
        <label className="crm-search">
          <Search size={14} />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Szukaj: nazwa, telefon, e-mail, miejscowość" aria-label="Szukaj klienta" />
        </label>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status klienta">
          <option value="">każdy status</option>
          {Object.entries(CRM_LEAD_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={kanal} onChange={(e) => setKanal(e.target.value)} aria-label="Kanał">
          <option value="">każdy kanał</option>
          {Object.entries(CRM_KANAL).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
        </select>
        <select value={etykieta} onChange={(e) => setEtykieta(e.target.value)} aria-label="Etykieta">
          <option value="">każda etykieta</option>
          {etykietyLista.map((e) => <option key={e.slug} value={e.slug}>{e.nazwa}</option>)}
        </select>
        <label className="crm-check-inline">
          <input type="checkbox" checked={bezZadania} onChange={(e) => setBezZadania(e.target.checked)} /> bez zadania
        </label>
        <span className="crm-toolbar-hint">{filtered.length} z {rows.length}</span>
        <button type="button" className="btn btn-sm btn-secondary" onClick={() => void load()} title="Odśwież"><RefreshCw size={14} /> Odśwież</button>
      </div>
      {error && <div className="crm-box crm-box--bad">{error.message}</div>}
      {loading ? (
        <Spinner center label="Ładowanie kontaktów…" />
      ) : (
        <DataTable rows={filtered} rowKey={(r) => r.id} columns={columns} className="crm-table" emptyText={rows.length === 0 ? 'Nie ma jeszcze żadnego klienta.' : 'Nikt nie pasuje do filtrów.'} />
      )}
    </div>
  )
}
