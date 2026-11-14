// =====================================================================
// Zakładka „CRM Po Drzwi” (pilot, brief drugiej sesji 14.11.2026, pkt 3, 6, 7).
// Ekrany: „Do zrobienia” (zadania = kolumny na leadzie: nastepna_akcja/akcja_opis/
// nastepny_krok) → lead (kontakt, rozmowy z Ringostatu, oferty) → oferta (blok
// „Sprawdź tylko to”, mail: Otwórz w poczcie / Kopiuj / Wysłane, Poprawka+Przelicz,
// dane techniczne, historia) oraz „Oferty” (lista wszystkich wersji).
// Widoczność zakładki pilnuje App (useCrmAccess). Frontend nie liczy nic sam:
// liczy funkcja crm-oferta po triggerze na status 'przelicz'; tu tylko odpytujemy
// co 10 s, póki coś jest w przeliczaniu.
// =====================================================================
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowLeft, Copy, RefreshCw, Phone, Mail, ExternalLink, Check } from 'lucide-react'
import type { CurrentUser, ToastVariant } from '../../types'
import {
  CRM_AKCJA,
  CRM_LEAD_STATUS,
  CRM_OFERTA_STATUS,
  CRM_ROZMOWA_STATUS,
  CRM_SYSTEM_ERROR_PREFIX,
  CRM_ZDARZENIE_LABEL,
  type CrmLead,
  type CrmOferta,
  type CrmRozbiciePozycja,
  type CrmRozmowa,
  type CrmZdarzenie,
} from '../../types/crm'
import {
  fetchBledyRozmow,
  fetchLead,
  fetchOferta,
  fetchOferty,
  fetchOfertyLeada,
  fetchProfileNames,
  fetchRozmowy,
  fetchZadania,
  fetchZdarzenia,
  markOfertaWyslana,
  markZadanieZrobione,
  requestOfertaPrzelicz,
  retryOfertaPrzelicz,
  type CrmError,
  type CrmZadanieRow,
} from '../../hooks/useCrm'
import { appConfirm } from '../../lib/appDialogs'
import { openExternalUrl } from '../../hooks/useAluOrders'
import DataTable, { type DataTableColumn } from '../DataTable'
import Spinner from '../Spinner'

/**
 * Tryb widoku (Tymek 14.11.2026): handlowiec ma dostać kolejkę „do zrobienia” z jednym
 * przyciskiem na pozycję, bez historii, wersji i danych diagnostycznych; właściciel
 * (superadmin) widzi wszystko, bo ocenia, gdzie system się myli.
 */
export type CrmMode = 'handlowiec' | 'pelny'

type Props = {
  currentUser: CurrentUser | null
  pushToast: (message: string, variant: ToastVariant) => void
  mode?: CrmMode
}

type Screen = { kind: 'zadania' } | { kind: 'oferty' } | { kind: 'oferta'; id: string } | { kind: 'lead'; id: string }

/** co ile odpytywać bazę, gdy coś jest w przeliczaniu (brief pkt 7: 30–90 s na wynik) */
const POLL_MS = 10_000

// ---- pomocnicze ----

const fmtPln = (v: number | null | undefined): string =>
  v == null ? '—' : new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 }).format(Number(v))

const fmtDateTime = (iso: string | null | undefined): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const fmtTime = (iso: string | null | undefined): string => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })
}

const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('pl-PL')
}

const todayIso = (): string => new Date().toLocaleDateString('sv-SE')

/** termin zadania: 'overdue' | 'today' | 'later' | null */
const terminState = (date: string | null | undefined): 'overdue' | 'today' | 'later' | null => {
  if (!date) return null
  const t = todayIso()
  return date < t ? 'overdue' : date === t ? 'today' : 'later'
}

const fmtDuration = (s: number | null | undefined): string => {
  if (s == null) return '—'
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}

const asStrings = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).filter(Boolean) : []

const leadName = (lead: Partial<Pick<CrmLead, 'nazwa' | 'telefon' | 'email'>> | null | undefined): string =>
  (lead?.nazwa || lead?.telefon || lead?.email || 'Klient bez nazwy').trim()

const isSystemError = (sprawdz: string[]): boolean => (sprawdz[0] ?? '').startsWith(CRM_SYSTEM_ERROR_PREFIX)

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fallback niżej */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

/** mailto: do domyślnego klienta poczty (Magda: Thunderbird) — adresat, temat i treść gotowe. */
const mailtoFor = (o: CrmOferta): string | null => {
  const to = (o.mail_do ?? '').trim()
  if (!to) return null
  const params = new URLSearchParams()
  if (o.mail_temat) params.set('subject', o.mail_temat)
  if (o.mail_tresc) params.set('body', o.mail_tresc)
  // URLSearchParams koduje spacje jako '+', a mailto chce %20
  const qs = params.toString().replace(/\+/g, '%20')
  return `mailto:${encodeURIComponent(to)}${qs ? `?${qs}` : ''}`
}

/** Link https:// w systemowej przeglądarce (Electron: shell:open-external; w przeglądarce: nowa karta). */
function ExtLink({ href, children, title }: { href: string; children: ReactNode; title?: string }) {
  return (
    <a
      href={href}
      className="crm-ext"
      title={title ?? href}
      onClick={(e) => {
        e.preventDefault()
        void openExternalUrl(href) // w dev/przeglądarce helper sam robi window.open
      }}
    >
      {children}
    </a>
  )
}

function StatusBadge({ status }: { status: string }) {
  const s = CRM_OFERTA_STATUS[status] ?? { label: status, cls: 'crm-status--muted' }
  return <span className={`crm-status ${s.cls}`}>{s.label}</span>
}

function AkcjaChip({ akcja, termin }: { akcja: string | null | undefined; termin?: string | null }) {
  if (!akcja) return null
  const a = CRM_AKCJA[akcja] ?? { label: akcja, icon: '•', hint: '' }
  const st = terminState(termin)
  return (
    <span className={`crm-akcja crm-akcja--${akcja}${st === 'overdue' ? ' crm-akcja--overdue' : ''}`} title={a.hint}>
      <span aria-hidden="true">{a.icon}</span> {a.label}
    </span>
  )
}

function KoszykBadge({ value, compact = false }: { value: boolean | null | undefined; compact?: boolean }) {
  if (value === true) return <span className="crm-koszyk crm-koszyk--ok" title="Sklep policzył to samo, co kalkulator">{compact ? '✓' : '✓ koszyk zgodny z kalkulatorem'}</span>
  if (value === false) return <span className="crm-koszyk crm-koszyk--bad" title="Suma koszyka w sklepie różni się od kalkulatora">{compact ? '✗' : '✗ koszyk NIEZGODNY z kalkulatorem — sprawdź cenę przed wysyłką'}</span>
  // null = nie udało się utworzyć linku do koszyka (brief drugiej sesji) — cena tylko z kalkulatora
  return <span className="crm-koszyk crm-koszyk--na" title="Nie udało się utworzyć koszyka w sklepie — cena pochodzi tylko z kalkulatora, bez potwierdzenia sklepu">{compact ? '?' : 'bez koszyka sklepu — cena tylko z kalkulatora, sprawdź ją uważniej'}</span>
}

function ErrorBox({ error }: { error: CrmError }) {
  return (
    <div className={`crm-error${error.kind === 'schema_not_exposed' ? ' crm-error--config' : ''}`} role="alert">
      {error.message}
    </div>
  )
}

function CopyRow({ label, value, multiline, onCopied }: { label: string; value: string | null | undefined; multiline?: boolean; onCopied: (ok: boolean, label: string) => void }) {
  const text = value ?? ''
  return (
    <div className={`crm-copy-row${multiline ? ' crm-copy-row--multi' : ''}`}>
      <div className="crm-copy-head">
        <span className="crm-copy-label">{label}</span>
        <button
          type="button"
          className="btn btn-sm btn-secondary"
          disabled={!text}
          onClick={() => void copyText(text).then((ok) => onCopied(ok, label))}
          title={`Skopiuj: ${label.toLowerCase()}`}
        >
          <Copy size={14} /> Kopiuj
        </button>
      </div>
      {multiline ? <pre className="crm-pre">{text || '—'}</pre> : <div className="crm-copy-value">{text || '—'}</div>}
    </div>
  )
}

function KeyValueTable({ data }: { data: Record<string, unknown> | null | undefined }) {
  const entries = Object.entries(data ?? {})
  if (entries.length === 0) return <span className="crm-muted">—</span>
  return (
    <table className="crm-kv">
      <tbody>
        {entries.map(([k, v]) => (
          <tr key={k}>
            <th>{k}</th>
            <td>{typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '—')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** odpytywanie co POLL_MS, gdy `active` (coś się liczy) */
function usePolling(active: boolean, fn: () => void) {
  useEffect(() => {
    if (!active) return
    const id = setInterval(fn, POLL_MS)
    return () => clearInterval(id)
  }, [active, fn])
}

// ---- DO ZROBIENIA (zadania na leadach) ----

function ZadaniaScreen({
  mode,
  currentUser,
  pushToast,
  onOpenLead,
  onOpenOferta,
}: {
  mode: CrmMode
  currentUser: CurrentUser | null
  pushToast: Props['pushToast']
  onOpenLead: (id: string) => void
  onOpenOferta: (id: string) => void
}) {
  const [rows, setRows] = useState<CrmZadanieRow[]>([])
  const [bledy, setBledy] = useState<Awaited<ReturnType<typeof fetchBledyRozmow>>['data']>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<CrmError | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    const { data, error: err } = await fetchZadania()
    setRows(data)
    setError(err)
    if (mode === 'pelny' && !err) setBledy((await fetchBledyRozmow()).data)
    setLoading(false)
  }, [mode])

  useEffect(() => {
    void load()
  }, [load])

  const anyComputing = rows.some((r) => r.oferta?.status === 'przelicz')
  const silentReload = useCallback(() => void load(true), [load])
  usePolling(anyComputing, silentReload)

  const handleZrobione = async (lead: CrmZadanieRow) => {
    if (!currentUser) return
    const a = CRM_AKCJA[lead.nastepna_akcja ?? '']?.label ?? lead.nastepna_akcja ?? 'zadanie'
    const ok = await appConfirm(`Oznaczyć „${a}” dla ${leadName(lead)} jako zrobione? Zadanie zniknie z listy.`, { title: 'Zrobione', confirmLabel: 'Tak, zrobione' })
    if (!ok) return
    setBusy(lead.id)
    const err = await markZadanieZrobione(lead, currentUser.id)
    setBusy(null)
    if (err) {
      pushToast(`Nie udało się oznaczyć: ${err.message}`, 'error')
      return
    }
    pushToast('Zadanie zrobione', 'success')
    await load(true)
  }

  const overdue = rows.filter((r) => terminState(r.nastepny_krok) === 'overdue').length
  const today = rows.filter((r) => terminState(r.nastepny_krok) === 'today').length

  const columns = useMemo<DataTableColumn<CrmZadanieRow>[]>(
    () => [
      {
        key: 'akcja',
        label: 'Co zrobić',
        sortValue: (r) => r.nastepna_akcja ?? '',
        render: (r) => <AkcjaChip akcja={r.nastepna_akcja} termin={r.nastepny_krok} />,
      },
      {
        key: 'klient',
        label: 'Klient',
        sortValue: (r) => leadName(r),
        render: (r) => (
          <button type="button" className="crm-link" onClick={() => onOpenLead(r.id)} title="Otwórz klienta (kontakt, rozmowy, oferty)">
            {leadName(r)}
          </button>
        ),
      },
      { key: 'miejscowosc', label: 'Miejscowość', sortValue: (r) => r.miejscowosc ?? '', render: (r) => r.miejscowosc || '—' },
      {
        key: 'opis',
        label: 'Szczegóły',
        render: (r) => (
          <span className="crm-zadanie-opis" title={r.akcja_opis ?? undefined}>
            {r.akcja_opis || CRM_AKCJA[r.nastepna_akcja ?? '']?.hint || '—'}
          </span>
        ),
      },
      {
        key: 'termin',
        label: 'Termin',
        sortValue: (r) => r.nastepny_krok ?? '9999',
        render: (r) => {
          const st = terminState(r.nastepny_krok)
          return (
            <span className={`crm-termin${st === 'overdue' ? ' crm-termin--overdue' : st === 'today' ? ' crm-termin--today' : ''}`}>
              {st === 'today' ? 'dziś' : fmtDate(r.nastepny_krok)}
              {st === 'overdue' ? ' (zaległe)' : ''}
            </span>
          )
        },
      },
      { key: 'rozmowa', label: 'Ostatnia rozmowa', sortValue: (r) => r.ostatnia_rozmowa_at ?? '', render: (r) => fmtDateTime(r.ostatnia_rozmowa_at) },
      {
        key: 'akcje',
        label: '',
        render: (r) => {
          if (r.nastepna_akcja === 'przygotuj_oferte') {
            if (r.oferta?.status === 'przelicz') {
              return (
                <span className="crm-muted" title={r.oferta.liczenie_od ? `liczy się od ${fmtTime(r.oferta.liczenie_od)}` : 'czeka na przeliczenie'}>
                  <Spinner inline size={14} /> system liczy ofertę…
                </span>
              )
            }
            if (r.oferta) {
              return (
                <button type="button" className="btn btn-sm btn-primary" onClick={() => onOpenOferta(r.oferta!.id)}>
                  Otwórz ofertę{r.oferta.cena_razem != null ? ` · ${fmtPln(r.oferta.cena_razem)}` : ''}
                </button>
              )
            }
            return (
              <button type="button" className="btn btn-sm btn-secondary" onClick={() => onOpenLead(r.id)} title="Brak aktywnej oferty — zobacz leada">
                Zobacz klienta
              </button>
            )
          }
          return (
            <button type="button" className="btn btn-sm btn-primary" disabled={busy === r.id} onClick={() => void handleZrobione(r)}>
              <Check size={14} /> Zrobione
            </button>
          )
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onOpenLead, onOpenOferta, busy, currentUser],
  )

  return (
    <>
      <div className="crm-toolbar">
        <span className="crm-toolbar-hint">
          {rows.length === 0
            ? 'Nic do zrobienia.'
            : `${rows.length} ${rows.length === 1 ? 'zadanie' : rows.length < 5 ? 'zadania' : 'zadań'}${overdue ? ` · ${overdue} zaległe` : ''}${today ? ` · ${today} na dziś` : ''}. „Oddzwoń” i „Dopytaj” zamykasz przyciskiem Zrobione; ofertę — przyciskiem Wysłane w karcie oferty.`}
        </span>
        <button type="button" className="btn btn-sm btn-secondary" onClick={() => void load()} title="Odśwież listę">
          <RefreshCw size={14} /> Odśwież
        </button>
      </div>
      {error && <ErrorBox error={error} />}
      {loading ? (
        <Spinner center label="Ładowanie zadań…" />
      ) : (
        <DataTable rows={rows} rowKey={(r) => r.id} columns={columns} className="crm-table" emptyText="Nic do zrobienia — wszystkie zadania załatwione." />
      )}
      {mode === 'pelny' && bledy.length > 0 && (
        <section className="crm-syserrors">
          <h4>Błędy systemu ({bledy.length}) — rozmowy, których nie udało się przetworzyć</h4>
          <ul className="crm-syserrors-list">
            {bledy.map((r) => (
              <li key={r.id}>
                <span className="crm-call-when">{fmtDateTime(r.data_rozmowy ?? r.created_at)}</span>{' '}
                {r.lead ? (
                  <button type="button" className="crm-link" onClick={() => r.lead && onOpenLead(r.lead.id)}>{leadName(r.lead)}</button>
                ) : (
                  <span>{r.numer_dzwoniacego || 'numer nieznany'}</span>
                )}
                {' · '}
                <span className="crm-text-bad">{r.blad || 'brak opisu błędu'}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

// ---- LISTA OFERT ----

function OfertyList({ mode, onOpenOferta, onOpenLead }: { mode: CrmMode; onOpenOferta: (id: string) => void; onOpenLead: (id: string) => void }) {
  const simple = mode === 'handlowiec'
  const [onlyOpen, setOnlyOpen] = useState(true)
  const [rows, setRows] = useState<CrmOferta[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<CrmError | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    const { data, error: err } = await fetchOferty(onlyOpen)
    setRows(data)
    setError(err)
    setLoading(false)
  }, [onlyOpen])

  useEffect(() => {
    void load()
  }, [load])

  const silentReload = useCallback(() => void load(true), [load])
  usePolling(rows.some((r) => r.status === 'przelicz'), silentReload)

  const columns = useMemo<DataTableColumn<CrmOferta>[]>(() => {
    const all: DataTableColumn<CrmOferta>[] = [
      {
        key: 'klient',
        label: 'Klient',
        sortValue: (r) => leadName(r.lead),
        render: (r) => (
          <button type="button" className="crm-link" onClick={() => r.lead_id && onOpenLead(r.lead_id)} title="Otwórz leada (kontakt, rozmowy)">
            {leadName(r.lead)}
          </button>
        ),
      },
      { key: 'miejscowosc', label: 'Miejscowość', sortValue: (r) => r.lead?.miejscowosc ?? '', render: (r) => r.lead?.miejscowosc || '—' },
      {
        key: 'produkt',
        label: 'Produkt',
        sortValue: (r) => r.produkt ?? '',
        render: (r) =>
          r.produkt ||
          (r.status === 'przelicz' || r.cena_razem == null ? (
            <span className="crm-muted" title="System jeszcze nie policzył tej oferty">w przygotowaniu</span>
          ) : (
            '—'
          )),
      },
      { key: 'cena', label: 'Cena brutto', align: 'right', sortValue: (r) => r.cena_razem ?? -1, render: (r) => fmtPln(r.cena_razem) },
      { key: 'koszyk', label: 'Koszyk', align: 'center', sortValue: (r) => (r.koszyk_zgodny === true ? 1 : r.koszyk_zgodny === false ? -1 : 0), render: (r) => <KoszykBadge value={r.koszyk_zgodny} compact /> },
      {
        key: 'sprawdz',
        label: 'Do sprawdzenia',
        align: 'center',
        sortValue: (r) => asStrings(r.sprawdz).length,
        render: (r) => {
          const s = asStrings(r.sprawdz)
          if (isSystemError(s)) return <span className="crm-text-bad" title={s[0]}>BŁĄD</span>
          return s.length === 0 ? <span className="crm-muted" title="Konfiguracja w całości z rozmowy">0</span> : <span className="crm-count">{s.length}</span>
        },
      },
      {
        key: 'status',
        label: 'Status',
        sortValue: (r) => r.status,
        render: (r) => (
          <>
            <StatusBadge status={r.status} />
            {r.status === 'przelicz' && r.liczenie_od && <span className="crm-muted"> liczy się od {fmtTime(r.liczenie_od)}</span>}
          </>
        ),
      },
      { key: 'wersja', label: 'Wersja', align: 'center', sortValue: (r) => r.wersja, render: (r) => `v${r.wersja}` },
      { key: 'data', label: 'Data', sortValue: (r) => r.created_at, render: (r) => fmtDateTime(r.created_at) },
      {
        key: 'akcje',
        label: '',
        render: (r) => (
          <button type="button" className="btn btn-sm btn-primary" onClick={() => onOpenOferta(r.id)}>
            Otwórz
          </button>
        ),
      },
    ]
    // tryb handlowca: bez kolumn diagnostycznych (liczba punktów do sprawdzenia, numer wersji)
    return simple ? all.filter((c) => !['sprawdz', 'wersja'].includes(c.key)) : all
  }, [onOpenOferta, onOpenLead, simple])

  return (
    <>
      <div className="crm-toolbar">
        <div className="crm-toolbar-group" role="tablist" aria-label="Filtr ofert">
          <button type="button" className={`btn btn-sm ${onlyOpen ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setOnlyOpen(true)}>
            Do sprawdzenia
          </button>
          <button type="button" className={`btn btn-sm ${!onlyOpen ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setOnlyOpen(false)}>
            {simple ? 'Wysłane i starsze' : 'Wszystkie'}
          </button>
        </div>
        <span className="crm-toolbar-hint">
          {onlyOpen
            ? 'Oferty gotowe do wysłania i te, które system jeszcze liczy. Otwórz = mail do sprawdzenia i wysłania; Klient = kontakt i rozmowy.'
            : 'Wszystkie wersje ofert, najnowsze na górze.'}
        </span>
        <button type="button" className="btn btn-sm btn-secondary" onClick={() => void load()} title="Odśwież listę">
          <RefreshCw size={14} /> Odśwież
        </button>
      </div>
      {error && <ErrorBox error={error} />}
      {loading ? (
        <Spinner center label="Ładowanie ofert…" />
      ) : (
        <DataTable rows={rows} rowKey={(r) => r.id} columns={columns} className="crm-table" emptyText={onlyOpen ? 'Nic do sprawdzenia — wszystkie oferty wysłane.' : 'Brak ofert w bazie.'} />
      )}
    </>
  )
}

// ---- WIDOK OFERTY ----

function OfertaScreen({
  id,
  mode,
  currentUser,
  pushToast,
  onBack,
  onOpenLead,
  onOpenOferta,
}: {
  id: string
  mode: CrmMode
  currentUser: CurrentUser | null
  pushToast: Props['pushToast']
  onBack: () => void
  onOpenLead: (id: string) => void
  onOpenOferta: (id: string) => void
}) {
  const [oferta, setOferta] = useState<CrmOferta | null>(null)
  const [wersje, setWersje] = useState<CrmOferta[]>([])
  const [zdarzenia, setZdarzenia] = useState<CrmZdarzenie[]>([])
  const [names, setNames] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<CrmError | null>(null)
  const [poprawka, setPoprawka] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    const { data: o, error: err } = await fetchOferta(id)
    setError(err)
    setOferta(o)
    if (o) {
      const [v, z] = await Promise.all([o.lead_id ? fetchOfertyLeada(o.lead_id) : Promise.resolve({ data: [] as CrmOferta[], error: null }), fetchZdarzenia({ ofertaId: o.id })])
      setWersje(v.data)
      setZdarzenia(z.data)
      setNames(await fetchProfileNames([...z.data.map((e) => e.kto ?? ''), o.handlowiec ?? '', o.sprawdzil ?? '']))
      if (o.status !== 'przelicz') setPoprawka((prev) => prev)
    }
    setLoading(false)
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  // w przeliczaniu: odpytuj, a gdy poprawka urodzi nową wersję — przejdź do niej
  const silentReload = useCallback(() => void load(true), [load])
  usePolling(oferta?.status === 'przelicz', silentReload)
  useEffect(() => {
    if (!oferta || oferta.status !== 'robocza' || !oferta.poprawka) return
    const next = wersje.find((w) => w.poprzednia_id === oferta.id)
    if (next) onOpenOferta(next.id)
  }, [oferta, wersje, onOpenOferta])

  const onCopied = (ok: boolean, label: string) =>
    pushToast(ok ? `Skopiowano: ${label.toLowerCase()}` : 'Nie udało się skopiować — zaznacz tekst i skopiuj ręcznie', ok ? 'success' : 'error')

  const handleOpenInMail = () => {
    if (!oferta) return
    const url = mailtoFor(oferta)
    if (!url) {
      pushToast('Brak adresu e-mail klienta — skopiuj treść i wyślij ręcznie', 'error')
      return
    }
    void openExternalUrl(url).then((ok) => {
      if (!ok) pushToast('Nie udało się otworzyć programu pocztowego — skopiuj adres, temat i treść przyciskami Kopiuj', 'error')
    })
  }

  const handleWyslane = async () => {
    if (!oferta || !currentUser) return
    const ok = await appConfirm(
      `Potwierdzić, że oferta v${oferta.wersja} dla ${leadName(oferta.lead)} została wysłana z Twojej poczty? Zniknie z listy do zrobienia, a za 3 dni pojawi się zadanie follow-up.`,
      { title: 'Wysłane', confirmLabel: 'Tak, wysłane' },
    )
    if (!ok) return
    setSaving(true)
    const err = await markOfertaWyslana(oferta, currentUser.id)
    setSaving(false)
    if (err) {
      pushToast(`Nie udało się oznaczyć: ${err.message}`, 'error')
      return
    }
    pushToast('Oferta oznaczona jako wysłana — follow-up za 3 dni', 'success')
    await load(true)
  }

  const handlePrzelicz = async () => {
    if (!oferta) return
    const text = poprawka.trim()
    if (!text) {
      pushToast('Wpisz, co poprawić — zwykłym językiem, np. „okucia zwykłe Haga, kolor antracyt struktura”', 'error')
      return
    }
    setSaving(true)
    const err = await requestOfertaPrzelicz(oferta, text)
    setSaving(false)
    if (err) {
      pushToast(`Nie udało się zlecić przeliczenia: ${err.message}`, 'error')
      return
    }
    pushToast('Poprawka zapisana — system liczy nową wersję (30–90 s). Ekran odświeży się sam.', 'success')
    setPoprawka('')
    await load(true)
  }

  const handleRetry = async () => {
    if (!oferta) return
    setSaving(true)
    const err = await retryOfertaPrzelicz(oferta)
    setSaving(false)
    if (err) {
      pushToast(`Nie udało się ponowić: ${err.message}`, 'error')
      return
    }
    pushToast('Ponowiono przeliczenie — ekran odświeży się sam.', 'success')
    await load(true)
  }

  if (loading) return <Spinner center label="Ładowanie oferty…" />
  if (error) return <ErrorBox error={error} />
  if (!oferta) {
    return (
      <div className="crm-screen">
        <button type="button" className="btn btn-sm btn-secondary" onClick={onBack}><ArrowLeft size={14} /> Wróć</button>
        <p className="no-results">Nie znaleziono oferty (mogła zostać usunięta albo nie masz do niej dostępu).</p>
      </div>
    )
  }

  const sprawdz = asStrings(oferta.sprawdz)
  const zalozenia = asStrings(oferta.zalozenia)
  const rozbicie = (Array.isArray(oferta.rozbicie) ? oferta.rozbicie : []) as CrmRozbiciePozycja[]
  const sysErr = isSystemError(sprawdz)
  const canSend = oferta.status === 'do_sprawdzenia' && !sysErr
  const isRecalc = oferta.status === 'przelicz'
  // brak treści = ingest założył wersję, backend jeszcze nie policzył (albo stara pusta robocza)
  const pending = isRecalc || (!oferta.mail_tresc && !oferta.produkt && oferta.cena_razem == null)
  const dobor = oferta.dobor ?? {}
  const analiza = oferta.analiza ?? {}
  const pw = oferta.poprawka_wynik ?? {}
  const linkValid = oferta.link_wazny_do ? new Date(oferta.link_wazny_do).getTime() > Date.now() : null

  return (
    <div className="crm-screen">
      <div className="crm-screen-head">
        <button type="button" className="btn btn-sm btn-secondary" onClick={onBack}><ArrowLeft size={14} /> Wróć</button>
        <div className="crm-screen-title">
          <h3>
            {pending
              ? `Oferta v${oferta.wersja} · w przygotowaniu`
              : `Oferta v${oferta.wersja} · ${oferta.produkt || 'produkt nieustalony'} · ${fmtPln(oferta.cena_razem)}`}
          </h3>
          <div className="crm-screen-sub">
            <button type="button" className="crm-link" onClick={() => oferta.lead_id && onOpenLead(oferta.lead_id)}>
              {leadName(oferta.lead)}
            </button>
            {oferta.lead?.miejscowosc ? ` · ${oferta.lead.miejscowosc}` : ''}
            {' · '}
            <StatusBadge status={oferta.status} />
            {' · utworzona '}
            {fmtDateTime(oferta.created_at)}
            {oferta.wyslano_at ? ` · wysłana ${fmtDateTime(oferta.wyslano_at)}${oferta.sprawdzil ? ` (${names.get(oferta.sprawdzil) ?? '…'})` : ''}` : ''}
          </div>
        </div>
        <button type="button" className="btn btn-sm btn-secondary" onClick={() => void load()} title="Odśwież"><RefreshCw size={14} /></button>
      </div>

      {/* 0. BŁĄD SYSTEMU przy liczeniu */}
      {sysErr && (
        <section className="crm-check crm-check--bad">
          <h4>Błąd systemu przy liczeniu oferty</h4>
          <p className="crm-text-bad">{sprawdz[0]}</p>
          {oferta.uwagi && <p className="crm-muted">{oferta.uwagi}</p>}
          <div className="crm-mail-actions">
            <button type="button" className="btn btn-primary" disabled={saving || isRecalc} onClick={() => void handleRetry()}>
              Ponów przeliczenie
            </button>
            <span className="crm-muted">Jeśli błąd się powtarza, zgłoś go przez „Zgłoś uwagę” — nie wysyłaj tej oferty.</span>
          </div>
        </section>
      )}

      {/* 1. SPRAWDŹ TYLKO TO */}
      {pending ? (
        <section className="crm-check crm-check--pending">
          <h4>Oferta w przygotowaniu</h4>
          <p className="crm-pending-text">
            <Spinner inline size={14} /> System liczy cenę, robi koszyk w sklepie i pisze mail
            {oferta.poprawka ? <> po poprawce: <em>„{oferta.poprawka}”</em></> : ' po rozmowie'}.
            {oferta.liczenie_od ? ` Liczenie trwa od ${fmtTime(oferta.liczenie_od)}.` : ' Zwykle 30–90 s.'} Ekran odświeży się sam; nie ma tu jeszcze nic do sprawdzenia.
          </p>
          {oferta.mail_do && <p className="crm-muted">Adres do wysyłki: {oferta.mail_do}</p>}
        </section>
      ) : !sysErr ? (
        <section className={`crm-check ${oferta.koszyk_zgodny === false ? 'crm-check--bad' : sprawdz.length === 0 && oferta.koszyk_zgodny ? 'crm-check--clean' : ''}`}>
          <h4>Sprawdź tylko to</h4>
          <div className="crm-check-koszyk"><KoszykBadge value={oferta.koszyk_zgodny} /></div>
          {sprawdz.length === 0 ? (
            <p className="crm-check-clean">Konfiguracja w całości z rozmowy — przeczytaj mail raz i wyślij.</p>
          ) : (
            <ol className="crm-check-list">
              {sprawdz.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          )}
        </section>
      ) : null}

      {/* 2. MAIL */}
      {!pending && (
        <section className="crm-mail">
          <h4>Mail do klienta</h4>
          <div className="crm-mail-actions crm-mail-actions--top">
            <button type="button" className="btn btn-primary" disabled={!oferta.mail_do || sysErr} onClick={handleOpenInMail} title="Otwiera w Twoim programie pocztowym gotową wiadomość: adresat, temat i treść. Sprawdź i kliknij Wyślij.">
              <Mail size={15} /> Otwórz w poczcie
            </button>
            <span className="crm-muted">Wiadomość otworzy się w programie pocztowym gotowa do wysłania. Poniżej te same pola do skopiowania.</span>
          </div>
          <CopyRow label="Adres" value={oferta.mail_do} onCopied={onCopied} />
          <CopyRow label="Temat" value={oferta.mail_temat} onCopied={onCopied} />
          <CopyRow label="Treść" value={oferta.mail_tresc} multiline onCopied={onCopied} />
          <div className="crm-mail-actions">
            <button type="button" className="btn btn-primary" disabled={!canSend || saving} onClick={() => void handleWyslane()} title={canSend ? 'Mail poszedł z Twojej poczty — potwierdź, oferta zniknie z listy do zrobienia' : 'Dostępne tylko dla oferty do sprawdzenia'}>
              Wysłane
            </button>
            {canSend && <span className="crm-muted">Kliknij po wysłaniu maila — system zapamięta kto i kiedy i za 3 dni przypomni o follow-upie.</span>}
            {!canSend && !sysErr && <span className="crm-muted">Ta wersja ma status „{CRM_OFERTA_STATUS[oferta.status]?.label ?? oferta.status}”.</span>}
          </div>
        </section>
      )}

      {/* 3. POPRAWKA — dopiero gdy jest co poprawiać */}
      {!pending && (
        <section className="crm-fix">
          <h4>Poprawka</h4>
          <p className="user-modal-hint">
            Napisz zwykłym językiem, co zmienić (np. „okucia zwykłe Haga nie Premium, kolor antracyt struktura, dopisz że mogę podjechać na pomiar”).
            System przeliczy cenę, zrobi nowy koszyk i napisze mail od nowa jako kolejną wersję.
          </p>
          <textarea className="crm-fix-textarea" rows={3} value={poprawka} onChange={(e) => setPoprawka(e.target.value)} disabled={saving} placeholder="Co poprawić?" />
          <div className="crm-mail-actions">
            <button type="button" className="btn btn-secondary" disabled={saving || !poprawka.trim()} onClick={() => void handlePrzelicz()}>
              Przelicz
            </button>
          </div>
        </section>
      )}

      {/* 4. DANE TECHNICZNE */}
      <details className="crm-details">
        <summary>Dane techniczne</summary>
        <div className="crm-details-body">
          <div className="crm-tech-grid">
            <div>
              <h5>Produkt</h5>
              <p>{oferta.produkt || '—'}{oferta.product_id != null ? <span className="crm-muted"> (ID {oferta.product_id})</span> : null}</p>
              <h5>Cena</h5>
              <p>bazowa {fmtPln(oferta.cena_bazowa)} · razem {fmtPln(oferta.cena_razem)}</p>
              <h5>Link do koszyka</h5>
              {oferta.link_koszyka ? (
                <p>
                  <ExtLink href={oferta.link_koszyka}><ExternalLink size={13} /> otwórz koszyk</ExtLink>{' '}
                  <button type="button" className="btn btn-sm btn-secondary" onClick={() => void copyText(oferta.link_koszyka ?? '').then((ok) => onCopied(ok, 'Link'))}><Copy size={13} /> Kopiuj</button>
                  {oferta.link_wazny_do ? <span className={`crm-muted${linkValid === false ? ' crm-text-bad' : ''}`}> ważny do {fmtDateTime(oferta.link_wazny_do)}{linkValid === false ? ' — WYGASŁ' : ''}</span> : null}
                </p>
              ) : (
                <p className="crm-muted">brak linku</p>
              )}
              <h5>Uzasadnienie doboru</h5>
              <p>{typeof dobor.uzasadnienie === 'string' ? dobor.uzasadnienie : '—'}{typeof dobor.pewnosc === 'string' ? <span className="crm-muted"> (pewność: {dobor.pewnosc})</span> : null}</p>
              <h5>Podsumowanie rozmowy</h5>
              <p>{typeof analiza.podsumowanie === 'string' ? analiza.podsumowanie : '—'}</p>
              {oferta.poprawka && (
                <>
                  <h5>Poprawka handlowca</h5>
                  <p>„{oferta.poprawka}”{typeof pw.streszczenie === 'string' ? <span className="crm-muted"> → {pw.streszczenie}</span> : null}</p>
                  {asStrings(pw.niezrozumiane).length > 0 && (
                    <p className="crm-text-bad">Niezrozumiane: {asStrings(pw.niezrozumiane).join('; ')}</p>
                  )}
                </>
              )}
              {zalozenia.length > 0 && (
                <>
                  <h5>Założenia</h5>
                  <ul>{zalozenia.map((z, i) => <li key={i}>{z}</li>)}</ul>
                </>
              )}
            </div>
            <div>
              <h5>Rozbicie ceny</h5>
              {rozbicie.length === 0 ? (
                <span className="crm-muted">—</span>
              ) : (
                <ul className="crm-rozbicie">
                  <li>
                    <span>Cena bazowa</span>
                    <span className="crm-rozbicie-kwota">{fmtPln(oferta.cena_bazowa)}</span>
                  </li>
                  {rozbicie.map((r, i) => (
                    <li key={i} title={r.grupa ?? undefined}>
                      <span>{[r.opcja, r.wybor].filter(Boolean).join(': ') || JSON.stringify(r)}</span>
                      {r.kwota != null && <span className="crm-rozbicie-kwota">{Number(r.kwota) >= 0 ? '+' : ''}{fmtPln(Number(r.kwota))}</span>}
                    </li>
                  ))}
                  <li className="crm-rozbicie-sum">
                    <span>Razem</span>
                    <span className="crm-rozbicie-kwota">{fmtPln(oferta.cena_razem)}</span>
                  </li>
                </ul>
              )}
              <h5>Wybory (opcje)</h5>
              <KeyValueTable data={oferta.wybory} />
              {mode === 'pelny' && oferta.koszt_ai_usd != null && <p className="crm-muted">Koszt AI: {Number(oferta.koszt_ai_usd).toFixed(3)} USD</p>}
            </div>
          </div>
        </div>
      </details>

      {/* 5. HISTORIA — tylko tryb pełny (właściciel ocenia, gdzie system się myli) */}
      {mode === 'pelny' && (
        <section className="crm-history">
          <h4>Historia</h4>
          {wersje.length > 1 && (
            <div className="crm-versions">
              {wersje.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  className={`crm-version${w.id === oferta.id ? ' crm-version--current' : ''}`}
                  onClick={() => w.id !== oferta.id && onOpenOferta(w.id)}
                  title={`${fmtDateTime(w.created_at)} · ${CRM_OFERTA_STATUS[w.status]?.label ?? w.status}${w.poprzednia_id ? ' · poprawka poprzedniej wersji' : ''}`}
                >
                  v{w.wersja}{w.cena_razem != null ? ` · ${fmtPln(w.cena_razem)}` : ''} · <StatusBadge status={w.status} />
                </button>
              ))}
            </div>
          )}
          <Timeline items={zdarzenia} names={names} />
        </section>
      )}
    </div>
  )
}

function Timeline({ items, names }: { items: CrmZdarzenie[]; names: Map<string, string> }) {
  if (items.length === 0) return <p className="crm-muted">Brak zdarzeń.</p>
  return (
    <ul className="crm-timeline">
      {items.map((z) => (
        <li key={z.id} className={`crm-timeline-item crm-timeline-item--${z.typ}`}>
          <span className="crm-timeline-when">{fmtDateTime(z.created_at)}</span>
          <span className="crm-timeline-typ">{CRM_ZDARZENIE_LABEL[z.typ] ?? z.typ}</span>
          <span className="crm-timeline-kto">{z.kto ? names.get(z.kto) ?? '…' : 'system'}</span>
          {z.opis && <span className="crm-timeline-opis">{z.opis}</span>}
        </li>
      ))}
    </ul>
  )
}

// ---- WIDOK LEADA ----

function LeadScreen({
  id,
  mode,
  currentUser,
  pushToast,
  onBack,
  onOpenOferta,
}: {
  id: string
  mode: CrmMode
  currentUser: CurrentUser | null
  pushToast: Props['pushToast']
  onBack: () => void
  onOpenOferta: (id: string) => void
}) {
  const [lead, setLead] = useState<CrmLead | null>(null)
  const [rozmowy, setRozmowy] = useState<CrmRozmowa[]>([])
  const [oferty, setOferty] = useState<CrmOferta[]>([])
  const [zdarzenia, setZdarzenia] = useState<CrmZdarzenie[]>([])
  const [names, setNames] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<CrmError | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    const { data: l, error: err } = await fetchLead(id)
    setError(err)
    setLead(l)
    if (l) {
      const [r, o, z] = await Promise.all([fetchRozmowy(l.id), fetchOfertyLeada(l.id), fetchZdarzenia({ leadId: l.id })])
      setRozmowy(r.data)
      setOferty(o.data)
      setZdarzenia(z.data)
      setNames(await fetchProfileNames(z.data.map((e) => e.kto ?? '')))
    }
    setLoading(false)
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const silentReload = useCallback(() => void load(true), [load])
  usePolling(oferty.some((o) => o.status === 'przelicz'), silentReload)

  const handleZrobione = async () => {
    if (!lead || !currentUser) return
    const a = CRM_AKCJA[lead.nastepna_akcja ?? '']?.label ?? lead.nastepna_akcja ?? 'zadanie'
    const ok = await appConfirm(`Oznaczyć „${a}” dla ${leadName(lead)} jako zrobione?`, { title: 'Zrobione', confirmLabel: 'Tak, zrobione' })
    if (!ok) return
    setSaving(true)
    const err = await markZadanieZrobione(lead, currentUser.id)
    setSaving(false)
    if (err) {
      pushToast(`Nie udało się oznaczyć: ${err.message}`, 'error')
      return
    }
    pushToast('Zadanie zrobione', 'success')
    await load(true)
  }

  if (loading) return <Spinner center label="Ładowanie klienta…" />
  if (error) return <ErrorBox error={error} />
  if (!lead) {
    return (
      <div className="crm-screen">
        <button type="button" className="btn btn-sm btn-secondary" onClick={onBack}><ArrowLeft size={14} /> Wróć</button>
        <p className="no-results">Nie znaleziono klienta.</p>
      </div>
    )
  }

  const Field = ({ label, children }: { label: string; children: ReactNode }) => (
    <div className="crm-field">
      <span className="crm-field-label">{label}</span>
      <span className="crm-field-value">{children}</span>
    </div>
  )
  const activeOferta = oferty.find((o) => o.status === 'do_sprawdzenia' || o.status === 'przelicz')

  return (
    <div className="crm-screen">
      <div className="crm-screen-head">
        <button type="button" className="btn btn-sm btn-secondary" onClick={onBack}><ArrowLeft size={14} /> Wróć</button>
        <div className="crm-screen-title">
          <h3>{leadName(lead)}</h3>
          <div className="crm-screen-sub">
            {CRM_LEAD_STATUS[lead.status ?? ''] ?? lead.status ?? '—'}
            {lead.kategoria ? ` · ${lead.kategoria}` : ''}
            {lead.zrodlo ? ` · źródło: ${lead.zrodlo}` : ''}
            {lead.kampania ? ` · kampania: ${lead.kampania}` : ''}
          </div>
        </div>
      </div>

      {/* zadanie na leadzie */}
      {lead.nastepna_akcja && (
        <section className={`crm-check ${terminState(lead.nastepny_krok) === 'overdue' ? 'crm-check--bad' : ''}`}>
          <h4>Do zrobienia</h4>
          <p className="crm-pending-text">
            <AkcjaChip akcja={lead.nastepna_akcja} termin={lead.nastepny_krok} />{' '}
            {lead.akcja_opis || CRM_AKCJA[lead.nastepna_akcja]?.hint}
            {lead.nastepny_krok ? <span className="crm-muted"> · termin {terminState(lead.nastepny_krok) === 'today' ? 'dziś' : fmtDate(lead.nastepny_krok)}</span> : null}
          </p>
          <div className="crm-mail-actions">
            {lead.nastepna_akcja === 'przygotuj_oferte' && activeOferta ? (
              activeOferta.status === 'przelicz' ? (
                <span className="crm-muted"><Spinner inline size={14} /> system liczy ofertę…</span>
              ) : (
                <button type="button" className="btn btn-primary" onClick={() => onOpenOferta(activeOferta.id)}>Otwórz ofertę · {fmtPln(activeOferta.cena_razem)}</button>
              )
            ) : (
              <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void handleZrobione()}><Check size={14} /> Zrobione</button>
            )}
          </div>
        </section>
      )}

      <section className="crm-lead-grid">
        <div>
          <h4>Kontakt</h4>
          {/* tel:/mailto: nie przechodzą przez shell:open-external (tylko https) — tekst do zaznaczenia/skopiowania */}
          <Field label="Telefon">{lead.telefon ? <span className="crm-ext crm-copy-value"><Phone size={13} /> {lead.telefon}</span> : '—'}</Field>
          <Field label="E-mail">{lead.email ? <span className="crm-ext crm-copy-value"><Mail size={13} /> {lead.email}</span> : '—'}</Field>
          <Field label="Miejscowość">{lead.miejscowosc || '—'}</Field>
          <Field label="Wartość szac.">{fmtPln(lead.wartosc_szac)}</Field>
          <Field label="Ostatnia rozmowa">{fmtDateTime(lead.ostatnia_rozmowa_at)}</Field>
          <Field label="Pierwszy kontakt">{fmtDateTime(lead.created_at)}</Field>
        </div>
        <div>
          <h4>Czego chce</h4>
          <p>{lead.podsumowanie || <span className="crm-muted">brak podsumowania</span>}</p>
          {lead.brakuje && (
            <>
              <h5>Brakuje</h5>
              <p>{lead.brakuje}</p>
            </>
          )}
        </div>
      </section>

      <section>
        <h4>Oferty ({oferty.length})</h4>
        {oferty.length === 0 ? (
          <p className="crm-muted">Brak ofert dla tego klienta.</p>
        ) : (
          <div className="crm-versions">
            {[...oferty].reverse().map((o) => (
              <button key={o.id} type="button" className="crm-version" onClick={() => onOpenOferta(o.id)}>
                v{o.wersja}{o.produkt ? ` · ${o.produkt}` : ''}{o.cena_razem != null ? ` · ${fmtPln(o.cena_razem)}` : ''} · <StatusBadge status={o.status} /> · {fmtDate(o.created_at)}
              </button>
            ))}
          </div>
        )}
      </section>

      <section>
        <h4>Rozmowy ({rozmowy.length})</h4>
        {rozmowy.length === 0 ? (
          <p className="crm-muted">Brak rozmów zapisanych z Ringostatu.</p>
        ) : (
          <ul className="crm-calls">
            {rozmowy.map((r) => {
              const st = r.status_przetwarzania ? CRM_ROZMOWA_STATUS[r.status_przetwarzania] ?? { label: r.status_przetwarzania, cls: 'crm-status--muted' } : null
              return (
                <li key={r.id} className={`crm-call${r.status_przetwarzania === 'blad' ? ' crm-call--blad' : ''}`}>
                  <div className="crm-call-head">
                    <span className="crm-call-when">{fmtDateTime(r.data_rozmowy ?? r.created_at)}</span>
                    <span className={`crm-call-dir crm-call-dir--${r.kierunek ?? 'x'}`}>{r.kierunek === 'przychodzaca' ? '↙ przychodząca' : r.kierunek === 'wychodzaca' ? '↗ wychodząca' : r.kierunek ?? '—'}</span>
                    <span className="crm-call-meta">{r.odebrana === false ? 'nieodebrana' : fmtDuration(r.czas_s)}</span>
                    {r.typ && <span className="crm-call-typ">{r.typ}</span>}
                    {r.kategoria && <span className="crm-call-typ">{r.kategoria}</span>}
                    {r.nastepna_akcja && <AkcjaChip akcja={r.nastepna_akcja} />}
                    {r.ivr && <span className="crm-muted">IVR {r.ivr}</span>}
                    {mode === 'pelny' && st && <span className={`crm-status ${st.cls}`}>{st.label}</span>}
                    {r.link_nagrania && (
                      <ExtLink href={r.link_nagrania} title="Nagranie w Ringostacie (otwiera przeglądarkę)"><ExternalLink size={13} /> nagranie</ExtLink>
                    )}
                  </div>
                  {r.status_przetwarzania === 'blad' && r.blad && <p className="crm-text-bad">{r.blad}</p>}
                  {r.podsumowanie && <p className="crm-call-summary">{r.podsumowanie}</p>}
                  {r.transkrypcja && (
                    <details className="crm-details crm-details--inline">
                      <summary>Transkrypcja</summary>
                      <pre className="crm-pre">{r.transkrypcja}</pre>
                    </details>
                  )}
                  {mode === 'pelny' && r.analiza && (
                    <details className="crm-details crm-details--inline">
                      <summary>Analiza AI{r.koszt_ai_usd != null ? ` · ${Number(r.koszt_ai_usd).toFixed(3)} USD` : ''}</summary>
                      <div className="crm-details-body"><KeyValueTable data={r.analiza} /></div>
                    </details>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {mode === 'pelny' && (
        <section className="crm-history">
          <h4>Historia</h4>
          <Timeline items={zdarzenia} names={names} />
        </section>
      )}
    </div>
  )
}

// ---- KORZEŃ ----

export default function CrmView({ currentUser, pushToast, mode = 'pelny' }: Props) {
  const [screen, setScreen] = useState<Screen>({ kind: 'zadania' })
  // historia ekranów (zadania → lead → oferta…): „Wróć” cofa o jeden
  const [, setStack] = useState<Screen[]>([])

  const go = useCallback((next: Screen) => {
    setStack((prev) => [...prev, screen])
    setScreen(next)
  }, [screen])

  const back = useCallback(() => {
    setStack((prev) => {
      const next = [...prev]
      const last = next.pop()
      setScreen(last ?? { kind: 'zadania' })
      return next
    })
  }, [])

  const openOferta = useCallback((id: string) => go({ kind: 'oferta', id }), [go])
  const openLead = useCallback((id: string) => go({ kind: 'lead', id }), [go])
  const goTop = (kind: 'zadania' | 'oferty') => {
    setStack([])
    setScreen({ kind })
  }
  const topKind = screen.kind === 'oferty' ? 'oferty' : 'zadania'

  return (
    <div className={`crm-view crm-view--${mode}`}>
      {/* pasek marki: moduł Po Drzwi w systemie KR Center (kolory ze strony podrzwi.pl) */}
      <div className="crm-brand">
        <span className="crm-brand-name">PO DRZWI</span>
        <nav className="crm-nav" aria-label="Sekcje CRM">
          <button type="button" className={`crm-nav-btn${topKind === 'zadania' && screen.kind !== 'oferty' ? ' crm-nav-btn--active' : ''}`} onClick={() => goTop('zadania')}>
            Do zrobienia
          </button>
          <button type="button" className={`crm-nav-btn${screen.kind === 'oferty' ? ' crm-nav-btn--active' : ''}`} onClick={() => goTop('oferty')}>
            Oferty
          </button>
        </nav>
        {currentUser && <span className="crm-brand-user">{currentUser.full_name}</span>}
      </div>
      {screen.kind === 'zadania' && <ZadaniaScreen mode={mode} currentUser={currentUser} pushToast={pushToast} onOpenLead={openLead} onOpenOferta={openOferta} />}
      {screen.kind === 'oferty' && <OfertyList mode={mode} onOpenOferta={openOferta} onOpenLead={openLead} />}
      {screen.kind === 'oferta' && (
        <OfertaScreen id={screen.id} mode={mode} currentUser={currentUser} pushToast={pushToast} onBack={back} onOpenLead={openLead} onOpenOferta={openOferta} />
      )}
      {screen.kind === 'lead' && <LeadScreen id={screen.id} mode={mode} currentUser={currentUser} pushToast={pushToast} onBack={back} onOpenOferta={openOferta} />}
    </div>
  )
}
