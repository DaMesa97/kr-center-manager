// =====================================================================
// „Zrobione — co dalej?” / „Dodaj zadanie” (brief pkt 20). Właściciel zamknął „dopytaj”
// i klient zniknął z „Do zrobienia” bez follow-upu, więc zamknięcie zawsze pyta o następny krok.
// Zapis przez rpc crm.zamknij_zadanie (zdarzenie + następne zadanie robi baza).
// Rysowane jako panel w miejscu (bez natywnych dialogów — zasada aplikacji).
// =====================================================================
import { useState } from 'react'
import { Check, X } from 'lucide-react'
import { CRM_AKCJA, CRM_FOLLOW_UP_DAYS, type CrmZamknijZadanie } from '../../types/crm'
import { isoLocal, terminHint, terminHintForIso } from '../../utils/crmTermin'
import { useDniWolne } from '../../hooks/useDniWolne'
import Spinner from '../Spinner'

const fmtPl = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso
}
/** liczba dni od dziś do daty RRRR-MM-DD (ujemna = przeszłość) */
const dniDo = (iso: string): number => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return 0
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const t = new Date()
  const dzis = new Date(t.getFullYear(), t.getMonth(), t.getDate())
  return Math.round((d.getTime() - dzis.getTime()) / 86_400_000)
}

type Props = {
  /** nazwa klienta do nagłówka */
  klient: string
  /** zadanie, które zamykamy; null = „Dodaj zadanie” na kliencie bez zadania */
  biezaceZadanie: string | null
  busy: boolean
  onConfirm: (z: CrmZamknijZadanie) => void | Promise<void>
  onCancel: () => void
  /** #150: edycja istniejącego zadania — wartości startowe; zapis bez zdarzenia „zrobione”. `termin` = obecny nastepny_krok (RRRR-MM-DD) */
  edycja?: { akcja: string; zaDni: number; opis: string; termin?: string | null }
}

const OPCJE: Array<{ akcja: string | null; label: string; hint: string }> = [
  { akcja: null, label: 'Nic więcej', hint: 'Klient znika z listy „Do zrobienia”; zostaje w Kontaktach' },
  { akcja: 'follow_up', label: 'Zapytaj o decyzję', hint: 'Przypomnienie za kilka dni, np. po wysłanej ofercie' },
  { akcja: 'dopytaj', label: 'Dopytaj', hint: 'Brakuje danych do oferty (wymiar, kolor…)' },
  { akcja: 'przygotuj_oferte', label: 'Przygotuj ofertę', hint: 'Z notatką w karcie system sam policzy ofertę' },
  { akcja: 'pomiar', label: 'Pomiar', hint: 'Umówiony pomiar u klienta — termin = dzień pomiaru' },
  { akcja: 'montaz', label: 'Montaż', hint: 'Umówiony montaż — termin = dzień montażu' },
]

export default function CrmZadanieDialog({ klient, biezaceZadanie, busy, onConfirm, onCancel, edycja }: Props) {
  const dodaj = biezaceZadanie == null
  const [akcja, setAkcja] = useState<string | null>(edycja ? edycja.akcja : 'follow_up')
  const [zaDni, setZaDni] = useState<number>(edycja ? edycja.zaDni : CRM_FOLLOW_UP_DAYS)
  // konkretna data z kalendarza (Tymek 16.11): nadrzędna wobec „za ile dni”; wpis w „za ile dni” ją czyści
  const [termin, setTermin] = useState<string>(edycja?.termin && /^\d{4}-\d{2}-\d{2}$/.test(edycja.termin) ? edycja.termin : '')
  const [opis, setOpis] = useState(edycja ? edycja.opis : '')
  const [wyslano, setWyslano] = useState(false)
  const dniWolne = useDniWolne()
  const terminWstecz = termin !== '' && dniDo(termin) < 0
  const podpowiedz = termin
    ? terminWstecz
      ? 'termin w przeszłości — zadanie od razu będzie zaległe'
      : (terminHintForIso(termin, new Date(), dniWolne) ?? `termin ${fmtPl(termin)}`)
    : (terminHint(zaDni, new Date(), dniWolne) ?? '0 = dziś · terminy tylko w dni robocze')

  const opcje = dodaj || edycja ? OPCJE.filter((o) => o.akcja != null) : OPCJE
  const tytul = edycja
    ? `Zmień zadanie · ${klient}`
    : dodaj
      ? `Nowe zadanie dla ${klient}`
      : `Zrobione: ${CRM_AKCJA[biezaceZadanie]?.label ?? biezaceZadanie} · ${klient}`

  return (
    <section className="crm-box crm-zadanie-dialog" role="dialog" aria-label={tytul}>
      <h4>{tytul}</h4>
      <p className="crm-muted">{edycja ? 'Popraw rodzaj, termin albo opis zadania.' : dodaj ? 'Co ma być następnym krokiem?' : 'Co dalej z tym klientem?'}</p>
      <div className="crm-zadanie-opcje" role="radiogroup">
        {opcje.map((o) => (
          <label key={o.akcja ?? 'nic'} className={`crm-zadanie-opcja${akcja === o.akcja ? ' crm-zadanie-opcja--on' : ''}`}>
            <input type="radio" name="crm-nastepna-akcja" checked={akcja === o.akcja} onChange={() => setAkcja(o.akcja)} disabled={busy} />
            <span>
              <b>{o.akcja ? `${CRM_AKCJA[o.akcja]?.icon ?? ''} ` : ''}{o.label}</b>
              <span className="crm-muted crm-zadanie-hint">{o.hint}</span>
            </span>
          </label>
        ))}
      </div>
      {akcja && (
        <div className="crm-zadanie-row">
          <label className="crm-pf-field crm-pf-field--short">
            <span className="crm-pf-label">Za ile dni</span>
            <input
              type="number"
              min={0}
              max={365}
              value={termin ? Math.max(0, dniDo(termin)) : zaDni}
              onChange={(e) => {
                setTermin('')
                setZaDni(Math.max(0, Math.min(365, Number(e.target.value) || 0)))
              }}
              disabled={busy}
            />
          </label>
          <label className="crm-pf-field crm-pf-field--short">
            <span className="crm-pf-label">albo termin</span>
            <input type="date" value={termin} min={isoLocal(new Date())} onChange={(e) => setTermin(e.target.value)} disabled={busy} aria-label="Konkretny termin zadania" />
          </label>
          {/* terminy tylko w dni robocze (trigger leady_termin_roboczy) — pokazujemy, co baza zapisze */}
          <span className="crm-muted">{podpowiedz}</span>
        </div>
      )}
      <label className="crm-pf-field">
        <span className="crm-pf-label">Co ustalono (opcjonalnie)</span>
        <textarea className="crm-fix-textarea" rows={2} value={opis} onChange={(e) => setOpis(e.target.value)} placeholder="np. klient wybiera kolor, odezwie się po weekendzie" disabled={busy} />
      </label>
      {!dodaj && !edycja && (
        <label className="crm-pf-field crm-pf-field--check">
          <input type="checkbox" checked={wyslano} onChange={(e) => setWyslano(e.target.checked)} disabled={busy} />
          <span>Wysłałem ofertę poza systemem (status klienta: „Ma ofertę”)</span>
        </label>
      )}
      <div className="crm-poczta-actions">
        <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void onConfirm({ nastepna_akcja: akcja, za_dni: termin ? Math.max(0, dniDo(termin)) : zaDni, opis, wyslano_oferte: wyslano, termin: termin || null })}>
          {busy ? <Spinner inline size={14} /> : <Check size={14} />} {edycja ? 'Zapisz zmiany' : dodaj ? 'Dodaj zadanie' : 'Zapisz'}
        </button>
        <button type="button" className="btn btn-sm btn-secondary" disabled={busy} onClick={onCancel}><X size={14} /> Anuluj</button>
      </div>
    </section>
  )
}
