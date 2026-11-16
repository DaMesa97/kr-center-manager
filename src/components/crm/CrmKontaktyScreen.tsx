// =====================================================================
// CRM → „Kontakty” (brief pkt 20): WSZYSCY klienci z crm.leady, nie tylko z zadaniem.
// Szukanie (nazwa, telefon, e-mail, miejscowość), filtry (status, kanał, etykieta,
// „bez zadania”), sort domyślnie po ostatniej aktywności. Klik = karta klienta.
// =====================================================================
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Merge, RefreshCw, Search } from 'lucide-react'
import type { ToastVariant } from '../../types'
import { CRM_AKCJA, CRM_KANAL, CRM_LEAD_STATUS, CRM_OFERTA_RODZAJ, CRM_OFERTA_STATUS, type CrmDuplikat } from '../../types/crm'
import { fetchDuplikaty, fetchKontakty, type CrmError, type CrmKontaktRow } from '../../hooks/useCrm'
import { useEtykiety } from '../../hooks/useEtykiety'
import { EtykietyRow, KanalBadge } from './CrmEtykiety'
import CrmPolaczPanel from './CrmPolaczPanel'
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
  // brief pkt 26: pary możliwych duplikatów (widok crm.duplikaty) + otwarty panel łączenia
  const [duplikaty, setDuplikaty] = useState<CrmDuplikat[]>([])
  const [pokazDuplikaty, setPokazDuplikaty] = useState(false)
  const [polacz, setPolacz] = useState<CrmDuplikat | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    const [r, d] = await Promise.all([fetchKontakty(), fetchDuplikaty()])
    setError(r.error)
    if (!r.error) setRows(r.data)
    if (!d.error) setDuplikaty(d.data)
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
        // brief pkt 26: szukamy też po danych klientów połączonych w tego (inne_kontakty)
        const inne = l.inne_kontakty ?? []
        const hay = norm([l.nazwa, l.email, l.miejscowosc, ...inne.flatMap((k) => [k.nazwa, k.email, k.miejscowosc])].filter(Boolean).join(' '))
        if (hay.includes(nq)) return true
        if (digits.length >= 3 && [l.telefon, ...inne.map((k) => k.telefon)].some((t) => (t ?? '').replace(/\D/g, '').includes(digits))) return true
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
        <label className={`crm-check-inline${duplikaty.length ? ' crm-check-inline--warn' : ''}`} title="Pary klientów z tym samym telefonem, e-mailem, nazwą albo domeną firmową — do połączenia">
          <input type="checkbox" checked={pokazDuplikaty} onChange={(e) => setPokazDuplikaty(e.target.checked)} /> <Merge size={13} /> duplikaty{duplikaty.length ? ` (${duplikaty.length})` : ''}
        </label>
        <span className="crm-toolbar-hint">{filtered.length} z {rows.length}</span>
        <button type="button" className="btn btn-sm btn-secondary" onClick={() => void load()} title="Odśwież"><RefreshCw size={14} /> Odśwież</button>
      </div>
      {error && <div className="crm-box crm-box--bad">{error.message}</div>}
      {loading ? (
        <Spinner center label="Ładowanie kontaktów…" />
      ) : pokazDuplikaty ? (
        <section className="crm-dup-baner crm-dup-baner--lista">
          <h4><Merge size={15} /> Możliwe duplikaty ({duplikaty.length})</h4>
          <p className="crm-muted">Każda para raz, najpewniejsze pierwsze. „Połącz” pyta, który kontakt zostaje; drugi wchodzi w niego z całą historią (nieodwracalne).</p>
          {duplikaty.length === 0 && <p className="crm-muted">Nie ma par wyglądających na duplikaty.</p>}
          <ul className="crm-dup-lista">
            {duplikaty.map((d) => {
              const key = `${d.lead_id}:${d.duplikat_id}`
              const open = polacz != null && `${polacz.lead_id}:${polacz.duplikat_id}` === key
              return (
                <li key={key} className={`crm-dup-row${open ? ' crm-dup-row--open' : ''}`}>
                  <span className="crm-dup-para">
                    <button type="button" className="crm-link" onClick={() => onOpenLead(d.lead_id)} title="Otwórz kartę klienta"><b>{(d.nazwa || d.telefon || d.email || 'Klient bez nazwy').trim()}</b></button>
                    <span className="crm-muted">{[d.telefon, d.email].filter(Boolean).join(' · ')}</span>
                    <span className="crm-dup-strzalka">↔</span>
                    <button type="button" className="crm-link" onClick={() => onOpenLead(d.duplikat_id)} title="Otwórz kartę klienta"><b>{(d.duplikat_nazwa || d.duplikat_telefon || d.duplikat_email || 'Klient bez nazwy').trim()}</b></button>
                    <span className="crm-muted">{[d.duplikat_telefon, d.duplikat_email].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="crm-dup-powod">{d.powod} · {d.pewnosc}%</span>
                  <button type="button" className="btn btn-sm btn-secondary" disabled={polacz != null && !open} onClick={() => setPolacz(open ? null : d)}>
                    <Merge size={14} /> Połącz
                  </button>
                  {open && polacz && (
                    <CrmPolaczPanel
                      a={{ id: polacz.lead_id, nazwa: polacz.nazwa, email: polacz.email, telefon: polacz.telefon }}
                      b={{ id: polacz.duplikat_id, nazwa: polacz.duplikat_nazwa, email: polacz.duplikat_email, telefon: polacz.duplikat_telefon }}
                      powod={polacz.powod}
                      pewnosc={polacz.pewnosc}
                      pushToast={pushToast}
                      onCancel={() => setPolacz(null)}
                      onDone={() => {
                        setPolacz(null)
                        void load(true)
                      }}
                    />
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      ) : (
        <DataTable rows={filtered} rowKey={(r) => r.id} columns={columns} className="crm-table" emptyText={rows.length === 0 ? 'Nie ma jeszcze żadnego klienta.' : 'Nikt nie pasuje do filtrów.'} />
      )}
    </div>
  )
}
