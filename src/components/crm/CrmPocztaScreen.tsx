// =====================================================================
// CRM Po Drzwi → „Poczta”: konfiguracja skrzynki IMAP Magdy (brief pkt 10,
// 14.11.2026). Skrzynkę czyta sama funkcja Supabase crm-mail-sent (cron co 5 min):
// mail wysłany do adresu z oferty zamyka ofertę, mail do leada zamyka zadanie.
// Każdy z dostępem do CRM widzi status; edytuje tylko superadmin (rpc ustaw_poczte
// sam odrzuca innych). Hasło: type=password, nigdy nie pokazywane, w stanie tylko
// do zapisu/testu, puste przy edycji = bez zmiany.
// =====================================================================
import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, PlugZap, Save, MailCheck } from 'lucide-react'
import type { ToastVariant } from '../../types'
import {
  CRM_POCZTA_DEFAULT_FOLDER,
  CRM_POCZTA_DEFAULT_PORT,
  type CrmPoczta,
  type CrmPocztaFolder,
  type CrmPocztaSprawdzenie,
  type CrmPocztaTest,
} from '../../types/crm'
import { fetchPoczta, savePoczta, sprawdzPoczte, testPoczta, type CrmError, type PocztaForm } from '../../hooks/useCrm'
import { appConfirm } from '../../lib/appDialogs'
import Spinner from '../Spinner'

type Props = {
  canEdit: boolean
  pushToast: (message: string, variant: ToastVariant) => void
}

const fmtDateTime = (iso: string | null | undefined): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const formFromRow = (row: CrmPoczta | null): PocztaForm => ({
  host: row?.host ?? '',
  port: row?.port ?? CRM_POCZTA_DEFAULT_PORT,
  login: row?.login ?? '',
  folder: row?.folder ?? CRM_POCZTA_DEFAULT_FOLDER,
  aktywna: row?.aktywna ?? true,
})

const sameForm = (a: PocztaForm, b: PocztaForm): boolean =>
  a.host.trim() === b.host.trim() && a.port === b.port && a.login.trim() === b.login.trim() && a.folder.trim() === b.folder.trim() && a.aktywna === b.aktywna

/** Błąd „świeży”, gdy jest nowszy od ostatniego sukcesu (albo sukcesu nie było). */
const hasFreshError = (row: CrmPoczta | null): boolean => {
  if (!row?.ostatni_blad) return false
  if (!row.ostatni_sukces_at) return true
  if (!row.ostatni_blad_at) return false
  return new Date(row.ostatni_blad_at).getTime() > new Date(row.ostatni_sukces_at).getTime()
}

export default function CrmPocztaScreen({ canEdit, pushToast }: Props) {
  const [row, setRow] = useState<CrmPoczta | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<CrmError | null>(null)
  const [form, setForm] = useState<PocztaForm>(formFromRow(null))
  const [haslo, setHaslo] = useState('')
  const [foldery, setFoldery] = useState<CrmPocztaFolder[] | null>(null)
  const [test, setTest] = useState<CrmPocztaTest | null>(null)
  const [sprawdzenie, setSprawdzenie] = useState<CrmPocztaSprawdzenie | null>(null)
  const [busy, setBusy] = useState<'test' | 'save' | 'check' | null>(null)

  const load = useCallback(async () => {
    const res = await fetchPoczta()
    setError(res.error)
    if (!res.error) {
      setRow(res.data)
      setForm(formFromRow(res.data))
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const dirty = !sameForm(form, formFromRow(row)) || haslo !== ''
  const configured = !!(row?.host && row?.login)
  const freshError = hasFreshError(row)

  const onTest = async () => {
    if (!form.host.trim() || !form.login.trim()) {
      pushToast('Podaj serwer i login skrzynki', 'error')
      return
    }
    if (!haslo && !row?.ma_haslo) {
      pushToast('Podaj hasło do skrzynki (nie ma jeszcze zapisanego)', 'error')
      return
    }
    setBusy('test')
    setTest(null)
    try {
      const res = await testPoczta(form, haslo)
      setTest(res)
      if (res.ok) {
        const list = res.foldery ?? []
        setFoldery(list)
        // podpowiedź folderu Wysłane: ustaw, gdy obecny wybór nie istnieje na serwerze
        const names = new Set(list.map((f) => f.nazwa))
        const hint = res.folder_podpowiedz || list.find((f) => f.wyslane)?.nazwa || null
        if (hint && !names.has(form.folder.trim())) setForm((f) => ({ ...f, folder: hint }))
        pushToast(res.blad_folderu ? `Połączenie działa, ale folder: ${res.blad_folderu}` : 'Połączenie ze skrzynką działa', res.blad_folderu ? 'error' : 'success')
      } else {
        pushToast(res.blad || 'Połączenie nie powiodło się', 'error')
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Błąd testu połączenia'
      setTest({ ok: false, blad: msg })
      pushToast(msg, 'error')
    } finally {
      setBusy(null)
    }
  }

  const onSave = async (removePassword = false) => {
    if (!form.host.trim() || !form.login.trim()) {
      pushToast('Podaj serwer i login skrzynki', 'error')
      return
    }
    if (!Number.isInteger(form.port) || form.port < 1 || form.port > 65535) {
      pushToast('Port musi być liczbą 1–65535 (IMAP szyfrowany: 993)', 'error')
      return
    }
    if (removePassword && !(await appConfirm('Usunąć zapisane hasło do skrzynki? Sprawdzanie poczty przestanie działać do wpisania nowego.'))) return
    setBusy('save')
    try {
      const res = await savePoczta(form, removePassword ? '' : haslo === '' ? null : haslo)
      if (res.error) {
        pushToast(res.error.message, 'error')
        return
      }
      setHaslo('')
      pushToast(removePassword ? 'Hasło usunięte' : 'Ustawienia skrzynki zapisane', 'success')
      await load()
    } finally {
      setBusy(null)
    }
  }

  const onCheck = async () => {
    setBusy('check')
    setSprawdzenie(null)
    try {
      const res = await sprawdzPoczte()
      setSprawdzenie(res)
      if (!res.ok) pushToast(res.blad || 'Sprawdzenie poczty nie powiodło się', 'error')
      else if ('start' in res && res.start) pushToast('Punkt startu ustawiony — od teraz nowe maile będą przetwarzane', 'success')
      else pushToast(`Sprawdzono: ${'nowych' in res ? res.nowych ?? 0 : 0} nowych maili`, 'success')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Błąd sprawdzania poczty'
      setSprawdzenie({ ok: false, blad: msg })
      pushToast(msg, 'error')
    } finally {
      await load()
      setBusy(null)
    }
  }

  const set = <K extends keyof PocztaForm>(key: K, value: PocztaForm[K]) => setForm((f) => ({ ...f, [key]: value }))
  const folderOptions: CrmPocztaFolder[] = (() => {
    if (!foldery) return []
    const cur = form.folder.trim()
    return cur && !foldery.some((f) => f.nazwa === cur) ? [{ nazwa: cur }, ...foldery] : foldery
  })()

  if (loading) return <Spinner center label="Ładowanie ustawień poczty…" />

  return (
    <div className="crm-screen crm-poczta">
      <div className="crm-screen-head">
        <div className="crm-screen-title">
          <h3>Poczta — skrzynka handlowca</h3>
          <div className="crm-screen-sub">
            System co 5 minut zagląda do folderu Wysłane tej skrzynki. Mail do adresu z oferty oznacza ofertę jako wysłaną, mail do klienta zamyka zadanie „Dopytaj” lub „Follow-up”.
          </div>
        </div>
        <button type="button" className="btn btn-sm btn-secondary" onClick={() => void load()} title="Odśwież status">
          <RefreshCw size={14} /> Odśwież
        </button>
      </div>

      {error && <div className="crm-box crm-box--bad">{error.message}</div>}

      {/* STATUS */}
      <section className={`crm-box crm-poczta-status${freshError ? ' crm-box--bad' : configured ? ' crm-box--ok' : ''}`}>
        <h4>Stan</h4>
        {!configured ? (
          <p className="crm-pending-text">Skrzynka nie jest jeszcze skonfigurowana.{canEdit ? ' Wpisz dane poniżej, przetestuj połączenie i zapisz.' : ' Poproś administratora o konfigurację.'}</p>
        ) : (
          <ul className="crm-poczta-status-list">
            <li>
              <b>{row?.aktywna ? 'Włączona' : 'Wyłączona'}</b> · {row?.login} @ {row?.host}:{row?.port} · folder „{row?.folder}”{row?.ma_haslo ? '' : ' · BRAK HASŁA'}
            </li>
            <li>
              Ostatnie sprawdzenie {fmtDateTime(row?.ostatnie_sprawdzenie_at)} · ostatni sukces {fmtDateTime(row?.ostatni_sukces_at)} · przetworzono maili {row?.przetworzono_maili ?? 0}
            </li>
            {row?.ostatni_blad && (
              <li className={freshError ? 'crm-text-bad' : 'crm-muted'}>
                {freshError ? 'Błąd' : 'Ostatni błąd (już nieaktualny)'} {fmtDateTime(row.ostatni_blad_at)}: {row.ostatni_blad}
              </li>
            )}
          </ul>
        )}
        {configured && (
          <div className="crm-poczta-actions">
            {/* sprawdzenie idzie po ZAPISANEJ konfiguracji — przy niezapisanych zmianach wprowadzałoby w błąd (wpadka 14.11: test OK na 993, sprawdzenie padło na zapisanym 143) */}
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              onClick={() => void onCheck()}
              disabled={busy !== null || (canEdit && dirty)}
              title={canEdit && dirty ? 'Najpierw zapisz zmiany — sprawdzenie używa zapisanych ustawień' : 'Sprawdź folder Wysłane teraz, nie czekając na automat'}
            >
              {busy === 'check' ? <Spinner inline size={14} /> : <MailCheck size={14} />} Sprawdź teraz
            </button>
            {canEdit && dirty && <span className="crm-muted">Najpierw kliknij „Zapisz” — sprawdzenie używa zapisanych ustawień.</span>}
            {sprawdzenie && sprawdzenie.ok && 'start' in sprawdzenie && sprawdzenie.start && (
              <span className="crm-muted">Punkt startu: folder „{sprawdzenie.folder}”, {sprawdzenie.maili_w_folderze ?? 0} maili w folderze; starsze nie są przetwarzane.</span>
            )}
            {sprawdzenie && sprawdzenie.ok && !('start' in sprawdzenie && sprawdzenie.start) && (
              <span className="crm-muted">
                Nowych maili: {'nowych' in sprawdzenie ? sprawdzenie.nowych ?? 0 : 0}
                {'wyniki' in sprawdzenie && sprawdzenie.wyniki && sprawdzenie.wyniki.length > 0
                  ? ` — ${sprawdzenie.wyniki.map((w) => w.temat || `uid ${w.uid ?? '?'}`).join(' · ')}`
                  : ''}
              </span>
            )}
            {sprawdzenie && !sprawdzenie.ok && <span className="crm-text-bad">{sprawdzenie.blad || 'błąd'}</span>}
          </div>
        )}
      </section>

      {/* KONFIGURACJA */}
      <section className="crm-box">
        <h4>Ustawienia IMAP {canEdit ? '' : '(podgląd — zmienia tylko superadministrator)'}</h4>
        <div className="crm-form-grid">
          <label className="crm-field">
            <span className="crm-field-label">Serwer IMAP</span>
            <input type="text" value={form.host} onChange={(e) => set('host', e.target.value)} disabled={!canEdit} placeholder="np. mail25.mydevil.net" autoComplete="off" />
          </label>
          <label className="crm-field crm-field--short">
            <span className="crm-field-label">Port</span>
            <input
              type="number"
              min={1}
              max={65535}
              value={form.port}
              onChange={(e) => set('port', Number.parseInt(e.target.value, 10) || 0)}
              disabled={!canEdit}
            />
            {/* crm-mail-sent v6 (14.11): 993 = TLS od razu, inne porty = STARTTLS; oba działają na mydevil, zalecamy 993 */}
            <span className="crm-field-hint">
              {form.port === CRM_POCZTA_DEFAULT_PORT
                ? '993 = połączenie szyfrowane (SSL/TLS), zalecane'
                : `Zalecany port ${CRM_POCZTA_DEFAULT_PORT} (SSL/TLS). Inne porty, np. 143, łączą się przez STARTTLS — też działa.`}
            </span>
          </label>
          <label className="crm-field">
            <span className="crm-field-label">Login (pełny adres skrzynki)</span>
            <input type="email" value={form.login} onChange={(e) => set('login', e.target.value)} disabled={!canEdit} placeholder="imie@podrzwi.pl" autoComplete="off" />
          </label>
          <label className="crm-field">
            <span className="crm-field-label">Hasło</span>
            <input
              type="password"
              value={haslo}
              onChange={(e) => setHaslo(e.target.value)}
              disabled={!canEdit}
              placeholder={row?.ma_haslo ? '•••••••• (zapisane — puste = bez zmiany)' : 'hasło do skrzynki'}
              autoComplete="new-password"
            />
            <span className="crm-field-hint">
              {row?.ma_haslo ? 'Hasło jest zapisane w sejfie; nigdy nie jest wyświetlane.' : 'Nie ma jeszcze zapisanego hasła.'}
              {canEdit && row?.ma_haslo && (
                <>
                  {' '}
                  <button type="button" className="crm-link" onClick={() => void onSave(true)} disabled={busy !== null}>
                    usuń zapisane hasło
                  </button>
                </>
              )}
            </span>
          </label>
          <label className="crm-field">
            <span className="crm-field-label">Folder „Wysłane”</span>
            {folderOptions.length > 0 ? (
              <select value={form.folder} onChange={(e) => set('folder', e.target.value)} disabled={!canEdit}>
                {folderOptions.map((f) => (
                  <option key={f.nazwa} value={f.nazwa}>
                    {f.nazwa}
                    {f.wyslane ? ' (Wysłane)' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <input type="text" value={form.folder} onChange={(e) => set('folder', e.target.value)} disabled={!canEdit} placeholder={CRM_POCZTA_DEFAULT_FOLDER} autoComplete="off" />
            )}
            <span className="crm-field-hint">
              {foldery ? 'Lista z serwera po teście połączenia.' : 'Po „Testuj połączenie” pojawi się lista folderów z serwera z podpowiedzią.'}
            </span>
          </label>
          <label className="crm-field crm-field--check">
            <input type="checkbox" checked={form.aktywna} onChange={(e) => set('aktywna', e.target.checked)} disabled={!canEdit} />
            <span className="crm-field-label">Włączone (automat sprawdza co 5 minut)</span>
          </label>
        </div>

        {canEdit && (
          <div className="crm-poczta-actions">
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => void onTest()} disabled={busy !== null}>
              {busy === 'test' ? <Spinner inline size={14} /> : <PlugZap size={14} />} Testuj połączenie
            </button>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => void onSave()} disabled={busy !== null || !dirty}>
              {busy === 'save' ? <Spinner inline size={14} /> : <Save size={14} />} Zapisz
            </button>
            {dirty && <span className="crm-muted">Niezapisane zmiany.</span>}
            {(form.host.trim() !== (row?.host ?? '') || form.login.trim() !== (row?.login ?? '') || form.folder.trim() !== (row?.folder ?? '')) && configured && (
              <span className="crm-muted">Zmiana serwera, loginu lub folderu zeruje punkt startu: starsze maile nie będą przetwarzane.</span>
            )}
          </div>
        )}

        {test && (
          <div className={`crm-poczta-test ${test.ok ? 'crm-poczta-test--ok' : 'crm-poczta-test--bad'}`}>
            {test.ok ? (
              <>
                <b>Połączenie działa.</b> Folderów: {test.foldery?.length ?? 0}
                {test.folder_sprawdzony ? ` · sprawdzony folder „${test.folder_sprawdzony}”: ${test.maili_w_folderze ?? 0} maili` : ''}
                {test.folder_podpowiedz ? ` · podpowiedź: „${test.folder_podpowiedz}”` : ''}
                {test.blad_folderu ? <span className="crm-text-bad"> · folder: {test.blad_folderu}</span> : null}
              </>
            ) : (
              <>
                <b>Połączenie nie działa:</b> {test.blad || 'nieznany błąd'}
                {test.dziennik != null && (
                  <details className="crm-details crm-details--inline">
                    <summary>dziennik połączenia</summary>
                    <pre className="crm-poczta-log">{typeof test.dziennik === 'string' ? test.dziennik : JSON.stringify(test.dziennik, null, 2)}</pre>
                  </details>
                )}
              </>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
