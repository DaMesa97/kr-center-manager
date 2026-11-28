// =====================================================================
// CRM Po Drzwi → „Poczta”: skrzynki IMAP (brief pkt 11, 14.11.2026) — główna
// kontakt@ i osobiste pracowników. Skrzynki czyta funkcja crm-mail-sent (cron co
// 5 min): folder Wysłane → zamyka oferty/zadania, folder Odebrane → analiza AI
// (lead, zadanie, oferta) przez crm-call-ingest. Superadmin edytuje wszystkie,
// użytkownik CRM tylko własną (rpc wymusza user_id = auth.uid()). Hasło:
// type=password, nigdy nie pokazywane, w stanie tylko do zapisu/testu.
// =====================================================================
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CurrentUser, ToastVariant } from '../../types'
import {
  CRM_POCZTA_DEFAULT_FOLDER,
  CRM_POCZTA_DEFAULT_INBOX,
  CRM_POCZTA_DEFAULT_PORT,
  CRM_PROBKI_STYLU_ILE,
  type CrmFolderWynik,
  type CrmPocztaFolder,
  type CrmPocztaTest,
  type CrmSkrzynka,
  type CrmSkrzynkaWynik,
} from '../../types/crm'
import {
  deleteSkrzynka,
  fetchCrmUserIds,
  fetchProfileNames,
  fetchSkrzynki,
  saveSkrzynka,
  sprawdzSkrzynki,
  testPoczta,
  wczytajHistorieWyslanych,
  type CrmError,
  type SkrzynkaForm,
} from '../../hooks/useCrm'
import { appConfirm } from '../../lib/appDialogs'
import Spinner from '../Spinner'
import { fmtDateTime } from '../../lib/crmFormat'

type Props = {
  currentUser: CurrentUser | null
  /** tryb pełny = superadmin: wszystkie skrzynki, wybór właściciela */
  isSuperadmin: boolean
  pushToast: (message: string, variant: ToastVariant) => void
}


const emptyForm = (ownerId: string | null): SkrzynkaForm => ({
  nazwa: '',
  host: '',
  port: CRM_POCZTA_DEFAULT_PORT,
  login: '',
  aktywna: true,
  czyta_wyslane: true,
  folder_wyslane: CRM_POCZTA_DEFAULT_FOLDER,
  czyta_odebrane: false,
  folder_odebrane: CRM_POCZTA_DEFAULT_INBOX,
  handlowiec: '',
  user_id: ownerId,
})

const formFromRow = (s: CrmSkrzynka): SkrzynkaForm => ({
  nazwa: s.nazwa ?? '',
  host: s.host ?? '',
  port: s.port ?? CRM_POCZTA_DEFAULT_PORT,
  login: s.login ?? '',
  aktywna: s.aktywna,
  czyta_wyslane: s.czyta_wyslane,
  folder_wyslane: s.folder_wyslane ?? CRM_POCZTA_DEFAULT_FOLDER,
  czyta_odebrane: s.czyta_odebrane,
  folder_odebrane: s.folder_odebrane ?? CRM_POCZTA_DEFAULT_INBOX,
  handlowiec: s.handlowiec ?? '',
  user_id: s.user_id,
})

/** Błąd „świeży”, gdy jest nowszy od ostatniego sukcesu (albo sukcesu nie było). */
const hasFreshError = (s: CrmSkrzynka): boolean => {
  if (!s.ostatni_blad) return false
  if (!s.ostatni_sukces_at) return true
  if (!s.ostatni_blad_at) return false
  return new Date(s.ostatni_blad_at).getTime() > new Date(s.ostatni_sukces_at).getTime()
}

/** Zmiana hosta/loginu/folderu zeruje punkt startu danego folderu (brief pkt 11) */
const resetsStart = (s: CrmSkrzynka, f: SkrzynkaForm): boolean =>
  f.host.trim() !== (s.host ?? '') ||
  f.login.trim().toLowerCase() !== (s.login ?? '').toLowerCase() ||
  (f.czyta_wyslane && f.folder_wyslane.trim() !== (s.folder_wyslane ?? '')) ||
  (f.czyta_odebrane && f.folder_odebrane.trim() !== (s.folder_odebrane ?? ''))

type Editing = { id: string | null; form: SkrzynkaForm; haslo: string; foldery: CrmPocztaFolder[] | null; test: CrmPocztaTest | null }

function FolderWynikLine({ label, w }: { label: string; w: CrmFolderWynik | undefined }) {
  if (!w) return null
  if (w.start) {
    return (
      <li>
        {label}: punkt startu ustawiony (folder „{w.folder}”, {w.maili_w_folderze ?? 0} maili) — starsze nie będą czytane.
      </li>
    )
  }
  const items = w.wyniki ?? []
  return (
    <li>
      {label}: {w.nowych ?? 0} nowych
      {items.length > 0 && (
        <ul className="crm-skrzynka-wyniki">
          {items.map((r, i) => (
            <li key={r.mail_id ?? r.uid ?? i}>
              {r.od ? `${r.od} · ` : ''}
              {r.temat || '(bez tematu)'}
              {r.typ ? ` · ${r.typ}` : ''}
              {r.status ? ` · ${r.status}` : ''}
              {r.zalaczniki ? ` · zał. ${r.zalaczniki}` : ''}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

export default function CrmPocztaScreen({ currentUser, isSuperadmin, pushToast }: Props) {
  const [rows, setRows] = useState<CrmSkrzynka[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<CrmError | null>(null)
  const [names, setNames] = useState<Map<string, string>>(new Map())
  const [ownerIds, setOwnerIds] = useState<string[]>([])
  const [editing, setEditing] = useState<Editing | null>(null)
  const [busy, setBusy] = useState<string | null>(null) // 'test' | 'save' | 'delete' | 'check:<id>' | 'check:all'
  const [wyniki, setWyniki] = useState<Map<string, CrmSkrzynkaWynik>>(new Map())

  const myId = currentUser?.id ?? null

  const load = useCallback(async () => {
    const res = await fetchSkrzynki()
    setError(res.error)
    if (!res.error) {
      setRows(res.data)
      const ids = new Set<string>(res.data.map((s) => s.user_id ?? '').filter(Boolean))
      if (isSuperadmin) for (const id of await fetchCrmUserIds()) ids.add(id)
      if (myId) ids.add(myId)
      const list = [...ids]
      setOwnerIds(list)
      setNames(await fetchProfileNames(list))
    }
    setLoading(false)
  }, [isSuperadmin, myId])

  useEffect(() => {
    void load()
  }, [load])

  const canEdit = useCallback((s: CrmSkrzynka) => isSuperadmin || (!!myId && s.user_id === myId), [isSuperadmin, myId])
  const ownerLabel = (uid: string | null) => (uid ? names.get(uid) ?? uid.slice(0, 8) : 'wspólna')

  const startAdd = () => setEditing({ id: null, form: emptyForm(isSuperadmin ? null : myId), haslo: '', foldery: null, test: null })
  const startEdit = (s: CrmSkrzynka) => setEditing({ id: s.id, form: formFromRow(s), haslo: '', foldery: null, test: null })
  const cancelEdit = () => setEditing(null)
  const setForm = <K extends keyof SkrzynkaForm>(key: K, value: SkrzynkaForm[K]) =>
    setEditing((e) => (e ? { ...e, form: { ...e.form, [key]: value } } : e))

  const editedRow = useMemo(() => (editing?.id ? rows.find((r) => r.id === editing.id) ?? null : null), [editing?.id, rows])
  const dirty = editing ? (editedRow ? JSON.stringify(formFromRow(editedRow)) !== JSON.stringify(editing.form) || editing.haslo !== '' : true) : false

  const onTest = async () => {
    if (!editing) return
    const { form, haslo, id } = editing
    if (!form.host.trim() || !form.login.trim()) {
      pushToast('Podaj serwer i login skrzynki', 'error')
      return
    }
    if (!haslo && !editedRow?.ma_haslo) {
      pushToast('Podaj hasło do skrzynki (nie ma jeszcze zapisanego)', 'error')
      return
    }
    setBusy('test')
    try {
      const res = await testPoczta(id, form, haslo)
      setEditing((e) => {
        if (!e) return e
        if (!res.ok) return { ...e, test: res }
        const list = res.foldery ?? []
        const namesOnServer = new Set(list.map((f) => f.nazwa))
        const f = { ...e.form }
        const hintW = res.folder_wyslane_podpowiedz || res.folder_podpowiedz || list.find((x) => x.wyslane)?.nazwa || null
        const hintO = res.folder_odebrane_podpowiedz || list.find((x) => x.odebrane)?.nazwa || null
        if (hintW && !namesOnServer.has(f.folder_wyslane.trim())) f.folder_wyslane = hintW
        if (hintO && !namesOnServer.has(f.folder_odebrane.trim())) f.folder_odebrane = hintO
        return { ...e, test: res, foldery: list, form: f }
      })
      if (res.ok) pushToast(res.blad_folderu ? `Połączenie działa, ale folder: ${res.blad_folderu}` : 'Połączenie ze skrzynką działa', res.blad_folderu ? 'error' : 'success')
      else pushToast(res.blad || 'Połączenie nie powiodło się', 'error')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Błąd testu połączenia'
      setEditing((ed) => (ed ? { ...ed, test: { ok: false, blad: msg } } : ed))
      pushToast(msg, 'error')
    } finally {
      setBusy(null)
    }
  }

  const onSave = async (removePassword = false) => {
    if (!editing) return
    const { form, haslo, id } = editing
    if (!form.nazwa.trim()) {
      pushToast('Podaj nazwę skrzynki (np. „kontakt@ główna”, „Magda”)', 'error')
      return
    }
    if (!form.host.trim() || !form.login.trim()) {
      pushToast('Podaj serwer i login skrzynki', 'error')
      return
    }
    if (!Number.isInteger(form.port) || form.port < 1 || form.port > 65535) {
      pushToast('Port musi być liczbą 1–65535 (zalecany 993)', 'error')
      return
    }
    if (!form.czyta_wyslane && !form.czyta_odebrane) {
      pushToast('Zaznacz, co skrzynka ma czytać: Wysłane, Odebrane albo oba', 'error')
      return
    }
    if (!id && !haslo) {
      pushToast('Nowa skrzynka potrzebuje hasła', 'error')
      return
    }
    if (removePassword && !(await appConfirm('Usunąć zapisane hasło do skrzynki? Czytanie poczty przestanie działać do wpisania nowego.'))) return
    if (editedRow && resetsStart(editedRow, form)) {
      const ok = await appConfirm(
        'Zmieniasz serwer, login albo folder. Punkt startu czytania zostanie ustawiony od nowa przy najbliższym sprawdzeniu — maile sprzed tej chwili nie będą przetwarzane. Zapisać?',
        { title: 'Zmiana ustawień skrzynki', confirmLabel: 'Zapisz' },
      )
      if (!ok) return
    }
    setBusy('save')
    try {
      const res = await saveSkrzynka(id, form, removePassword ? '' : haslo === '' ? null : haslo)
      if (res.error) {
        pushToast(res.error.message, 'error')
        return
      }
      pushToast(removePassword ? 'Hasło usunięte' : id ? 'Skrzynka zapisana' : 'Skrzynka dodana', 'success')
      setEditing(null)
      await load()
    } finally {
      setBusy(null)
    }
  }

  const onDelete = async (s: CrmSkrzynka) => {
    const ok = await appConfirm(
      `Usunąć skrzynkę „${s.nazwa || s.login}”? Hasło zostanie skasowane, maile już odczytane zostają. Po ponownym dodaniu skrzynki stare maile nie będą czytane — czytanie zacznie się od chwili dodania.`,
      { title: 'Usuń skrzynkę', confirmLabel: 'Usuń' },
    )
    if (!ok) return
    setBusy('delete')
    const err = await deleteSkrzynka(s.id)
    setBusy(null)
    if (err) {
      pushToast(err.message, 'error')
      return
    }
    if (editing?.id === s.id) setEditing(null)
    pushToast('Skrzynka usunięta', 'success')
    await load()
  }

  const onCheck = async (id?: string) => {
    setBusy(id ? `check:${id}` : 'check:all')
    try {
      const res = await sprawdzSkrzynki(id)
      if (!res.ok && !res.skrzynki?.length) {
        pushToast(res.blad || 'Sprawdzenie poczty nie powiodło się', 'error')
      } else {
        setWyniki((prev) => {
          const next = new Map(prev)
          for (const w of res.skrzynki ?? []) next.set(w.id, w)
          return next
        })
        const failed = (res.skrzynki ?? []).filter((w) => !w.ok && !w.pominieto)
        const nowych = (res.skrzynki ?? []).reduce((n, w) => n + (w.wyslane?.nowych ?? 0) + (w.odebrane?.nowych ?? 0), 0)
        if (failed.length) pushToast(`Błąd w ${failed.length} ${failed.length === 1 ? 'skrzynce' : 'skrzynkach'}: ${failed[0].blad ?? ''}`, 'error')
        else pushToast(nowych ? `Sprawdzono: ${nowych} nowych maili` : 'Sprawdzono: nic nowego', 'success')
      }
    } catch (e) {
      pushToast(e instanceof Error ? e.message : 'Błąd sprawdzania poczty', 'error')
    } finally {
      await load()
      setBusy(null)
    }
  }

  // brief pkt 23 (superadmin): ostatnie N wysłanych sprzed punktu startu → próbki stylu handlowca (crm.maile wychodzące)
  const onProbki = async (s: CrmSkrzynka) => {
    setBusy(`probki:${s.id}`)
    try {
      const res = await wczytajHistorieWyslanych(s.id, CRM_PROBKI_STYLU_ILE)
      if (!res.ok) {
        pushToast(res.blad || res.error || 'Nie udało się wczytać wysłanych', 'error')
      } else {
        const parts = [`zapisano ${res.zapisano ?? 0}`]
        if (res.duplikaty) parts.push(`już były ${res.duplikaty}`)
        if (res.pominieto) parts.push(`pominięto ${res.pominieto}`)
        if (res.bledy) parts.push(`błędy ${res.bledy}`)
        pushToast(`Próbki stylu z „${s.nazwa || s.login}”: ${parts.join(', ')}`, res.bledy ? 'error' : 'success')
      }
    } catch (e) {
      pushToast(e instanceof Error ? e.message : 'Błąd wczytywania wysłanych', 'error')
    } finally {
      setBusy(null)
    }
  }

  const folderOptions = (foldery: CrmPocztaFolder[] | null, current: string): CrmPocztaFolder[] => {
    if (!foldery) return []
    const cur = current.trim()
    return cur && !foldery.some((f) => f.nazwa === cur) ? [{ nazwa: cur }, ...foldery] : foldery
  }

  if (loading) return <Spinner center label="Ładowanie skrzynek…" />

  const f = editing?.form
  const renderFolderField = (key: 'folder_wyslane' | 'folder_odebrane', label: string, flag: boolean, markKey: 'wyslane' | 'odebrane') => {
    if (!f || !editing) return null
    const opts = folderOptions(editing.foldery, f[key])
    return (
      <label className="crm-pf-field">
        <span className="crm-pf-label">{label}</span>
        {opts.length > 0 ? (
          <select value={f[key]} onChange={(e) => setForm(key, e.target.value)} disabled={!flag}>
            {opts.map((o) => (
              <option key={o.nazwa} value={o.nazwa}>
                {o.nazwa}
                {o[markKey] ? ` (${markKey === 'wyslane' ? 'Wysłane' : 'Odebrane'})` : ''}
              </option>
            ))}
          </select>
        ) : (
          <input type="text" value={f[key]} onChange={(e) => setForm(key, e.target.value)} disabled={!flag} autoComplete="off" />
        )}
      </label>
    )
  }

  return (
    <div className="crm-screen crm-poczta">
      <div className="crm-screen-head">
        <div className="crm-screen-title">
          <h3>Poczta — skrzynki</h3>
          <div className="crm-screen-sub">
            System co 5 minut zagląda do skrzynek. Folder Wysłane: mail do adresu z oferty oznacza ją jako wysłaną, mail do klienta zamyka zadanie. Folder Odebrane: mail klienta jest analizowany jak rozmowa — powstaje lead, zadanie albo oferta.
          </div>
        </div>
        <div className="crm-poczta-actions crm-poczta-actions--head">
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => void onCheck()} disabled={busy !== null || rows.length === 0} title="Sprawdź wszystkie aktywne skrzynki teraz">
            {busy === 'check:all' ? <Spinner inline size={14} /> : null} Sprawdź wszystkie
          </button>
          <button type="button" className="btn btn-sm btn-primary" onClick={startAdd} disabled={busy !== null || editing?.id === null}>
            {isSuperadmin ? 'Dodaj skrzynkę' : 'Dodaj moją skrzynkę'}
          </button>
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => void load()} title="Odśwież">
            Odśwież
          </button>
        </div>
      </div>

      {error && <div className="crm-box crm-box--bad">{error.message}</div>}

      {/* FORMULARZ */}
      {editing && f && (
        <section className="crm-box crm-pf">
          <h4>{editing.id ? `Edycja skrzynki „${editedRow?.nazwa || editedRow?.login || ''}”` : 'Nowa skrzynka'}</h4>
          <div className="crm-pf-grid">
            <label className="crm-pf-field">
              <span className="crm-pf-label">Nazwa</span>
              <input type="text" value={f.nazwa} onChange={(e) => setForm('nazwa', e.target.value)} placeholder="np. kontakt@ (główna), Magda" autoComplete="off" />
            </label>
            <label className="crm-pf-field">
              <span className="crm-pf-label">Serwer IMAP</span>
              <input type="text" value={f.host} onChange={(e) => setForm('host', e.target.value)} placeholder="np. mail25.mydevil.net" autoComplete="off" />
            </label>
            <label className="crm-pf-field crm-pf-field--short">
              <span className="crm-pf-label">Port</span>
              <input type="number" min={1} max={65535} value={f.port} onChange={(e) => setForm('port', Number.parseInt(e.target.value, 10) || 0)} />
              <span className="crm-pf-hint">{f.port === CRM_POCZTA_DEFAULT_PORT ? '993 = SSL/TLS, zalecane' : `Zalecany ${CRM_POCZTA_DEFAULT_PORT} (SSL/TLS); inne porty łączą się przez STARTTLS.`}</span>
            </label>
            <label className="crm-pf-field">
              <span className="crm-pf-label">Login (pełny adres skrzynki)</span>
              <input type="email" value={f.login} onChange={(e) => setForm('login', e.target.value)} placeholder="imie@podrzwi.pl" autoComplete="off" />
            </label>
            <label className="crm-pf-field">
              <span className="crm-pf-label">Hasło</span>
              <input
                type="password"
                value={editing.haslo}
                onChange={(e) => setEditing((ed) => (ed ? { ...ed, haslo: e.target.value } : ed))}
                placeholder={editedRow?.ma_haslo ? '•••••••• (zapisane — puste = bez zmiany)' : 'hasło do skrzynki'}
                autoComplete="new-password"
              />
              <span className="crm-pf-hint">
                {editedRow?.ma_haslo ? 'Hasło jest w sejfie; nigdy nie jest wyświetlane.' : 'Hasło trafia do sejfu, nie do tabeli.'}
                {editedRow?.ma_haslo && (
                  <>
                    {' '}
                    <button type="button" className="crm-link" onClick={() => void onSave(true)} disabled={busy !== null}>
                      usuń zapisane hasło
                    </button>
                  </>
                )}
              </span>
            </label>
            <label className="crm-pf-field">
              <span className="crm-pf-label">Imię do podpisu</span>
              <input type="text" value={f.handlowiec} onChange={(e) => setForm('handlowiec', e.target.value)} placeholder="np. Magda" autoComplete="off" />
              <span className="crm-pf-hint">Pojawia się w historii i podpisie maili z tej skrzynki.</span>
            </label>
            {isSuperadmin ? (
              <label className="crm-pf-field">
                <span className="crm-pf-label">Właściciel</span>
                <select value={f.user_id ?? ''} onChange={(e) => setForm('user_id', e.target.value || null)}>
                  <option value="">wspólna (firmowa)</option>
                  {ownerIds.map((uid) => (
                    <option key={uid} value={uid}>
                      {names.get(uid) ?? uid.slice(0, 8)}
                    </option>
                  ))}
                </select>
                <span className="crm-pf-hint">Skrzynka osobista: wysyłka z niej podpisuje ofertę tym użytkownikiem.</span>
              </label>
            ) : (
              <div className="crm-pf-field">
                <span className="crm-pf-label">Właściciel</span>
                <span className="crm-pf-static">{currentUser?.full_name ?? 'ja'} (moja skrzynka)</span>
              </div>
            )}
          </div>

          <div className="crm-pf-grid crm-pf-grid--folders">
            <label className="crm-pf-field crm-pf-field--check">
              <input type="checkbox" checked={f.czyta_wyslane} onChange={(e) => setForm('czyta_wyslane', e.target.checked)} />
              <span className="crm-pf-label">Czytaj Wysłane (wysyłka ofert)</span>
            </label>
            {renderFolderField('folder_wyslane', 'Folder Wysłane', f.czyta_wyslane, 'wyslane')}
            <label className="crm-pf-field crm-pf-field--check">
              <input type="checkbox" checked={f.czyta_odebrane} onChange={(e) => setForm('czyta_odebrane', e.target.checked)} />
              <span className="crm-pf-label">Czytaj Odebrane (analiza AI maili klientów)</span>
            </label>
            {renderFolderField('folder_odebrane', 'Folder Odebrane', f.czyta_odebrane, 'odebrane')}
            <label className="crm-pf-field crm-pf-field--check">
              <input type="checkbox" checked={f.aktywna} onChange={(e) => setForm('aktywna', e.target.checked)} />
              <span className="crm-pf-label">Włączona (automat co 5 minut)</span>
            </label>
          </div>
          <p className="crm-pf-hint">{editing.foldery ? 'Lista folderów pobrana z serwera.' : 'Po „Testuj połączenie” pojawi się lista folderów z serwera z podpowiedzią Wysłane / Odebrane.'}</p>

          <div className="crm-poczta-actions">
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => void onTest()} disabled={busy !== null}>
              {busy === 'test' ? <Spinner inline size={14} /> : null} Testuj połączenie
            </button>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => void onSave()} disabled={busy !== null || !dirty}>
              {busy === 'save' ? <Spinner inline size={14} /> : null} {editing.id ? 'Zapisz' : 'Dodaj'}
            </button>
            <button type="button" className="btn btn-sm btn-secondary" onClick={cancelEdit} disabled={busy !== null}>
              Anuluj
            </button>
            {editedRow && resetsStart(editedRow, f) && <span className="crm-muted">Zmiana serwera, loginu lub folderu zeruje punkt startu: starsze maile nie będą czytane.</span>}
          </div>

          {editing.test && (
            <div className={`crm-poczta-test ${editing.test.ok ? 'crm-poczta-test--ok' : 'crm-poczta-test--bad'}`}>
              {editing.test.ok ? (
                <>
                  <b>Połączenie działa.</b> Folderów: {editing.test.foldery?.length ?? 0}
                  {editing.test.folder_sprawdzony ? ` · folder „${editing.test.folder_sprawdzony}”: ${editing.test.maili_w_folderze ?? 0} maili` : ''}
                  {editing.test.folder_wyslane_podpowiedz ? ` · Wysłane: „${editing.test.folder_wyslane_podpowiedz}”` : ''}
                  {editing.test.folder_odebrane_podpowiedz ? ` · Odebrane: „${editing.test.folder_odebrane_podpowiedz}”` : ''}
                  {editing.test.blad_folderu ? <span className="crm-text-bad"> · folder: {editing.test.blad_folderu}</span> : null}
                </>
              ) : (
                <>
                  <b>Połączenie nie działa:</b> {editing.test.blad || 'nieznany błąd'}
                  {editing.test.dziennik != null && (
                    <details className="crm-details crm-details--inline">
                      <summary>dziennik połączenia</summary>
                      <pre className="crm-poczta-log">{typeof editing.test.dziennik === 'string' ? editing.test.dziennik : JSON.stringify(editing.test.dziennik, null, 2)}</pre>
                    </details>
                  )}
                </>
              )}
            </div>
          )}
        </section>
      )}

      {/* LISTA */}
      {rows.length === 0 ? (
        <section className="crm-box">
          <p className="crm-pending-text">Nie ma jeszcze żadnej skrzynki. {isSuperadmin ? 'Dodaj główną skrzynkę firmową.' : 'Możesz dodać swoją skrzynkę osobistą.'}</p>
        </section>
      ) : (
        <ul className="crm-skrzynki">
          {rows.map((s) => {
            const fresh = hasFreshError(s)
            const w = wyniki.get(s.id)
            const checking = busy === `check:${s.id}` || busy === 'check:all'
            return (
              <li key={s.id} className={`crm-box crm-skrzynka${fresh ? ' crm-box--bad' : s.aktywna ? ' crm-box--ok' : ''}${!s.aktywna ? ' crm-skrzynka--off' : ''}`}>
                <div className="crm-skrzynka-head">
                  <div className="crm-skrzynka-title">
                    <b>{s.nazwa || s.login}</b>
                    <span className="crm-muted"> · {s.login} @ {s.host}:{s.port}</span>
                    {!s.aktywna && <span className="crm-status crm-status--muted">wyłączona</span>}
                    {!s.ma_haslo && <span className="crm-status crm-status--lost">brak hasła</span>}
                    {s.czyta_wyslane && <span className="crm-call-typ">Wysłane: {s.folder_wyslane}</span>}
                    {s.czyta_odebrane && <span className="crm-call-typ">Odebrane: {s.folder_odebrane}</span>}
                    <span className="crm-call-typ">{s.user_id ? `osobista: ${ownerLabel(s.user_id)}` : 'wspólna'}</span>
                    {s.handlowiec && <span className="crm-muted">podpis: {s.handlowiec}</span>}
                  </div>
                  <div className="crm-skrzynka-btns">
                    <button type="button" className="btn btn-sm btn-secondary" onClick={() => void onCheck(s.id)} disabled={busy !== null} title="Sprawdź tę skrzynkę teraz (także wyłączoną)">
                      {checking ? <Spinner inline size={14} /> : null} Sprawdź teraz
                    </button>
                    {isSuperadmin && s.czyta_wyslane && (
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        onClick={() => void onProbki(s)}
                        disabled={busy !== null}
                        title={`Wczytuje ostatnie ${CRM_PROBKI_STYLU_ILE} maili z folderu Wysłane sprzed punktu startu jako próbki stylu do szkiców odpowiedzi (bez dopasowania do zadań). Można powtarzać — duplikaty są pomijane.`}
                      >
                        {busy === `probki:${s.id}` ? <Spinner inline size={14} /> : null} Wczytaj {CRM_PROBKI_STYLU_ILE} wysłanych jako próbki stylu
                      </button>
                    )}
                    {canEdit(s) && (
                      <>
                        <button type="button" className="btn btn-sm btn-secondary" onClick={() => startEdit(s)} disabled={busy !== null}>
                          Edytuj
                        </button>
                        <button type="button" className="btn btn-sm btn-secondary" onClick={() => void onDelete(s)} disabled={busy !== null} title="Usuń skrzynkę (hasło i punkt startu przepadają)">
                          Usuń
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <ul className="crm-poczta-status-list">
                  <li>
                    Ostatnie sprawdzenie {fmtDateTime(s.ostatnie_sprawdzenie_at)} · ostatni sukces {fmtDateTime(s.ostatni_sukces_at)} · przetworzono maili {s.przetworzono_maili ?? 0}
                  </li>
                  {s.ostatni_blad && (
                    <li className={fresh ? 'crm-text-bad' : 'crm-muted'}>
                      {fresh ? 'Błąd' : 'Ostatni błąd (już nieaktualny)'} {fmtDateTime(s.ostatni_blad_at)}: {s.ostatni_blad}
                    </li>
                  )}
                  {w && !w.ok && !w.pominieto && <li className="crm-text-bad">Sprawdzenie: {w.blad || 'błąd'}</li>}
                  {w && w.pominieto && <li className="crm-muted">Pominięta (wyłączona) — użyj „Sprawdź teraz” przy skrzynce, żeby sprawdzić mimo to.</li>}
                  {w && w.ok && (
                    <>
                      <FolderWynikLine label="Wysłane" w={w.wyslane} />
                      <FolderWynikLine label="Odebrane" w={w.odebrane} />
                    </>
                  )}
                </ul>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
