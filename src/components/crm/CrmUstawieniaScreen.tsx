// =====================================================================
// CRM Po Drzwi → „Ustawienia” (tylko tryb pełny = superadmin), brief pkt 16–17:
//  • Zasady ofert (crm.zasady): co system przyjmuje domyślnie (dobór) i jak pisze mail;
//    jedna zasada = jedno zdanie, trafia wprost do promptów AI.
//  • Alerty (crm.ustawienia): adresy, skrzynka SMTP, port, „Wyślij mail próbny”
//    (crm-mail-sent akcja test_alertu), stan ostatniego alertu.
//  • Poprawki (widok crm.poprawki_ostatnie, 30 dni): tylko odczyt — co Magda poprawia,
//    właściciel zamienia to w zasadę.
// =====================================================================
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Save, X, Pencil, Trash2, RefreshCw, Send, ArrowUp, ArrowDown } from 'lucide-react'
import type { CurrentUser, ToastVariant } from '../../types'
import { CRM_ALERT_KEYS, CRM_DZIEN_WOLNY_RODZAJ, CRM_FIRMA_KEYS, CRM_LOGO_PATH, CRM_UST_SZKIC_HANDLOWIEC, CRM_ZASADA_GRUPA, licznikLabel, type CrmDzienWolny, type CrmLicznik, type CrmPoprawkaRow, type CrmSkrzynka, type CrmUstawienie, type CrmZasada } from '../../types/crm'
import {
  addDzienWolny,
  addZasada,
  deleteDzienWolny,
  deleteZasada,
  fetchCrmUserIds,
  fetchDniWolne,
  fetchLiczniki,
  fetchPoprawkiOstatnie,
  fetchProfileNames,
  fetchSkrzynki,
  fetchUstawienia,
  fetchZasady,
  saveLicznik,
  saveUstawienia,
  signedUrlDokument,
  testAlert,
  updateZasada,
  uploadLogo,
  type CrmError,
} from '../../hooks/useCrm'
import { openExternalUrl } from '../../hooks/useAluOrders'
import { invalidateDniWolne } from '../../hooks/useDniWolne'
import { appConfirm } from '../../lib/appDialogs'
import Spinner from '../Spinner'

type Props = {
  currentUser: CurrentUser | null
  pushToast: (message: string, variant: ToastVariant) => void
  onOpenOferta: (id: string) => void
  onOpenLead: (id: string) => void
}

type Tab = 'zasady' | 'alerty' | 'poprawki' | 'firma' | 'dni_wolne'

const fmtDateTime = (iso: string | null | undefined): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const asStrings = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).filter(Boolean) : []

// ---------------------------------------------------------------- Zasady ofert

function ZasadySection({ currentUser, pushToast }: Pick<Props, 'currentUser' | 'pushToast'>) {
  const [lista, setLista] = useState<CrmZasada[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<CrmError | null>(null)
  const [busy, setBusy] = useState(false)
  const [edit, setEdit] = useState<{ id: string | null; grupa: string; tresc: string } | null>(null)

  const load = useCallback(async () => {
    const r = await fetchZasady()
    setError(r.error)
    if (!r.error) setLista(r.data)
    setLoading(false)
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const grupy = useMemo(() => Object.keys(CRM_ZASADA_GRUPA), [])

  const run = async (fn: () => Promise<CrmError | null>, okMsg: string) => {
    setBusy(true)
    const err = await fn()
    setBusy(false)
    if (err) {
      pushToast(err.message, 'error')
      return false
    }
    pushToast(okMsg, 'success')
    await load()
    return true
  }

  const onSave = async () => {
    if (!edit || !currentUser) return
    const tresc = edit.tresc.trim()
    if (!tresc) {
      pushToast('Wpisz treść zasady', 'error')
      return
    }
    const ok = edit.id
      ? await run(() => updateZasada(edit.id as string, { tresc }, currentUser.id), 'Zasada zapisana')
      : await run(
          () => addZasada(edit.grupa, tresc, (Math.max(0, ...lista.filter((z) => z.grupa === edit.grupa).map((z) => z.kolejnosc)) || 0) + 10, currentUser.id),
          'Zasada dodana',
        )
    if (ok) setEdit(null)
  }

  const move = async (z: CrmZasada, dir: -1 | 1) => {
    if (!currentUser) return
    const same = lista.filter((x) => x.grupa === z.grupa)
    const i = same.findIndex((x) => x.id === z.id)
    const j = i + dir
    if (j < 0 || j >= same.length) return
    const other = same[j]
    // zamiana kolejności; przy równych wartościach przesuwamy tylko tę jedną o 1 w stronę ruchu
    const equal = z.kolejnosc === other.kolejnosc
    const zNew = equal ? other.kolejnosc + dir : other.kolejnosc
    const otherNew = equal ? other.kolejnosc : z.kolejnosc
    setBusy(true)
    const e1 = await updateZasada(z.id, { kolejnosc: zNew }, currentUser.id)
    const e2 = e1 || equal ? null : await updateZasada(other.id, { kolejnosc: otherNew }, currentUser.id)
    setBusy(false)
    if (e1 || e2) pushToast((e1 ?? e2)?.message ?? 'Błąd', 'error')
    await load()
  }

  const onDelete = async (z: CrmZasada) => {
    if (!(await appConfirm(`Usunąć zasadę: „${z.tresc}”? Zwykle lepiej ją wyłączyć — zostanie w historii.`, { title: 'Usuń zasadę', confirmLabel: 'Usuń' }))) return
    await run(() => deleteZasada(z.id), 'Zasada usunięta')
  }

  if (loading) return <Spinner center label="Ładowanie zasad…" />
  if (error) return <div className="crm-box crm-box--bad">{error.message}</div>

  return (
    <div className="crm-ust-section">
      <p className="crm-muted crm-ust-intro">
        Gdy klient czegoś nie ustalił, system przyjmuje te zasady, pisze o tym w mailu („przyjęłam…, jeśli ma być inaczej, proszę o sygnał”) i nie wrzuca tego na listę
        „sprawdź tylko to”. Jedna zasada = jedno jasne zdanie; tekst idzie wprost do AI. Wyłączona zasada nie działa, ale zostaje.
      </p>
      {grupy.map((g) => {
        const items = lista.filter((z) => z.grupa === g)
        return (
          <section key={g} className="crm-box crm-ust-group">
            <div className="crm-screen-head">
              <div className="crm-screen-title">
                <h4>{CRM_ZASADA_GRUPA[g].label} ({items.filter((z) => z.aktywna).length}/{items.length})</h4>
                <div className="crm-screen-sub">{CRM_ZASADA_GRUPA[g].hint}</div>
              </div>
              <button type="button" className="btn btn-sm btn-secondary" disabled={busy || !!edit} onClick={() => setEdit({ id: null, grupa: g, tresc: '' })}>
                <Plus size={14} /> Dodaj zasadę
              </button>
            </div>
            {edit && edit.grupa === g && edit.id === null && (
              <ZasadaEditor value={edit.tresc} onChange={(t) => setEdit({ ...edit, tresc: t })} onSave={() => void onSave()} onCancel={() => setEdit(null)} busy={busy} />
            )}
            {items.length === 0 && !edit && <p className="crm-muted">Brak zasad w tej grupie.</p>}
            <ol className="crm-zasady">
              {items.map((z, i) => (
                <li key={z.id} className={`crm-zasada${z.aktywna ? '' : ' crm-zasada--off'}`}>
                  {edit && edit.id === z.id ? (
                    <ZasadaEditor value={edit.tresc} onChange={(t) => setEdit({ ...edit, tresc: t })} onSave={() => void onSave()} onCancel={() => setEdit(null)} busy={busy} />
                  ) : (
                    <>
                      <label className="crm-zasada-toggle" title={z.aktywna ? 'Wyłącz zasadę' : 'Włącz zasadę'}>
                        <input type="checkbox" checked={z.aktywna} disabled={busy} onChange={() => currentUser && void run(() => updateZasada(z.id, { aktywna: !z.aktywna }, currentUser.id), z.aktywna ? 'Zasada wyłączona' : 'Zasada włączona')} />
                      </label>
                      <span className="crm-zasada-text">{z.tresc}</span>
                      <span className="crm-zasada-btns">
                        <button type="button" className="crm-link" disabled={busy || i === 0} onClick={() => void move(z, -1)} title="Wyżej"><ArrowUp size={13} /></button>
                        <button type="button" className="crm-link" disabled={busy || i === items.length - 1} onClick={() => void move(z, 1)} title="Niżej"><ArrowDown size={13} /></button>
                        <button type="button" className="crm-link" disabled={busy || !!edit} onClick={() => setEdit({ id: z.id, grupa: z.grupa, tresc: z.tresc })} title="Edytuj"><Pencil size={13} /></button>
                        <button type="button" className="crm-link" disabled={busy} onClick={() => void onDelete(z)} title="Usuń"><Trash2 size={13} /></button>
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ol>
          </section>
        )
      })}
    </div>
  )
}

function ZasadaEditor({ value, onChange, onSave, onCancel, busy }: { value: string; onChange: (t: string) => void; onSave: () => void; onCancel: () => void; busy: boolean }) {
  return (
    <div className="crm-zasada-editor">
      <textarea className="crm-fix-textarea" rows={2} value={value} onChange={(e) => onChange(e.target.value)} placeholder="np. Kolor skrzydła nieustalony: przyjmij Antracyt gładki." autoFocus disabled={busy} />
      <div className="crm-poczta-actions">
        <button type="button" className="btn btn-sm btn-primary" onClick={onSave} disabled={busy}>{busy ? <Spinner inline size={14} /> : <Save size={14} />} Zapisz</button>
        <button type="button" className="btn btn-sm btn-secondary" onClick={onCancel} disabled={busy}><X size={14} /> Anuluj</button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- Alerty

function AlertySection({ pushToast }: Pick<Props, 'pushToast'>) {
  const [ust, setUst] = useState<CrmUstawienie[]>([])
  const [skrzynki, setSkrzynki] = useState<CrmSkrzynka[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<CrmError | null>(null)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ email: '', port: '465', skrzynka: '' })
  const [dirty, setDirty] = useState(false)
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null)

  const get = useCallback((rows: CrmUstawienie[], k: string) => rows.find((u) => u.klucz === k)?.wartosc ?? '', [])

  const load = useCallback(async () => {
    const [u, s] = await Promise.all([fetchUstawienia(), fetchSkrzynki()])
    setError(u.error)
    if (!u.error) {
      setUst(u.data)
      setForm({ email: get(u.data, CRM_ALERT_KEYS.email), port: get(u.data, CRM_ALERT_KEYS.port) || '465', skrzynka: get(u.data, CRM_ALERT_KEYS.skrzynka) })
      setDirty(false)
    }
    setSkrzynki(s.data)
    setLoading(false)
  }, [get])
  useEffect(() => {
    void load()
  }, [load])

  const onSave = async () => {
    setBusy(true)
    const err = await saveUstawienia({ [CRM_ALERT_KEYS.email]: form.email.trim(), [CRM_ALERT_KEYS.port]: form.port.trim(), [CRM_ALERT_KEYS.skrzynka]: form.skrzynka })
    setBusy(false)
    if (err) {
      pushToast(err.message, 'error')
      return
    }
    pushToast('Ustawienia alertów zapisane', 'success')
    await load()
  }

  const onTest = async () => {
    setBusy(true)
    setTest(null)
    try {
      const r = await testAlert()
      const do_ = Array.isArray(r.wyslano_do) ? r.wyslano_do.join(', ') : r.wyslano_do ?? ''
      setTest(r.ok ? { ok: true, text: `Mail próbny wysłany${do_ ? ` do: ${do_}` : ''}${r.temat ? ` · temat: „${r.temat}”` : ''}${r.smtp ? ` · ${r.smtp}` : ''}` } : { ok: false, text: r.blad ?? 'Nie udało się wysłać' })
    } catch (e) {
      setTest({ ok: false, text: e instanceof Error ? e.message : String(e) })
    }
    setBusy(false)
    await load()
  }

  if (loading) return <Spinner center label="Ładowanie ustawień…" />
  if (error) return <div className="crm-box crm-box--bad">{error.message}</div>

  const ostatniAt = get(ust, CRM_ALERT_KEYS.ostatniAt)
  const ostatniBlad = get(ust, CRM_ALERT_KEYS.ostatniBlad)

  return (
    <div className="crm-ust-section">
      <p className="crm-muted crm-ust-intro">
        System co 15 minut sprawdza nowe zdarzenia „błąd” (analiza rozmowy, liczenie oferty, poczta) i wysyła jeden mail zbiorczy na podane adresy, przez wybraną skrzynkę (SMTP tym samym
        hostem, loginem i hasłem co IMAP).
      </p>
      <section className="crm-box crm-pf">
        <div className="crm-pf-grid">
          <label className="crm-pf-field crm-pf-field--wide">
            <span className="crm-pf-label">Adresy alertów (po przecinku)</span>
            <input type="text" value={form.email} onChange={(e) => { setForm({ ...form, email: e.target.value }); setDirty(true) }} placeholder="wlasciciel@podrzwi.pl, drugi@podrzwi.pl" autoComplete="off" />
          </label>
          <label className="crm-pf-field">
            <span className="crm-pf-label">Skrzynka nadawcza</span>
            <select value={form.skrzynka} onChange={(e) => { setForm({ ...form, skrzynka: e.target.value }); setDirty(true) }}>
              <option value="">— wybierz skrzynkę —</option>
              {skrzynki.map((s) => (
                <option key={s.id} value={s.id}>{s.nazwa || s.login || s.id}{s.aktywna ? '' : ' (nieaktywna)'}</option>
              ))}
            </select>
            <span className="crm-pf-hint">Skrzynki dodajesz w CRM → Poczta.</span>
          </label>
          <label className="crm-pf-field crm-pf-field--short">
            <span className="crm-pf-label">Port SMTP</span>
            <select value={form.port} onChange={(e) => { setForm({ ...form, port: e.target.value }); setDirty(true) }}>
              <option value="465">465 (SSL/TLS)</option>
              <option value="587">587 (STARTTLS)</option>
            </select>
          </label>
        </div>
        <div className="crm-poczta-actions">
          <button type="button" className="btn btn-sm btn-primary" onClick={() => void onSave()} disabled={busy || !dirty}>{busy ? <Spinner inline size={14} /> : <Save size={14} />} Zapisz</button>
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => void onTest()} disabled={busy || dirty} title={dirty ? 'Najpierw zapisz zmiany' : 'Wyśle testowy alert na podane adresy'}>
            <Send size={14} /> Wyślij mail próbny
          </button>
          {dirty && <span className="crm-muted">niezapisane zmiany — zapisz przed testem</span>}
        </div>
        {test && <div className={`crm-box ${test.ok ? 'crm-poczta-test--ok' : 'crm-poczta-test--bad'} crm-ust-test`}>{test.text}</div>}
      </section>
      <section className="crm-box">
        <h5>Stan</h5>
        <ul className="crm-poczta-status-list">
          <li>Ostatni alert: <b>{fmtDateTime(ostatniAt)}</b></li>
          <li>Ostatni błąd wysyłki: {ostatniBlad ? <span className="crm-text-bad">{ostatniBlad}</span> : <span className="crm-muted">brak — ok</span>}</li>
          <li className="crm-muted">Ostatnie zgłoszone zdarzenie: #{get(ust, CRM_ALERT_KEYS.ostatnieZdarzenie) || '—'}</li>
        </ul>
        <div className="crm-poczta-actions"><button type="button" className="crm-link" onClick={() => void load()}><RefreshCw size={13} /> odśwież</button></div>
      </section>
    </div>
  )
}

// ---------------------------------------------------------------- Poprawki (odczyt)

function PoprawkiSection({ onOpenOferta, onOpenLead }: Pick<Props, 'onOpenOferta' | 'onOpenLead'>) {
  const [rows, setRows] = useState<CrmPoprawkaRow[]>([])
  const [names, setNames] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<CrmError | null>(null)

  const load = useCallback(async () => {
    const r = await fetchPoprawkiOstatnie()
    setError(r.error)
    if (!r.error) {
      setRows(r.data)
      setNames(await fetchProfileNames(r.data.map((x) => x.handlowiec ?? '')))
    }
    setLoading(false)
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  if (loading) return <Spinner center label="Ładowanie poprawek…" />
  if (error) return <div className="crm-box crm-box--bad">{error.message}</div>

  return (
    <div className="crm-ust-section">
      <p className="crm-muted crm-ust-intro">
        Poprawki handlowca z ostatnich 30 dni ({rows.length}). Co się powtarza, zamień w zasadę w zakładce „Zasady ofert”, żeby system przyjmował to od razu.
      </p>
      {rows.length === 0 ? (
        <p className="crm-muted">Brak poprawek w ostatnich 30 dniach.</p>
      ) : (
        <div className="crm-box crm-poprawki-wrap">
          <table className="crm-poprawki">
            <thead>
              <tr>
                <th>Kiedy</th>
                <th>Klient</th>
                <th>Poprawka handlowca</th>
                <th>Jak system zrozumiał</th>
                <th>Kto</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const zm = asStrings(r.zmiany)
                const us = asStrings(r.usuniete)
                const nz = asStrings(r.niezrozumiane)
                return (
                  <tr key={`${r.oferta_id ?? ''}-${i}`}>
                    <td className="crm-nowrap">{fmtDateTime(r.created_at)}</td>
                    <td>
                      {r.lead_id ? <button type="button" className="crm-link" onClick={() => onOpenLead(r.lead_id as string)}>{r.klient || r.telefon || '—'}</button> : r.klient || r.telefon || '—'}
                      {r.oferta_id && <div><button type="button" className="crm-link" onClick={() => onOpenOferta(r.oferta_id as string)}>oferta v{r.wersja ?? '?'}</button></div>}
                    </td>
                    <td className="crm-poprawki-txt">„{r.poprawka || '—'}”</td>
                    <td className="crm-poprawki-txt">
                      {r.streszczenie && <div>{r.streszczenie}</div>}
                      {zm.length > 0 && <div className="crm-muted">zmiany: {zm.join('; ')}</div>}
                      {us.length > 0 && <div className="crm-muted">usunięte: {us.join('; ')}</div>}
                      {r.do_maila && <div className="crm-muted">do maila: {r.do_maila}</div>}
                      {nz.length > 0 && <div className="crm-text-bad">niezrozumiane: {nz.join('; ')}</div>}
                    </td>
                    <td className="crm-nowrap">{r.handlowiec ? names.get(r.handlowiec) ?? '…' : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- Dane firmy (PDF oferty, brief pkt 21)

/** klucze ustawień poza firma_*, które też należą do ofert PDF (limity VAT, ważność oferty) */
const isOfertaKey = (k: string) => /^(vat_limit_|oferta_waznosc)/.test(k)

function FirmaSection({ pushToast }: Pick<Props, 'pushToast'>) {
  const [ust, setUst] = useState<CrmUstawienie[]>([])
  const [liczniki, setLiczniki] = useState<CrmLicznik[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<CrmError | null>(null)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState<Record<string, string>>({})
  const [dirty, setDirty] = useState(false)
  const [licznikForm, setLicznikForm] = useState<Record<string, string>>({})
  const [logoOk, setLogoOk] = useState<boolean | null>(null)
  // brief pkt 23: domyślny handlowiec szkiców (id z profiles) — do wyboru spośród osób z dostępem do CRM
  const [handlowcy, setHandlowcy] = useState<Array<{ id: string; name: string }>>([])

  const load = useCallback(async () => {
    const [u, l, ids] = await Promise.all([fetchUstawienia(), fetchLiczniki(), fetchCrmUserIds()])
    setError(u.error)
    if (!u.error) {
      setUst(u.data)
      const f: Record<string, string> = {}
      for (const k of CRM_FIRMA_KEYS) f[k.klucz] = u.data.find((x) => x.klucz === k.klucz)?.wartosc ?? ''
      for (const x of u.data) if (isOfertaKey(x.klucz)) f[x.klucz] = x.wartosc ?? ''
      f[CRM_UST_SZKIC_HANDLOWIEC] = u.data.find((x) => x.klucz === CRM_UST_SZKIC_HANDLOWIEC)?.wartosc ?? ''
      setForm(f)
      setDirty(false)
      const wybrany = f[CRM_UST_SZKIC_HANDLOWIEC]
      const names = await fetchProfileNames(wybrany && !ids.includes(wybrany) ? [...ids, wybrany] : ids)
      setHandlowcy([...names.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'pl')))
    }
    setLiczniki(l.data)
    setLicznikForm(Object.fromEntries(l.data.map((x) => [x.klucz, String(x.wartosc)])))
    const logo = await signedUrlDokument(CRM_LOGO_PATH)
    setLogoOk(!!logo.data && !logo.error)
    setLoading(false)
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const onSave = async () => {
    setBusy(true)
    const err = await saveUstawienia(Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim()])))
    setBusy(false)
    if (err) {
      pushToast(err.message, 'error')
      return
    }
    pushToast('Dane firmy zapisane — następny PDF użyje nowych', 'success')
    await load()
  }

  const onSaveLicznik = async (klucz: string) => {
    const v = Number(licznikForm[klucz])
    if (!Number.isInteger(v) || v < 0) {
      pushToast('Numer musi być liczbą całkowitą', 'error')
      return
    }
    setBusy(true)
    const err = await saveLicznik(klucz, v)
    setBusy(false)
    if (err) {
      pushToast(err.message, 'error')
      return
    }
    pushToast(`${licznikLabel(klucz)}: ostatni numer ${v} (następny dokument dostanie ${v + 1})`, 'success')
    await load()
  }

  const onLogo = async (file: File | null) => {
    if (!file) return
    if (!/png$/i.test(file.type) && !/\.png$/i.test(file.name)) {
      pushToast('Logo musi być plikiem PNG', 'error')
      return
    }
    setBusy(true)
    const err = await uploadLogo(file)
    setBusy(false)
    if (err) {
      pushToast(`Nie udało się wgrać logo: ${err.message}`, 'error')
      return
    }
    pushToast('Logo wgrane — pojawi się w kolejnych PDF-ach', 'success')
    setLogoOk(true)
  }

  const openLogo = async () => {
    const r = await signedUrlDokument(CRM_LOGO_PATH)
    if (r.data) void openExternalUrl(r.data)
    else pushToast('Brak logo w buckecie', 'error')
  }

  if (loading) return <Spinner center label="Ładowanie danych firmy…" />
  if (error) return <div className="crm-box crm-box--bad">{error.message}</div>

  const rok = new Date().getFullYear()
  const ofertaKeys = ust.filter((x) => isOfertaKey(x.klucz))

  return (
    <div className="crm-ust-section">
      <p className="crm-muted crm-ust-intro">Nagłówek i stopka PDF oferty z montażem, reguły VAT i ważność oferty. Zmiany działają od następnej wygenerowanej oferty; już zrobione PDF-y zostają.</p>
      <section className="crm-box crm-pf">
        <h5>Stopka PDF</h5>
        <div className="crm-pf-grid">
          {CRM_FIRMA_KEYS.map((k) => (
            <label key={k.klucz} className="crm-pf-field">
              <span className="crm-pf-label">{k.label}</span>
              <input type="text" value={form[k.klucz] ?? ''} onChange={(e) => { setForm({ ...form, [k.klucz]: e.target.value }); setDirty(true) }} disabled={busy} autoComplete="off" />
            </label>
          ))}
        </div>
        {ofertaKeys.length > 0 && (
          <>
            <h5>Reguły ofert</h5>
            <div className="crm-pf-grid">
              {ofertaKeys.map((x) => (
                <label key={x.klucz} className="crm-pf-field">
                  <span className="crm-pf-label">{x.klucz}</span>
                  <input type="text" value={form[x.klucz] ?? ''} onChange={(e) => { setForm({ ...form, [x.klucz]: e.target.value }); setDirty(true) }} disabled={busy} autoComplete="off" />
                  {x.opis && <span className="crm-pf-hint">{x.opis}</span>}
                </label>
              ))}
            </div>
          </>
        )}
        <div className="crm-poczta-actions">
          <button type="button" className="btn btn-sm btn-primary" onClick={() => void onSave()} disabled={busy || !dirty}>{busy ? <Spinner inline size={14} /> : <Save size={14} />} Zapisz</button>
        </div>
      </section>

      <section className="crm-box crm-pf">
        <h5>Logo w nagłówku PDF</h5>
        <div className="crm-poczta-actions">
          <label className="btn btn-sm btn-secondary crm-file-btn">
            Wgraj logo (PNG)
            <input type="file" accept="image/png,.png" disabled={busy} onChange={(e) => void onLogo(e.target.files?.[0] ?? null)} hidden />
          </label>
          {logoOk ? <button type="button" className="crm-link" onClick={() => void openLogo()}>zobacz obecne logo</button> : <span className="crm-muted">{logoOk === false ? 'brak logo — PDF idzie bez grafiki' : ''}</span>}
          <span className="crm-muted">Plik zapisuje się jako {CRM_LOGO_PATH} i zastępuje poprzednie.</span>
        </div>
      </section>

      <section className="crm-box crm-pf">
        <h5>Numeracja ofert i umów</h5>
        <p className="crm-muted crm-pf-hint">Numer oferty = RRRR/MM/NNN, numer umowy = NN/MM/RRRR. Licznik trzyma OSTATNI użyty numer w roku; wpisz numer z rejestru, żeby numeracja była ciągła (następny dokument dostanie +1).</p>
        <div className="crm-pf-grid">
          {[`oferta:${rok}`, `umowa:${rok}`]
            .filter((k) => !liczniki.some((l) => l.klucz === k))
            .map((klucz): CrmLicznik => ({ klucz, wartosc: 0, updated_at: null }))
            .concat(liczniki)
            .sort((a, b) => a.klucz.localeCompare(b.klucz))
            .map((l) => (
            <div key={l.klucz} className="crm-pf-field crm-pf-field--short">
              <span className="crm-pf-label" title={l.klucz}>{licznikLabel(l.klucz)}</span>
              <div className="crm-licznik-row">
                <input type="number" min={0} value={licznikForm[l.klucz] ?? String(l.wartosc)} onChange={(e) => setLicznikForm({ ...licznikForm, [l.klucz]: e.target.value })} disabled={busy} />
                <button type="button" className="btn btn-sm btn-secondary" disabled={busy || (licznikForm[l.klucz] ?? String(l.wartosc)) === String(l.wartosc)} onClick={() => void onSaveLicznik(l.klucz)}>Zapisz</button>
              </div>
              {l.updated_at && <span className="crm-pf-hint">zmieniono {fmtDateTime(l.updated_at)}</span>}
            </div>
          ))}
        </div>
      </section>

      <section className="crm-box crm-pf">
        <h5>Szkice odpowiedzi mailowych</h5>
        <p className="crm-muted crm-pf-hint">
          Szkic pisze się stylem zalogowanego handlowca (z jego wysłanych maili w CRM → Poczta). Gdy robi go system sam (zadanie „dopytaj”, follow-up z cronu) i nie wie, kto prowadzi klienta, używa stylu osoby wybranej tu.
        </p>
        <div className="crm-pf-grid">
          <label className="crm-pf-field">
            <span className="crm-pf-label">Domyślny handlowiec szkiców</span>
            <select value={form[CRM_UST_SZKIC_HANDLOWIEC] ?? ''} onChange={(e) => { setForm({ ...form, [CRM_UST_SZKIC_HANDLOWIEC]: e.target.value }); setDirty(true) }} disabled={busy}>
              <option value="">— ustawienie systemu (Magdalena) —</option>
              {handlowcy.map((h) => (
                <option key={h.id} value={h.id}>{h.name}</option>
              ))}
            </select>
            <span className="crm-pf-hint">Osoby z dostępem do CRM. Żeby styl był tej osoby, a nie „wspólny”, dodaj jej skrzynkę osobistą w CRM → Poczta i wczytaj próbki.</span>
          </label>
        </div>
        <div className="crm-poczta-actions">
          <button type="button" className="btn btn-sm btn-primary" onClick={() => void onSave()} disabled={busy || !dirty}>{busy ? <Spinner inline size={14} /> : <Save size={14} />} Zapisz</button>
        </div>
      </section>
    </div>
  )
}

// ---------------------------------------------------------------- Dni wolne (brief pkt 25)

const fmtDzien = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return d.toLocaleDateString('pl-PL', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
}

function DniWolneSection({ pushToast }: Pick<Props, 'pushToast'>) {
  const [lista, setLista] = useState<CrmDzienWolny[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<CrmError | null>(null)
  const [busy, setBusy] = useState(false)
  const [nowy, setNowy] = useState<{ data: string; nazwa: string } | null>(null)

  const load = useCallback(async () => {
    const r = await fetchDniWolne()
    setError(r.error)
    if (!r.error) setLista(r.data)
    setLoading(false)
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const onAdd = async () => {
    if (!nowy) return
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nowy.data)) {
      pushToast('Wybierz datę dnia wolnego', 'error')
      return
    }
    if (lista.some((d) => d.data === nowy.data)) {
      pushToast('Ten dzień już jest na liście', 'error')
      return
    }
    setBusy(true)
    const err = await addDzienWolny(nowy.data, nowy.nazwa)
    setBusy(false)
    if (err) {
      pushToast(`Nie udało się dodać: ${err.message}`, 'error')
      return
    }
    pushToast(`Dodano dzień firmowy ${fmtDzien(nowy.data)} — terminy zadań będą go omijać`, 'success')
    setNowy(null)
    invalidateDniWolne()
    await load()
  }
  const onDelete = async (d: CrmDzienWolny) => {
    if (!(await appConfirm(`Usunąć dzień firmowy ${fmtDzien(d.data)}${d.nazwa ? ` („${d.nazwa}”)` : ''}? Terminy zadań znów będą mogły na niego wypaść.`, { title: 'Usuń dzień firmowy', confirmLabel: 'Usuń' }))) return
    setBusy(true)
    const err = await deleteDzienWolny(d.data)
    setBusy(false)
    if (err) {
      pushToast(`Nie udało się usunąć: ${err.message}`, 'error')
      return
    }
    pushToast('Dzień firmowy usunięty', 'success')
    invalidateDniWolne()
    await load()
  }

  if (loading) return <Spinner center label="Ładowanie dni wolnych…" />
  if (error) return <div className="crm-box crm-box--bad">{error.message}</div>

  const lata = [...new Set(lista.map((d) => d.data.slice(0, 4)))]
  return (
    <div className="crm-ust-section">
      <p className="crm-muted crm-ust-intro">
        Terminy zadań omijają weekendy i te dni (sobota, niedziela, święto albo dzień firmowy → następny dzień roboczy; termin „dziś” zapisany po 17:00 → jutro). Święta państwowe
        dopisuje system co roku 2 stycznia (łącznie z Wigilią); dni firmowe (np. inwentaryzacja, urlop zbiorowy) dodajesz tu. Lista od dziś.
      </p>
      <section className="crm-box crm-ust-group">
        <div className="crm-screen-head">
          <div className="crm-screen-title">
            <h4>Dni wolne ({lista.length})</h4>
            <div className="crm-screen-sub">Usunąć można tylko dzień firmowy — święto wróciłoby po następnym uzupełnieniu.</div>
          </div>
          <button type="button" className="btn btn-sm btn-secondary" disabled={busy || !!nowy} onClick={() => setNowy({ data: '', nazwa: '' })}>
            <Plus size={14} /> Dodaj dzień firmowy
          </button>
        </div>
        {nowy && (
          <div className="crm-pf-grid crm-dni-wolne-form">
            <label className="crm-pf-field crm-pf-field--short">
              <span className="crm-pf-label">Data</span>
              <input type="date" value={nowy.data} onChange={(e) => setNowy({ ...nowy, data: e.target.value })} disabled={busy} />
            </label>
            <label className="crm-pf-field">
              <span className="crm-pf-label">Nazwa (opcjonalnie)</span>
              <input type="text" value={nowy.nazwa} onChange={(e) => setNowy({ ...nowy, nazwa: e.target.value })} disabled={busy} placeholder="np. inwentaryzacja, zamknięte" autoComplete="off" />
            </label>
            <div className="crm-poczta-actions">
              <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void onAdd()}>{busy ? <Spinner inline size={14} /> : <Save size={14} />} Dodaj</button>
              <button type="button" className="btn btn-sm btn-secondary" disabled={busy} onClick={() => setNowy(null)}><X size={14} /> Anuluj</button>
            </div>
          </div>
        )}
        {lista.length === 0 && <p className="crm-muted">Brak dni wolnych od dziś.</p>}
        {lata.map((rok) => (
          <div key={rok} className="crm-dni-wolne-rok">
            <h5>{rok}</h5>
            <ul className="crm-zasady">
              {lista
                .filter((d) => d.data.startsWith(rok))
                .map((d) => (
                  <li key={d.data} className="crm-zasada crm-dzien-wolny">
                    <span className="crm-dzien-wolny-data">{fmtDzien(d.data)}</span>
                    <span className="crm-zasada-text">{d.nazwa || '—'}</span>
                    <span className={`crm-status ${d.rodzaj === 'firmowe' ? 'crm-status--working' : 'crm-status--muted'}`}>{CRM_DZIEN_WOLNY_RODZAJ[d.rodzaj] ?? d.rodzaj}</span>
                    <span className="crm-zasada-btns">
                      {d.rodzaj === 'firmowe' && (
                        <button type="button" className="crm-link" disabled={busy} onClick={() => void onDelete(d)} title="Usuń dzień firmowy"><Trash2 size={13} /></button>
                      )}
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </section>
    </div>
  )
}

// ---------------------------------------------------------------- Ekran

export default function CrmUstawieniaScreen({ currentUser, pushToast, onOpenOferta, onOpenLead }: Props) {
  const [tab, setTab] = useState<Tab>('zasady')
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'zasady', label: 'Zasady ofert' },
    { id: 'alerty', label: 'Alerty' },
    { id: 'poprawki', label: 'Poprawki' },
    { id: 'firma', label: 'Dane firmy' },
    { id: 'dni_wolne', label: 'Dni wolne' },
  ]
  return (
    <div className="crm-screen crm-ust">
      <div className="crm-ust-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`crm-ust-tab${tab === t.id ? ' crm-ust-tab--active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'zasady' && <ZasadySection currentUser={currentUser} pushToast={pushToast} />}
      {tab === 'alerty' && <AlertySection pushToast={pushToast} />}
      {tab === 'poprawki' && <PoprawkiSection onOpenOferta={onOpenOferta} onOpenLead={onOpenLead} />}
      {tab === 'firma' && <FirmaSection pushToast={pushToast} />}
      {tab === 'dni_wolne' && <DniWolneSection pushToast={pushToast} />}
    </div>
  )
}
