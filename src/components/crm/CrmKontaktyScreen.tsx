// =====================================================================
// CRM → „Kontakty” (brief pkt 20): WSZYSCY klienci z crm.leady, nie tylko z zadaniem.
// Szukanie (nazwa, telefon, e-mail, miejscowość), filtry (status, kanał, etykieta,
// „bez zadania”), sort domyślnie po ostatniej aktywności. Klik = karta klienta.
// =====================================================================
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Merge, RefreshCw, Search } from 'lucide-react'
import type { ToastVariant } from '../../types'
import { CRM_AKCJA, CRM_KANAL, CRM_LEAD_STATUS, CRM_OFERTA_RODZAJ, CRM_OFERTA_STATUS, type CrmDuplikat } from '../../types/crm'
import { fetchDuplikaty, fetchKontakty, oznaczWynik, type CrmError, type CrmKontaktRow } from '../../hooks/useCrm'
import { appConfirm } from '../../lib/appDialogs'
import WynikPrzegranyForm from './CrmWynikPrzegranyForm'
import { useEtykiety } from '../../hooks/useEtykiety'
import { EtykietyRow, KanalBadge } from './CrmEtykiety'
import CrmPolaczPanel from './CrmPolaczPanel'
import DataTable, { type DataTableColumn } from '../DataTable'
import { CRM_WYNIK_POWOD, LEAD_STATUS_CLS, LEJEK_KOLUMNY, LEJEK_ZAMKNIETE_DNI, lejekPodsumowanie, opisWyniku, ruchWLejku, swiezoZamkniety, wartoscKlienta, type LejekStatus } from '../../lib/crmWynik'
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
  // makieta 18.11: widok Lista / Lejek (pamiętany na komputerze)
  const [widok, setWidok] = useState<'lista' | 'lejek'>(() => {
    try {
      return localStorage.getItem('crm.kontakty.widok') === 'lista' ? 'lista' : 'lejek'
    } catch {
      return 'lejek'
    }
  })
  // przeciąganie w lejku (Tymek 18.11): karta → kolumna = wynik klienta; „Przegrany” pyta o powód
  // Przeciąganie wskaźnikiem (nie HTML5 drag&drop — ten nie startował na kartach-przyciskach w Electronie):
  // wciśnięcie na karcie → ruch > 6 px = przeciąganie (duszek przy kursorze, podświetlona kolumna pod kursorem),
  // puszczenie nad kolumną = ruch w lejku; bez ruchu zwykły klik otwiera kartę klienta.
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<LejekStatus | null>(null)
  const [duszek, setDuszek] = useState<{ x: number; y: number; nazwa: string } | null>(null)
  const pomijajKlik = useRef(false)
  const kolumnaPod = (x: number, y: number): LejekStatus | null => {
    const el = document.elementFromPoint(x, y)?.closest('[data-kol]') as HTMLElement | null
    return (el?.dataset.kol as LejekStatus | undefined) ?? null
  }
  const startDrag = (e: ReactPointerEvent<HTMLElement>, r: CrmKontaktRow) => {
    if (e.button !== 0 || wynikBusy) return
    const x0 = e.clientX
    const y0 = e.clientY
    let ruszono = false
    let nad: LejekStatus | null = null
    const move = (ev: PointerEvent) => {
      if (!ruszono && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return
      if (!ruszono) {
        ruszono = true
        setDragId(r.id)
        document.body.classList.add('crm-dragging')
      }
      ev.preventDefault()
      nad = kolumnaPod(ev.clientX, ev.clientY)
      setDragOver(nad)
      setDuszek({ x: ev.clientX, y: ev.clientY, nazwa: leadName(r) })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      document.body.classList.remove('crm-dragging')
      setDuszek(null)
      setDragOver(null)
      setDragId(null)
      if (!ruszono) return
      pomijajKlik.current = true // klik, który przyjdzie po puszczeniu, nie otwiera karty
      window.setTimeout(() => { pomijajKlik.current = false }, 0)
      if (nad) void onDropKol(r, nad)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }
  const [przegranyDla, setPrzegranyDla] = useState<CrmKontaktRow | null>(null)
  // v2: „Przenieś…” na karcie — to samo co przeciągnięcie, dla tych, którzy nie lubią przeciągać
  const [przenies, setPrzenies] = useState<string | null>(null)
  const [wynikBusy, setWynikBusy] = useState(false)
  const zapiszWynik = async (r: CrmKontaktRow, wynik: 'wygrany' | 'przegrany' | 'w_grze', opts: { powod?: string; notatka?: string } = {}) => {
    setWynikBusy(true)
    const err = await oznaczWynik(r.id, wynik, opts)
    setWynikBusy(false)
    if (err) {
      pushToast(`Nie udało się zapisać wyniku: ${err.message}`, 'error')
      return
    }
    setPrzegranyDla(null)
    pushToast(wynik === 'wygrany' ? `${leadName(r)}: zamówił` : wynik === 'przegrany' ? `${leadName(r)}: przegrany` : `${leadName(r)} wraca do gry`, 'success')
    await load(true)
  }
  const onDropKol = async (r: CrmKontaktRow, kol: LejekStatus) => {
    const ruch = ruchWLejku(r.status, kol)
    if (ruch === 'nic') return
    if (ruch === 'systemowy') {
      pushToast('„Nowy” i „Ma ofertę” ustawia system: klient przechodzi do „Ma ofertę”, gdy dostanie ofertę', 'error')
      return
    }
    if (ruch === 'przegrany') {
      setPrzegranyDla(r)
      return
    }
    if (ruch === 'wygrany') {
      const ok = await appConfirm(`Oznaczyć „${leadName(r)}” jako Zamówił? Zadanie się zamknie, a najnowsza wysłana oferta dostanie status „Zaakceptowana”.`)
      if (!ok) return
    }
    await zapiszWynik(r, ruch)
  }

  const zmienWidok = (w: 'lista' | 'lejek') => {
    setWidok(w)
    try {
      localStorage.setItem('crm.kontakty.widok', w)
    } catch {
      /* prywatne okno — bez pamiętania */
    }
  }
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
        if (status === 'w_grze' ? !(l.status === 'nowy' || l.status === 'oferta' || !l.status) : status && (l.status ?? '') !== status) return false
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
      {
        key: 'status',
        label: 'Status',
        sortValue: (r) => r.status ?? '',
        render: (r) => (
          <span className={`crm-status ${LEAD_STATUS_CLS[r.status ?? ''] ?? 'crm-status--muted'}`} title={opisWyniku(r) || undefined}>
            {CRM_LEAD_STATUS[r.status ?? ''] ?? r.status ?? '—'}
            {r.status === 'przegrany' && r.wynik_powod ? ` · ${CRM_WYNIK_POWOD[r.wynik_powod] ?? r.wynik_powod}` : ''}
          </span>
        ),
      },
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
          <option value="w_grze">w grze (nowy + ma ofertę)</option>
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
        <div className="crm-widok" role="group" aria-label="Widok">
          <button type="button" className={`crm-widok-btn${widok === 'lista' ? ' crm-widok-btn--on' : ''}`} aria-pressed={widok === 'lista'} onClick={() => zmienWidok('lista')}>Lista</button>
          <button type="button" className={`crm-widok-btn${widok === 'lejek' ? ' crm-widok-btn--on' : ''}`} aria-pressed={widok === 'lejek'} onClick={() => zmienWidok('lejek')}>Lejek</button>
        </div>
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
        <>
          {(() => {
            const s = lejekPodsumowanie(filtered)
            return (
              <div className="crm-kpi-linia" aria-label="Podsumowanie">
                <span title="Klienci Nowy + Ma ofertę; wartość = ostatnie oferty albo wartości wpisane ręcznie (*)">W grze <b>{s.wGrze} · {fmtPln(s.wartoscWGrze)}</b></span>
                <span>Zamówili <b className="crm-kpi-won">{s.wygrane.n} · {fmtPln(s.wygrane.suma)}</b></span>
                <span>Przegrani <b>{s.przegrane.n}{s.przegrane.topPowod ? ` · najczęściej ${CRM_WYNIK_POWOD[s.przegrane.topPowod] ?? s.przegrane.topPowod}` : ''}</b></span>
                <span title="Zamówili / (zamówili + przegrani)">Skuteczność <b>{s.procentWygranych == null ? '—' : `${s.procentWygranych}%`}</b></span>
              </div>
            )
          })()}
          {widok === 'lista' ? (
            <DataTable rows={filtered} rowKey={(r) => r.id} columns={columns} className="crm-table" emptyText={rows.length === 0 ? 'Nie ma jeszcze żadnego klienta.' : 'Nikt nie pasuje do filtrów.'} />
          ) : (
            <>
            {przegranyDla && (
              <div className="crm-lejek-wynik">
                <p><b>{leadName(przegranyDla)}</b> → Przegrany</p>
                <WynikPrzegranyForm
                  busy={wynikBusy}
                  onCancel={() => setPrzegranyDla(null)}
                  onConfirm={(powod, notatka) => void zapiszWynik(przegranyDla, 'przegrany', { powod, notatka })}
                />
              </div>
            )}
            {duszek && (
              <div className="crm-lejek-duszek" style={{ left: duszek.x + 12, top: duszek.y + 8 }} aria-hidden="true">
                {duszek.nazwa}{dragOver ? ` → ${LEJEK_KOLUMNY.find((k) => k.key === dragOver)?.label ?? ''}` : ''}
              </div>
            )}
            <p className="crm-muted crm-lejek-hint">Złap kartę i upuść w innej kolumnie albo kliknij „Przenieś…” na karcie. Z „Zamówił” / „Przegrany” z powrotem do „Nowy” / „Ma ofertę” = klient wraca do gry.</p>
            <div className="crm-lejek">
              {LEJEK_KOLUMNY.map((kol) => {
                const wszystkie = filtered.filter((r) => (r.status ?? 'nowy') === kol.key || (kol.key === 'nowy' && !r.status))
                // „Zamówił” / „Przegrany”: tylko ostatnie 30 dni, najświeższe na górze; starsze w widoku Lista
                const zamknieta = kol.key === 'wygrany' || kol.key === 'przegrany'
                const lista = zamknieta
                  ? wszystkie.filter((r) => swiezoZamkniety(r)).sort((a, b) => (b.wynik_at ?? b.updated_at ?? '').localeCompare(a.wynik_at ?? a.updated_at ?? ''))
                  : wszystkie
                const starsze = wszystkie.length - lista.length
                const suma = lista.reduce((a, r) => a + (wartoscKlienta(r.wartosc_szac, r.ostatnia_oferta).kwota ?? 0), 0)
                const MAX = 60
                return (
                  <section
                    key={kol.key}
                    data-kol={kol.key}
                    className={`crm-lejek-kol crm-lejek-kol--${kol.key}${dragOver === kol.key ? ' crm-lejek-kol--over' : ''}`}
                    aria-label={kol.label}
                  >
                    <div className="crm-lejek-head">
                      <span><b>{kol.label}</b> <span className="crm-muted">{lista.length}{zamknieta ? ` · ${LEJEK_ZAMKNIETE_DNI} dni` : ''}</span></span>
                      {(kol.key !== 'nowy' || suma > 0) && <span className="crm-lejek-suma">{fmtPln(suma)}</span>}
                    </div>
                    {lista.slice(0, MAX).map((r) => {
                      const info =
                        r.status === 'przegrany'
                          ? `Powód: ${r.wynik_powod ? CRM_WYNIK_POWOD[r.wynik_powod] ?? r.wynik_powod : 'nie podano'}`
                          : r.status === 'wygrany'
                            ? opisWyniku(r)
                            : r.nastepna_akcja
                              ? `${CRM_AKCJA[r.nastepna_akcja]?.label ?? r.nastepna_akcja}${r.nastepny_krok ? ` · ${fmtDate(r.nastepny_krok)}` : ''}`
                              : 'bez zadania'
                      return (
                        <article
                          key={r.id}
                          className={`crm-lejek-karta${dragId === r.id ? ' crm-lejek-karta--drag' : ''}`}
                          onPointerDown={(e) => {
                            if ((e.target as HTMLElement).closest('.crm-lejek-przenies, .crm-lejek-przenies-menu')) return
                            startDrag(e, r)
                          }}
                        >
                          <button
                            type="button"
                            className="crm-lejek-otworz"
                            onClick={() => {
                              if (pomijajKlik.current) return
                              onOpenLead(r.id)
                            }}
                            title={`${leadName(r)}${r.miejscowosc ? ` · ${r.miejscowosc}` : ''} — kliknij, żeby otworzyć kartę klienta, albo przeciągnij do innej kolumny`}
                          >
                            <span className="crm-lejek-top">
                              <b>{leadName(r)}</b>
                              {(() => {
                                const w = wartoscKlienta(r.wartosc_szac, r.ostatnia_oferta)
                                return <span title={w.reczna ? 'Wartość wpisana ręcznie' : undefined}>{fmtPln(w.kwota)}{w.reczna ? '*' : ''}</span>
                              })()}
                            </span>
                          </button>
                          <span className="crm-lejek-dol">
                            <span className={`crm-lejek-info crm-lejek-info--${kol.key}`} title={`ostatnia aktywność ${fmtDate(aktywnosc(r))}`}>{info}</span>
                            <button type="button" className="crm-lejek-przenies" aria-expanded={przenies === r.id} disabled={wynikBusy} onClick={() => setPrzenies((p) => (p === r.id ? null : r.id))}>
                              Przenieś…
                            </button>
                          </span>
                          {przenies === r.id && (
                            <span className="crm-lejek-przenies-menu" role="group" aria-label={`Przenieś ${leadName(r)} do`}>
                              {LEJEK_KOLUMNY.filter((k) => k.key !== kol.key).map((k) => (
                                <button key={k.key} type="button" className="btn btn-sm btn-secondary" disabled={wynikBusy} onClick={() => { setPrzenies(null); void onDropKol(r, k.key) }}>
                                  {k.label}
                                </button>
                              ))}
                            </span>
                          )}
                        </article>
                      )
                    })}
                    {starsze > 0 && (
                      <button type="button" className="crm-link crm-lejek-wiecej" onClick={() => { zmienWidok('lista'); setStatus(kol.key) }} title={`W lejku są tylko wyniki z ostatnich ${LEJEK_ZAMKNIETE_DNI} dni`}>
                        + {starsze} starszych niż {LEJEK_ZAMKNIETE_DNI} dni — pokaż na liście
                      </button>
                    )}
                    {lista.length > MAX && (
                      <button type="button" className="crm-link crm-lejek-wiecej" onClick={() => { zmienWidok('lista'); setStatus(kol.key) }}>
                        + {lista.length - MAX} więcej — pokaż na liście
                      </button>
                    )}
                    {lista.length === 0 && <span className="crm-muted crm-lejek-pusto">{dragId ? 'Upuść tutaj' : 'Brak klientów.'}</span>}
                  </section>
                )
              })}
            </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
