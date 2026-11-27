// =====================================================================
// Etykiety (badge) na leadach — brief pkt 12 (14.11.2026). Słownik crm.etykiety
// (grupy: kategoria / usluga / klient / inne; „jedna na grupę” = kategoria, klient),
// na leadzie `etykiety text[]` pilnowane triggerem. Klik w badge/wybór = rpc
// przelacz_etykiete (dodaje, zdejmuje, w grupie jednokrotnej podmienia).
// Automat (crm-call-ingest v9) nadaje etykiety z analizy AI; ręczne zostają.
// =====================================================================
import { useMemo, useState } from 'react'
import type { ToastVariant } from '../../types'
import { CRM_ETYKIETA_GRUPA, CRM_ETYKIETA_GRUPY, CRM_ETYKIETA_KOLORY, CRM_KANAL, type CrmEtykieta } from '../../types/crm'

/** KANAŁ kontaktu (leady.zrodlo, brief pkt 13.1) — mały badge obok etykiet; nie mylić ze „sprawą” (typ z analizy AI). */
// v3 (27.11): bez ikonki — sama nazwa kanału (także w wariancie compact, który dotąd pokazywał tylko emoji)
export function KanalBadge({ zrodlo }: { zrodlo: string | null | undefined; compact?: boolean }) {
  if (!zrodlo) return null
  const k = CRM_KANAL[zrodlo] ?? { label: zrodlo, icon: '' }
  return (
    <span className="crm-tag crm-kanal" title={`Kanał: ${k.label}`}>
      {k.label}
    </span>
  )
}
import { addEtykieta, setEtykietaAktywna, toggleEtykieta } from '../../hooks/useCrm'

type PushToast = (message: string, variant: ToastVariant) => void

export function EtykietaBadge({ e, slug, on, onClick, title }: { e?: CrmEtykieta; slug?: string; on?: boolean; onClick?: () => void; title?: string }) {
  const kolor = e?.kolor || 'gray'
  const label = e?.nazwa ?? slug ?? '?'
  const cls = `crm-tag crm-tag--${kolor}${on === false ? ' crm-tag--off' : ''}${onClick ? ' crm-tag--btn' : ''}`
  if (onClick) {
    return (
      <button type="button" className={cls} onClick={onClick} title={title} aria-pressed={on}>
        {label}
      </button>
    )
  }
  return <span className={cls} title={title}>{label}</span>
}

/**
 * Rząd badge’y leada + przycisk „+” otwierający wybór ze słownika pogrupowany
 * (kategoria i klient jednokrotne — rpc podmienia; usługa i inne wielokrotne).
 */
export function EtykietyRow({
  leadId,
  slugi,
  slownik,
  canEdit = true,
  compact = false,
  pushToast,
  onChanged,
}: {
  leadId: string
  slugi: string[] | null | undefined
  slownik: Map<string, CrmEtykieta>
  canEdit?: boolean
  compact?: boolean
  pushToast: PushToast
  onChanged: (slugi: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const current = useMemo(() => new Set(slugi ?? []), [slugi])

  const toggle = async (slug: string) => {
    setBusy(slug)
    const res = await toggleEtykieta(leadId, slug)
    setBusy(null)
    if (res.error) {
      pushToast(`Nie udało się zmienić etykiety: ${res.error.message}`, 'error')
      return
    }
    onChanged(res.data)
  }

  const grupy = useMemo(() => {
    const out: Array<{ grupa: string; items: CrmEtykieta[] }> = []
    for (const g of CRM_ETYKIETA_GRUPY) {
      const items = [...slownik.values()].filter((e) => e.grupa === g && (e.aktywna || current.has(e.slug)))
      if (items.length) out.push({ grupa: g, items })
    }
    return out
  }, [slownik, current])

  return (
    <span className={`crm-tags${compact ? ' crm-tags--compact' : ''}`}>
      {(slugi ?? []).map((s) => (
        <EtykietaBadge
          key={s}
          e={slownik.get(s)}
          slug={s}
          onClick={canEdit ? () => void toggle(s) : undefined}
          title={canEdit ? 'Kliknij, aby zdjąć etykietę' : undefined}
        />
      ))}
      {canEdit && (
        <span className="crm-tags-pick">
          <button type="button" className="crm-tag crm-tag--add" onClick={() => setOpen((v) => !v)} title="Dodaj / zmień etykiety" aria-expanded={open}>
            {slugi && slugi.length ? '+ dodaj' : '+ etykiety'}
          </button>
          {open && (
            <>
              <span className="crm-tags-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />
              <span className="crm-tags-panel" role="dialog" aria-label="Etykiety">
                <span className="crm-tags-panel-head">
                  <b>Etykiety</b>
                  <button type="button" className="crm-link" onClick={() => setOpen(false)} aria-label="Zamknij">Zamknij</button>
                </span>
                {grupy.map(({ grupa, items }) => (
                  <span key={grupa} className="crm-tags-group">
                    <span className="crm-tags-group-name">
                      {CRM_ETYKIETA_GRUPA[grupa] ?? grupa}
                      {items[0]?.jedna_na_grupe ? <span className="crm-muted"> · jedna</span> : null}
                    </span>
                    <span className="crm-tags-group-items">
                      {items.map((e) => (
                        <EtykietaBadge key={e.slug} e={e} on={current.has(e.slug)} onClick={busy ? undefined : () => void toggle(e.slug)} title={e.aktywna ? undefined : 'etykieta wyłączona w słowniku'} />
                      ))}
                    </span>
                  </span>
                ))}
                {grupy.length === 0 && <span className="crm-muted">Słownik etykiet jest pusty.</span>}
              </span>
            </>
          )}
        </span>
      )}
    </span>
  )
}

/** Superadmin: dopisywanie etykiet do słownika + włącz/wyłącz (RLS odrzuci innych). */
export function EtykietySlownikEditor({ lista, pushToast, onChanged }: { lista: CrmEtykieta[]; pushToast: PushToast; onChanged: () => Promise<void> }) {
  const [form, setForm] = useState({ nazwa: '', slug: '', grupa: 'inne', kolor: 'gray', jedna_na_grupe: false })
  const [busy, setBusy] = useState(false)

  const slugFrom = (nazwa: string) =>
    nazwa
      .toLowerCase()
      .replace(/ą/g, 'a').replace(/ć/g, 'c').replace(/ę/g, 'e').replace(/ł/g, 'l').replace(/ń/g, 'n').replace(/ó/g, 'o').replace(/ś/g, 's').replace(/ż|ź/g, 'z')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40)

  const onAdd = async () => {
    const slug = (form.slug || slugFrom(form.nazwa)).trim()
    if (!form.nazwa.trim() || !/^[a-z0-9_]+$/.test(slug)) {
      pushToast('Podaj nazwę; identyfikator może mieć tylko małe litery, cyfry i „_”', 'error')
      return
    }
    if (lista.some((e) => e.slug === slug)) {
      pushToast(`Etykieta „${slug}” już istnieje`, 'error')
      return
    }
    setBusy(true)
    const grupaItems = lista.filter((e) => e.grupa === form.grupa)
    const err = await addEtykieta({
      slug,
      nazwa: form.nazwa.trim(),
      grupa: form.grupa,
      kolor: form.kolor,
      // reguła „jedna na grupę” jest cechą grupy — dziedziczymy po istniejących
      jedna_na_grupe: grupaItems.length ? grupaItems[0].jedna_na_grupe : form.jedna_na_grupe,
      kolejnosc: (Math.max(0, ...grupaItems.map((e) => e.kolejnosc ?? 0)) || 0) + 10,
    })
    setBusy(false)
    if (err) {
      pushToast(err.message, 'error')
      return
    }
    pushToast('Etykieta dodana', 'success')
    setForm({ nazwa: '', slug: '', grupa: form.grupa, kolor: form.kolor, jedna_na_grupe: false })
    await onChanged()
  }

  const onToggleAktywna = async (e: CrmEtykieta) => {
    setBusy(true)
    const err = await setEtykietaAktywna(e.slug, !e.aktywna)
    setBusy(false)
    if (err) {
      pushToast(err.message, 'error')
      return
    }
    await onChanged()
  }

  return (
    <details className="crm-details crm-slownik">
      <summary>Słownik etykiet ({lista.length})</summary>
      <div className="crm-details-body">
        <p className="crm-muted crm-slownik-hint">Kategoria i Klient: na leadzie najwyżej jedna z grupy. Wyłączona etykieta zostaje na leadach, ale nie da się jej już nadać. Automat nadaje: kategoria z analizy, dostawa/odbiór, montaż, rodzaj klienta, Czyste Powietrze; „pilne” i „pomiar” tylko ręcznie.</p>
        {CRM_ETYKIETA_GRUPY.map((g) => {
          const items = lista.filter((e) => e.grupa === g)
          if (!items.length) return null
          return (
            <div key={g} className="crm-tags-group">
              <span className="crm-tags-group-name">{CRM_ETYKIETA_GRUPA[g]}</span>
              <span className="crm-tags-group-items">
                {items.map((e) => (
                  <EtykietaBadge key={e.slug} e={e} on={e.aktywna} onClick={busy ? undefined : () => void onToggleAktywna(e)} title={`${e.slug} · kliknij, aby ${e.aktywna ? 'wyłączyć' : 'włączyć'}`} />
                ))}
              </span>
            </div>
          )
        })}
        <div className="crm-slownik-form">
          <input type="text" value={form.nazwa} onChange={(e) => setForm((f) => ({ ...f, nazwa: e.target.value }))} placeholder="Nazwa, np. Hotel" aria-label="Nazwa etykiety" />
          <input type="text" value={form.slug} onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))} placeholder={slugFrom(form.nazwa) || 'identyfikator'} aria-label="Identyfikator" title="małe litery, cyfry, _ (puste = z nazwy)" />
          <select value={form.grupa} onChange={(e) => setForm((f) => ({ ...f, grupa: e.target.value }))} aria-label="Grupa">
            {CRM_ETYKIETA_GRUPY.map((g) => <option key={g} value={g}>{CRM_ETYKIETA_GRUPA[g]}</option>)}
          </select>
          <select value={form.kolor} onChange={(e) => setForm((f) => ({ ...f, kolor: e.target.value }))} aria-label="Kolor" className={`crm-tag crm-tag--${form.kolor}`}>
            {CRM_ETYKIETA_KOLORY.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => void onAdd()} disabled={busy}>Dodaj etykietę</button>
        </div>
      </div>
    </details>
  )
}
