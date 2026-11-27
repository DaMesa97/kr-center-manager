// =====================================================================
// Łączenie duplikatów klientów (brief pkt 26): jeden panel dla banera na karcie
// klienta i dla listy „Duplikaty” w Kontaktach. Wybór, który kontakt ZOSTAJE (cel),
// drugi (źródło) wchodzi w niego przez rpc crm.polacz_leady — nieodwracalnie:
// historia, oferty, rozmowy, maile i dokumenty źródła przechodzą na cel, kontakt
// źródła ląduje w leady.inne_kontakty, źródło znika. Rysowane w miejscu, bez
// natywnych dialogów; ostatnie potwierdzenie przez appConfirm (panel aplikacji).
// =====================================================================
import { useState } from 'react'
import type { ToastVariant } from '../../types'
import type { CrmStronaPolaczenia } from '../../types/crm'
import { polaczLeady } from '../../hooks/useCrm'
import { appConfirm } from '../../lib/appDialogs'
import Spinner from '../Spinner'

type Props = {
  a: CrmStronaPolaczenia
  b: CrmStronaPolaczenia
  powod: string
  pewnosc: number
  /** id strony proponowanej jako cel; brak = heurystyka (pełniejsze dane, dłuższa nazwa) */
  domyslnyCel?: string
  /** liczba wpisów historii / ofert znana dla strony a (karta klienta) — pokazujemy w opisie */
  opisA?: string
  opisB?: string
  pushToast: (message: string, variant: ToastVariant) => void
  /** po udanym połączeniu: id celu (ten klient zostaje) */
  onDone: (celId: string) => void
  onCancel: () => void
}

const stronaLabel = (s: CrmStronaPolaczenia): string => (s.nazwa || s.telefon || s.email || 'Klient bez nazwy').trim()

/** pełniejszy kontakt = więcej wypełnionych pól, przy remisie dłuższa nazwa */
function proponowanyCel(a: CrmStronaPolaczenia, b: CrmStronaPolaczenia): string {
  const score = (s: CrmStronaPolaczenia) => [s.nazwa, s.email, s.telefon, s.miejscowosc].filter((x) => (x ?? '').trim()).length
  const sa = score(a)
  const sb = score(b)
  if (sa !== sb) return sa > sb ? a.id : b.id
  return (b.nazwa ?? '').trim().length > (a.nazwa ?? '').trim().length ? b.id : a.id
}

function Strona({ s, opis }: { s: CrmStronaPolaczenia; opis?: string }) {
  return (
    <span className="crm-polacz-strona">
      <b>{stronaLabel(s)}</b>
      <span className="crm-muted">
        {[s.telefon, s.email, s.miejscowosc].filter((x) => (x ?? '').trim()).join(' · ') || 'brak danych kontaktowych'}
        {opis ? ` · ${opis}` : ''}
      </span>
    </span>
  )
}

export default function CrmPolaczPanel({ a, b, powod, pewnosc, domyslnyCel, opisA, opisB, pushToast, onDone, onCancel }: Props) {
  const [cel, setCel] = useState<string>(domyslnyCel ?? proponowanyCel(a, b))
  const [busy, setBusy] = useState(false)
  const celS = cel === a.id ? a : b
  const zrodloS = cel === a.id ? b : a

  const run = async () => {
    const ok = await appConfirm(
      `Połączyć klientów? „${stronaLabel(zrodloS)}” wejdzie w „${stronaLabel(celS)}”: cała historia, oferty, rozmowy, maile i dokumenty przejdą na „${stronaLabel(celS)}”, dane kontaktowe drugiego zostaną jako „inne dane kontaktowe”. Tego NIE DA SIĘ cofnąć.`,
      { title: 'Połącz klientów', confirmLabel: 'Połącz', tone: 'danger' },
    )
    if (!ok) return
    setBusy(true)
    const r = await polaczLeady(celS.id, zrodloS.id)
    setBusy(false)
    if (r.error || !r.data) {
      pushToast(`Nie udało się połączyć: ${r.error?.message ?? 'brak odpowiedzi'}`, 'error')
      return
    }
    pushToast(`Połączono — zostaje „${stronaLabel(celS)}”`, 'success')
    onDone(r.data)
  }

  return (
    <div className="crm-polacz-panel" role="dialog" aria-label="Połącz klientów">
      <p className="crm-polacz-powod">
        <b>{powod}</b> <span className="crm-muted">(pewność {pewnosc}%)</span> — który kontakt ma zostać?
      </p>
      <div className="crm-polacz-wybor" role="radiogroup">
        {[{ s: a, opis: opisA }, { s: b, opis: opisB }].map(({ s, opis }) => (
          <label key={s.id} className={`crm-polacz-opcja${cel === s.id ? ' crm-polacz-opcja--on' : ''}`}>
            <input type="radio" name="crm-polacz-cel" checked={cel === s.id} onChange={() => setCel(s.id)} disabled={busy} />
            <Strona s={s} opis={opis} />
            {cel === s.id ? <span className="crm-status crm-status--won">zostaje</span> : <span className="crm-status crm-status--muted">wchodzi w drugi</span>}
          </label>
        ))}
      </div>
      <p className="crm-dok-uwaga">Nieodwracalne: po połączeniu „{stronaLabel(zrodloS)}” zniknie z Kontaktów, a jego historia, oferty i dokumenty będą przy „{stronaLabel(celS)}”.</p>
      <div className="crm-poczta-actions">
        <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void run()}>
          {busy ? <Spinner inline size={14} /> : null} Połącz
        </button>
        <button type="button" className="btn btn-sm btn-secondary" disabled={busy} onClick={onCancel}>Anuluj</button>
      </div>
    </div>
  )
}
