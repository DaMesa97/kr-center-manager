import { useState } from 'react'
import { Clock, ExternalLink, Paperclip } from 'lucide-react'
import type { CrmMail } from '../../types/crm'
import { bezCytatu, czekaNaOdpowiedz, watek, zajawka } from '../../lib/crmKorespondencja'

const fmtDateTime = (iso: string | null | undefined): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const kto = (m: CrmMail): string =>
  m.kierunek === 'wychodzacy'
    ? `My → ${(m.do_adresy ?? []).join(', ') || 'klient'}`
    : (m.od_nazwa || m.od_adres || 'Klient').trim()

/**
 * Korespondencja z klientem (karta klienta v2, 20.11): maile jako wątek jak w komunikatorze —
 * od najstarszego, od klienta z lewej, nasze z prawej; ostatni rozwinięty, reszta zwinięta do zajawki;
 * treść bez cytowanej historii. „Klient czeka na odpowiedź”, gdy ostatni mail jest od niego.
 */
export default function CrmKorespondencja({ maile, onOpenMail }: { maile: CrmMail[]; onOpenMail: (id: string) => void }) {
  const lista = watek(maile)
  const ostatniId = lista[lista.length - 1]?.id
  const [otwarte, setOtwarte] = useState<Record<string, boolean>>({})
  const [zCytatami, setZCytatami] = useState<Record<string, boolean>>({})
  const czeka = czekaNaOdpowiedz(lista)

  if (lista.length === 0) return <p className="crm-muted">Brak maili z tym klientem.</p>

  return (
    <div className="crm-kor">
      {czeka && (
        <div className="crm-kor-czeka" role="status">
          <Clock size={15} aria-hidden="true" /> Klient czeka na odpowiedź od {fmtDateTime(czeka.data ?? czeka.created_at)}
        </div>
      )}
      <ol className="crm-kor-lista" aria-label="Maile z klientem">
        {lista.map((m) => {
          const nasz = m.kierunek === 'wychodzacy'
          const open = otwarte[m.id] ?? m.id === ostatniId
          const tresc = bezCytatu(m.tresc)
          const pelna = (m.tresc ?? '').trim()
          const maCytaty = !!tresc && pelna.length > tresc.length + 20
          return (
            <li key={m.id} className={`crm-kor-wiersz${nasz ? ' crm-kor-wiersz--nasz' : ''}`}>
              <article className={`crm-kor-mail${nasz ? ' crm-kor-mail--nasz' : ''}`}>
                <div className="crm-kor-head">
                  <b>{kto(m)}</b>
                  <span className="crm-muted">{fmtDateTime(m.data ?? m.created_at)}</span>
                  <span className="crm-kor-spacer" />
                  <button type="button" className="crm-link" aria-expanded={open} onClick={() => setOtwarte((o) => ({ ...o, [m.id]: !open }))}>
                    {open ? 'Zwiń' : 'Rozwiń'}
                  </button>
                  <button type="button" className="crm-link" onClick={() => onOpenMail(m.id)} title="Otwórz cały mail z nagłówkami i załącznikami">
                    <ExternalLink size={13} aria-hidden="true" /> otwórz
                  </button>
                </div>
                <div className="crm-kor-temat">{m.temat || '(bez tematu)'}</div>
                {open ? (
                  <p className="crm-kor-tresc">
                    {(zCytatami[m.id] ? pelna : tresc) || m.podsumowanie || <span className="crm-muted">(pusta treść)</span>}
                  </p>
                ) : (
                  <p className="crm-kor-zajawka">{zajawka(m.tresc) || m.podsumowanie || ''}</p>
                )}
                {open && maCytaty && (
                  <button
                    type="button"
                    className="crm-link crm-kor-cytaty"
                    aria-expanded={!!zCytatami[m.id]}
                    onClick={() => setZCytatami((o) => ({ ...o, [m.id]: !o[m.id] }))}
                  >
                    {zCytatami[m.id] ? 'Ukryj cytowaną historię' : 'Pokaż całą historię z cytatami'}
                  </button>
                )}
                {open && m.tresc_ucieta && <span className="crm-muted">Treść ucięta — pełna wersja po „otwórz”.</span>}
                {m.zalaczniki && m.zalaczniki.length > 0 && (
                  <span className="crm-kor-zal" title={m.zalaczniki.map((z) => z.nazwa ?? '').join(', ')}>
                    <Paperclip size={13} aria-hidden="true" /> {m.zalaczniki.map((z) => z.nazwa ?? 'załącznik').join(', ')}
                  </span>
                )}
              </article>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
