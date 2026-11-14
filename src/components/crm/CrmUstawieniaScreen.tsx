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
import { CRM_ALERT_KEYS, CRM_ZASADA_GRUPA, type CrmPoprawkaRow, type CrmSkrzynka, type CrmUstawienie, type CrmZasada } from '../../types/crm'
import {
  addZasada,
  deleteZasada,
  fetchPoprawkiOstatnie,
  fetchProfileNames,
  fetchSkrzynki,
  fetchUstawienia,
  fetchZasady,
  saveUstawienia,
  testAlert,
  updateZasada,
  type CrmError,
} from '../../hooks/useCrm'
import { appConfirm } from '../../lib/appDialogs'
import Spinner from '../Spinner'

type Props = {
  currentUser: CurrentUser | null
  pushToast: (message: string, variant: ToastVariant) => void
  onOpenOferta: (id: string) => void
  onOpenLead: (id: string) => void
}

type Tab = 'zasady' | 'alerty' | 'poprawki'

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
      setTest(r.ok ? { ok: true, text: `Mail próbny wysłany${do_ ? ` do: ${do_}` : ''}` } : { ok: false, text: r.blad ?? 'Nie udało się wysłać' })
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

// ---------------------------------------------------------------- Ekran

export default function CrmUstawieniaScreen({ currentUser, pushToast, onOpenOferta, onOpenLead }: Props) {
  const [tab, setTab] = useState<Tab>('zasady')
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'zasady', label: 'Zasady ofert' },
    { id: 'alerty', label: 'Alerty' },
    { id: 'poprawki', label: 'Poprawki' },
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
    </div>
  )
}
