// =====================================================================
// CRM Po Drzwi → „Pomoc”: instrukcja pracy w CRM z tabeli crm.pomoc (markdown),
// żeby poprawki nie wymagały nowej wersji aplikacji. Czyta każdy z dostępem do CRM,
// superadmin ma prosty edytor (textarea + podgląd), „Dodaj stronę” i „Usuń”.
// Markdown renderuje lib/crmMarkdown (bez surowego HTML, linki tylko http/mailto),
// linki otwieramy przez openExternalUrl (Electron: shell:open-external).
// =====================================================================
import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react'
import type { CurrentUser, ToastVariant } from '../../types'
import type { CrmPomocStrona } from '../../types/crm'
import { addPomoc, deletePomoc, fetchPomoc, savePomoc, type CrmError } from '../../hooks/useCrm'
import { crmMarkdownToHtml } from '../../lib/crmMarkdown'
import { openExternalUrl } from '../../hooks/useAluOrders'
import { appConfirm } from '../../lib/appDialogs'
import Spinner from '../Spinner'

type Props = {
  currentUser: CurrentUser | null
  canEdit: boolean
  pushToast: (message: string, variant: ToastVariant) => void
}

const slugFrom = (t: string) =>
  t
    .toLowerCase()
    .replace(/ą/g, 'a').replace(/ć/g, 'c').replace(/ę/g, 'e').replace(/ł/g, 'l').replace(/ń/g, 'n').replace(/ó/g, 'o').replace(/ś/g, 's').replace(/ż|ź/g, 'z')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)

const fmtDateTime = (iso: string | null | undefined): string => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function MarkdownView({ md }: { md: string | null | undefined }) {
  const html = useMemo(() => crmMarkdownToHtml(md), [md])
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement).closest('a')
    if (!a) return
    e.preventDefault()
    const href = a.getAttribute('href') ?? ''
    if (href) openExternalUrl(href)
  }
  if (!html) return <p className="crm-muted">Ta strona jest jeszcze pusta.</p>
  // HTML pochodzi z markdown po ucieczce znaczników i filtrze linków (crmMarkdownToHtml)
  return <div className="crm-md" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
}

type Draft = { slug: string | null; tytul: string; tresc_md: string }

export default function CrmPomocScreen({ currentUser, canEdit, pushToast }: Props) {
  const [strony, setStrony] = useState<CrmPomocStrona[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<CrmError | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await fetchPomoc()
    setError(res.error)
    if (!res.error) {
      setStrony(res.data)
      setActive((cur) => (cur && res.data.some((s) => s.slug === cur) ? cur : res.data[0]?.slug ?? null))
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const page = strony.find((s) => s.slug === active) ?? null

  const startEdit = () => page && setDraft({ slug: page.slug, tytul: page.tytul, tresc_md: page.tresc_md ?? '' })
  const startAdd = () => setDraft({ slug: null, tytul: '', tresc_md: '# Tytuł\n\nTreść…' })

  const onSave = async () => {
    if (!draft || !currentUser) return
    if (!draft.tytul.trim()) {
      pushToast('Podaj tytuł strony', 'error')
      return
    }
    setBusy(true)
    let err: CrmError | null
    let slug = draft.slug
    if (slug) {
      err = await savePomoc(slug, { tytul: draft.tytul, tresc_md: draft.tresc_md }, currentUser.id)
    } else {
      slug = slugFrom(draft.tytul) || `strona-${Date.now()}`
      if (strony.some((s) => s.slug === slug)) slug = `${slug}-${strony.length + 1}`
      const kolejnosc = (Math.max(0, ...strony.map((s) => s.kolejnosc ?? 0)) || 0) + 10
      err = await addPomoc({ slug, tytul: draft.tytul, tresc_md: draft.tresc_md, kolejnosc }, currentUser.id)
    }
    setBusy(false)
    if (err) {
      pushToast(err.message, 'error')
      return
    }
    pushToast('Strona zapisana', 'success')
    setDraft(null)
    await load()
    setActive(slug)
  }

  const onDelete = async () => {
    if (!page) return
    if (!(await appConfirm(`Usunąć stronę „${page.tytul}”? Tej operacji nie da się cofnąć.`, { title: 'Usuń stronę', confirmLabel: 'Usuń' }))) return
    setBusy(true)
    const err = await deletePomoc(page.slug)
    setBusy(false)
    if (err) {
      pushToast(err.message, 'error')
      return
    }
    pushToast('Strona usunięta', 'success')
    setActive(null)
    await load()
  }

  if (loading) return <Spinner center label="Ładowanie pomocy…" />

  return (
    <div className="crm-screen crm-pomoc">
      {error && <div className="crm-box crm-box--bad">{error.message}</div>}
      <div className="crm-pomoc-layout">
        <aside className="crm-pomoc-nav">
          <div className="crm-pomoc-nav-head">
            <b>Pomoc</b>
            <button type="button" className="crm-link" onClick={() => void load()} title="Odśwież">Odśwież</button>
          </div>
          {strony.length === 0 && <p className="crm-muted">Brak stron pomocy.</p>}
          <ul>
            {strony.map((s) => (
              <li key={s.slug}>
                <button type="button" className={`crm-pomoc-nav-btn${s.slug === active ? ' crm-pomoc-nav-btn--active' : ''}`} onClick={() => { setActive(s.slug); setDraft(null) }}>
                  {s.tytul}
                </button>
              </li>
            ))}
          </ul>
          {canEdit && (
            <button type="button" className="btn btn-sm btn-secondary crm-pomoc-add" onClick={startAdd} disabled={busy}>
              Dodaj stronę
            </button>
          )}
        </aside>

        <section className="crm-box crm-pomoc-page">
          {draft ? (
            <div className="crm-pomoc-editor">
              <div className="crm-pomoc-editor-head">
                <input type="text" value={draft.tytul} onChange={(e) => setDraft((d) => (d ? { ...d, tytul: e.target.value } : d))} placeholder="Tytuł strony" aria-label="Tytuł strony" />
                <div className="crm-poczta-actions">
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => void onSave()} disabled={busy}>
                    {busy ? <Spinner inline size={14} /> : null} Zapisz
                  </button>
                  <button type="button" className="btn btn-sm btn-secondary" onClick={() => setDraft(null)} disabled={busy}>
                    Anuluj
                  </button>
                </div>
              </div>
              <p className="crm-muted crm-pomoc-hint">Markdown: # nagłówek, - lista, **pogrubienie**, tabela | w | kreskach |. Surowy HTML nie działa (pokazuje się jako tekst).</p>
              <div className="crm-pomoc-split">
                <textarea value={draft.tresc_md} onChange={(e) => setDraft((d) => (d ? { ...d, tresc_md: e.target.value } : d))} spellCheck aria-label="Treść (markdown)" />
                <div className="crm-pomoc-preview">
                  <MarkdownView md={draft.tresc_md} />
                </div>
              </div>
            </div>
          ) : page ? (
            <>
              <div className="crm-screen-head">
                <div className="crm-screen-title">
                  <h3>{page.tytul}</h3>
                  {page.updated_at && <div className="crm-screen-sub">aktualizacja {fmtDateTime(page.updated_at)}</div>}
                </div>
                {canEdit && (
                  <div className="crm-skrzynka-btns">
                    <button type="button" className="btn btn-sm btn-secondary" onClick={startEdit} disabled={busy}>Edytuj</button>
                    <button type="button" className="btn btn-sm btn-secondary" onClick={() => void onDelete()} disabled={busy} title="Usuń stronę">Usuń</button>
                  </div>
                )}
              </div>
              <MarkdownView md={page.tresc_md} />
            </>
          ) : (
            <p className="crm-muted">Wybierz stronę z listy.</p>
          )}
        </section>
      </div>
    </div>
  )
}
