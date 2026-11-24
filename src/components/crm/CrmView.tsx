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
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, Copy, RefreshCw, Phone, Mail, MessageCircle, ExternalLink, Check, UserPlus, FileText, Pencil, Trash2, Merge, Ruler } from 'lucide-react'
import type { CurrentUser, ToastVariant } from '../../types'
import {
  CRM_AKCJA,
  CRM_LEAD_STATUS,
  CRM_OFERTA_STATUS,
  CRM_ROZMOWA_STATUS,
  CRM_SPRAWA,
  CRM_SYSTEM_ERROR_PREFIX,
  zdarzenieLabel,
  CRM_DOSTAWA_LABEL,
  CRM_ZRODLO_LABEL,
  CRM_OFERTA_RODZAJ,
  CRM_RODZAJ_LOKALU,
  CRM_DOKUMENT_RODZAJ,
  CRM_DOKUMENT_STATUS,
  type CrmDokument,
  type CrmDokumentOdp,
  type CrmDuplikatLeada,
  CRM_KANAL,
  type CrmLead,
  type CrmMail,
  type CrmOferta,
  type CrmOfertaPozycja,
  type CrmRozbiciePozycja,
  type CrmRozmowa,
  type CrmSzkic, type CrmMailOfertyOdp,
  type CrmUsluga,
  type CrmZamknijZadanie,
  type CrmZdarzenie,
  CRM_SZKIC_RODZAJ,
} from '../../types/crm'
import {
  fetchBledyRozmow,
  fetchLead,
  fetchMaileLeada,
  fetchOferta,
  fetchOferty,
  fetchOfertyLeada,
  fetchProfileNames,
  fetchRozmowy,
  fetchZadania,
  fetchZdarzenia,
  markOfertaWyslana,
  requestOfertaPrzelicz,
  retryOfertaPrzelicz,
  zlecOferteWstrzymana,
  odpowiedzIPolicz,
  zlecOferteZNotatki,
  zlecOferteZNagrania,
  zamknijZadanie,
  updateLeadDane,
  deleteLead,
  deleteOferta,
  usunZadanie,
  edytujZadanie,
  signedUrlDokument,
  fetchDokumenty,
  fetchDuplikatyLeada,
  updateDokumentStatus,
  generujSzkic,
  type CrmError,
  type CrmZadanieRow,
  type CrmWynik,
  oznaczWynik,
  konfiguracjaPliki,
  napiszMailOferty,
  ustawWartoscKlienta,
  nazwijOferte,
  poprawUstaleniaIPolicz,
} from '../../hooks/useCrm'
import { supabase } from '../../supabaseClient'
import { appConfirm } from '../../lib/appDialogs'
import { openExternalUrl } from '../../hooks/useAluOrders'
import CrmTelefon from './CrmTelefon'
import DataTable, { type DataTableColumn } from '../DataTable'
import Spinner from '../Spinner'
import CrmPocztaScreen from './CrmPocztaScreen'
import CrmPomocScreen from './CrmPomocScreen'
import CrmUstawieniaScreen from './CrmUstawieniaScreen'
import CrmNagrajNotatke, { type Nagranie } from './CrmNagrajNotatke'
import CrmKontaktyScreen from './CrmKontaktyScreen'
import CrmStatystykiScreen from './CrmStatystykiScreen'
import CrmKorespondencja from './CrmKorespondencja'
import { ZADANIE_RODZAJE, zadaniePoCo, zadanieRodzaj, zadanieTytul, type ZadanieRodzaj } from '../../lib/crmZadania'
import { ileOdm } from '../../utils/odmiana'
import { KROKI_OFERTY, brakDoboruOferty, krokOferty, pytaniaOferty, tekstOdpowiedzi, ustaleniaLista, wersjeOferty } from '../../lib/crmOferta'
import CrmZadanieDialog from './CrmZadanieDialog'
import CrmOfertaOficjalnaForm from './CrmOfertaOficjalnaForm'
import CrmDokumentForm, { type DokumentRodzaj } from './CrmDokumentForm'
import CrmPolaczPanel from './CrmPolaczPanel'
import WynikPrzegranyForm from './CrmWynikPrzegranyForm'
import CrmMaileScreen, { CrmMailScreen } from './CrmMaileScreen'
import { EtykietyRow, EtykietySlownikEditor, KanalBadge } from './CrmEtykiety'
import { LEAD_STATUS_CLS, ZADANIE_GRUPY, kwotaOferty, opisWyniku, ostatniaOferta, parseKwota, tytulOferty, wartoscKlienta, zadanieGrupa } from '../../lib/crmWynik'
import CrmNowyKlient from './CrmNowyKlient'
import { useEtykiety } from '../../hooks/useEtykiety'

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

type Screen =
  | { kind: 'zadania' }
  | { kind: 'oferty' }
  | { kind: 'maile' }
  | { kind: 'poczta' }
  | { kind: 'pomoc' }
  | { kind: 'ustawienia' }
  | { kind: 'kontakty' }
  | { kind: 'statystyki' }
  | { kind: 'oferta'; id: string }
  | { kind: 'lead'; id: string }
  | { kind: 'mail'; id: string }

/** co ile odpytywać bazę, gdy coś jest w przeliczaniu (brief pkt 7: 30–90 s na wynik) */
// brief pkt 19: zmiany przychodzą realtime (postgres_changes na crm.leady/oferty/zdarzenia); odpytywanie zostaje awaryjnie co 60 s
const POLL_MS = 60_000

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

const leadName = (lead: Partial<Pick<CrmLead, 'nazwa' | 'telefon' | 'email' | 'profil_social'>> | null | undefined): string =>
  (lead?.nazwa || lead?.telefon || lead?.email || lead?.profil_social || 'Klient bez nazwy').trim()

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
const mailtoFor = (o: Pick<CrmOferta, 'mail_do' | 'mail_temat' | 'mail_tresc'>): string | null => {
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

/** `dokumenty` (brief pkt 22, migracja crm_dokumenty_realtime) tylko na żądanie — gdy ekran poda dla niej filtr */
type CrmRtTable = 'leady' | 'oferty' | 'zdarzenia' | 'dokumenty'
type CrmRtRow = Record<string, unknown>

/**
 * Realtime (brief pkt 19): jedna subskrypcja na crm.leady/oferty/zdarzenia (RLS obowiązuje — widzimy to, co zwykle).
 * `onChange` dostaje tabelę i wiersz (new, przy DELETE old); ekran sam decyduje, czy go to dotyczy, i przeładowuje się
 * z opóźnieniem (debounce), bo jedno przeliczenie oferty to kilka UPDATE-ów pod rząd.
 */
function useCrmRealtime(
  onChange: (table: CrmRtTable, row: CrmRtRow) => void,
  /** filtry po stronie serwera per tabela (np. `lead_id=eq.<id>`); brak klucza = bez filtra; `null` = jeszcze nie subskrybuj */
  filters: Partial<Record<CrmRtTable, string>> | null = {},
) {
  const cb = useRef(onChange)
  cb.current = onChange
  const key = filters ? JSON.stringify(filters) : null
  useEffect(() => {
    if (key == null) return
    const f = JSON.parse(key) as Partial<Record<CrmRtTable, string>>
    const ch = supabase.channel(`crm:${Math.random().toString(36).slice(2, 10)}`)
    const tables: CrmRtTable[] = ['leady', 'oferty', 'zdarzenia', ...(f.dokumenty ? (['dokumenty'] as const) : [])]
    for (const table of tables) {
      ch.on('postgres_changes', { event: '*', schema: 'crm', table, ...(f[table] ? { filter: f[table] } : {}) }, (payload) => {
        const row = ((payload.new && Object.keys(payload.new).length > 0 ? payload.new : payload.old) ?? {}) as CrmRtRow
        cb.current(table, row)
      })
    }
    ch.subscribe()
    return () => {
      void supabase.removeChannel(ch)
    }
  }, [key])
}

/** przeładowanie zbiorcze: wiele zdarzeń realtime w krótkim czasie = jedno odświeżenie */
function useDebounced(fn: () => void, ms = 400) {
  const ref = useRef(fn)
  ref.current = fn
  const timer = useRef<number | null>(null)
  useEffect(() => () => { if (timer.current != null) window.clearTimeout(timer.current) }, [])
  return useCallback(() => {
    if (timer.current != null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      timer.current = null
      ref.current()
    }, ms)
  }, [ms])
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
  // etykiety (brief pkt 12): słownik wspólny z kartą leada, filtr po jednej etykiecie (po stronie klienta — lista ≤ 300)
  const etyk = useEtykiety()
  const [etykietaFilter, setEtykietaFilter] = useState('')
  // v2 (20.11): filtr po rodzaju zadania — telefony / oferty / pomiary i montaże
  const [rodzajFilter, setRodzajFilter] = useState<ZadanieRodzaj | ''>('')
  // walk-in (brief pkt 13.1): formularz „Dodaj klienta” nad listą
  const [nowyKlient, setNowyKlient] = useState(false)

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
  // realtime: każda zmiana leada/oferty może zmienić kolejkę (zadanie, status, cena); zdarzenia pomijamy (lista ich nie pokazuje)
  const debouncedReload = useDebounced(silentReload)
  useCrmRealtime((table) => {
    if (table !== 'zdarzenia') debouncedReload()
  })

  // brief pkt 20: „Zrobione” pyta, co dalej (panel nad listą), zapis przez rpc zamknij_zadanie
  const [zrobioneDla, setZrobioneDla] = useState<CrmZadanieRow | null>(null)
  const handleZrobione = (lead: CrmZadanieRow) => {
    if (!currentUser) return
    setZrobioneDla(lead)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const confirmZrobione = async (z: CrmZamknijZadanie) => {
    if (!zrobioneDla) return
    setBusy(zrobioneDla.id)
    const err = await zamknijZadanie(zrobioneDla.id, z)
    setBusy(null)
    if (err) {
      pushToast(`Nie udało się zamknąć zadania: ${err.message}`, 'error')
      return
    }
    pushToast(z.nastepna_akcja ? `Zrobione — następne: ${CRM_AKCJA[z.nastepna_akcja]?.label ?? z.nastepna_akcja}` : 'Zadanie zrobione', 'success')
    setZrobioneDla(null)
    await load(true)
  }

  const overdue = rows.filter((r) => terminState(r.nastepny_krok) === 'overdue').length
  const today = rows.filter((r) => terminState(r.nastepny_krok) === 'today').length

  // przycisk w wierszu: oferta → liczy się / Sprawdź ustalenia / Otwórz ofertę; oddzwoń → zapasowo „ręcznie”; reszta → Zrobione
  const renderAkcje = (r: CrmZadanieRow): ReactNode => {
    if (r.nastepna_akcja === 'przygotuj_oferte') {
      if (r.oferta?.status === 'przelicz') {
        return (
          <span className="crm-muted" title={r.oferta.liczenie_od ? `liczy się od ${fmtTime(r.oferta.liczenie_od)}` : 'czeka na przeliczenie'}>
            <Spinner inline size={14} /> system liczy ofertę…
          </span>
        )
      }
      if (r.oferta?.status === 'wstrzymana') {
        return (
          <button type="button" className="btn btn-sm btn-primary" onClick={() => onOpenOferta(r.oferta!.id)} title="Ustalenia z rozmowy / maila czekają na Twoją akceptację — dopiero wtedy system policzy ofertę">
            Sprawdź ustalenia
          </button>
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
        <button type="button" className="btn btn-sm btn-secondary" onClick={() => onOpenLead(r.id)} title="Brak aktywnej oferty — zobacz klienta">
          Zobacz klienta
        </button>
      )
    }
    if (r.nastepna_akcja === 'oddzwon') {
      // ingest zamyka to zadanie sam po odebranej rozmowie wychodzącej z Ringostatu; „Zrobione” tylko zapasowo
      return (
        <button type="button" className="btn btn-sm btn-secondary" disabled={busy === r.id} onClick={() => handleZrobione(r)} title="Zamknie się samo po oddzwonieniu z Ringostatu. Użyj tylko, gdy dzwoniłeś z innego telefonu.">
          Zrobione ręcznie
        </button>
      )
    }
    return (
      <button type="button" className="btn btn-sm btn-primary" disabled={busy === r.id} onClick={() => handleZrobione(r)}>
        <Check size={14} /> Zrobione
      </button>
    )
  }

  // v2 (20.11): filtr po rodzaju (chipy z licznikiem) + grupy Zaległe / Dziś / Później
  const poEtykiecie = etykietaFilter ? rows.filter((r) => (r.etykiety ?? []).includes(etykietaFilter)) : rows
  const licznikRodzaju = new Map<ZadanieRodzaj, number>()
  for (const r of poEtykiecie) {
    const k = zadanieRodzaj(r.nastepna_akcja)
    licznikRodzaju.set(k, (licznikRodzaju.get(k) ?? 0) + 1)
  }
  const widoczne = rodzajFilter ? poEtykiecie.filter((r) => zadanieRodzaj(r.nastepna_akcja) === rodzajFilter) : poEtykiecie
  const dzisIso = todayIso()
  const grupy = ZADANIE_GRUPY.map((g) => ({ ...g, rows: widoczne.filter((r) => zadanieGrupa(r.nastepny_krok, dzisIso) === g.key) }))

  return (
    <>
      <div className="crm-toolbar">
        <select className="crm-select" value={etykietaFilter} onChange={(e) => setEtykietaFilter(e.target.value)} aria-label="Filtr po etykiecie" title="Pokaż tylko zadania z etykietą">
          <option value="">Wszystkie etykiety</option>
          {etyk.lista.filter((e) => e.aktywna).map((e) => (
            <option key={e.slug} value={e.slug}>{e.nazwa}</option>
          ))}
        </select>
        <span className="crm-toolbar-hint">
          {loading
            ? ''
            : rows.length === 0
            ? 'Nic do zrobienia.'
            : `${ileOdm(rows.length, 'zadanie', 'zadania', 'zadań')}${overdue ? ` · ${overdue} zaległe` : ''}${today ? ` · ${today} na dziś` : ''}`}
        </span>
        <button type="button" className="btn btn-sm btn-primary" onClick={() => setNowyKlient((v) => !v)} title="Klient z wizyty w salonie (walk-in)" aria-expanded={nowyKlient}>
          <UserPlus size={14} /> Dodaj klienta
        </button>
        <button type="button" className="btn btn-sm btn-secondary" onClick={() => void load()} title="Odśwież listę">
          <RefreshCw size={14} /> Odśwież
        </button>
      </div>
      {zrobioneDla && (
        <CrmZadanieDialog key={zrobioneDla.id} klient={leadName(zrobioneDla)} biezaceZadanie={zrobioneDla.nastepna_akcja} busy={busy === zrobioneDla.id} onConfirm={confirmZrobione} onCancel={() => setZrobioneDla(null)} />
      )}
      {nowyKlient && (
        <CrmNowyKlient
          currentUser={currentUser}
          slownik={etyk.mapa}
          pushToast={pushToast}
          onCancel={() => setNowyKlient(false)}
          onCreated={(id) => {
            setNowyKlient(false)
            void load(true)
            onOpenLead(id)
          }}
          onOpenExisting={(id) => {
            setNowyKlient(false)
            onOpenLead(id)
          }}
        />
      )}
      {error && <ErrorBox error={error} />}
      {loading ? (
        <Spinner center label="Ładowanie zadań…" />
      ) : (
        <div className="crm-zad">
          {licznikRodzaju.size > 1 && (
            <div className="crm-chipy" role="group" aria-label="Rodzaj zadania">
              <button type="button" className={`crm-chip${!rodzajFilter ? ' crm-chip--on' : ''}`} onClick={() => setRodzajFilter('')} aria-pressed={!rodzajFilter}>
                Wszystko <span className="crm-chip-n">{poEtykiecie.length}</span>
              </button>
              {ZADANIE_RODZAJE.filter((k) => licznikRodzaju.get(k.key)).map((k) => (
                <button key={k.key} type="button" className={`crm-chip${rodzajFilter === k.key ? ' crm-chip--on' : ''}`} onClick={() => setRodzajFilter(rodzajFilter === k.key ? '' : k.key)} aria-pressed={rodzajFilter === k.key}>
                  {k.label} <span className="crm-chip-n">{licznikRodzaju.get(k.key)}</span>
                </button>
              ))}
            </div>
          )}
          {widoczne.length === 0 && (
            <p className="crm-muted crm-zad-pusto">{etykietaFilter || rodzajFilter ? 'Brak zadań dla tych filtrów.' : 'Nic do zrobienia — wszystkie zadania załatwione.'}</p>
          )}
          {grupy.filter((g) => g.rows.length > 0).map((g) => (
            <section key={g.key} className={`crm-zad-grupa crm-zad-grupa--${g.key}`} aria-label={g.label}>
              <h4>{g.label} <span className="crm-muted">{g.rows.length}</span></h4>
              {g.rows.map((r) => {
                // v2: „Akcja: Klient”, jedno zdanie po co, termin, jeden przycisk; etykiety, kanał i miejscowość są na karcie klienta
                const st = terminState(r.nastepny_krok)
                const rodzaj = zadanieRodzaj(r.nastepna_akcja)
                const pelnyOpis = r.akcja_opis || CRM_AKCJA[r.nastepna_akcja ?? '']?.hint || ''
                return (
                  <article key={r.id} className={`crm-z2${st === 'overdue' ? ' crm-z2--late' : ''}`}>
                    <span className={`crm-z2-ikona crm-z2-ikona--${rodzaj}`} aria-hidden="true">
                      {rodzaj === 'oferta' ? <FileText size={19} /> : rodzaj === 'wizyta' ? <Ruler size={19} /> : <Phone size={19} />}
                    </span>
                    <div className="crm-z2-tekst">
                      <button type="button" className="crm-z2-tytul" onClick={() => onOpenLead(r.id)} title="Otwórz kartę klienta">
                        {r.oferta?.nazwa ? `${r.nastepna_akcja === 'przygotuj_oferte' && r.oferta.status === 'wstrzymana' ? 'Sprawdź ustalenia' : CRM_AKCJA[r.nastepna_akcja ?? '']?.label ?? 'Zadanie'}: ${leadName(r)} · ${r.oferta.nazwa}`
                          : r.nastepna_akcja === 'przygotuj_oferte' && r.oferta?.status === 'wstrzymana'
                          ? `Sprawdź ustalenia: ${leadName(r)}`
                          : r.nastepna_akcja === 'przygotuj_oferte' && r.oferta?.status === 'przelicz'
                            ? `Oferta się liczy: ${leadName(r)}`
                            : zadanieTytul(r.nastepna_akcja, leadName(r), CRM_AKCJA[r.nastepna_akcja ?? '']?.label)}
                      </button>
                      <span className="crm-z2-poco" title={pelnyOpis || undefined}>{zadaniePoCo(r.akcja_opis, CRM_AKCJA[r.nastepna_akcja ?? '']?.hint) || '—'}</span>
                    </div>
                    <span className={`crm-z2-termin${st === 'overdue' ? ' crm-z2-termin--late' : st === 'today' ? ' crm-z2-termin--dzis' : ''}`}>
                      {st === 'today' ? 'dziś' : r.nastepny_krok ? fmtDate(r.nastepny_krok) : 'bez terminu'}
                    </span>
                    <div className="crm-z2-akcje">{renderAkcje(r)}</div>
                  </article>
                )
              })}
            </section>
          ))}
        </div>
      )}
      {mode === 'pelny' && <EtykietySlownikEditor lista={etyk.lista} pushToast={pushToast} onChanged={etyk.reload} />}
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
                {r.proby ? <span className="crm-muted"> · prób: {r.proby}/6 (automat ponawia co 15 min)</span> : null}
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
        label: 'Oferta',
        sortValue: (r) => tytulOferty(r),
        render: (r) =>
          r.nazwa?.trim() ||
          r.produkt ||
          (r.rodzaj === 'oficjalna' && r.numer ? `Oferta nr ${r.numer}` : null) ||
          (r.status === 'wstrzymana' ? (
            <span className="crm-muted" title="Ustalenia czekają na Twoje sprawdzenie — otwórz i kliknij „Ustalenia OK”">czeka na sprawdzenie ustaleń</span>
          ) : brakDoboruOferty(r) ? (
            <span className="crm-text-bad" title="System nie dobrał produktu — otwórz ofertę i odpowiedz na pytania">czeka na odpowiedzi</span>
          ) : r.status === 'przelicz' || r.cena_razem == null ? (
            <span className="crm-muted" title="System jeszcze nie policzył tej oferty">w przygotowaniu</span>
          ) : (
            '—'
          )),
      },
      // brief pkt 21: Sklep (cena z kalkulatora) vs PDF (oferta oficjalna z montażem, brutto z VAT wg obiektu)
      {
        key: 'rodzaj',
        label: 'Rodzaj',
        align: 'center',
        sortValue: (r) => r.rodzaj ?? 'sklep',
        render: (r) => {
          const rd = CRM_OFERTA_RODZAJ[r.rodzaj ?? 'sklep'] ?? CRM_OFERTA_RODZAJ.sklep
          return <span className={`crm-rodzaj crm-rodzaj--${r.rodzaj ?? 'sklep'}`} title={rd.title}>{rd.label}{r.rodzaj === 'oficjalna' && r.numer ? ` ${r.numer}` : ''}</span>
        },
      },
      {
        key: 'cena',
        label: 'Cena brutto',
        align: 'right',
        sortValue: (r) => (r.rodzaj === 'oficjalna' ? r.brutto : r.cena_razem) ?? -1,
        render: (r) => (r.rodzaj === 'oficjalna' ? fmtPln(r.brutto) : fmtPln(r.cena_razem)),
      },
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
  onZastapOferte,
}: {
  id: string
  mode: CrmMode
  currentUser: CurrentUser | null
  pushToast: Props['pushToast']
  onBack: () => void
  onOpenLead: (id: string) => void
  onOpenOferta: (id: string) => void
  /** przejście na nową wersję BEZ dokładania ekranu do historii („Wróć” nie wraca do starej) */
  onZastapOferte: (id: string) => void
}) {
  const [oferta, setOferta] = useState<CrmOferta | null>(null)
  // zwiad 21.11: na nową wersję przechodzimy tylko, gdy NA TYM ekranie oferta była w przeliczaniu —
  // inaczej starej wersji nie dało się obejrzeć, a „Wróć” krążył między v1 i v2
  const bylPrzelicz = useRef(false)
  const [wersje, setWersje] = useState<CrmOferta[]>([])
  const [zdarzenia, setZdarzenia] = useState<CrmZdarzenie[]>([])
  const [names, setNames] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<CrmError | null>(null)
  const [poprawka, setPoprawka] = useState('')
  const [saving, setSaving] = useState(false)
  // brief pkt 31: „Klient odmówił” → powód przegranej
  const [odmowa, setOdmowa] = useState(false)
  const [wynikBusy, setWynikBusy] = useState(false)
  // 21.11: tytuł oferty (kilka ofert równolegle dla jednego inwestora) — null = nie edytujemy
  const [nazwaEdit, setNazwaEdit] = useState<string | null>(null)
  const [nazwaBusy, setNazwaBusy] = useState(false)
  // oferta v2: menu „…” (odśwież, PDF, usuń) i jedno miejsce na poprawkę (otwierane z paska „Teraz”)
  const [menuOferty, setMenuOferty] = useState(false)
  const [poprawOpen, setPoprawOpen] = useState(false)
  // 24.11: odpowiedzi na pytania systemu po nieudanym doborze produktu (indeks pytania → odpowiedź) + wolne uwagi
  const [odpowiedzi, setOdpowiedzi] = useState<Record<number, string>>({})
  const [odpUwagi, setOdpUwagi] = useState('')

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

  // w przeliczaniu: odpytuj (awaryjnie), a gdy poprawka urodzi nową wersję — przejdź do niej
  const silentReload = useCallback(() => void load(true), [load])
  usePolling(oferta?.status === 'przelicz', silentReload)
  // realtime (filtr po stronie serwera): oferty tego klienta (ta + nowa wersja po poprawce) i zdarzenia tej oferty;
  // subskrypcja rusza, gdy znamy lead_id (po pierwszym wczytaniu); oferta bez leada — tylko po własnym id
  const debouncedReload = useDebounced(silentReload)
  const rtFilters = useMemo(
    () => (oferta ? { oferty: oferta.lead_id ? `lead_id=eq.${oferta.lead_id}` : `id=eq.${id}`, zdarzenia: `oferta_id=eq.${id}`, leady: `id=eq.${oferta.lead_id ?? '00000000-0000-0000-0000-000000000000'}` } : null),
    [oferta, id],
  )
  useCrmRealtime((table) => {
    if (table !== 'leady') debouncedReload()
  }, rtFilters)
  useEffect(() => {
    if (oferta?.status === 'przelicz') bylPrzelicz.current = true
    if (!oferta || !bylPrzelicz.current || oferta.status !== 'robocza' || !oferta.poprawka) return
    const next = wersje.find((w) => w.poprzednia_id === oferta.id)
    if (next) onZastapOferte(next.id)
  }, [oferta, wersje, onZastapOferte])

  const onCopied = (ok: boolean, label: string) =>
    pushToast(ok ? `Skopiowano: ${label.toLowerCase()}` : 'Nie udało się skopiować — zaznacz tekst i skopiuj ręcznie', ok ? 'success' : 'error')

  // PDF oferty / plik konfiguracji: prywatny bucket, link podpisany na 10 min, otwarcie w przeglądarce systemowej
  const handleOpenDokument = async (sciezka: string) => {
    const r = await signedUrlDokument(sciezka)
    if (r.error || !r.data) {
      pushToast(`Nie udało się pobrać dokumentu: ${r.error?.message ?? 'brak linku'}`, 'error')
      return
    }
    const ok = await openExternalUrl(r.data)
    if (!ok) pushToast('Nie udało się otworzyć dokumentu w przeglądarce', 'error')
  }

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
    const { error: err, bezFollowUpu } = await markOfertaWyslana(oferta, currentUser.id)
    setSaving(false)
    if (err) {
      pushToast(`Nie udało się oznaczyć: ${err.message}`, 'error')
      return
    }
    if (bezFollowUpu) pushToast(`Oferta oznaczona jako wysłana, ale zadanie follow-up się nie zapisało (${bezFollowUpu}) — ustaw je ręcznie na karcie klienta`, 'error')
    else pushToast('Oferta oznaczona jako wysłana — follow-up za 3 dni', 'success')
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
  // pkt 28: pozycje oferty sklepowej (null = stara oferta, jedna pozycja z product_id/wybory)
  const pozycjeSklep = (Array.isArray(oferta.pozycje) ? oferta.pozycje : []) as CrmOfertaPozycja[]
  const sysErr = isSystemError(sprawdz)
  const canSend = oferta.status === 'do_sprawdzenia' && !sysErr
  const leadZamkniety = oferta.lead?.status === 'wygrany' || oferta.lead?.status === 'przegrany'
  const handleWynikOferty = async (wynik: 'wygrany' | 'przegrany', opts: { powod?: string; notatka?: string } = {}) => {
    if (!oferta.lead_id) return
    setWynikBusy(true)
    const err = await oznaczWynik(oferta.lead_id, wynik, { ...opts, ofertaId: oferta.id })
    setWynikBusy(false)
    if (err) {
      pushToast(`Nie udało się zapisać wyniku: ${err.message}`, 'error')
      return
    }
    setOdmowa(false)
    pushToast(wynik === 'wygrany' ? 'Zapisano: klient przyjął ofertę' : 'Zapisano: klient odmówił', 'success')
    void load(true)
  }
  const isRecalc = oferta.status === 'przelicz'
  // 16.11: automat ofert wyłączony — oferta czeka, aż handlowiec przeczyta ustalenia i kliknie „policz”
  const wstrzymana = oferta.status === 'wstrzymana'
  // brief pkt 21: oferta oficjalna z montażem (PDF) — pozycje przepisane z konfiguracji, VAT wg obiektu, bez koszyka
  const oficjalna = oferta.rodzaj === 'oficjalna'
  // brak treści = ingest założył wersję, backend jeszcze nie policzył (albo stara pusta robocza).
  // Oficjalna: crm-oferta-pdf zapisuje brutto, PDF, mail i status jednym update'em, więc znacznikiem jest sam status
  // 'przelicz' (zimny start funkcji 2–3 min to nie błąd); błąd = do_sprawdzenia + sprawdz[0] „BŁĄD systemu” + brutto null → sekcja błędu, nie „w przygotowaniu”
  // 24.11 (Perzanowski): oferta bez dobranego produktu NIE jest „w przygotowaniu” — system skończył (10 s) i zadał pytania,
  // a ekran brał pusty produkt/cenę/mail za liczenie i kręcił spinner bez końca
  const brakDoboru = !wstrzymana && !isRecalc && !sysErr && brakDoboruOferty(oferta)
  const pytania = pytaniaOferty(oferta)
  const pending = !wstrzymana && !brakDoboru && (isRecalc || (!oficjalna && !oferta.mail_tresc && !oferta.produkt && oferta.cena_razem == null))
  const dobor = oferta.dobor ?? {}
  const analiza = oferta.analiza ?? {}
  const pw = oferta.poprawka_wynik ?? {}
  // brief pkt 15: oferta z notatki handlowca (klient z salonu) — nie ma rozmowy ani maila, jest notatka
  const zNotatki = !!oferta.notatka && !oferta.rozmowa_id && !oferta.mail_id
  const domyslne = asStrings(dobor.domyslne)
  const linkValid = oferta.link_wazny_do ? new Date(oferta.link_wazny_do).getTime() > Date.now() : null
  // ---- oferta v2: krok i pasek „Teraz” ----
  const { krok, idx: krokIdx } = krokOferty(oferta.status, { sysErr, pending, brakDoboru })
  const ustalenia = ustaleniaLista(analiza.dane && typeof analiza.dane === 'object' ? (analiza.dane as Record<string, unknown>) : null)
  const brakuje = Array.isArray(analiza.brakuje) ? (analiza.brakuje as unknown[]).map(String).filter(Boolean) : []
  const lancuch = wersjeOferty(wersje, oferta)
  const najnowsza = [...lancuch].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
  const kwotaTeraz = oficjalna ? oferta.brutto : oferta.cena_razem
  const otworzPoprawke = () => {
    setPoprawOpen(true)
    window.setTimeout(() => document.querySelector('.crm-o2-poprawka')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60)
  }
  const handleUstaleniaOk = async () => {
    setSaving(true)
    const err = await zlecOferteWstrzymana(oferta.id)
    setSaving(false)
    if (err) { pushToast(`Nie udało się zlecić oferty: ${err.message}`, 'error'); return }
    pushToast('Oferta liczy się — zwykle do minuty', 'success')
    void load(true)
  }
  const handlePoprawUstalenia = async () => {
    setSaving(true)
    const err = await poprawUstaleniaIPolicz(oferta, poprawka)
    setSaving(false)
    if (err) { pushToast(`Nie udało się: ${err.message}`, 'error'); return }
    pushToast('Poprawka dopisana do ustaleń — oferta liczy się', 'success')
    setPoprawka('')
    setPoprawOpen(false)
    void load(true)
  }
  const handleOdpowiedzi = async () => {
    setSaving(true)
    const err = await odpowiedzIPolicz(oferta, tekstOdpowiedzi(pytania, odpowiedzi, odpUwagi), currentUser?.id ?? null)
    setSaving(false)
    if (err) { pushToast(`Nie udało się: ${err.message}`, 'error'); return }
    pushToast('Odpowiedzi zapisane — oferta liczy się od nowa', 'success')
    setOdpowiedzi({})
    setOdpUwagi('')
    void load(true)
  }
  const teraz: { klasa: string; tytul: string; opis: ReactNode; akcje: ReactNode } =
    krok === 'ustalenia'
      ? {
          klasa: 'crm-k2-krok',
          tytul: 'Sprawdź ustalenia',
          opis: 'Przeczytaj, czego chce klient. Zgadza się — zatwierdź, a system policzy ofertę. Nie zgadza się — kliknij „Popraw ustalenia”.',
          akcje: (
            <>
              <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void handleUstaleniaOk()}><Check size={14} /> Ustalenia OK — policz ofertę</button>
              <button type="button" className="btn btn-secondary" disabled={saving} onClick={otworzPoprawke}><Pencil size={14} /> Popraw ustalenia</button>
            </>
          ),
        }
      : krok === 'dobor'
        ? {
            klasa: 'crm-k2-krok crm-k2-krok--late',
            tytul: 'System nie dobrał produktu — odpowiedz na pytania',
            opis: <>{sprawdz[1] ?? oferta.uwagi ?? 'Zabrakło danych do doboru.'} Odpowiedz niżej na pytania systemu (albo zadzwoń do klienta i dopytaj) — oferta policzy się od nowa od razu po zapisaniu.</>,
            akcje: <button type="button" className="btn btn-primary" onClick={() => document.querySelector('.crm-o2-pytania')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>Przejdź do pytań</button>,
          }
      : krok === 'liczenie'
        ? {
            klasa: 'crm-k2-krok crm-k2-krok--brak',
            tytul: 'Poczekaj chwilę — system liczy ofertę',
            opis: <><Spinner inline size={14} /> {oficjalna ? 'Przepisuje pozycje z konfiguracji, liczy VAT, robi PDF i pisze mail.' : 'Dobiera drzwi, liczy cenę, robi koszyk i pisze mail.'} Ekran odświeży się sam.</>,
            akcje: null,
          }
        : krok === 'blad'
          ? {
              klasa: 'crm-k2-krok crm-k2-krok--late',
              tytul: 'Błąd przy liczeniu oferty',
              opis: <>{sprawdz[0]}{oferta.uwagi ? <> · {oferta.uwagi}</> : null} — nie wysyłaj tej oferty; jeśli błąd wraca, zgłoś go przez „Zgłoś uwagę”.</>,
              akcje: <button type="button" className="btn btn-primary" disabled={saving || isRecalc} onClick={() => void handleRetry()}>Ponów przeliczenie</button>,
            }
          : krok === 'wysylka'
            ? {
                klasa: 'crm-k2-krok crm-k2-krok--dzis',
                tytul: 'Sprawdź mail i wyślij klientowi',
                opis: oficjalna
                  ? 'Otwórz w poczcie, dołącz PDF i wyślij. Potem kliknij „Wysłałem” — w „Do zrobienia” pojawi się przypomnienie za 3 dni.'
                  : 'Otwórz w poczcie i wyślij. Potem kliknij „Wysłałem” — w „Do zrobienia” pojawi się przypomnienie za 3 dni.',
                akcje: (
                  <>
                    <button type="button" className="btn btn-primary" disabled={!oferta.mail_do || !oferta.mail_tresc?.trim()} onClick={handleOpenInMail} title="Otwiera w Twoim programie pocztowym gotową wiadomość: adresat, temat i treść"><Mail size={15} /> Otwórz w poczcie</button>
                    {oficjalna && oferta.plik_pdf && (
                      <button type="button" className="btn btn-secondary" onClick={() => void handleOpenDokument(oferta.plik_pdf as string)}><FileText size={15} /> Pobierz PDF</button>
                    )}
                    <button type="button" className="btn btn-secondary" disabled={!canSend || saving} onClick={() => void handleWyslane()} title="Mail poszedł z Twojej poczty — system zapamięta kto i kiedy i za 3 dni przypomni"><Check size={14} /> Wysłałem</button>
                  </>
                ),
              }
            : krok === 'decyzja'
              ? {
                  klasa: 'crm-k2-krok crm-k2-krok--won',
                  tytul: leadZamkniety ? 'Klient ma już wynik' : 'Czekamy na decyzję klienta',
                  opis: `Wysłana ${oferta.wyslano_at ? fmtDateTime(oferta.wyslano_at) : ''}${oferta.wyslano_at && !oferta.sprawdzil ? ' (wykryto w poczcie)' : ''}. Gdy klient odpowie, zaznacz wynik.`,
                  akcje: oferta.lead_id && !leadZamkniety ? (
                    <>
                      <button type="button" className="btn btn-success" disabled={wynikBusy} onClick={() => void handleWynikOferty('wygrany')} title="Oferta zaakceptowana, klient „Zamówił”, zadanie się zamknie"><Check size={15} /> Klient przyjął</button>
                      <button type="button" className="btn btn-secondary" disabled={wynikBusy} onClick={() => setOdmowa(true)} aria-expanded={odmowa}>Odmówił…</button>
                    </>
                  ) : null,
                }
              : krok === 'koniec'
                ? {
                    klasa: `crm-k2-krok${oferta.status === 'zaakceptowana' ? ' crm-k2-krok--won' : ' crm-k2-krok--late'}`,
                    tytul: oferta.status === 'zaakceptowana' ? 'Klient przyjął ofertę' : 'Klient odmówił',
                    opis: oferta.status === 'zaakceptowana' ? 'Oferta zaakceptowana — dalsze kroki (pomiar, montaż, umowa) prowadzisz na karcie klienta.' : 'Oferta odrzucona. Powód jest na karcie klienta.',
                    akcje: oferta.lead_id ? <button type="button" className="btn btn-secondary" onClick={() => onOpenLead(oferta.lead_id as string)}>Karta klienta</button> : null,
                  }
                : {
                    klasa: 'crm-k2-krok crm-k2-krok--brak',
                    tytul: 'To starsza wersja oferty',
                    opis: 'Klient dostał (albo dostanie) nowszą wersję — tę zostawiamy dla historii.',
                    akcje: najnowsza && najnowsza.id !== oferta.id ? <button type="button" className="btn btn-primary" onClick={() => onOpenOferta(najnowsza.id)}>Otwórz najnowszą (v{najnowsza.wersja})</button> : null,
                  }

  return (
    <div className="crm-screen crm-o2">
      <div className="crm-screen-head">
        <button type="button" className="btn btn-sm btn-secondary" onClick={onBack}><ArrowLeft size={14} /> Wróć</button>
        <div className="crm-screen-title">
          {nazwaEdit != null ? (
            <form
              className="crm-oferta-nazwa-form"
              onSubmit={async (e) => {
                e.preventDefault()
                setNazwaBusy(true)
                const err = await nazwijOferte(oferta, nazwaEdit, currentUser?.id ?? '')
                setNazwaBusy(false)
                if (err) { pushToast(`Nie udało się zapisać tytułu: ${err.message}`, 'error'); return }
                setNazwaEdit(null)
                pushToast(nazwaEdit.trim() ? 'Tytuł oferty zapisany' : 'Tytuł oferty usunięty', 'success')
                await load(true)
              }}
            >
              <input type="text" autoFocus maxLength={120} value={nazwaEdit} onChange={(e) => setNazwaEdit(e.target.value)} aria-label="Tytuł oferty" placeholder="np. Budynek W1 — drzwi do mieszkań" disabled={nazwaBusy} />
              <button type="submit" className="btn btn-sm btn-primary" disabled={nazwaBusy}>{nazwaBusy ? <Spinner inline size={14} /> : <Check size={14} />} Zapisz</button>
              <button type="button" className="btn btn-sm btn-secondary" disabled={nazwaBusy} onClick={() => setNazwaEdit(null)}>Anuluj</button>
            </form>
          ) : (
            <h3 className="crm-oferta-tytul">
              {tytulOferty(oferta)}
              <button type="button" className="crm-wartosc-edytuj" aria-label="Zmień tytuł oferty" title="Zmień tytuł oferty — przydaje się, gdy klient ma kilka ofert naraz" onClick={() => setNazwaEdit(oferta.nazwa ?? '')}>
                <Pencil size={14} />
              </button>
            </h3>
          )}
          <div className="crm-screen-sub crm-oferta-szczegol">
            {oficjalna
              ? `Oferta PDF nr ${oferta.numer ?? '…'} · wersja ${oferta.wersja}${pending ? ' · w przygotowaniu' : ` · ${fmtPln(oferta.brutto)} brutto`}`
              : pending
              ? `Oferta ze sklepu · wersja ${oferta.wersja} · w przygotowaniu`
              : brakDoboru
              ? `Oferta ze sklepu · wersja ${oferta.wersja} · produkt nie dobrany`
              : oferta.cena_razem == null
              ? `Oferta ze sklepu · wersja ${oferta.wersja} · jeszcze nie policzona`
              : `Oferta ze sklepu · wersja ${oferta.wersja} · ${fmtPln(oferta.cena_razem)}${
                  oferta.dostawa_koszt != null && oferta.cena_razem != null
                    ? ` + ${CRM_DOSTAWA_LABEL[oferta.dostawa ?? ''] ?? 'dostawa'} ${fmtPln(oferta.dostawa_koszt)} = ${fmtPln(Number(oferta.cena_razem) + Number(oferta.dostawa_koszt))}`
                    : ''
                }`}
          </div>
          <div className="crm-screen-sub">
            <button type="button" className="crm-link" onClick={() => oferta.lead_id && onOpenLead(oferta.lead_id)}>
              ← {leadName(oferta.lead)}
            </button>
            {' · '}
            <StatusBadge status={oferta.status} />
            {' · utworzona '}
            {fmtDateTime(oferta.created_at)}
            {/* sprawdzil null przy wyslano_at = wykryte automatycznie w folderze Wysłane (crm-mail-sent) */}
            {oferta.wyslano_at ? ` · wysłana ${fmtDateTime(oferta.wyslano_at)} (${oferta.sprawdzil ? names.get(oferta.sprawdzil) ?? '…' : 'wykryto automatycznie w poczcie'})` : ''}
          </div>
        </div>
        <div className="crm-menu">
          <button type="button" className="btn btn-secondary crm-menu-btn" aria-label="Więcej akcji oferty" aria-haspopup="menu" aria-expanded={menuOferty} onClick={() => setMenuOferty((v) => !v)}>…</button>
          {menuOferty && (
            <div className="crm-menu-lista" role="menu">
              <button type="button" role="menuitem" className="crm-menu-item" onClick={() => { setMenuOferty(false); void load() }}><RefreshCw size={14} /> Odśwież</button>
              {oferta.plik_pdf && (
                <button type="button" role="menuitem" className="crm-menu-item" onClick={() => { setMenuOferty(false); void handleOpenDokument(oferta.plik_pdf as string) }}><FileText size={14} /> Pobierz PDF</button>
              )}
              <button
                type="button"
                role="menuitem"
                className="crm-menu-item crm-menu-item--danger"
                disabled={saving || oferta.status === 'przelicz'}
                title="Usuń ofertę (nieodwracalne)"
                onClick={async () => {
                  setMenuOferty(false)
                  const ok = await appConfirm(`Usunąć ofertę v${oferta.wersja}${oferta.numer ? ` nr ${oferta.numer}` : ''}? Zniknie z historii klienta razem z plikiem PDF. Tego nie da się cofnąć.`)
                  if (!ok) return
                  setSaving(true)
                  const err = await deleteOferta(oferta)
                  setSaving(false)
                  if (err) { pushToast(`Nie udało się usunąć oferty: ${err.message}`, 'error'); return }
                  pushToast('Oferta usunięta', 'success')
                  onBack()
                }}
              >
                <Trash2 size={14} /> Usuń ofertę…
              </button>
            </div>
          )}
        </div>
      </div>

      {/* oferta v2: kroki i pasek „Teraz” — co zrobić w tym kroku */}
      {krokIdx >= 0 && (
        <ol className="crm-o2-kroki" aria-label="Etap tej oferty">
          {KROKI_OFERTY.map((k, i) => (
            <li key={k.key} className={`crm-o2-krok${i < krokIdx ? ' crm-o2-krok--done' : i === krokIdx ? ' crm-o2-krok--teraz' : ''}`} aria-current={i === krokIdx ? 'step' : undefined}>
              <span className="crm-o2-krok-nr" aria-hidden="true">{i < krokIdx ? '✓' : i + 1}</span>
              <span className="crm-o2-krok-tekst"><b>{k.nazwa}</b><span>{k.opis}</span></span>
            </li>
          ))}
        </ol>
      )}
      <section className={teraz.klasa} aria-label="Teraz">
        <div className="crm-k2-krok-tekst">
          <span className="crm-k2-krok-label">Teraz</span>
          <span className="crm-k2-krok-tytul">{teraz.tytul}</span>
          <span className="crm-k2-krok-opis crm-k2-krok-opis--pelny">{teraz.opis}</span>
        </div>
        {teraz.akcje && <div className="crm-mail-actions">{teraz.akcje}</div>}
      </section>
      {odmowa && (
        <WynikPrzegranyForm
          busy={wynikBusy}
          hint="Ta oferta dostanie status „Odrzucona”, a klient „Przegrany”; otwarte zadanie się zamknie."
          onCancel={() => setOdmowa(false)}
          onConfirm={(powod, notatka) => void handleWynikOferty('przegrany', { powod, notatka })}
        />
      )}

      <div className="crm-k2-cols">
      <div className="crm-k2-main crm-o2-main">

      {/* 0b. USTALENIA (automat ofert wyłączony): po polsku, tylko wypełnione pola; akcje w „Teraz” */}
      {wstrzymana && (
        <section className="crm-o2-ustalenia">
          <h4>Ustalenia {oferta.mail_id ? 'z maila' : oferta.rozmowa_id ? 'z rozmowy' : zNotatki ? 'z notatki' : ''}</h4>
          <p className="crm-o2-podsumowanie">{typeof analiza.podsumowanie === 'string' && analiza.podsumowanie ? analiza.podsumowanie : 'Brak podsumowania w analizie.'}</p>
          {ustalenia.length > 0 && (
            <dl className="crm-o2-dl">
              {ustalenia.map((u) => (
                <div key={u.klucz} className="crm-o2-dl-row"><dt>{u.nazwa}</dt><dd>{u.wartosc}</dd></div>
              ))}
            </dl>
          )}
          {brakuje.length > 0 && <div className="crm-o2-brakuje"><b>Brakuje:</b> {brakuje.join('; ')}</div>}
          {poprawOpen ? (
            <div className="crm-o2-poprawka">
              <label className="crm-pf-field">
                <span className="crm-pf-label">Co poprawić w ustaleniach? Zwykłym językiem — np. „okucia zwykłe Haga, nie Premium; kolor antracyt”</span>
                <textarea className="crm-fix-textarea" rows={3} autoFocus value={poprawka} onChange={(e) => setPoprawka(e.target.value)} disabled={saving} placeholder="Co poprawić?" />
              </label>
              <div className="crm-mail-actions">
                <button type="button" className="btn btn-primary" disabled={saving || !poprawka.trim()} onClick={() => void handlePoprawUstalenia()}>{saving ? <Spinner inline size={14} /> : <Check size={14} />} Zapisz poprawkę i policz</button>
                <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => setPoprawOpen(false)}>Anuluj</button>
              </div>
            </div>
          ) : (
            <button type="button" className="crm-link" onClick={otworzPoprawke}>Coś się nie zgadza? Popraw ustalenia</button>
          )}
        </section>
      )}

      {/* 0c. PYTANIA SYSTEMU (24.11): produkt nie dobrany — odpowiedzi idą do analizy i oferta liczy się od nowa */}
      {brakDoboru && (
        <section className="crm-o2-ustalenia crm-o2-pytania">
          <h4>Pytania systemu — żeby dobrać produkt</h4>
          <p className="crm-o2-podsumowanie">{oferta.uwagi || sprawdz[1] || 'System nie znalazł w sklepie produktu pasującego do ustaleń.'}</p>
          {pytania.length > 0 ? (
            <ol className="crm-o2-pytania-lista">
              {pytania.map((p, i) => (
                <li key={i}>
                  <label className="crm-pf-field">
                    <span className="crm-pf-label">{p}</span>
                    <input className="crm-fix-input" type="text" value={odpowiedzi[i] ?? ''} onChange={(e) => setOdpowiedzi((s) => ({ ...s, [i]: e.target.value }))} disabled={saving} placeholder="Odpowiedź (puste = pomiń)" />
                  </label>
                </li>
              ))}
            </ol>
          ) : (
            <p className="crm-muted">Ta oferta nie ma zapisanych pytań (starsza). Napisz niżej, jakie to drzwi: rodzaj, linia/system, wzór, rozmiar, kierunek.</p>
          )}
          <label className="crm-pf-field">
            <span className="crm-pf-label">Inne uwagi do doboru (opcjonalnie)</span>
            <textarea className="crm-fix-textarea" rows={2} value={odpUwagi} onChange={(e) => setOdpUwagi(e.target.value)} disabled={saving} placeholder="np. „Bastion A-104, ościeżnica drewniana, 80 prawe”" />
          </label>
          <div className="crm-mail-actions">
            <button type="button" className="btn btn-primary" disabled={saving || !tekstOdpowiedzi(pytania, odpowiedzi, odpUwagi)} onClick={() => void handleOdpowiedzi()}>{saving ? <Spinner inline size={14} /> : <Check size={14} />} Zapisz odpowiedzi i policz od nowa</button>
          </div>
        </section>
      )}

      {/* 1. SPRAWDŹ TYLKO TO */}
      {wstrzymana || brakDoboru ? null : pending ? (
        <section className="crm-check crm-check--pending">
          <h4>Oferta w przygotowaniu</h4>
          <p className="crm-pending-text">
            <Spinner inline size={14} /> {oficjalna ? 'System przepisuje pozycje z konfiguracji, liczy VAT, robi PDF i pisze mail' : 'System liczy cenę, robi koszyk w sklepie i pisze mail'}
            {oferta.poprawka ? <> po poprawce: <em>„{oferta.poprawka}”</em></> : zNotatki ? ' z notatki handlowca' : oferta.mail_id ? ' po mailu' : ' po rozmowie'}.
            {oferta.liczenie_od ? ` Liczenie trwa od ${fmtTime(oferta.liczenie_od)}.` : oficjalna ? ' Zwykle 20–40 s, przy zimnym starcie do 3 min.' : ' Zwykle 30–90 s.'} Ekran odświeży się sam; nie ma tu jeszcze nic do sprawdzenia.
          </p>
          {oferta.mail_do && <p className="crm-muted">Adres do wysyłki: {oferta.mail_do}</p>}
        </section>
      ) : !sysErr ? (
        <section className={`crm-check ${oferta.koszyk_zgodny === false ? 'crm-check--bad' : sprawdz.length === 0 && oferta.koszyk_zgodny ? 'crm-check--clean' : ''}`}>
          <h4>Zanim wyślesz — sprawdź</h4>
          {!oficjalna && <div className="crm-check-koszyk"><KoszykBadge value={oferta.koszyk_zgodny} /></div>}
          {sprawdz.length === 0 ? (
            <p className="crm-check-clean">{oficjalna ? 'Pozycje przepisane z konfiguracji bez wątpliwości — sprawdź PDF i wyślij.' : 'Konfiguracja w całości z rozmowy — przeczytaj mail raz i wyślij.'}</p>
          ) : (
            <ol className="crm-check-list">
              {sprawdz.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          )}
          {/* brief pkt 16: co przyjęto z zasad firmy (Ustawienia → Zasady ofert) — mail o tym pisze, Magda nie musi sprawdzać */}
          {domyslne.length > 0 && (
            <div className="crm-domyslne">
              <span className="crm-domyslne-label">Przyjęte domyślnie (zasady firmy, mail o tym informuje):</span>
              <ul>{domyslne.map((d, i) => <li key={i}>{d}</li>)}</ul>
            </div>
          )}
        </section>
      ) : null}

      {/* 1b. OFERTA OFICJALNA (brief pkt 21): pozycje z konfiguracji, usługi, VAT, zakres, PDF */}
      {!pending && oficjalna && <OfertaOficjalnaSekcja oferta={oferta} onOpenDokument={handleOpenDokument} />}

      {/* 2. MAIL — podgląd jak prawdziwa wiadomość; „Otwórz w poczcie” / „Wysłałem” / wynik są w pasku „Teraz” */}
      {!pending && oferta.mail_tresc?.trim() && (
        <section className="crm-mail crm-o2-mail">
          <h4>Mail do klienta</h4>
          {oficjalna && <p className="crm-muted">Mail otworzy się bez załącznika — pobierz PDF (pasek „Teraz” albo menu „…”) i dołącz go przed wysłaniem.</p>}
          <CopyRow label="Do" value={oferta.mail_do} onCopied={onCopied} />
          <CopyRow label="Temat" value={oferta.mail_temat} onCopied={onCopied} />
          <CopyRow label="Treść" value={oferta.mail_tresc} multiline onCopied={onCopied} />
          <MailOfertyStyl oferta={oferta} pushToast={pushToast} onCopied={onCopied} onSaved={silentReload} />
        </section>
      )}

      {/* 2b. NOTATKA HANDLOWCA (brief pkt 15) — zamiast transkrypcji/maila, bo źródłem oferty są słowa handlowca */}
      {zNotatki && (
        <section className="crm-notatka-src">
          <h4>Notatka handlowca</h4>
          <pre className="crm-pre">{oferta.notatka}</pre>
        </section>
      )}

      {/* 3. POPRAWKA policzonej oferty — nowa wersja; zwinięta, żeby nie mylić z wysyłką */}
      {!pending && !wstrzymana && !brakDoboru && krok !== 'stara' && (
        <details className="crm-details crm-o2-poprawka" open={poprawOpen} onToggle={(e) => setPoprawOpen((e.target as HTMLDetailsElement).open)}>
          <summary>Poprawić coś w ofercie? (powstanie nowa wersja)</summary>
          <div className="crm-details-body">
            <p className="user-modal-hint">
              Napisz zwykłym językiem, co zmienić (np. „okucia zwykłe Haga nie Premium, kolor antracyt struktura, dopisz że mogę podjechać na pomiar”).
              System przeliczy cenę, zrobi nowy koszyk i napisze mail od nowa jako kolejną wersję.
            </p>
            <textarea className="crm-fix-textarea" rows={3} value={poprawka} onChange={(e) => setPoprawka(e.target.value)} disabled={saving} placeholder="Co poprawić?" />
            <div className="crm-mail-actions">
              <button type="button" className="btn btn-secondary" disabled={saving || !poprawka.trim()} onClick={() => void handlePrzelicz()}>Przelicz z poprawką</button>
            </div>
          </div>
        </details>
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
              <p>
                drzwi: bazowa {fmtPln(oferta.cena_bazowa)} · razem {fmtPln(oferta.cena_razem)} (= koszyk sklepu)
                {oferta.dostawa_koszt != null && (
                  <>
                    <br />
                    {CRM_DOSTAWA_LABEL[oferta.dostawa ?? ''] ?? 'dostawa'}: {fmtPln(oferta.dostawa_koszt)} · <b>razem z dostawą {fmtPln(Number(oferta.cena_razem ?? 0) + Number(oferta.dostawa_koszt))}</b>
                  </>
                )}
              </p>
              {!oficjalna && <h5>Link do koszyka</h5>}
              {oficjalna ? null : oferta.link_koszyka ? (
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
              <h5>{zNotatki ? 'Podsumowanie notatki' : oferta.mail_id ? 'Podsumowanie maila' : 'Podsumowanie rozmowy'}</h5>
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
              {/* brief pkt 28: oferta sklepowa z kilkoma pozycjami (crm-oferta v12) — tabela nad rozbiciem */}
              {!oficjalna && pozycjeSklep.length > 0 && (pozycjeSklep.length > 1 || Number(pozycjeSklep[0]?.ilosc ?? 1) > 1) && (
                <>
                  <h5>Pozycje ({pozycjeSklep.length}, {pozycjeSklep.reduce((n, p) => n + (Number(p.ilosc) || 1), 0)} szt.)</h5>
                  <table className="crm-poz-table">
                    <thead>
                      <tr><th>Lp</th><th>Produkt</th><th>Opis</th><th className="crm-poz-num">Ilość</th><th className="crm-poz-num">Cena szt.</th><th className="crm-poz-num">Razem</th></tr>
                    </thead>
                    <tbody>
                      {pozycjeSklep.map((p, i) => (
                        <tr key={i} title={p.rozbicie?.length ? p.rozbicie.map((r) => `${[r.opcja, r.wybor].filter(Boolean).join(': ')} ${r.kwota != null ? fmtPln(Number(r.kwota)) : ''}`).join('\n') : undefined}>
                          <td>{p.lp ?? i + 1}</td>
                          <td>{p.produkt || p.nazwa || '—'}{p.product_id != null ? <span className="crm-muted"> (ID {String(p.product_id)})</span> : null}</td>
                          <td>{p.opis || '—'}</td>
                          <td className="crm-poz-num">{Number(p.ilosc) || 1}</td>
                          <td className="crm-poz-num">{p.cena_szt != null ? fmtPln(Number(p.cena_szt)) : '—'}</td>
                          <td className="crm-poz-num"><b>{p.cena_razem != null ? fmtPln(Number(p.cena_razem)) : '—'}</b></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="crm-muted crm-poz-hint">Najedź na wiersz, żeby zobaczyć dopłaty pozycji. Poprawka handlowca może wskazać pozycję: „w pozycji 2 daj 70 lewe”, „dodaj jeszcze jedne 80 prawe”, „usuń trzecią pozycję”.</p>
                </>
              )}
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
                    <span>Razem drzwi (= koszyk sklepu)</span>
                    <span className="crm-rozbicie-kwota">{fmtPln(oferta.cena_razem)}</span>
                  </li>
                  {oferta.dostawa_koszt != null && (
                    <>
                      <li>
                        <span>{CRM_DOSTAWA_LABEL[oferta.dostawa ?? ''] ?? 'dostawa'}</span>
                        <span className="crm-rozbicie-kwota">{fmtPln(oferta.dostawa_koszt)}</span>
                      </li>
                      <li className="crm-rozbicie-sum">
                        <span>Razem z dostawą</span>
                        <span className="crm-rozbicie-kwota">{fmtPln(Number(oferta.cena_razem ?? 0) + Number(oferta.dostawa_koszt))}</span>
                      </li>
                    </>
                  )}
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
          {lancuch.length > 1 && (
            <div className="crm-versions">
              {lancuch.map((w) => (
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

      <aside className="crm-k2-side" aria-label="O ofercie">
        <section className="crm-k2-card">
          <h4>W skrócie</h4>
          <div className="crm-o2-skrot">
            <span className="crm-muted">Produkt</span><span>{oferta.produkt || (pending || wstrzymana ? 'jeszcze nie dobrany' : '—')}</span>
            <span className="crm-muted">Cena</span><b>{kwotaTeraz != null ? `${fmtPln(kwotaTeraz)}${oficjalna ? ' brutto' : ''}` : 'po policzeniu'}</b>
            {!oficjalna && oferta.dostawa_koszt != null && <><span className="crm-muted">Dostawa</span><span>{CRM_DOSTAWA_LABEL[oferta.dostawa ?? ''] ?? 'dostawa'} {fmtPln(oferta.dostawa_koszt)}</span></>}
            {!oficjalna && oferta.link_wazny_do && <><span className="crm-muted">Ważna do</span><span className={linkValid === false ? 'crm-text-bad' : undefined}>{fmtDate(oferta.link_wazny_do)}{linkValid === false ? ' — wygasła' : ''}</span></>}
            <span className="crm-muted">Utworzona</span><span>{fmtDateTime(oferta.created_at)}</span>
          </div>
        </section>
        <section className="crm-k2-card">
          <h4>Klient</h4>
          <button type="button" className="crm-link crm-o2-klient" onClick={() => oferta.lead_id && onOpenLead(oferta.lead_id)}>{leadName(oferta.lead)}</button>
          <span className="crm-muted">{[oferta.lead?.miejscowosc, oferta.mail_do || oferta.lead?.email, oferta.lead?.telefon].filter(Boolean).join(' · ') || '—'}</span>
        </section>
        {(oferta.plik_pdf || konfiguracjaPliki(oferta).length > 0) && (
          <section className="crm-k2-card">
            <h4>Pliki</h4>
            {oferta.plik_pdf && <button type="button" className="crm-link" onClick={() => void handleOpenDokument(oferta.plik_pdf as string)}><FileText size={13} /> Oferta PDF{oferta.numer ? ` nr ${oferta.numer}` : ''}</button>}
            {konfiguracjaPliki(oferta).map((sc, i, all) => (
              <button key={sc} type="button" className="crm-link" onClick={() => void handleOpenDokument(sc)}><FileText size={13} /> Konfiguracja producenta{all.length > 1 ? ` ${i + 1}/${all.length}` : ''}</button>
            ))}
          </section>
        )}
        {lancuch.length > 1 && (
          <section className="crm-k2-card">
            <h4>Wersje ({lancuch.length})</h4>
            <ul className="crm-o2-wersje">
              {[...lancuch].reverse().map((w) => (
                <li key={w.id}>
                  <button type="button" className={`crm-link${w.id === oferta.id ? ' crm-o2-wersja--ta' : ''}`} disabled={w.id === oferta.id} onClick={() => onOpenOferta(w.id)}>v{w.wersja}</button>
                  <StatusBadge status={w.status} />
                  <span className="crm-muted">{w.cena_razem != null ? fmtPln(w.cena_razem) : w.brutto != null ? fmtPln(w.brutto) : ''}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </aside>
      </div>
    </div>
  )
}

// ---- OFERTA OFICJALNA (brief pkt 21): sekcja z pozycjami, usługami, VAT i dokumentami ----

/** podpis „w stylu X, N próbek” (szkic odpowiedzi i mail oferty, brief pkt 23/30) */
function stylLabel(s: { handlowiec?: string | null; probki?: number | null; probki_zrodlo?: string | null } | null | undefined): string {
  if (!s) return ''
  if (s.probki_zrodlo === 'wspolna') return `styl wspólnej skrzynki${s.probki ? `, ${ileOdm(s.probki, 'próbka', 'próbki', 'próbek')}` : ''}`
  if (s.probki) return `w stylu ${s.handlowiec || 'handlowca'}, ${ileOdm(s.probki, 'próbka', 'próbki', 'próbek')}`
  return 'bez próbek stylu — dodaj skrzynkę handlowca w CRM → Poczta'
}

/**
 * Brief pkt 30 (#159): mail oferty (sklep i oficjalna) w stylu handlowca. Podpis z oferty.mail_styl
 * i przycisk „Napisz w moim stylu” (opcjonalnie „co zmienić”) → crm-szkic mail_oferty. Gdy oferta
 * jest już wysłana (zapisano=false), pokazujemy tekst do skopiowania zamiast nadpisywać ofertę.
 */
function MailOfertyStyl({ oferta, pushToast, onCopied, onSaved }: { oferta: CrmOferta; pushToast: Props['pushToast']; onCopied: (ok: boolean, label: string) => void; onSaved: () => void }) {
  const [form, setForm] = useState(false)
  const [uwagi, setUwagi] = useState('')
  const [gen, setGen] = useState(false)
  const [niezapisany, setNiezapisany] = useState<CrmMailOfertyOdp['mail'] | null>(null)
  const styl = oferta.mail_styl ?? null

  const run = async () => {
    setGen(true)
    const r = await napiszMailOferty(oferta.id, uwagi)
    setGen(false)
    if (r.error || !r.data?.mail) {
      pushToast(`Nie udało się napisać maila: ${r.error?.message ?? 'brak odpowiedzi'}`, 'error')
      return
    }
    const m = r.data.mail
    setForm(false)
    setUwagi('')
    if (!r.data.zapisano) {
      setNiezapisany(m)
      pushToast('Oferta jest już po sprawdzeniu — nowy mail pokazany poniżej do skopiowania, oferta bez zmian', 'success')
      return
    }
    setNiezapisany(null)
    pushToast(m.probki ? `Mail gotowy — ${stylLabel(m)}` : 'Mail gotowy — bez próbek stylu', 'success')
    onSaved()
  }

  return (
    <div className="crm-mail-styl">
      <div className="crm-mail-actions">
        {styl && (
          <span className="crm-muted crm-szkic-meta">
            {stylLabel(styl)}{styl.auto === false ? ' · przepisany przyciskiem' : styl.auto ? ' · przy liczeniu oferty' : ''}{styl.utworzono ? ` · ${fmtDateTime(styl.utworzono)}` : ''}
          </span>
        )}
        {!form && (
          <button type="button" className="btn btn-sm btn-secondary" disabled={gen} onClick={() => setForm(true)} title="Przepisz mail tej oferty Twoim stylem — fakty (pozycje, kwota, link, dostawa) zostają z oferty">
            <Pencil size={14} /> Napisz w moim stylu
          </button>
        )}
      </div>
      {form && (
        <div className="crm-szkic-form">
          <label className="crm-pf-field crm-szkic-uwagi">
            <span className="crm-pf-label">Co zmienić (opcjonalnie)</span>
            <textarea value={uwagi} onChange={(e) => setUwagi(e.target.value)} rows={2} disabled={gen} placeholder="np. „krócej”, „dopisz, że montaż możliwy w przyszłym tygodniu”" />
          </label>
          <div className="crm-mail-actions">
            <button type="button" className="btn btn-primary" disabled={gen} onClick={() => void run()}>
              {gen ? <Spinner inline size={14} /> : <RefreshCw size={14} />} Napisz w moim stylu
            </button>
            <button type="button" className="btn btn-sm btn-secondary" disabled={gen} onClick={() => setForm(false)}>Anuluj</button>
            {gen && <span className="crm-muted">System pisze Twoim stylem — zwykle 10–40 s…</span>}
          </div>
        </div>
      )}
      {niezapisany && (
        <div className="crm-mail-niezapisany">
          <p className="crm-muted">Oferta jest już po sprawdzeniu, więc nowej treści nie zapisaliśmy — skopiuj ją stąd ({stylLabel(niezapisany)}).</p>
          <CopyRow label="Temat" value={niezapisany.temat} onCopied={onCopied} />
          <CopyRow label="Treść" value={niezapisany.tresc} multiline onCopied={onCopied} />
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => setNiezapisany(null)}>Zamknij</button>
        </div>
      )}
    </div>
  )
}

function OfertaOficjalnaSekcja({ oferta, onOpenDokument }: { oferta: CrmOferta; onOpenDokument: (sciezka: string) => Promise<void> }) {
  const pozycje = (Array.isArray(oferta.pozycje) ? oferta.pozycje : []) as CrmOfertaPozycja[]
  const uslugi = (Array.isArray(oferta.uslugi) ? oferta.uslugi : []) as CrmUsluga[]
  const fmt2 = (v: number | null | undefined) => (v == null ? '—' : Number(v).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
  return (
    <section className="crm-ofic">
      <div className="crm-screen-head">
        <div className="crm-screen-title">
          <h4>Oferta nr {oferta.numer ?? '…'}{oferta.producent ? <span className="crm-muted"> · {oferta.producent}</span> : null}</h4>
          <div className="crm-screen-sub">
            {oferta.z_montazem ? 'z montażem' : 'bez montażu'}
            {oferta.lokal_mieszkalny != null ? ` · ${oferta.lokal_mieszkalny ? 'obiekt mieszkalny' : 'obiekt niemieszkalny'}` : ''}
            {oferta.rodzaj_lokalu ? ` · ${CRM_RODZAJ_LOKALU[oferta.rodzaj_lokalu] ?? oferta.rodzaj_lokalu}` : ''}
            {oferta.powierzchnia_m2 != null ? ` · ${fmt2(oferta.powierzchnia_m2)} m²` : ''}
          </div>
        </div>
        <div className="crm-skrzynka-btns">
          {oferta.plik_pdf && (
            <button type="button" className="btn btn-sm btn-primary" onClick={() => void onOpenDokument(oferta.plik_pdf as string)}><FileText size={14} /> Pobierz PDF</button>
          )}
          {/* pkt 29: wszystkie pliki konfiguracji (kilka drzwi / zrzuty), nie tylko pierwszy */}
          {konfiguracjaPliki(oferta).map((sc, i, all) => (
            <button key={sc} type="button" className="btn btn-sm btn-secondary" onClick={() => void onOpenDokument(sc)} title="Plik z konfiguratora producenta">
              {all.length > 1 ? `Konfiguracja ${i + 1}` : 'Plik konfiguracji'}
            </button>
          ))}
        </div>
      </div>
      <table className="crm-pozycje">
        <thead>
          <tr><th>Lp.</th><th>Pozycja</th><th className="crm-num">Ilość</th><th className="crm-num">Netto / szt.</th><th className="crm-num">Netto</th></tr>
        </thead>
        <tbody>
          {pozycje.map((p, i) => (
            <tr key={i}>
              <td>{p.lp ?? i + 1}</td>
              <td>
                <b>{p.nazwa || '—'}</b>
                {p.opis ? <div className="crm-muted">{p.opis}</div> : null}
              </td>
              <td className="crm-num">{p.ilosc ?? 1} {p.jm ?? ''}</td>
              <td className="crm-num">{fmt2(p.netto_szt)}</td>
              <td className="crm-num">{fmt2(p.netto)}</td>
            </tr>
          ))}
          {uslugi.map((u, i) => (
            <tr key={`u${i}`} className="crm-pozycja--usluga">
              <td>{pozycje.length + i + 1}</td>
              <td>{u.nazwa} <span className="crm-muted">(usługa)</span></td>
              <td className="crm-num">1</td>
              <td className="crm-num">{fmt2(u.netto)}</td>
              <td className="crm-num">{fmt2(u.netto)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td colSpan={4}>Razem netto</td><td className="crm-num">{fmt2(oferta.netto)}</td></tr>
          <tr>
            <td colSpan={4}>
              VAT {oferta.vat_stawka ?? ''}
              {/* crm-oferta-pdf v3: stawka z konfiguracji producenta jest źródłem prawdy — vat_uwaga zaczyna się wtedy tym zdaniem */}
              {oferta.vat_uwaga?.startsWith('Stawka VAT z konfiguracji producenta') && <span className="crm-rodzaj crm-vat-src" title={oferta.vat_uwaga}>z konfiguracji producenta</span>}
            </td>
            <td className="crm-num">{fmt2(oferta.vat_kwota)}</td>
          </tr>
          <tr className="crm-pozycje-sum"><td colSpan={4}>Razem brutto</td><td className="crm-num">{fmt2(oferta.brutto)} zł</td></tr>
        </tfoot>
      </table>
      {oferta.vat_uwaga && <p className="crm-muted crm-ofic-vat">{oferta.vat_uwaga}</p>}
      {oferta.zakres && <p className="crm-ofic-zakres"><b>Zakres:</b> {oferta.zakres}</p>}
      {oferta.konfiguracja_tekst && (
        <details className="crm-details crm-details--inline">
          <summary>Wklejona konfiguracja</summary>
          <pre className="crm-pre">{oferta.konfiguracja_tekst}</pre>
        </details>
      )}
    </section>
  )
}

// ---- HISTORIA KLIENTA (brief pkt 20): jedna oś czasu ze zdarzeń, rozmów i maili ----

type HistoriaWpis = { key: string; at: string; typ: string; cls: string; kto: string; opis: string; onOpen?: () => void }

function HistoriaKlienta({ zdarzenia, rozmowy, maile, names, mode, onOpenMail, onOpenOferta, onOpenPlik }: {
  zdarzenia: CrmZdarzenie[]
  rozmowy: CrmRozmowa[]
  maile: CrmMail[]
  names: Map<string, string>
  mode: CrmMode
  onOpenMail: (id: string) => void
  onOpenOferta: (id: string) => void
  /** zdarzenie `dokument` (brief pkt 22): otwórz PDF z dane.plik_pdf */
  onOpenPlik?: (sciezka: string) => void
}) {
  const wpisy = useMemo<HistoriaWpis[]>(() => {
    const out: HistoriaWpis[] = []
    for (const z of zdarzenia) {
      // rozmowy i maile mają własne wpisy niżej — zdarzenie „rozmowa” z ingestu pomijamy, żeby nie dublować
      if (z.typ === 'rozmowa' && rozmowy.length > 0) continue
      const zr = typeof z.dane?.zrodlo === 'string' ? CRM_ZRODLO_LABEL[z.dane.zrodlo] : null
      // „klik” = ktoś kliknął w aplikacji; bez profilu nie piszemy „system”, bo to nie automat
      const kto = z.kto ? names.get(z.kto) ?? '…' : z.dane?.zrodlo === 'klik' ? '' : 'system'
      out.push({
        key: `z${z.id}`,
        at: z.created_at,
        typ: zdarzenieLabel(z.typ, z.dane),
        cls: `crm-timeline-item--${z.typ}`,
        kto: `${kto}${zr ? `${kto ? ' ' : ''}(${zr})` : ''}`,
        opis: z.opis ?? '',
        onOpen:
          z.typ === 'dokument' && typeof z.dane?.plik_pdf === 'string' && onOpenPlik
            ? () => onOpenPlik(z.dane?.plik_pdf as string)
            : z.oferta_id
              ? () => onOpenOferta(z.oferta_id as string)
              : undefined,
      })
    }
    for (const r of rozmowy) {
      out.push({
        key: `r${r.id}`,
        at: r.data_rozmowy ?? r.created_at,
        typ: r.kierunek === 'wychodzaca' ? '📞 Rozmowa od nas' : r.odebrana === false ? '📞 Nieodebrana' : '📞 Rozmowa od klienta',
        cls: r.odebrana === false ? 'crm-timeline-item--nieodebrana' : 'crm-timeline-item--rozmowa',
        kto: r.odebrana === false ? '' : fmtDuration(r.czas_s),
        opis: r.podsumowanie ?? (r.status_przetwarzania === 'blad' ? `błąd: ${r.blad ?? ''}` : ''),
      })
    }
    for (const m of maile) {
      out.push({
        key: `m${m.id}`,
        at: m.data ?? m.created_at,
        typ: m.kierunek === 'wychodzacy' ? '✉ Mail od nas' : m.kanal === 'formularz' ? '✉ Formularz ze strony' : '✉ Mail od klienta',
        cls: 'crm-timeline-item--mail',
        kto: m.kierunek === 'wychodzacy' ? (m.do_adresy ?? []).join(', ') : m.od_adres ?? '',
        opis: `${m.temat ? `${m.temat} — ` : ''}${m.podsumowanie ?? ''}`.replace(/ — $/, ''),
        onOpen: () => onOpenMail(m.id),
      })
    }
    return out.sort((a, b) => b.at.localeCompare(a.at))
  }, [zdarzenia, rozmowy, maile, names, onOpenMail, onOpenOferta, onOpenPlik])

  if (wpisy.length === 0) return <p className="crm-muted">Jeszcze nic się nie wydarzyło.</p>
  // tryb handlowca: bez wpisów diagnostycznych systemu (analiza, przeliczono…)
  const widoczne = mode === 'pelny' ? wpisy : wpisy.filter((w) => !/^(Analiza|Przeliczono|Błąd)/i.test(w.typ))
  return (
    <ul className="crm-timeline">
      {widoczne.map((w) => (
        <li key={w.key} className={`crm-timeline-item ${w.cls}`}>
          <span className="crm-timeline-when">{fmtDateTime(w.at)}</span>
          <span className="crm-timeline-typ">{w.typ}</span>
          <span className="crm-timeline-kto" title={w.kto || undefined}>{w.kto}</span>
          <span className="crm-timeline-opis">
            <OpisRozwijany tekst={w.opis} />
            {w.onOpen && <button type="button" className="crm-link crm-timeline-open" onClick={w.onOpen}>otwórz</button>}
          </span>
        </li>
      ))}
    </ul>
  )
}

const OPIS_KROTKI_MAX = 160

/** Długi opis (np. zadanie_zrobione z całą analizą maila): pierwsza linia + „więcej” (zgłoszenie 15.11) */
function OpisRozwijany({ tekst }: { tekst: string }) {
  const [open, setOpen] = useState(false)
  const t = tekst.trim()
  const nl = t.indexOf('\n')
  const pierwsza = nl >= 0 ? t.slice(0, nl) : t
  const dlugi = nl >= 0 || t.length > OPIS_KROTKI_MAX
  if (!t) return null
  if (!dlugi) return <>{t}</>
  if (open) {
    return (
      <>
        <span className="crm-timeline-opis-pelny">{t}</span>
        <button type="button" className="crm-link crm-timeline-open" onClick={() => setOpen(false)}>zwiń</button>
      </>
    )
  }
  const skrot = pierwsza.length > OPIS_KROTKI_MAX ? `${pierwsza.slice(0, OPIS_KROTKI_MAX).trimEnd()}…` : nl >= 0 ? `${pierwsza} …` : pierwsza
  return (
    <>
      {skrot}
      <button type="button" className="crm-link crm-timeline-open" onClick={() => setOpen(true)}>więcej</button>
    </>
  )
}

function Timeline({ items, names }: { items: CrmZdarzenie[]; names: Map<string, string> }) {
  if (items.length === 0) return <p className="crm-muted">Brak zdarzeń.</p>
  return (
    <ul className="crm-timeline">
      {items.map((z) => {
        const kto = z.kto ? names.get(z.kto) ?? '…' : z.dane?.zrodlo === 'klik' ? '' : 'system'
        const zr = typeof z.dane?.zrodlo === 'string' ? CRM_ZRODLO_LABEL[z.dane.zrodlo] : null
        return (
          <li key={z.id} className={`crm-timeline-item crm-timeline-item--${z.typ}`}>
            <span className="crm-timeline-when">{fmtDateTime(z.created_at)}</span>
            <span className="crm-timeline-typ">{zdarzenieLabel(z.typ, z.dane)}</span>
            <span className="crm-timeline-kto" title={kto || undefined}>
              {kto}
              {zr ? <span className="crm-muted">{kto ? ' ' : ''}({zr})</span> : null}
            </span>
            {z.opis && <span className="crm-timeline-opis"><OpisRozwijany tekst={z.opis} /></span>}
          </li>
        )
      })}
    </ul>
  )
}

// ---- WIDOK LEADA ----

/**
 * Szkic odpowiedzi mailowej (brief pkt 23): `leady.szkic` pisany przez crm-szkic w stylu zalogowanego
 * handlowca. Przycisk zawsze, gdy klient ma e-mail (nie tylko przy „dopytaj”). Szkic znika sam przy
 * zmianie zadania (trigger), a odświeża się jak reszta leada (realtime na crm.leady). Nic nie wysyłamy:
 * „Otwórz w poczcie” = mailto do programu pocztowego, reszta to Kopiuj.
 */
function SzkicOdpowiedzi({ lead, disabled, pushToast, onChanged }: { lead: CrmLead; disabled: boolean; pushToast: Props['pushToast']; onChanged: (szkic: CrmSzkic | null) => void }) {
  const [gen, setGen] = useState(false)
  const [form, setForm] = useState(false)
  const [uwagi, setUwagi] = useState('')
  const [rodzaj, setRodzaj] = useState('')
  const szkic = lead.szkic ?? null
  const email = (lead.email ?? '').trim()
  const zZadania = lead.nastepna_akcja === 'dopytaj' || lead.nastepna_akcja === 'follow_up' ? lead.nastepna_akcja : 'odpowiedz'
  const onCopied = (ok: boolean, label: string) => pushToast(ok ? `Skopiowano: ${label.toLowerCase()}` : 'Nie udało się skopiować — zaznacz tekst i skopiuj ręcznie', ok ? 'success' : 'error')

  const run = async () => {
    setGen(true)
    const r = await generujSzkic(lead.id, { rodzaj: rodzaj || undefined, uwagi })
    setGen(false)
    if (r.error || !r.data) {
      pushToast(`Nie udało się napisać szkicu: ${r.error?.message ?? 'brak odpowiedzi'}`, 'error')
      return
    }
    // wyścig: zadanie zmieniło się, gdy model pisał — szkic wrócił, ale nie jest w leady.szkic; pokazujemy aktualny stan leada
    if (r.data.zapisano === false) {
      pushToast(`Szkic nie został zapisany: ${r.data.powod || 'zadanie klienta zmieniło się w trakcie pisania'}`, 'error')
      setForm(false)
      onChanged(null)
      return
    }
    pushToast(r.data.probki ? `Szkic gotowy — w stylu ${r.data.handlowiec || 'handlowca'} (${ileOdm(r.data.probki, 'próbka', 'próbki', 'próbek')})` : 'Szkic gotowy — bez próbek stylu', 'success')
    setForm(false)
    setUwagi('')
    onChanged(r.data)
  }
  const openInMail = () => {
    if (!szkic) return
    const url = mailtoFor({ mail_do: szkic.mail_do || email, mail_temat: szkic.temat, mail_tresc: szkic.tresc })
    if (!url) {
      pushToast('Brak adresu e-mail klienta — skopiuj treść i wyślij ręcznie', 'error')
      return
    }
    void openExternalUrl(url).then((ok) => {
      if (!ok) pushToast('Nie udało się otworzyć programu pocztowego — skopiuj adres, temat i treść przyciskami Kopiuj', 'error')
    })
  }

  if (!email) return null
  const stylInfo = szkic
    ? szkic.probki
      ? `w stylu ${szkic.handlowiec || 'handlowca'}, ${ileOdm(szkic.probki, 'próbka', 'próbki', 'próbek')}${szkic.probki_zrodlo === 'wspolna' ? ' ze wspólnej skrzynki' : ''}`
      : 'bez próbek stylu — dodaj skrzynkę osobistą handlowca w CRM → Poczta'
    : ''
  const genForm = (
    <div className="crm-szkic-form">
      <label className="crm-pf-field">
        <span className="crm-pf-label">Rodzaj</span>
        <select value={rodzaj} onChange={(e) => setRodzaj(e.target.value)} disabled={gen}>
          <option value="">jak w zadaniu ({CRM_SZKIC_RODZAJ[zZadania]})</option>
          {Object.entries(CRM_SZKIC_RODZAJ).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </label>
      <label className="crm-pf-field crm-szkic-uwagi">
        <span className="crm-pf-label">Co zmienić (opcjonalnie)</span>
        <textarea value={uwagi} onChange={(e) => setUwagi(e.target.value)} rows={2} disabled={gen} placeholder="np. „krócej”, „dopisz, że mamy wolny termin w przyszłym tygodniu”" />
      </label>
      <div className="crm-mail-actions">
        <button type="button" className="btn btn-primary" disabled={gen || disabled} onClick={() => void run()}>
          {gen ? <Spinner inline size={14} /> : <RefreshCw size={14} />} {szkic ? 'Wygeneruj ponownie' : 'Wygeneruj odpowiedź'}
        </button>
        <button type="button" className="btn btn-sm btn-secondary" disabled={gen} onClick={() => setForm(false)}>Anuluj</button>
        {gen && <span className="crm-muted">System pisze w stylu handlowca — zwykle 10–40 s…</span>}
      </div>
    </div>
  )

  return (
    <section className="crm-szkic">
      <h4>Szkic odpowiedzi</h4>
      {szkic ? (
        <>
          <p className="crm-muted crm-szkic-meta">
            {CRM_SZKIC_RODZAJ[szkic.rodzaj] ?? szkic.rodzaj} · {stylInfo}
            {szkic.auto ? ' · zrobiony automatycznie' : ''}
            {szkic.utworzono ? ` · ${fmtDateTime(szkic.utworzono)}` : ''}
            {szkic.uwagi ? ` · uwagi: „${szkic.uwagi}”` : ''}
          </p>
          <div className="crm-mail-actions crm-mail-actions--top">
            <button type="button" className="btn btn-primary" onClick={openInMail} title="Otwiera w Twoim programie pocztowym gotową wiadomość: adresat, temat i treść. Sprawdź i kliknij Wyślij.">
              <Mail size={15} /> Otwórz w poczcie
            </button>
            {!form && (
              <button type="button" className="btn btn-sm btn-secondary" disabled={gen || disabled} onClick={() => setForm(true)}>
                <RefreshCw size={14} /> Wygeneruj ponownie
              </button>
            )}
            <span className="crm-muted">Program nie wysyła sam: kliknij „Otwórz w poczcie”, sprawdź i wyślij. Gdy mail wyjdzie z firmowej skrzynki, zadanie zamknie się samo.</span>
          </div>
          {form && genForm}
          <CopyRow label="Adres" value={szkic.mail_do || email} onCopied={onCopied} />
          <CopyRow label="Temat" value={szkic.temat} onCopied={onCopied} />
          <CopyRow label="Treść" value={szkic.tresc} multiline onCopied={onCopied} />
        </>
      ) : form ? (
        genForm
      ) : (
        <div className="crm-mail-actions">
          <button type="button" className="btn btn-sm btn-secondary" disabled={gen || disabled} onClick={() => setForm(true)}>
            <Mail size={14} /> Wygeneruj odpowiedź
          </button>
          <span className="crm-muted">
            {lead.nastepna_akcja === 'dopytaj'
              ? 'Przy zadaniu „dopytaj” system pisze szkic sam (do minuty od ustawienia zadania) — albo kliknij, żeby napisać teraz.'
              : 'Gotowa odpowiedź mailowa w stylu zalogowanego handlowca, do otwarcia w poczcie albo skopiowania.'}
          </span>
        </div>
      )}
    </section>
  )
}

type Zakladka = 'korespondencja' | 'rozmowy' | 'wszystko'

function LeadScreen({
  id,
  mode,
  currentUser,
  pushToast,
  onBack,
  onDeleted,
  onOpenOferta,
  onOpenMail,
  onOpenLead,
}: {
  id: string
  mode: CrmMode
  currentUser: CurrentUser | null
  pushToast: Props['pushToast']
  onBack: () => void
  /** po usunięciu klienta: wyjście z karty poza historię ekranów (#142) */
  onDeleted: () => void
  onOpenOferta: (id: string) => void
  onOpenMail: (id: string) => void
  onOpenLead: (id: string) => void
}) {
  const [lead, setLead] = useState<CrmLead | null>(null)
  // #142: po „Usuń klienta” realtime (DELETE na leady/oferty/zdarzenia) odpalał przeładowanie,
  // fetchLead zwracał null i karta pokazywała „Nie znaleziono klienta” zamiast zniknąć
  const goneRef = useRef(false)
  // brief pkt 31: wynik klienta (Zamówił / Przegrany z powodem / Przywróć do gry), menu „…” z usuwaniem
  const [wynikForm, setWynikForm] = useState<{ ofertaId: string | null } | null>(null)
  const [wynikBusy, setWynikBusy] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  // karta v2: lewa kolumna — korespondencja / rozmowy / wszystko (null = domyślna wg tego, co klient ma)
  const [zakladka, setZakladka] = useState<Zakladka | null>(null)
  useEffect(() => setZakladka(null), [id])
  const [rozmowy, setRozmowy] = useState<CrmRozmowa[]>([])
  const [maile, setMaile] = useState<CrmMail[]>([])
  const etyk = useEtykiety()
  const [oferty, setOferty] = useState<CrmOferta[]>([])
  const [zdarzenia, setZdarzenia] = useState<CrmZdarzenie[]>([])
  // dokumenty klienta (brief pkt 22): karta pomiarowa / umowa / protokół z crm.dokumenty
  const [dokumenty, setDokumenty] = useState<CrmDokument[]>([])
  const [dokForm, setDokForm] = useState<{ rodzaj: DokumentRodzaj; istniejacy?: CrmDokument } | null>(null)
  const [dokWynik, setDokWynik] = useState<CrmDokumentOdp | null>(null)
  // brief pkt 26: możliwe duplikaty tego klienta (rpc duplikaty_leada) + otwarty panel łączenia
  const [duplikaty, setDuplikaty] = useState<CrmDuplikatLeada[]>([])
  const [polacz, setPolacz] = useState<CrmDuplikatLeada | null>(null)
  const [names, setNames] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<CrmError | null>(null)
  const [saving, setSaving] = useState(false)
  // #162: ręczna wartość klienta — null = nie edytujemy, string = treść pola
  const [wartoscEdit, setWartoscEdit] = useState<string | null>(null)
  const [wartoscBusy, setWartoscBusy] = useState(false)
  // 21.11 (test UX): „Zamówił” na karcie pyta o kwotę zamiast zapisywać od razu (pomyłka jednym kliknięciem, 0 zł w statystykach)
  const [zamowilForm, setZamowilForm] = useState<string | null>(null)
  // 21.11: opis zadania w pasku „Następny krok” — pełny po „więcej”
  const [opisPelny, setOpisPelny] = useState(false)
  // notatka handlowca (brief pkt 15): edytowalna kopia leady.podsumowanie; „Zleć ofertę” wysyła ją do rpc
  const [notatka, setNotatka] = useState('')
  const [notatkaDirty, setNotatkaDirty] = useState(false)
  // po zleceniu oferta `przelicz` pojawia się dopiero po ~15 s — przez 2 min odpytujemy mimo braku oferty
  const [zleconoAt, setZleconoAt] = useState<number | null>(null)

  const load = useCallback(async (silent = false) => {
    if (goneRef.current) return
    if (!silent) setLoading(true)
    const { data: l, error: err } = await fetchLead(id)
    if (goneRef.current) return
    setError(err)
    setLead(l)
    setNotatkaDirty((dirty) => {
      if (!dirty) setNotatka(l?.podsumowanie ?? '')
      return dirty
    })
    if (l) {
      const [r, o, z, m, dk, dp] = await Promise.all([fetchRozmowy(l.id), fetchOfertyLeada(l.id), fetchZdarzenia({ leadId: l.id }), fetchMaileLeada(l.id, { zTrescia: true }), fetchDokumenty(l.id), fetchDuplikatyLeada(l.id)])
      setRozmowy(r.data)
      setOferty(o.data)
      setZdarzenia(z.data)
      setMaile(m.data)
      if (!dk.error) setDokumenty(dk.data)
      if (!dp.error) setDuplikaty(dp.data)
      setNames(await fetchProfileNames(z.data.map((e) => e.kto ?? '')))
    }
    setLoading(false)
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const silentReload = useCallback(() => void load(true), [load])
  const czekaNaOferte = zleconoAt != null && Date.now() - zleconoAt < 120_000
  usePolling(oferty.some((o) => o.status === 'przelicz') || czekaNaOferte, silentReload)
  // realtime (filtr po stronie serwera): ten lead, jego oferty i zdarzenia (transkrypcja notatki głosowej, nowa oferta, zadanie)
  const debouncedReload = useDebounced(silentReload)
  const rtFilters = useMemo(() => ({ leady: `id=eq.${id}`, oferty: `lead_id=eq.${id}`, zdarzenia: `lead_id=eq.${id}`, dokumenty: `lead_id=eq.${id}` }), [id])
  useCrmRealtime(() => debouncedReload(), rtFilters)
  const [nagrywanieBusy, setNagrywanieBusy] = useState(false)

  const handleNagranie = async (n: Nagranie) => {
    if (!lead) return
    setNagrywanieBusy(true)
    const err = await zlecOferteZNagrania(lead.id, n.blob, n.contentType)
    setNagrywanieBusy(false)
    if (err) {
      pushToast(`Nie udało się wysłać nagrania: ${err.message}`, 'error')
      return
    }
    pushToast('Nagranie wysłane — system spisuje notatkę i liczy ofertę (ok. minuty)', 'success')
    setNotatkaDirty(false)
    setZleconoAt(Date.now())
    await load(true)
  }

  const handleZlecOferte = async () => {
    if (!lead) return
    const tekst = notatka.trim()
    if (!tekst) {
      pushToast('Wpisz notatkę: co klient chce, jakie drzwi, wymiar, kolor', 'error')
      return
    }
    setSaving(true)
    const err = await zlecOferteZNotatki(lead.id, tekst)
    setSaving(false)
    if (err) {
      pushToast(`Nie udało się zlecić oferty: ${err.message}`, 'error')
      return
    }
    pushToast('Zlecono ofertę z notatki — system liczy, zwykle do minuty', 'success')
    setNotatkaDirty(false)
    setZleconoAt(Date.now())
    await load(true)
  }

  // brief pkt 20: „Zrobione” / „Dodaj zadanie” przez panel z następnym krokiem (rpc zamknij_zadanie)
  const [zadanieDialog, setZadanieDialog] = useState(false)
  // #150: „Zmień zadanie” — ten sam dialog, zapis przez edytujZadanie (bez zdarzenia „zrobione”)
  const [zadanieEdycja, setZadanieEdycja] = useState(false)
  const confirmZadanie = async (z: CrmZamknijZadanie) => {
    if (!lead || !currentUser) return
    setSaving(true)
    const err = zadanieEdycja ? await edytujZadanie(lead, z, currentUser.id) : await zamknijZadanie(lead.id, z)
    setSaving(false)
    if (err) {
      pushToast(`Nie udało się zapisać: ${err.message}`, 'error')
      return
    }
    pushToast(zadanieEdycja ? 'Zadanie zmienione' : z.nastepna_akcja ? `Zapisane — następne: ${CRM_AKCJA[z.nastepna_akcja]?.label ?? z.nastepna_akcja}` : 'Zadanie zrobione', 'success')
    setZadanieDialog(false)
    setZadanieEdycja(false)
    await load(true)
  }
  const handleZrobione = () => setZadanieDialog(true)

  // edycja danych kontaktowych (brief pkt 20)
  const [dane, setDane] = useState<{ nazwa: string; telefon: string; email: string; miejscowosc: string; profil_social: string } | null>(null)
  const saveDane = async () => {
    if (!lead || !dane) return
    setSaving(true)
    const err = await updateLeadDane(lead.id, dane)
    setSaving(false)
    if (err) {
      pushToast(err.message, 'error')
      return
    }
    pushToast('Dane klienta zapisane', 'success')
    setDane(null)
    await load(true)
  }

  // „Oferta z montażem” (brief pkt 21): formularz pod sekcją „Czego chce”
  const [oficForm, setOficForm] = useState(false)

  const handleOpenDokument = async (sciezka: string) => {
    const r = await signedUrlDokument(sciezka)
    if (r.error || !r.data) {
      pushToast(`Nie udało się pobrać dokumentu: ${r.error?.message ?? 'brak linku'}`, 'error')
      return
    }
    if (!(await openExternalUrl(r.data))) pushToast('Nie udało się otworzyć dokumentu w przeglądarce', 'error')
  }

  // brief pkt 22: po wygenerowaniu PDF otwieramy podpisany link z odpowiedzi (10 min) — bez drugiego wywołania
  const handleDokumentCreated = (odp: CrmDokumentOdp) => {
    setDokForm(null)
    setDokWynik(odp)
    const label = CRM_DOKUMENT_RODZAJ[odp.rodzaj]?.label ?? odp.rodzaj
    pushToast(`${label}${odp.numer ? ` nr ${odp.numer}` : ''} gotowa — otwieram PDF`, 'success')
    void openExternalUrl(odp.url)
    void load(true)
  }
  const handleDokumentStatus = async (d: CrmDokument, status: string) => {
    if (status === d.status) return
    const err = await updateDokumentStatus(d.id, status)
    if (err) {
      pushToast(`Nie udało się zmienić statusu: ${err.message}`, 'error')
      return
    }
    setDokumenty((ds) => ds.map((x) => (x.id === d.id ? { ...x, status } : x)))
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
  const activeOferta = oferty.find((o) => o.status === 'do_sprawdzenia' || o.status === 'przelicz' || o.status === 'wstrzymana')
  const ostatnia = ostatniaOferta(oferty)
  const zamkniety = lead.status === 'wygrany' || lead.status === 'przegrany'
  const wartosc = wartoscKlienta(lead.wartosc_szac, ostatnia, lead.wartosc_wstepna)
  const wartoscZmiana = wartosc.reczna ? [...zdarzenia].filter((z) => z.typ === 'wartosc_zmieniona').sort((a, b) => b.created_at.localeCompare(a.created_at))[0] : undefined
  const zapiszWartosc = async (kwota: number | null) => {
    setWartoscBusy(true)
    const err = await ustawWartoscKlienta(lead, kwota, currentUser?.id ?? '')
    setWartoscBusy(false)
    if (err) {
      pushToast(`Nie udało się zapisać wartości: ${err.message}`, 'error')
      return
    }
    setWartoscEdit(null)
    pushToast(kwota == null ? 'Wartość wraca do kwoty z oferty' : 'Wartość klienta zapisana', 'success')
    await load(true)
  }
  const handleWynik = async (wynik: CrmWynik, opts: { powod?: string; notatka?: string; ofertaId?: string | null } = {}) => {
    setWynikBusy(true)
    const err = await oznaczWynik(lead.id, wynik, opts)
    setWynikBusy(false)
    if (err) {
      pushToast(`Nie udało się zapisać wyniku: ${err.message}`, 'error')
      return
    }
    setWynikForm(null)
    pushToast(wynik === 'wygrany' ? 'Zapisano: klient zamówił' : wynik === 'przegrany' ? 'Zapisano: klient przegrany' : 'Klient wrócił do gry — ma nowe zadanie', 'success')
    await load(true)
  }
  const handleDelete = async () => {
    const ok = await appConfirm(
      `Usunąć klienta „${leadName(lead)}”? Razem z nim znikną: ${ileOdm(oferty.length, 'oferta', 'oferty', 'ofert')}, ${ileOdm(dokumenty.length, 'dokument', 'dokumenty', 'dokumentów')}, ${ileOdm(rozmowy.length, 'rozmowa', 'rozmowy', 'rozmów')} i cała historia. Maile zostaną, ale bez powiązania. Tego nie da się cofnąć.`,
    )
    if (!ok) return
    setSaving(true)
    const err = await deleteLead(lead.id)
    setSaving(false)
    if (err) { pushToast(`Nie udało się usunąć klienta: ${err.message}`, 'error'); return }
    goneRef.current = true
    pushToast('Klient usunięty', 'success')
    onDeleted()
  }

  // karta klienta v2 (makieta „CRM — makieta” v2, 20.11): następny krok na górze, rozmowa z klientem po lewej, fakty po prawej
  const domyslnaZakladka: Zakladka = maile.length > 0 ? 'korespondencja' : rozmowy.length > 0 ? 'rozmowy' : 'wszystko'
  const tab = zakladka ?? domyslnaZakladka
  const krokStan = lead.nastepny_krok ? terminState(lead.nastepny_krok) : null
  const ofertyOdNajnowszej = [...oferty].sort((a, b) => b.created_at.localeCompare(a.created_at))
  const ofertyBiezace = ofertyOdNajnowszej.filter((o) => o.status !== 'robocza')
  const ofertyStare = ofertyOdNajnowszej.filter((o) => o.status === 'robocza')
  const plikiOfert = [...oferty].reverse().flatMap((o) => [
    ...(o.plik_pdf ? [{ key: `${o.id}-pdf`, label: `Oferta nr ${o.numer ?? '…'} v${o.wersja} (PDF)`, sciezka: o.plik_pdf, at: o.updated_at }] : []),
    ...konfiguracjaPliki(o).map((sc, i, all) => ({
      key: `${o.id}-konf-${i}`,
      label: `Konfiguracja producenta${all.length > 1 ? ` ${i + 1}/${all.length}` : ''} do oferty nr ${o.numer ?? '…'} v${o.wersja}`,
      sciezka: sc,
      at: o.created_at,
    })),
  ])
  const OfertaWiersz = ({ o }: { o: CrmOferta }) => (
    <li className={`crm-k2-oferta${o.status === 'zaakceptowana' ? ' crm-k2-oferta--won' : o.status === 'robocza' ? ' crm-k2-oferta--old' : ''}`}>
      <button type="button" className="crm-k2-oferta-tytul" onClick={() => onOpenOferta(o.id)} title="Otwórz ofertę">{tytulOferty(o)}</button>
      <div className="crm-k2-oferta-top">
        <span className="crm-muted" title={CRM_OFERTA_RODZAJ[o.rodzaj ?? 'sklep']?.title}>
          {o.rodzaj === 'oficjalna' ? <span className="crm-rodzaj crm-rodzaj--oficjalna">PDF{o.numer ? ` ${o.numer}` : ''}</span> : 'Sklep'} · v{o.wersja}
        </span>
        <StatusBadge status={o.status} />
        <span className="crm-muted">{fmtDate(o.created_at)}</span>
      </div>
      <div className="crm-k2-oferta-kwota">
        <b>{fmtPln(kwotaOferty(o))}</b>{o.rodzaj === 'oficjalna' && o.brutto != null ? <span className="crm-muted"> brutto</span> : null}
      </div>
      {o.nazwa && (o.produkt || o.streszczenie) && <div className="crm-k2-oferta-co" title={o.produkt ?? o.streszczenie ?? undefined}>{o.produkt || o.streszczenie}</div>}
      <div className="crm-k2-oferta-akcje">
        <button type="button" className="btn btn-sm btn-secondary" onClick={() => onOpenOferta(o.id)}>Otwórz</button>
        {o.status === 'wyslana' && !zamkniety && (
          <>
            <button type="button" className="btn btn-sm btn-secondary crm-btn-przyjal" disabled={wynikBusy} onClick={() => void handleWynik('wygrany', { ofertaId: o.id })} title="Oferta zaakceptowana, klient „Zamówił”, zadanie się zamknie">Klient przyjął</button>
            <button type="button" className="btn btn-sm btn-secondary" disabled={wynikBusy} onClick={() => { setWynikForm({ ofertaId: o.id }); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>Odmówił…</button>
          </>
        )}
      </div>
    </li>
  )

  return (
    <div className="crm-screen crm-k2">
      <header className="crm-lead-head">
        <button type="button" className="btn btn-sm btn-secondary" onClick={onBack}><ArrowLeft size={14} /> Wróć</button>
        <div className="crm-lead-head-main">
          <div className="crm-lead-head-title">
            <h3>{leadName(lead)}</h3>
            <span className={`crm-status crm-lead-status ${LEAD_STATUS_CLS[lead.status ?? ''] ?? 'crm-status--muted'}`}>{CRM_LEAD_STATUS[lead.status ?? ''] ?? lead.status ?? '—'}</span>
          </div>
          <div className="crm-screen-sub">
            {lead.kategoria ? lead.kategoria : 'kategoria nieznana'}
            {lead.zrodlo ? <> · <KanalBadge zrodlo={lead.zrodlo} /></> : null}
            {lead.kampania ? ` · kampania: ${lead.kampania}` : ''}
          </div>
          {/* kontakt od razu w nagłówku (v2); telefon = link tel: do Ringostat Smart Phone (23.11), mail tekstem do zaznaczenia */}
          <div className="crm-k2-kontakt">
            {lead.telefon ? <CrmTelefon telefon={lead.telefon} nazwa={lead.nazwa} /> : <span className="crm-muted">brak telefonu</span>}
            {lead.email ? <span className="crm-ext crm-copy-value"><Mail size={13} /> {lead.email}</span> : <span className="crm-muted">brak e-maila</span>}
            {/* #166: klient z Facebooka/Instagrama — profil zamiast telefonu i maila */}
            {lead.profil_social ? <span className="crm-ext crm-copy-value" title="Profil Facebook / Instagram"><MessageCircle size={13} /> {lead.profil_social}</span> : null}
            {lead.miejscowosc && <span>{lead.miejscowosc}</span>}
            {!dane && (
              <button type="button" className="crm-link" disabled={saving} onClick={() => setDane({ nazwa: lead.nazwa ?? '', telefon: lead.telefon ?? '', email: lead.email ?? '', miejscowosc: lead.miejscowosc ?? '', profil_social: lead.profil_social ?? '' })} title="Popraw nazwę, telefon, e-mail, profil, miejscowość">
                <Pencil size={13} /> edytuj
              </button>
            )}
          </div>
          {/* etykiety (brief pkt 12): klik w badge zdejmuje, „+” otwiera wybór ze słownika */}
          <div className="crm-lead-tags crm-k2-tagi">
            <EtykietyRow
              leadId={lead.id}
              slugi={lead.etykiety}
              slownik={etyk.mapa}
              pushToast={pushToast}
              onChanged={(slugi) => setLead((l) => (l ? { ...l, etykiety: slugi } : l))}
            />
          </div>
          {zamkniety && <div className={`crm-lead-wynik crm-lead-wynik--${lead.status}`}>{opisWyniku(lead)}</div>}
        </div>
        <div className="crm-lead-head-kwota" title={wartosc.reczna ? 'Wartość wpisana ręcznie — liczy się w lejku zamiast kwoty z oferty' : wartosc.wstepna ? 'Cena orientacyjna podana klientowi w rozmowie / mailu — liczy się w lejku do czasu oferty' : 'Ostatnia oferta klienta (bez starych wersji)'}>
          <span className="crm-pf-label">{wartosc.reczna ? 'Wartość (wpisana ręcznie)' : ostatnia ? 'Ostatnia oferta' : wartosc.wstepna ? 'Wartość (wstępnie z rozmowy)' : 'Wartość'}</span>
          {wartoscEdit != null ? (
            <form
              className="crm-wartosc-form"
              onSubmit={(e) => {
                e.preventDefault()
                const n = parseKwota(wartoscEdit)
                if (n == null) {
                  pushToast('Wpisz kwotę brutto, np. 12 500', 'error')
                  return
                }
                void zapiszWartosc(n)
              }}
            >
              <label className="crm-wartosc-pole">
                <input type="text" inputMode="decimal" aria-label="Wartość brutto w zł" autoFocus value={wartoscEdit} onChange={(e) => setWartoscEdit(e.target.value)} placeholder="np. 12 500" disabled={wartoscBusy} /> zł
              </label>
              <span className="crm-wartosc-akcje">
                <button type="submit" className="btn btn-sm btn-primary" disabled={wartoscBusy}>{wartoscBusy ? <Spinner inline size={14} /> : <Check size={14} />} Zapisz</button>
                <button type="button" className="btn btn-sm btn-secondary" disabled={wartoscBusy} onClick={() => setWartoscEdit(null)}>Anuluj</button>
              </span>
              <span className="crm-muted">Np. rabat albo mniejsze zamówienie. Liczy się w lejku zamiast kwoty z oferty.</span>
            </form>
          ) : (
            <>
              <span className="crm-wartosc-kwota">
                {wartosc.kwota != null ? <b>{fmtPln(wartosc.kwota)}</b> : <span className="crm-muted">brak</span>}
                <button type="button" className="crm-wartosc-edytuj" aria-label="Zmień wartość klienta" title="Zmień wartość klienta" onClick={() => setWartoscEdit(wartosc.kwota != null ? String(wartosc.kwota).replace('.', ',') : '')}>
                  <Pencil size={14} />
                </button>
              </span>
              {wartosc.reczna ? (
                <>
                  <span className="crm-muted crm-wartosc-reczna">wpisane ręcznie{wartoscZmiana ? ` · ${(wartoscZmiana.kto && names.get(wartoscZmiana.kto)) || 'ktoś z zespołu'}, ${fmtDate(wartoscZmiana.created_at)}` : ''}</span>
                  {ostatnia && (
                    <button type="button" className="crm-link" disabled={wartoscBusy} onClick={() => void zapiszWartosc(null)}>
                      Wróć do kwoty z oferty ({fmtPln(kwotaOferty(ostatnia))})
                    </button>
                  )}
                  {!ostatnia && (
                    <button type="button" className="crm-link" disabled={wartoscBusy} onClick={() => void zapiszWartosc(null)}>Usuń wartość</button>
                  )}
                </>
              ) : ostatnia ? (
                <span className="crm-muted">{ostatnia.rodzaj === 'oficjalna' ? 'brutto · ' : ''}{(CRM_OFERTA_STATUS[ostatnia.status]?.label ?? ostatnia.status).toLowerCase()} · {fmtDate(ostatnia.created_at)}</span>
              ) : wartosc.wstepna ? (
                <span className="crm-muted">cena orientacyjna z rozmowy / maila — zmieni się po ofercie, możesz też wpisać ręcznie</span>
              ) : (
                <span className="crm-muted">bez oferty — możesz wpisać szacunek</span>
              )}
            </>
          )}
        </div>
        <div className="crm-lead-head-akcje">
          {!zamkniety ? (
            <>
              <button type="button" className="btn btn-success" disabled={wynikBusy} aria-expanded={zamowilForm != null} onClick={() => setZamowilForm(wartosc.kwota != null ? String(wartosc.kwota).replace('.', ',') : '')} title="Klient zamówił: zapytam o kwotę, potem zadanie się zamknie, a najnowsza wysłana oferta dostanie status „Zaakceptowana”">
                <Check size={15} /> Zamówił
              </button>
              <button type="button" className="btn btn-secondary" disabled={wynikBusy} onClick={() => setWynikForm({ ofertaId: null })} aria-expanded={wynikForm != null}>
                Przegrany…
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={wynikBusy}
              onClick={() => void handleWynik('w_grze')}
              title={lead.status === 'wygrany' ? 'Cofa pomyłkowe „Zamówił”: klient wraca do gry z nowym zadaniem (oferta zostaje zaakceptowana)' : 'Klient wraca do gry z nowym zadaniem „Zapytaj o decyzję”'}
            >
              {wynikBusy ? <Spinner inline size={14} /> : <RefreshCw size={14} />} {lead.status === 'wygrany' ? 'Cofnij „Zamówił”' : 'Przywróć do gry'}
            </button>
          )}
          <div className="crm-menu">
            <button type="button" className="btn btn-secondary crm-menu-btn" aria-label="Więcej akcji" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>…</button>
            {menuOpen && (
              <div className="crm-menu-lista" role="menu">
                <button type="button" role="menuitem" className="crm-menu-item crm-menu-item--danger" disabled={saving} onClick={() => { setMenuOpen(false); void handleDelete() }} title="Usuń klienta ze wszystkim, co ma w CRM (nieodwracalne)">
                  <Trash2 size={14} /> Usuń klienta…
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      {zamowilForm != null && (
        <form
          className="crm-box crm-zamowil-form"
          aria-label="Klient zamówił"
          onSubmit={(e) => {
            e.preventDefault()
            const n = zamowilForm.trim() ? parseKwota(zamowilForm) : null
            if (zamowilForm.trim() && n == null) {
              pushToast('Wpisz kwotę brutto, np. 12 500 — albo zostaw puste', 'error')
              return
            }
            // zwiad 21.11: blokada od pierwszego kliknięcia (podwójny Enter zapisywał kwotę i wynik dwa razy)
            if (wynikBusy) return
            setWynikBusy(true)
            void (async () => {
              if (n != null && n !== wartosc.kwota) {
                const err = await ustawWartoscKlienta(lead, n, currentUser?.id ?? '')
                if (err) {
                  setWynikBusy(false)
                  pushToast(`Nie udało się zapisać kwoty: ${err.message}`, 'error')
                  return
                }
              }
              setZamowilForm(null)
              await handleWynik('wygrany')
            })()
          }}
        >
          <b>{leadName(lead)} zamówił — za ile?</b>
          <label className="crm-wartosc-pole">
            <input type="text" inputMode="decimal" aria-label="Wartość zamówienia brutto w zł" autoFocus value={zamowilForm} onChange={(e) => setZamowilForm(e.target.value)} placeholder="np. 12 500" disabled={wynikBusy} /> zł brutto
          </label>
          <span className="crm-muted">{ostatnia ? 'Podpowiadam kwotę z ostatniej oferty — popraw, jeśli klient zamówił inaczej.' : 'Klient nie ma oferty — wpisz, za ile zamówił, żeby liczyło się w statystykach.'} Zadanie się zamknie; potem umów pomiar albo montaż.</span>
          <span className="crm-wartosc-akcje">
            <button type="submit" className="btn btn-success" disabled={wynikBusy}>{wynikBusy ? <Spinner inline size={14} /> : <Check size={14} />} Zapisz: zamówił</button>
            <button type="button" className="btn btn-secondary" disabled={wynikBusy} onClick={() => setZamowilForm(null)}>Anuluj</button>
          </span>
        </form>
      )}
      {wynikForm && (
        <WynikPrzegranyForm
          busy={wynikBusy}
          hint={wynikForm.ofertaId ? 'Ta oferta dostanie status „Odrzucona”, otwarte zadanie się zamknie, klient zniknie z „Do zrobienia”.' : undefined}
          onCancel={() => setWynikForm(null)}
          onConfirm={(powod, notatka) => void handleWynik('przegrany', { powod, notatka, ofertaId: wynikForm.ofertaId })}
        />
      )}
      {dane && (
        <section className="crm-box crm-pf crm-dane-edit" aria-label="Edycja danych kontaktowych">
          <div className="crm-pf-grid">
            <label className="crm-pf-field"><span className="crm-pf-label">Imię i nazwisko / firma</span><input type="text" value={dane.nazwa} onChange={(e) => setDane({ ...dane, nazwa: e.target.value })} disabled={saving} autoComplete="off" /></label>
            <label className="crm-pf-field"><span className="crm-pf-label">Telefon</span><input type="tel" value={dane.telefon} onChange={(e) => setDane({ ...dane, telefon: e.target.value })} disabled={saving} autoComplete="off" /></label>
            <label className="crm-pf-field"><span className="crm-pf-label">E-mail</span><input type="email" value={dane.email} onChange={(e) => setDane({ ...dane, email: e.target.value })} disabled={saving} autoComplete="off" /></label>
            <label className="crm-pf-field"><span className="crm-pf-label">Profil Facebook / Instagram</span><input type="text" value={dane.profil_social} onChange={(e) => setDane({ ...dane, profil_social: e.target.value })} disabled={saving} autoComplete="off" placeholder="@nazwa albo link" /></label>
            <label className="crm-pf-field"><span className="crm-pf-label">Miejscowość</span><input type="text" value={dane.miejscowosc} onChange={(e) => setDane({ ...dane, miejscowosc: e.target.value })} disabled={saving} autoComplete="off" /></label>
          </div>
          <div className="crm-poczta-actions">
            <button type="button" className="btn btn-sm btn-primary" disabled={saving} onClick={() => void saveDane()}>{saving ? <Spinner inline size={14} /> : <Check size={14} />} Zapisz</button>
            <button type="button" className="btn btn-sm btn-secondary" disabled={saving} onClick={() => setDane(null)}>Anuluj</button>
          </div>
        </section>
      )}
      {/* brief pkt 26: możliwe duplikaty — baner z linkiem do drugiej karty i „Połącz” (panel w miejscu, nieodwracalne) */}
      {duplikaty.length > 0 && (
        <section className="crm-dup-baner">
          <h4><Merge size={15} /> Możliwy duplikat{duplikaty.length > 1 ? ` (${duplikaty.length})` : ''}</h4>
          <ul className="crm-dup-lista">
            {duplikaty.map((d) => (
              <li key={d.id} className="crm-dup-row">
                <button type="button" className="crm-link" onClick={() => onOpenLead(d.id)} title="Otwórz kartę tego klienta">
                  <b>{(d.nazwa || d.telefon || d.email || 'Klient bez nazwy').trim()}</b>
                </button>
                <span className="crm-muted">
                  {[d.telefon, d.email, d.miejscowosc].filter(Boolean).join(' · ')}
                  {d.status ? ` · ${CRM_LEAD_STATUS[d.status] ?? d.status}` : ''}
                </span>
                <span className="crm-dup-powod">{d.powod} · {d.pewnosc}%</span>
                <button type="button" className="btn btn-sm btn-secondary" disabled={saving || (polacz != null && polacz.id !== d.id)} onClick={() => setPolacz(polacz?.id === d.id ? null : d)}>
                  <Merge size={14} /> Połącz
                </button>
              </li>
            ))}
          </ul>
          {polacz && (
            <CrmPolaczPanel
              a={{ id: lead.id, nazwa: lead.nazwa, email: lead.email, telefon: lead.telefon, miejscowosc: lead.miejscowosc }}
              b={{ id: polacz.id, nazwa: polacz.nazwa, email: polacz.email, telefon: polacz.telefon, miejscowosc: polacz.miejscowosc }}
              powod={polacz.powod}
              pewnosc={polacz.pewnosc}
              opisA={`${zdarzenia.length} wpisów historii, ${oferty.length} ofert, ${dokumenty.length} dokumentów`}
              pushToast={pushToast}
              onCancel={() => setPolacz(null)}
              onDone={(celId) => {
                setPolacz(null)
                // ten klient był źródłem → zniknął, przechodzimy na kartę celu; inaczej odświeżamy
                if (celId !== lead.id) onOpenLead(celId)
                else void load(true)
              }}
            />
          )}
        </section>
      )}
      {/* NASTĘPNY KROK (v2): jedyny kolorowy pasek — co, kiedy, czym to zamknąć */}
      {lead.nastepna_akcja ? (
        <section className={`crm-k2-krok${krokStan === 'overdue' ? ' crm-k2-krok--late' : krokStan === 'today' ? ' crm-k2-krok--dzis' : ''}`} aria-label="Następny krok">
          <div className="crm-k2-krok-tekst">
            <span className="crm-k2-krok-label">{krokStan === 'overdue' ? 'Zaległe' : 'Następny krok'}</span>
            <span className="crm-k2-krok-tytul">
              {CRM_AKCJA[lead.nastepna_akcja]?.label ?? lead.nastepna_akcja}
              {lead.nastepny_krok ? <span className="crm-k2-krok-termin"> · {krokStan === 'today' ? 'dziś' : fmtDate(lead.nastepny_krok)}</span> : null}
            </span>
            {(lead.akcja_opis || CRM_AKCJA[lead.nastepna_akcja]?.hint) && (
              <span className={`crm-k2-krok-opis${opisPelny ? ' crm-k2-krok-opis--pelny' : ''}`}>
                {lead.akcja_opis || CRM_AKCJA[lead.nastepna_akcja]?.hint}
                {(lead.akcja_opis?.length ?? 0) > 150 && (
                  <>
                    {' '}
                    <button type="button" className="crm-link" onClick={() => setOpisPelny((v) => !v)}>{opisPelny ? 'mniej' : 'więcej'}</button>
                  </>
                )}
              </span>
            )}
          </div>
          <div className="crm-mail-actions">
            {lead.nastepna_akcja === 'przygotuj_oferte' && activeOferta ? (
              activeOferta.status === 'wstrzymana' ? (
                <button type="button" className="btn btn-primary" onClick={() => onOpenOferta(activeOferta.id)} title="Przeczytaj ustalenia z rozmowy / maila i zleć policzenie oferty">Sprawdź ustalenia i zleć ofertę</button>
              ) : activeOferta.status === 'przelicz' ? (
                <span className="crm-muted"><Spinner inline size={14} /> system liczy ofertę…</span>
              ) : (
                <button type="button" className="btn btn-primary" onClick={() => onOpenOferta(activeOferta.id)}>Otwórz ofertę · {fmtPln(activeOferta.cena_razem)}</button>
              )
            ) : lead.nastepna_akcja === 'oddzwon' ? (
              <>
                <span className="crm-muted">Zadanie zamknie się samo po odebranej rozmowie wychodzącej z Ringostatu.</span>
                <button type="button" className="btn btn-sm btn-secondary" disabled={saving || zadanieDialog} onClick={handleZrobione} title="Użyj tylko, gdy dzwoniłeś z innego telefonu niż Ringostat">Zrobione ręcznie</button>
              </>
            ) : (
              <button type="button" className="btn btn-primary" disabled={saving || zadanieDialog} onClick={handleZrobione}><Check size={14} /> Zrobione</button>
            )}
            {lead.nastepna_akcja === 'przygotuj_oferte' && activeOferta && activeOferta.status !== 'przelicz' && (
              <button type="button" className="btn btn-sm btn-secondary" disabled={saving || zadanieDialog} onClick={handleZrobione} title="Zamknij zadanie i ustaw następny krok">Zrobione</button>
            )}
            {lead.email && (
              <button type="button" className="btn btn-sm btn-secondary" onClick={() => { setZakladka('korespondencja'); window.setTimeout(() => document.querySelector('.crm-k2-main')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50) }} title="Korespondencja z klientem i szkic odpowiedzi w moim stylu">
                <Mail size={14} /> Napisz mail
              </button>
            )}
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              disabled={saving || zadanieDialog}
              title="Zmień rodzaj, termin albo opis zadania"
              onClick={() => { setZadanieEdycja(true); setZadanieDialog(true) }}
            >
              <Pencil size={14} /> Zmień zadanie
            </button>
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              disabled={saving || zadanieDialog}
              title="Zdejmij zadanie bez oznaczania jako zrobione"
              onClick={async () => {
                if (!(await appConfirm('Usunąć to zadanie? Klient zniknie z listy „Do zrobienia”, w historii zostanie ślad.'))) return
                setSaving(true)
                const err = await usunZadanie(lead, currentUser?.id ?? '')
                setSaving(false)
                if (err) { pushToast(`Nie udało się usunąć zadania: ${err.message}`, 'error'); return }
                pushToast('Zadanie usunięte', 'success')
                void load(true)
              }}
            >
              <Trash2 size={14} /> Usuń zadanie
            </button>
          </div>
        </section>
      ) : (
        !zadanieDialog && (
          <section className="crm-k2-krok crm-k2-krok--brak" aria-label="Następny krok">
            <div className="crm-k2-krok-tekst">
              <span className="crm-k2-krok-label">Następny krok</span>
              <span className="crm-k2-krok-tytul">{lead.status === 'wygrany' ? 'Klient zamówił — umów pomiar albo montaż' : lead.status === 'przegrany' ? 'Brak — sprawa zamknięta' : 'Brak — klient nie pojawia się w „Do zrobienia”'}</span>
            </div>
            <div className="crm-mail-actions">
              <button type="button" className="btn btn-primary" disabled={saving} onClick={() => setZadanieDialog(true)}>Dodaj zadanie</button>
            </div>
          </section>
        )
      )}
      {zadanieDialog && (
        <CrmZadanieDialog
          klient={leadName(lead)}
          biezaceZadanie={lead.nastepna_akcja}
          busy={saving}
          onConfirm={confirmZadanie}
          onCancel={() => { setZadanieDialog(false); setZadanieEdycja(false) }}
          edycja={zadanieEdycja && lead.nastepna_akcja ? {
            akcja: lead.nastepna_akcja,
            zaDni: lead.nastepny_krok ? Math.max(0, Math.round((new Date(lead.nastepny_krok).getTime() - new Date(new Date().toDateString()).getTime()) / 86_400_000)) : 0,
            opis: (lead.akcja_opis ?? '').replace(CRM_AKCJA[lead.nastepna_akcja]?.hint ?? '\u0000', '').trim(),
            termin: lead.nastepny_krok ? String(lead.nastepny_krok).slice(0, 10) : null,
          } : undefined}
        />
      )}
      {oficForm && (
        <CrmOfertaOficjalnaForm
          leadId={lead.id}
          klient={leadName(lead)}
          pushToast={pushToast}
          onCreated={() => {
            setOficForm(false)
            setZleconoAt(Date.now())
            void load(true)
          }}
          onCancel={() => setOficForm(false)}
        />
      )}
      <div className="crm-k2-cols">
        <section className="crm-k2-main" aria-label="Kontakt z klientem">
          <div className="crm-k2-tabs" role="tablist" aria-label="Widok">
            {([
              ['korespondencja', `Korespondencja ${maile.length}`],
              ['rozmowy', `Rozmowy ${rozmowy.length}`],
              ['wszystko', 'Wszystko'],
            ] as Array<[Zakladka, string]>).map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={`crm-k2-tab${tab === k ? ' crm-k2-tab--on' : ''}`} onClick={() => setZakladka(k)}>
                {label}
              </button>
            ))}
          </div>

          {tab === 'korespondencja' && (
            <>
              <CrmKorespondencja maile={maile} onOpenMail={onOpenMail} />
              {/* brief pkt 23: szkic odpowiedzi mailowej — pod wątkiem, jak pole odpowiedzi */}
              <SzkicOdpowiedzi
                lead={lead}
                disabled={saving}
                pushToast={pushToast}
                onChanged={(szkic) => {
                  // null = szkic nie zapisany (wyścig) — nie wstawiamy do stanu, tylko przeładowujemy leada
                  if (szkic) setLead((l) => (l ? { ...l, szkic } : l))
                  void load(true)
                }}
              />
            </>
          )}

          {tab === 'rozmowy' && (
            <div className="crm-k2-rozmowy">
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
                    {/* SPRAWA (wynik AI) — tylko tryb pełny; kanał rozmowy = zawsze telefon */}
                    {mode === 'pelny' && r.typ && <span className="crm-call-typ" title="Sprawa (z analizy)">{CRM_SPRAWA[r.typ] ?? r.typ}</span>}
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
            </div>
          )}

          {tab === 'wszystko' && (
            <div className="crm-history">
              <HistoriaKlienta zdarzenia={zdarzenia} rozmowy={rozmowy} maile={maile} names={names} mode={mode} onOpenMail={onOpenMail} onOpenOferta={onOpenOferta} onOpenPlik={(s) => void handleOpenDokument(s)} />
            </div>
          )}
        </section>

        <aside className="crm-k2-side" aria-label="O kliencie">
          <section className="crm-k2-card">
            <h4>Czego chce</h4>
          {/* brief pkt 15: notatka handlowca (klient z salonu) → „Zleć ofertę” liczy ofertę z jej treści.
              Przy rozmowach/mailach podsumowanie pisze system, więc pole pokazujemy tylko przy wizycie albo gdy już jest notatka. */}
          {lead.zrodlo === 'wizyta' || lead.podsumowanie || lead.nastepna_akcja === 'przygotuj_oferte' ? (
            <div className="crm-notatka">
              <textarea
                className="crm-fix-textarea"
                rows={4}
                value={notatka}
                onChange={(e) => {
                  setNotatka(e.target.value)
                  setNotatkaDirty(true)
                }}
                disabled={saving}
                placeholder="Notatka: jakie drzwi, wymiar, kolor, okucia, dostawa czy odbiór…"
                aria-label="Notatka handlowca"
              />
              <div className="crm-mail-actions">
                {activeOferta?.status === 'przelicz' || (czekaNaOferte && !activeOferta) ? (
                  <span className="crm-muted"><Spinner inline size={14} /> system liczy ofertę z notatki…</span>
                ) : (
                  <button type="button" className="btn btn-secondary" disabled={saving || !notatka.trim()} onClick={() => void handleZlecOferte()} title="System przeanalizuje notatkę, dobierze drzwi, policzy cenę i napisze mail">
                    <FileText size={14} /> {activeOferta ? 'Zleć nową wersję oferty' : 'Zleć ofertę'}
                  </button>
                )}
                {/* brief pkt 18: notatka głosowa → transkrypcja do podsumowania → oferta jak z notatki pisanej */}
                {!(activeOferta?.status === 'przelicz' || (czekaNaOferte && !activeOferta)) && (
                  <CrmNagrajNotatke onRecorded={handleNagranie} busy={nagrywanieBusy} disabled={saving} />
                )}
                {/* brief pkt 21: oferta oficjalna PDF dla klienta z montażem */}
                <button type="button" className="btn btn-secondary" disabled={saving || oficForm} onClick={() => setOficForm(true)} title="Oferta PDF z montażem: ceny z konfiguracji producenta, usługi własne, VAT 8%/23%">
                  <FileText size={14} /> Oferta z montażem
                </button>
                {notatkaDirty && <span className="crm-muted">notatka zapisze się przy zleceniu oferty</span>}
              </div>
            </div>
          ) : (
            <div className="crm-mail-actions">
              <span className="crm-muted">brak podsumowania</span>
              <button type="button" className="btn btn-sm btn-secondary" disabled={saving || oficForm} onClick={() => setOficForm(true)}><FileText size={14} /> Oferta z montażem</button>
            </div>
          )}
          {lead.brakuje && (
            <>
              <h5>Brakuje</h5>
              <p>{lead.brakuje}</p>
            </>
          )}
          </section>

          <section className="crm-k2-card">
            <h4>Oferty{oferty.length ? ` (${oferty.length})` : ''}</h4>
            {oferty.length === 0 ? (
              <p className="crm-muted">Brak ofert dla tego klienta.</p>
            ) : (
              <>
                <ul className="crm-k2-oferty">
                  {(ofertyBiezace.length ? ofertyBiezace : ofertyStare.slice(0, 1)).map((o) => <OfertaWiersz key={o.id} o={o} />)}
                </ul>
                {ofertyBiezace.length > 0 && ofertyStare.length > 0 && (
                  <details className="crm-details crm-details--inline">
                    <summary>Starsze wersje ({ofertyStare.length})</summary>
                    <ul className="crm-k2-oferty">{ofertyStare.map((o) => <OfertaWiersz key={o.id} o={o} />)}</ul>
                  </details>
                )}
              </>
            )}
          </section>

          {/* dokumenty klienta (brief pkt 22): karta pomiarowa / umowa / protokół + pliki ofert oficjalnych (pkt 21) */}
          <section className="crm-k2-card crm-dok">
            <h4>Dokumenty</h4>
        {dokWynik && !dokForm && (
          <div className={`crm-box crm-dok-wynik${dokWynik.rodzaj === 'umowa' ? ' crm-dok-wynik--umowa' : ''}`}>
            <b>{CRM_DOKUMENT_RODZAJ[dokWynik.rodzaj]?.label ?? dokWynik.rodzaj}{dokWynik.numer ? ` nr ${dokWynik.numer}` : ''} gotowa.</b>{' '}
            {dokWynik.rodzaj === 'umowa' ? 'Obejrzyj PDF przed wysłaniem do Autenti — nic nie wysłaliśmy. Po wysłaniu ustaw status „Wysłana”.' : 'PDF otworzył się w przeglądarce; jeśli nie, pobierz poniżej.'}
            <div className="crm-mail-actions">
              <button type="button" className="btn btn-sm btn-primary" onClick={() => void handleOpenDokument(dokWynik.plik_pdf)}><FileText size={14} /> Pokaż PDF</button>
              <button type="button" className="btn btn-sm btn-secondary" onClick={() => setDokWynik(null)}>OK</button>
            </div>
          </div>
        )}
        {(() => {
          const ofertyDoUmowy = oferty.filter((o) => o.rodzaj === 'oficjalna' && o.z_montazem !== false && o.brutto != null && o.numer && o.plik_pdf && (o.status === 'do_sprawdzenia' || o.status === 'wyslana'))
          const umowy = dokumenty.filter((d) => d.rodzaj === 'umowa' && d.status !== 'anulowana')
          return (
            <>
              {!dokForm && (
                <div className="crm-mail-actions">
                  <button type="button" className="btn btn-sm btn-secondary" disabled={saving} onClick={() => { setDokWynik(null); setDokForm({ rodzaj: 'karta_pomiarowa' }) }} title={CRM_DOKUMENT_RODZAJ.karta_pomiarowa.title}><FileText size={14} /> Karta pomiarowa</button>
                  {ofertyDoUmowy.length > 0 && (
                    <button type="button" className="btn btn-sm btn-secondary" disabled={saving} onClick={() => { setDokWynik(null); setDokForm({ rodzaj: 'umowa' }) }} title={CRM_DOKUMENT_RODZAJ.umowa.title}><FileText size={14} /> Umowa</button>
                  )}
                  {umowy.length > 0 && (
                    <button type="button" className="btn btn-sm btn-secondary" disabled={saving} onClick={() => { setDokWynik(null); setDokForm({ rodzaj: 'protokol' }) }} title={CRM_DOKUMENT_RODZAJ.protokol.title}><FileText size={14} /> Protokół odbioru</button>
                  )}
                  {ofertyDoUmowy.length === 0 && <span className="crm-muted">umowa wymaga policzonej oferty oficjalnej z montażem</span>}
                </div>
              )}
              {dokForm && (
                <CrmDokumentForm
                  rodzaj={dokForm.rodzaj}
                  lead={lead}
                  ofertyDoUmowy={ofertyDoUmowy}
                  umowy={umowy}
                  istniejacy={dokForm.istniejacy ?? null}
                  pushToast={pushToast}
                  onCreated={handleDokumentCreated}
                  onCancel={() => setDokForm(null)}
                />
              )}
            </>
          )
        })()}
        {dokumenty.length > 0 && (
          <ul className="crm-dokumenty crm-dok-lista">
            {dokumenty.map((d) => {
              const st = CRM_DOKUMENT_STATUS[d.status] ?? { label: d.status, cls: 'crm-status--muted' }
              const label = `${CRM_DOKUMENT_RODZAJ[d.rodzaj]?.label ?? d.rodzaj}${d.numer ? ` nr ${d.numer}` : ''}`
              const szczegol = d.rodzaj === 'karta_pomiarowa' ? [d.dane.data_pomiaru, d.dane.godzina, d.dane.wykonal].filter(Boolean).join(' · ') : d.rodzaj === 'umowa' ? [d.dane.numer_oferty ? `oferta ${d.dane.numer_oferty}` : null, typeof d.dane.brutto === 'number' ? `${fmtPln(d.dane.brutto)} brutto` : null].filter(Boolean).join(' · ') : d.dane.numer_umowy ? `do umowy ${d.dane.numer_umowy}` : ''
              return (
                <li key={d.id} className="crm-dok-row">
                  {d.plik_pdf ? (
                    <button type="button" className="crm-link" onClick={() => void handleOpenDokument(d.plik_pdf as string)} title="Otwórz PDF (link ważny 10 min)"><FileText size={13} /> {label}</button>
                  ) : (
                    <span><FileText size={13} /> {label}</span>
                  )}
                  <span className="crm-muted"> · {fmtDate(d.created_at)}{szczegol ? ` · ${szczegol}` : ''}</span>
                  <span className={`crm-status ${st.cls}`}>{st.label}</span>
                  <select className="crm-dok-status" value={d.status} onChange={(e) => void handleDokumentStatus(d, e.target.value)} disabled={saving} aria-label={`Status: ${label}`} title="Status zmieniasz ręcznie: umowa → Wysłana po Autenti, Podpisana po podpisie; karta/protokół → Podpisana po skanie">
                    {Object.entries(CRM_DOKUMENT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                  {d.status !== 'podpisana' && d.status !== 'anulowana' && (
                    <button type="button" className="crm-link" disabled={saving || Boolean(dokForm)} onClick={() => { setDokWynik(null); setDokForm({ rodzaj: d.rodzaj as DokumentRodzaj, istniejacy: d }) }} title={d.rodzaj === 'umowa' ? 'Nowy PDF z poprawionymi polami, ten sam numer umowy' : 'Nowy PDF z poprawionymi polami'}>
                      <Pencil size={13} /> generuj ponownie
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
            {plikiOfert.length > 0 && (
              <details className="crm-details crm-details--inline">
                <summary>Pliki ofert ({plikiOfert.length})</summary>
                <ul className="crm-dokumenty">
                  {plikiOfert.map((d) => (
                    <li key={d.key}>
                      <button type="button" className="crm-link" onClick={() => void handleOpenDokument(d.sciezka)}><FileText size={13} /> {d.label}</button>
                      <span className="crm-muted"> · {fmtDate(d.at)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>

          <section className="crm-k2-card">
            <details className="crm-details crm-details--inline">
              <summary>Szczegóły kontaktu</summary>
              {/* brief pkt 26: dane klientów połączonych w tego */}
              {(lead.inne_kontakty?.length ?? 0) > 0 && (
                <Field label="Inne dane kontaktowe">
                  <ul className="crm-inne-kontakty">
                    {(lead.inne_kontakty ?? []).map((k, i) => (
                      <li key={i} title={k.polaczono ? `połączono ${fmtDateTime(k.polaczono)}` : undefined}>
                        {[k.nazwa, k.telefon, k.email, k.miejscowosc].filter((x) => (x ?? '').trim()).join(' · ') || '—'}
                        {k.zrodlo && CRM_KANAL[k.zrodlo] ? <span className="crm-muted"> · {CRM_KANAL[k.zrodlo].label}</span> : null}
                      </li>
                    ))}
                  </ul>
                </Field>
              )}
              <Field label="Ostatnia rozmowa">{fmtDateTime(lead.ostatnia_rozmowa_at)}</Field>
              <Field label="Pierwszy kontakt">{fmtDateTime(lead.created_at)}</Field>
            </details>
          </section>
        </aside>
      </div>
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
  const zastapOferte = useCallback((id: string) => setScreen({ kind: 'oferta', id }), [])
  const openLead = useCallback((id: string) => go({ kind: 'lead', id }), [go])
  const openMail = useCallback((id: string) => go({ kind: 'mail', id }), [go])
  const goTop = (kind: 'zadania' | 'oferty' | 'maile' | 'poczta' | 'pomoc' | 'ustawienia' | 'kontakty' | 'statystyki') => {
    setStack([])
    setScreen({ kind })
  }
  const topKind =
    screen.kind === 'oferty' || screen.kind === 'poczta' || screen.kind === 'maile' || screen.kind === 'pomoc' || screen.kind === 'ustawienia' || screen.kind === 'kontakty' || screen.kind === 'statystyki'
      ? screen.kind
      : screen.kind === 'mail'
        ? 'maile'
        : 'zadania'

  return (
    <div className={`crm-view crm-view--${mode}`}>
      {/* pasek marki: moduł Po Drzwi w systemie KR Center (kolory ze strony podrzwi.pl) */}
      <div className="crm-brand">
        <span className="crm-brand-name">PO DRZWI</span>
        <nav className="crm-nav" aria-label="Sekcje CRM">
          <button type="button" className={`crm-nav-btn${topKind === 'zadania' ? ' crm-nav-btn--active' : ''}`} onClick={() => goTop('zadania')}>
            Do zrobienia
          </button>
          <button type="button" className={`crm-nav-btn${topKind === 'oferty' ? ' crm-nav-btn--active' : ''}`} onClick={() => goTop('oferty')}>
            Oferty
          </button>
          {/* brief pkt 20: wszyscy klienci, także bez zadania */}
          <button type="button" className={`crm-nav-btn${topKind === 'kontakty' ? ' crm-nav-btn--active' : ''}`} onClick={() => goTop('kontakty')} title="Wszyscy klienci: lejek, lista, szukanie, filtry">
            Klienci
          </button>
          {/* 21.11: historia zamkniętych — per miesiąc, pochodzenie, powody, kto zamyka */}
          <button type="button" className={`crm-nav-btn${topKind === 'statystyki' ? ' crm-nav-btn--active' : ''}`} onClick={() => goTop('statystyki')} title="Ile wygraliśmy per miesiąc, skąd przychodzą klienci, dlaczego przegrywamy">
            Statystyki
          </button>
          <button type="button" className={`crm-nav-btn${topKind === 'maile' ? ' crm-nav-btn--active' : ''}`} onClick={() => goTop('maile')} title="Maile przychodzące i wychodzące ze skrzynek">
            Maile
          </button>
          {/* skrzynki IMAP (brief pkt 11): każdy z CRM widzi i może dodać swoją, superadmin zarządza wszystkimi */}
          <button type="button" className={`crm-nav-btn${topKind === 'poczta' ? ' crm-nav-btn--active' : ''}`} onClick={() => goTop('poczta')} title="Skrzynki pocztowe">
            Poczta
          </button>
          {/* instrukcja pracy z crm.pomoc (markdown) — superadmin edytuje bez nowej wersji aplikacji */}
          <button type="button" className={`crm-nav-btn${topKind === 'pomoc' ? ' crm-nav-btn--active' : ''}`} onClick={() => goTop('pomoc')} title="Jak pracować w CRM">
            Pomoc
          </button>
          {/* brief pkt 16–17: zasady ofert, alerty, przegląd poprawek — tylko właściciel (tryb pełny) */}
          {mode === 'pelny' && (
            <button type="button" className={`crm-nav-btn${topKind === 'ustawienia' ? ' crm-nav-btn--active' : ''}`} onClick={() => goTop('ustawienia')} title="Zasady ofert, alerty, poprawki">
              Ustawienia
            </button>
          )}
        </nav>
        {currentUser && <span className="crm-brand-user">{currentUser.full_name}</span>}
      </div>
      {screen.kind === 'zadania' && <ZadaniaScreen mode={mode} currentUser={currentUser} pushToast={pushToast} onOpenLead={openLead} onOpenOferta={openOferta} />}
      {screen.kind === 'oferty' && <OfertyList mode={mode} onOpenOferta={openOferta} onOpenLead={openLead} />}
      {screen.kind === 'statystyki' && <CrmStatystykiScreen />}
      {screen.kind === 'kontakty' && <CrmKontaktyScreen currentUser={currentUser} pushToast={pushToast} onOpenLead={openLead} onOpenOferta={openOferta} />}
      {screen.kind === 'maile' && <CrmMaileScreen mode={mode} onOpenMail={openMail} onOpenLead={openLead} onOpenOferta={openOferta} />}
      {screen.kind === 'mail' && <CrmMailScreen id={screen.id} mode={mode} pushToast={pushToast} onBack={back} onOpenLead={openLead} onOpenOferta={openOferta} />}
      {screen.kind === 'poczta' && <CrmPocztaScreen currentUser={currentUser} isSuperadmin={mode === 'pelny'} pushToast={pushToast} />}
      {screen.kind === 'pomoc' && <CrmPomocScreen currentUser={currentUser} canEdit={mode === 'pelny'} pushToast={pushToast} />}
      {screen.kind === 'ustawienia' && mode === 'pelny' && <CrmUstawieniaScreen currentUser={currentUser} pushToast={pushToast} onOpenOferta={openOferta} onOpenLead={openLead} />}
      {screen.kind === 'oferta' && (
        <OfertaScreen key={screen.id} id={screen.id} mode={mode} currentUser={currentUser} pushToast={pushToast} onBack={back} onOpenLead={openLead} onOpenOferta={openOferta} onZastapOferte={zastapOferte} />
      )}
      {screen.kind === 'lead' && <LeadScreen key={screen.id} id={screen.id} mode={mode} currentUser={currentUser} pushToast={pushToast} onBack={back} onDeleted={() => goTop('kontakty')} onOpenOferta={openOferta} onOpenMail={openMail} onOpenLead={openLead} />}
    </div>
  )
}
