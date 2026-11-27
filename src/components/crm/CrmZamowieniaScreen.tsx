// CRM Po Drzwi → Zamówienia (#144/#153, etap 1: podgląd). Zamówienia sklepu z Baselinkera (crm-bl-sync co 15 min)
// razem z tym, co dzieje się z nimi w KR Center: zlecenia, etapy, wydanie, wyjazd, reklamacje. Lista z filtrami,
// pasek „wymaga uwagi” i karta zamówienia (wysuwana z prawej). Zmiana statusów w Baselinkerze to etap 2.
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CurrentUser, Order, ToastVariant } from '../../types'
import {
  fetchZamowieniaPanel,
  klientZamowieniaSklep,
  odepnijZlecenie,
  odswiezZamowieniaBl,
  powiazZlecenie,
  szukajZlecenPoDrzwi,
  type CrmError,
  type CrmZamowieniaPanel,
} from '../../hooks/useCrm'
import {
  BL_PANEL_URL,
  STAN_ZAMOWIENIA,
  pasujeDoKlienta,
  slowaNazwiska,
  stanZamowienia,
  stanWysylki,
  stanZlecenia,
  terminWysylki,
  terminZamowienia,
  BL_STATUS_PACZKI,
  STAN_WYSYLKI,
  type StanWysylki,
  uwagiZamowienia,
  type Powiazanie,
  type ReklamacjaKr,
  type StanZamowienia,
  type ZamowienieSklep,
} from '../../lib/crmZamowienia'
import { countCompletedStages, parseOrderExtraFields } from '../../utils'
import { openExternalUrl } from '../../hooks/useAluOrders'
import { appConfirm } from '../../lib/appDialogs'
import DataTable, { type DataTableColumn } from '../DataTable'
import Spinner from '../Spinner'
import { useOnCrmReshow } from './crmActive'

type Props = {
  currentUser: CurrentUser | null
  pushToast: (message: string, variant: ToastVariant) => void
  onOpenLead: (id: string) => void
  /** przejście do zlecenia w zakładce kategorii (tylko gdy użytkownik ma te zakładki) */
  onOpenOrder?: (o: Order) => void
  /** podgląd ekranu bez logowania (dane podane z zewnątrz zamiast pobierania z bazy) — sprawdzanie układu w przeglądarce dev */
  podglad?: CrmZamowieniaPanel
}

type Filtr = 'wszystkie' | 'uwaga' | 'brak' | 'prod' | 'gotowe' | 'list' | 'wyslane' | 'reklamacja' | 'bez_produkcji' | 'anulowane'

type Wiersz = {
  z: ZamowienieSklep
  zlecenia: Array<{ o: Order; powiazanie: Powiazanie['powiazanie'] }>
  reklamacje: ReklamacjaKr[]
  stan: StanZamowienia
  status: string | null
  uwagi: string[]
  termin: string
  wysylka: StanWysylki
}

const fmtPln = (v: number | null | undefined): string =>
  v == null ? '—' : new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 }).format(Number(v))
const fmtDateTime = (iso: string | null | undefined): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}
const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const FILTRY: Array<{ id: Filtr; label: string }> = [
  { id: 'wszystkie', label: 'Wszystkie' },
  { id: 'uwaga', label: 'Wymagają uwagi' },
  { id: 'brak', label: 'Brak zlecenia' },
  { id: 'prod', label: 'W produkcji' },
  { id: 'gotowe', label: 'Gotowe' },
  { id: 'list', label: 'Przygotowane do wysyłki' },
  { id: 'wyslane', label: 'Wysłane' },
  { id: 'reklamacja', label: 'Reklamacje' },
  { id: 'bez_produkcji', label: 'Bez produkcji' },
  { id: 'anulowane', label: 'Anulowane' },
]

function pasujeFiltr(w: Wiersz, f: Filtr): boolean {
  switch (f) {
    case 'wszystkie': return true
    case 'uwaga': return w.uwagi.length > 0
    case 'prod': return w.stan === 'prod' || w.stan === 'czesc'
    case 'list': return w.wysylka === 'list'
    default: return w.stan === f
  }
}

function zbuduj(panel: CrmZamowieniaPanel): { wiersze: Wiersz[]; sieroty: Order[] } {
  const statusy = new Map(panel.statusy.map((s) => [s.id, s.nazwa]))
  const zlecenia = new Map(panel.zlecenia.map((o) => [Number(o.id), o]))
  const poZam = new Map<number, Wiersz['zlecenia']>()
  const spiete = new Set<number>()
  for (const p of panel.powiazania) {
    const o = zlecenia.get(Number(p.order_id))
    if (!o) continue
    spiete.add(Number(o.id))
    const lista = poZam.get(Number(p.bl_id)) ?? []
    lista.push({ o, powiazanie: p.powiazanie })
    poZam.set(Number(p.bl_id), lista)
  }
  const reklPoZleceniu = new Map<number, ReklamacjaKr[]>()
  for (const r of panel.reklamacje) {
    if (r.order_id == null) continue
    const l = reklPoZleceniu.get(Number(r.order_id)) ?? []
    l.push(r)
    reklPoZleceniu.set(Number(r.order_id), l)
  }
  const teraz = Date.now()
  const wiersze = panel.zamowienia.map((z): Wiersz => {
    const zl = (poZam.get(Number(z.bl_id)) ?? []).sort((a, b) => String(a.o.category).localeCompare(String(b.o.category)) || Number(a.o.id) - Number(b.o.id))
    const orders = zl.map((x) => x.o)
    const rekl = orders.flatMap((o) => reklPoZleceniu.get(Number(o.id)) ?? [])
    const status = z.status_id != null ? statusy.get(z.status_id) ?? `status ${z.status_id}` : null
    const stan = stanZamowienia(z, orders, rekl.filter((r) => !r.release_date).length, status)
    return { z, zlecenia: zl, reklamacje: rekl, stan, status, uwagi: uwagiZamowienia(z, orders, stan, status, teraz), termin: terminWysylki(z) ?? terminZamowienia(orders), wysylka: stanWysylki(z) }
  })
  // otwarte zlecenia Po Drzwi bez pary (bez numeru BL albo z numerem, którego nie ma w Baselinkerze);
  // przed pierwszym pobraniem z BL lista byłaby pełna fałszywych alarmów, więc wtedy pusta
  const sieroty = panel.zamowienia.length === 0 ? [] : panel.zlecenia.filter((o) => !spiete.has(Number(o.id)) && !o.release_date && !parseOrderExtraFields(o.extra_fields).cancelled)
    .sort((a, b) => String(a.order_date ?? '').localeCompare(String(b.order_date ?? '')))
  return { wiersze, sieroty }
}

function PasekEtapow({ o }: { o: Order }) {
  const c = countCompletedStages(o)
  if (c.total === 0) return null
  return (
    <span className="crm-zam-bar" title={`${c.completed}/${c.total} etapów`}>
      {c.stages.map((s) => <i key={s.key} className={s.done ? 'crm-zam-bar-d' : ''} />)}
    </span>
  )
}

function ChipZlecenia({ o }: { o: Order }) {
  const s = stanZlecenia(o)
  return (
    <span className={`crm-zam-kr${s === 'anulowane' ? ' crm-zam-kr--anul' : ''}`} title={`${o.category} ${o.order_number} · ${o.model ?? ''}${o.erp_ro_number ? ` · RO ${o.erp_ro_number}` : ''}`}>
      <b>{o.category}</b> {o.order_number} <PasekEtapow o={o} />
      {s === 'wyslane' ? ' 🚚' : s === 'gotowe' ? ' ✓' : ''}
    </span>
  )
}

export default function CrmZamowieniaScreen({ pushToast, onOpenLead, onOpenOrder, podglad }: Props) {
  const [panel, setPanel] = useState<CrmZamowieniaPanel | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<CrmError | null>(null)
  const [filtr, setFiltr] = useState<Filtr>('wszystkie')
  const [szukaj, setSzukaj] = useState('')
  const [otwarte, setOtwarte] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [sierotaDoPowiazania, setSierotaDoPowiazania] = useState<Order | null>(null)

  const load = useCallback(async (cicho = false) => {
    if (!cicho) setLoading(true)
    const { data, error: e } = podglad ? { data: podglad, error: null } : await fetchZamowieniaPanel()
    setPanel(data)
    setError(e)
    setLoading(false)
  }, [podglad])
  useEffect(() => { void load() }, [load])
  useOnCrmReshow(() => void load(true))

  const { wiersze, sieroty } = useMemo(() => (panel ? zbuduj(panel) : { wiersze: [], sieroty: [] }), [panel])
  const liczniki = useMemo(() => {
    const m: Record<Filtr, number> = { wszystkie: 0, uwaga: 0, brak: 0, prod: 0, gotowe: 0, list: 0, wyslane: 0, reklamacja: 0, bez_produkcji: 0, anulowane: 0 }
    for (const w of wiersze) for (const f of FILTRY) if (pasujeFiltr(w, f.id)) m[f.id]++
    return m
  }, [wiersze])
  const widoczne = useMemo(() => {
    const q = szukaj.trim().toLowerCase()
    return wiersze.filter((w) => {
      if (!pasujeFiltr(w, filtr)) return false
      if (!q) return true
      const hay = [
        w.z.bl_id, w.z.shop_order_id, w.z.klient, w.z.firma, w.z.email, w.z.telefon, w.z.miasto,
        ...w.zlecenia.flatMap(({ o }) => [o.order_number, o.erp_ro_number, o.client_order_number]),
      ].filter(Boolean).join(' ').toLowerCase()
      return hay.includes(q) || hay.replace(/\s/g, '').includes(q.replace(/\s/g, ''))
    })
  }, [wiersze, filtr, szukaj])

  const ust = panel?.ustawienia ?? {}
  const tokenOk = ust.bl_token_ustawiony === 'true'
  const wybrany = otwarte != null ? wiersze.find((w) => w.z.bl_id === otwarte) ?? null : null

  const odswiez = async (blId?: number) => {
    setBusy(true)
    const e = await odswiezZamowieniaBl(blId)
    if (e) { pushToast(`Nie udało się odświeżyć: ${e.message}`, 'error'); setBusy(false); return }
    pushToast(blId ? `Pobieram zamówienie ${blId} z Baselinkera…` : 'Pobieram zamówienia z Baselinkera…', 'info')
    // funkcja działa w tle (pg_net): po kilku sekundach przeładuj listę
    window.setTimeout(() => { void load(true).then(() => setBusy(false)) }, blId ? 4000 : 9000)
  }

  const otworzKlienta = async (z: ZamowienieSklep) => {
    setBusy(true)
    const { data, error: e } = await klientZamowieniaSklep(z.bl_id)
    setBusy(false)
    if (e || !data) { pushToast(`Nie udało się otworzyć klienta: ${e?.message ?? '?'}`, 'error'); return }
    onOpenLead(data)
  }

  const powiaz = async (blId: number, o: Order) => {
    setBusy(true)
    const e = await powiazZlecenie(blId, Number(o.id))
    setBusy(false)
    if (e) { pushToast(`Nie udało się powiązać: ${e.message}`, 'error'); return }
    pushToast(`Zlecenie ${o.category} ${o.order_number} spięte z zamówieniem ${blId}`, 'success')
    setSierotaDoPowiazania(null)
    void load(true)
  }

  const odepnij = async (blId: number, o: Order, powiazanie: Powiazanie['powiazanie']) => {
    const ok = await appConfirm(
      `Zlecenie ${o.category} ${o.order_number} przestanie być pokazywane przy zamówieniu ${blId}. Samo zlecenie się nie zmienia.`,
      { title: 'Odpiąć zlecenie?', confirmLabel: 'Odepnij', tone: 'danger' },
    )
    if (!ok) return
    setBusy(true)
    const e = await odepnijZlecenie(blId, Number(o.id), powiazanie)
    setBusy(false)
    if (e) { pushToast(`Nie udało się odpiąć: ${e.message}`, 'error'); return }
    void load(true)
  }

  const kolumny = useMemo<DataTableColumn<Wiersz>[]>(() => [
    {
      key: 'nr', label: 'Zamówienie', sortValue: (w) => w.z.data_zlozenia ?? '',
      render: (w) => (
        <span className="crm-zam-nr">
          <b>{w.z.bl_id}</b>
          <span className="crm-muted">{fmtDateTime(w.z.data_zlozenia)}</span>
          {w.uwagi.length > 0 && <span className="crm-zam-uwaga-txt" title={w.uwagi.join('\n')}>⚠ {w.uwagi[0]}{w.uwagi.length > 1 ? ` (+${w.uwagi.length - 1})` : ''}</span>}
        </span>
      ),
    },
    {
      key: 'klient', label: 'Klient', sortValue: (w) => w.z.klient ?? '',
      render: (w) => (<span className="crm-zam-nr">{w.z.klient || w.z.firma || '—'}<span className="crm-muted">{[w.z.miasto, w.z.dostawa_metoda].filter(Boolean).join(' · ')}</span></span>),
    },
    {
      key: 'co', label: 'Co zamówił',
      render: (w) => (
        <span className="crm-zam-pozycje">
          {w.z.pozycje.slice(0, 3).map((p, i) => <span key={i} title={p.atrybuty ?? undefined}>{p.nazwa}{p.ilosc > 1 ? ` ×${p.ilosc}` : ''}</span>)}
          {w.z.pozycje.length > 3 && <span className="crm-muted">+{w.z.pozycje.length - 3} poz.</span>}
        </span>
      ),
    },
    {
      key: 'kwota', label: 'Kwota', align: 'right', sortValue: (w) => w.z.kwota ?? 0,
      render: (w) => (<span className="crm-zam-nr">{fmtPln(w.z.kwota)}{!w.z.pobranie && (w.z.oplacone ?? 0) + 0.5 < (w.z.kwota ?? 0) && <span className="crm-text-bad">{(w.z.oplacone ?? 0) > 0 ? `wpłacono ${fmtPln(w.z.oplacone)}` : 'nieopłacone'}</span>}{w.z.pobranie && <span className="crm-muted">pobranie</span>}</span>),
    },
    { key: 'bl', label: 'Status w sklepie', sortValue: (w) => w.status ?? '', render: (w) => (w.status ? <span className="crm-status crm-status--muted">{w.status}</span> : '—') },
    {
      key: 'stan', label: 'Produkcja', sortValue: (w) => w.stan,
      render: (w) => { const s = STAN_ZAMOWIENIA[w.stan]; return <span className={`crm-status ${s.cls}`} title={s.title}>{s.label}</span> },
    },
    {
      key: 'kr', label: 'Zlecenia KR',
      render: (w) => (w.zlecenia.length ? <span className="crm-zam-krs">{w.zlecenia.map(({ o }) => <ChipZlecenia key={o.id} o={o} />)}</span> : <span className="crm-muted">—</span>),
    },
    {
      key: 'wysylka', label: 'Wysyłka', sortValue: (w) => w.wysylka,
      render: (w) => { const s = STAN_WYSYLKI[w.wysylka]; return w.wysylka === 'brak' ? <span className="crm-muted">—</span> : <span className={`crm-status ${s.cls}`} title={`${s.title}${w.z.paczka_nr ? ` · ${w.z.paczka_nr}` : ''}`}>{s.label}</span> },
    },
    { key: 'termin', label: 'Termin', sortValue: (w) => w.termin, render: (w) => w.termin },
  ], [])

  if (loading && !panel) return <div className="crm-screen"><Spinner /></div>
  if (error) return <div className="crm-screen"><section><p className="crm-text-bad">{error.message}</p></section></div>

  const uwagiLista = wiersze.filter((w) => w.uwagi.length > 0)
  return (
    <div className="crm-screen crm-zam">
      {!tokenOk && (
        <section className="crm-zam-alert">
          Synchronizacja z Baselinkerem czeka na token API. Właściciel wpisuje go w <b>Ustawienia → Baselinker</b>; zamówienia pojawią się po pierwszym pobraniu.
        </section>
      )}
      {tokenOk && ust.bl_sync_ostatni_blad && (
        <section className="crm-zam-alert crm-zam-alert--bad">Ostatnie pobranie z Baselinkera nie wyszło: {ust.bl_sync_ostatni_blad}</section>
      )}

      <div className="crm-toolbar">
        <div className="crm-chipy" role="tablist" aria-label="Filtr zamówień">
          {FILTRY.map((f) => (
            <button key={f.id} type="button" role="tab" aria-selected={filtr === f.id} className={`crm-chip${filtr === f.id ? ' crm-chip--on' : ''}`} onClick={() => setFiltr(f.id)}>
              {f.label} <span className="crm-chip-n">{liczniki[f.id]}</span>
            </button>
          ))}
        </div>
        <input type="search" className="crm-zam-szukaj" placeholder="Szukaj: nr BL, nazwisko, mail, telefon, nr zlecenia KR, RO…" value={szukaj} onChange={(e) => setSzukaj(e.target.value)} aria-label="Szukaj zamówienia" />
        <button type="button" className="btn btn-sm btn-secondary" disabled={busy || !tokenOk} onClick={() => void odswiez()} title="Pobierz zamówienia z Baselinkera teraz (automat robi to co 15 min)">
          {busy ? <Spinner inline size={14} /> : null} Odśwież z Baselinkera
        </button>
        <span className="crm-toolbar-hint">
          {ust.bl_sync_ostatni_at ? `pobrane ${fmtDateTime(ust.bl_sync_ostatni_at)}` : 'jeszcze nie pobierano'}
          {ust.bl_sync_od ? ` · zamówienia od ${fmtDate(ust.bl_sync_od)}` : ''}
        </span>
      </div>

      {/* 25.11 (Tymek: „lista ostrzegawcza z dupy, nie widać zamówień”): jeden pasek zamiast listy — powody są w wierszach
          (filtr „Wymagają uwagi”), zlecenia KR bez pary zwinięte */}
      {(uwagiLista.length > 0 || sieroty.length > 0) && (
        <div className="crm-zam-uwagi-bar">
          {uwagiLista.length > 0 && (
            <button type="button" className={`crm-chip crm-zam-uwagi-chip${filtr === 'uwaga' ? ' crm-chip--on' : ''}`} onClick={() => setFiltr(filtr === 'uwaga' ? 'wszystkie' : 'uwaga')} title="Pokaż tylko zamówienia z uwagą (powód w wierszu)">
              ⚠ {uwagiLista.length} {uwagiLista.length === 1 ? 'zamówienie wymaga' : uwagiLista.length < 5 ? 'zamówienia wymagają' : 'zamówień wymaga'} uwagi
            </button>
          )}
          {sieroty.length > 0 && (
            <details className="crm-zam-sieroty">
              <summary>{sieroty.length} otwartych zleceń KR Po Drzwi bez pary w sklepie</summary>
              <ul>
            {sieroty.map((o) => (
              <li key={`o${o.id}`}>
                zlecenie KR <b>{o.category} {o.order_number}</b> „{o.client_order_number || 'bez numeru klienta'}” ({fmtDate(o.order_date)}){' '}
                {/^\s*\d{8}(\D|$)/.test(o.client_order_number ?? '')
                  ? 'otwarte, a jego zamówienia nie ma w Baselinkerze (archiwum BL albo zlecenie do zamknięcia)'
                  : 'nie ma pary w zamówieniach sklepu'} ·{' '}
                <button type="button" className="crm-link" onClick={() => setSierotaDoPowiazania(o)}>powiąż</button>
                {onOpenOrder && <> · <button type="button" className="crm-link" onClick={() => onOpenOrder(o)}>otwórz zlecenie</button></>}
              </li>
            ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <DataTable
        rows={widoczne}
        rowKey={(w) => w.z.bl_id}
        columns={kolumny}
        className="crm-table"
        defaultSort={{ key: 'nr', dir: 'desc' }}
        onRowClick={(w) => setOtwarte(w.z.bl_id)}
        rowClassName={(w) => `crm-row--clickable${w.z.bl_id === otwarte ? ' crm-zam-row--on' : ''}`}
        emptyText={tokenOk ? 'Nic nie pasuje do filtra.' : 'Brak zamówień — synchronizacja czeka na token Baselinkera.'}
      />

      {wybrany && (
        <KartaZamowienia
          w={wybrany}
          pola={ust.bl_pola_dodatkowe}
          busy={busy}
          onClose={() => setOtwarte(null)}
          onOdswiez={() => void odswiez(wybrany.z.bl_id)}
          onKlient={() => void otworzKlienta(wybrany.z)}
          onPowiaz={(o) => void powiaz(wybrany.z.bl_id, o)}
          onOdepnij={(o, p) => void odepnij(wybrany.z.bl_id, o, p)}
          onOpenOrder={onOpenOrder}
        />
      )}
      {sierotaDoPowiazania && (
        <PowiazSierote
          o={sierotaDoPowiazania}
          wiersze={wiersze}
          busy={busy}
          onClose={() => setSierotaDoPowiazania(null)}
          onPowiaz={(blId) => void powiaz(blId, sierotaDoPowiazania)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------- karta zamówienia

function KartaZamowienia({ w, pola, busy, onClose, onOdswiez, onKlient, onPowiaz, onOdepnij, onOpenOrder }: {
  w: Wiersz
  pola: string | undefined
  busy: boolean
  onClose: () => void
  onOdswiez: () => void
  onKlient: () => void
  onPowiaz: (o: Order) => void
  onOdepnij: (o: Order, p: Powiazanie['powiazanie']) => void
  onOpenOrder?: (o: Order) => void
}) {
  const { z } = w
  const s = STAN_ZAMOWIENIA[w.stan]
  const [fraza, setFraza] = useState('')
  const [wyniki, setWyniki] = useState<Order[]>([])
  const [szukam, setSzukam] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const nazwyPol = useMemo<Record<string, string>>(() => { try { return pola ? JSON.parse(pola) : {} } catch { return {} } }, [pola])
  const polaDod = Object.entries(z.pola_dodatkowe ?? {}).filter(([, v]) => v != null && v !== '')
  const spiete = new Set(w.zlecenia.map(({ o }) => Number(o.id)))

  const szukajZlecen = async () => {
    setSzukam(true)
    const { data } = await szukajZlecenPoDrzwi(fraza)
    setWyniki(data.filter((o) => !spiete.has(Number(o.id))))
    setSzukam(false)
  }

  return (
    <div className="crm-zam-drawer" role="dialog" aria-modal="true" aria-label={`Zamówienie ${z.bl_id}`}>
      <div className="crm-zam-drawer-bd" onClick={onClose} />
      <div className="crm-zam-drawer-panel">
        <div className="crm-zam-drawer-head">
          <div>
            <h3>Zamówienie {z.bl_id} · {z.klient || z.firma || '—'}</h3>
            <div className="crm-muted">
              złożone {fmtDateTime(z.data_zlozenia)}{z.shop_order_id ? ` · sklep #${z.shop_order_id}` : ''} ·{' '}
              {w.status && <span className="crm-status crm-status--muted">sklep: {w.status}</span>}{' '}
              <span className={`crm-status ${s.cls}`}>{s.label}</span>
            </div>
          </div>
          <button type="button" className="btn btn-sm btn-secondary" onClick={onClose} aria-label="Zamknij">Zamknij</button>
        </div>

        <div className="crm-zam-akcje">
          <button type="button" className="btn btn-sm btn-secondary" disabled={busy} onClick={onOdswiez}>Odśwież z Baselinkera</button>
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => void openExternalUrl(BL_PANEL_URL(z.bl_id))}>Otwórz w Baselinkerze</button>
          {z.strona_klienta && <button type="button" className="btn btn-sm btn-secondary" onClick={() => void openExternalUrl(z.strona_klienta!)} title="Strona zamówienia, którą widzi klient">Strona klienta</button>}
          <button type="button" className="btn btn-sm btn-secondary" disabled={busy} onClick={onKlient} title={z.lead_id ? 'Klient jest już w CRM' : 'Znajdzie klienta po telefonie / mailu albo założy nowego (wygrany)'}>Klient w CRM</button>
        </div>

        {w.uwagi.length > 0 && <div className="crm-zam-alert">{w.uwagi.map((u, i) => <div key={i}>⚠ {u}</div>)}</div>}

        <section className="crm-k2-card">
          <h4>Klient i dostawa</h4>
          <dl className="crm-zam-kv">
            <dt>Telefon</dt><dd>{z.telefon || '—'}</dd>
            <dt>E-mail</dt><dd>{z.email || '—'}</dd>
            {z.firma && <><dt>Firma</dt><dd>{z.firma}</dd></>}
            <dt>Dostawa</dt><dd>{z.dostawa_metoda || '—'}{z.dostawa_cena ? ` (${fmtPln(z.dostawa_cena)})` : ''}</dd>
            <dt>Adres</dt><dd>{[z.adres, [z.kod, z.miasto].filter(Boolean).join(' ')].filter(Boolean).join(', ') || '—'}</dd>
            {z.punkt_odbioru && <><dt>Punkt</dt><dd>{z.punkt_odbioru}</dd></>}
            <dt>Płatność</dt><dd>{z.platnosc_metoda || '—'} · {z.pobranie ? 'pobranie' : `wpłacono ${fmtPln(z.oplacone)}`} z {fmtPln(z.kwota)}</dd>
            {z.uwagi_klienta && <><dt>Uwagi klienta</dt><dd>{z.uwagi_klienta}</dd></>}
            {z.uwagi_sklepu && <><dt>Uwagi sklepu</dt><dd>{z.uwagi_sklepu}</dd></>}
            {polaDod.map(([k, v]) => (
              <span key={k} className="crm-zam-kv-row">
                <dt>{nazwyPol[k] ?? `pole ${k}`}</dt>
                <dd>{typeof v === 'object' && v && 'url' in (v as Record<string, unknown>)
                  ? <button type="button" className="crm-link" onClick={() => void openExternalUrl(String((v as { url: string }).url))}>{String((v as { title?: string }).title ?? 'plik')}</button>
                  : String(v)}</dd>
              </span>
            ))}
          </dl>
        </section>

        <section className="crm-k2-card">
          <h4>Co zamówił</h4>
          {z.pozycje.length === 0 ? <p className="crm-muted">Brak pozycji.</p> : (
            <ul className="crm-zam-poz">
              {z.pozycje.map((p, i) => (
                <li key={i}>
                  <span>{p.nazwa}{p.atrybuty && <span className="crm-muted crm-zam-attr">{p.atrybuty}</span>}</span>
                  <span className="crm-zam-poz-k">×{p.ilosc} · {fmtPln(p.cena)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="crm-k2-card">
          <h4>Zlecenia KR Center ({w.zlecenia.length})</h4>
          {w.zlecenia.length === 0 && (
            <p className="crm-muted">{w.stan === 'brak'
              ? 'Nie ma jeszcze zlecenia. Automat „BL → API KR” zakłada je kilka minut po statusie „Wysłane na produkcję”; jeśli zlecenie powstało ręcznie (bez numeru BL), powiąż je niżej.'
              : 'Zamówienie bez zlecenia KR.'}</p>
          )}
          {w.zlecenia.map(({ o, powiazanie }) => {
            const c = countCompletedStages(o)
            const st = stanZlecenia(o)
            return (
              <div key={o.id} className="crm-zam-krcard">
                <div className="crm-zam-krcard-top">
                  <ChipZlecenia o={o} />
                  <span className="crm-muted">{o.model}{o.erp_ro_number ? ` · RO ${o.erp_ro_number}` : ''}{powiazanie === 'reczne' ? ' · powiązane ręcznie' : ''}</span>
                  <span className="crm-zam-krcard-btns">
                    {onOpenOrder && <button type="button" className="crm-link" onClick={() => onOpenOrder(o)}>otwórz zlecenie</button>}
                    <button type="button" className="crm-link" disabled={busy} onClick={() => onOdepnij(o, powiazanie)} title="Odepnij od tego zamówienia">Odepnij</button>
                  </span>
                </div>
                <div className="crm-muted">
                  {st === 'anulowane' ? 'anulowane'
                    : st === 'wyslane' ? `wyjechało ${fmtDate(o.shipped_at)}${o.shipped_route ? ` (${o.shipped_route})` : ''}`
                    : o.release_date ? `wydane z produkcji ${fmtDate(o.release_date)}`
                    : `w produkcji${o.production_day ? ` · ${o.production_day}` : ''}${c.total ? ` · etapy ${c.completed}/${c.total}` : ''}`}
                </div>
                {c.stages.length > 0 && (
                  <div className="crm-zam-etapy">
                    {c.stages.map((e) => <span key={e.key} className={`crm-zam-etap${e.done ? ' crm-zam-etap--d' : ''}`} title={e.title || e.header}>{e.header}</span>)}
                  </div>
                )}
              </div>
            )
          })}
          <div className="crm-zam-powiaz">
            <input type="search" placeholder="Powiąż zlecenie: nr zlecenia albo nazwisko z nr klienta" value={fraza} onChange={(e) => setFraza(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void szukajZlecen() }} />
            <button type="button" className="btn btn-sm btn-secondary" disabled={szukam || fraza.trim().length < 2} onClick={() => void szukajZlecen()}>{szukam ? <Spinner inline size={14} /> : null} Szukaj</button>
          </div>
          {wyniki.length > 0 && (
            <ul className="crm-zam-wyniki">
              {wyniki.map((o) => (
                <li key={o.id}>
                  <ChipZlecenia o={o} /> <span className="crm-muted">{o.client_order_number || '—'} · {fmtDate(o.order_date)}</span>
                  <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => { onPowiaz(o); setWyniki([]); setFraza('') }}>Powiąż</button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {(w.wysylka !== 'brak' || (z.paczki ?? []).length > 0) && (
          <section className="crm-k2-card">
            <h4>Przesyłki <span className={`crm-status ${STAN_WYSYLKI[w.wysylka].cls}`}>{STAN_WYSYLKI[w.wysylka].label}</span></h4>
            {(z.paczki ?? []).length === 0 ? (
              <p className="crm-muted">List {z.paczka_nr} wygenerowany w Baselinkerze; status kuriera pojawi się przy następnym sprawdzeniu (co godzinę).</p>
            ) : (
              <ul className="crm-zam-poz">
                {(z.paczki ?? []).map((p, i) => (
                  <li key={i}>
                    <span><b>{p.nr || '—'}</b> <span className="crm-muted">{p.kurier ?? ''}{p.zwrot ? ' · zwrot' : ''}</span></span>
                    <span className="crm-zam-poz-k">{BL_STATUS_PACZKI[Number(p.status)] ?? `status ${p.status}`}{p.status_at ? ` · ${fmtDateTime(p.status_at)}` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {w.reklamacje.length > 0 && (
          <section className="crm-k2-card">
            <h4>Reklamacje ({w.reklamacje.length})</h4>
            <ul className="crm-zam-poz">
              {w.reklamacje.map((r) => (
                <li key={r.id}>
                  <span><b>{r.complaint_number || `RK ${r.id}`}</b> · {r.what_complained || '—'}{r.reason && <span className="crm-muted crm-zam-attr">{r.reason}</span>}</span>
                  <span className="crm-zam-poz-k">{r.release_date ? `naprawa wydana ${r.release_date}` : 'w naprawie'}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        <p className="crm-muted crm-zam-stopka">Dane z Baselinkera pobrane {fmtDateTime(z.synced_at)}. Zmiana statusu w sklepie, mail do klienta i zgłoszenie reklamacji z tej karty: etap 2.</p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- zlecenie bez pary → zamówienie

function PowiazSierote({ o, wiersze, busy, onClose, onPowiaz }: { o: Order; wiersze: Wiersz[]; busy: boolean; onClose: () => void; onPowiaz: (blId: number) => void }) {
  const [q, setQ] = useState('')
  const slowa = useMemo(() => slowaNazwiska(o.client_order_number), [o.client_order_number])
  const kandydaci = useMemo(() => {
    const f = q.trim().toLowerCase()
    return wiersze
      .filter((w) => (f ? [w.z.bl_id, w.z.klient, w.z.firma, w.z.email, w.z.telefon].filter(Boolean).join(' ').toLowerCase().includes(f) : pasujeDoKlienta(w.z, slowa)))
      .slice(0, 15)
  }, [wiersze, q, slowa])
  return (
    <div className="crm-zam-drawer" role="dialog" aria-modal="true" aria-label="Powiąż zlecenie z zamówieniem">
      <div className="crm-zam-drawer-bd" onClick={onClose} />
      <div className="crm-zam-drawer-panel crm-zam-drawer-panel--waski">
        <div className="crm-zam-drawer-head">
          <div><h3>Powiąż {o.category} {o.order_number}</h3><div className="crm-muted">nr klienta „{o.client_order_number || '—'}” · {o.model} · {fmtDate(o.order_date)}</div></div>
          <button type="button" className="btn btn-sm btn-secondary" onClick={onClose} aria-label="Zamknij">Zamknij</button>
        </div>
        <input type="search" className="crm-zam-szukaj" placeholder="Szukaj zamówienia: nr BL, nazwisko, mail, telefon" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <p className="crm-muted">{q ? 'Wyniki szukania' : slowa.length ? `Podpowiedzi po nazwisku: ${slowa.join(', ')}` : 'Brak nazwiska w numerze klienta — wpisz, czego szukać.'}</p>
        {kandydaci.length === 0 ? <p className="crm-muted">Nic nie pasuje.</p> : (
          <ul className="crm-zam-wyniki">
            {kandydaci.map((w) => (
              <li key={w.z.bl_id}>
                <span><b>{w.z.bl_id}</b> {w.z.klient} <span className="crm-muted">{fmtDate(w.z.data_zlozenia)} · {fmtPln(w.z.kwota)}</span></span>
                <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => onPowiaz(w.z.bl_id)}>Powiąż</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
