// =====================================================================
// „Zrobione — co dalej?” / „Dodaj zadanie” (brief pkt 20). Właściciel zamknął „dopytaj”
// i klient zniknął z „Do zrobienia” bez follow-upu, więc zamknięcie zawsze pyta o następny krok.
// Zapis przez rpc crm.zamknij_zadanie (zdarzenie + następne zadanie robi baza).
// Rysowane jako panel w miejscu (bez natywnych dialogów — zasada aplikacji).
// =====================================================================
import { useState } from 'react'
import { Check, X } from 'lucide-react'
import { CRM_AKCJA, CRM_FOLLOW_UP_DAYS, type CrmZamknijZadanie } from '../../types/crm'
import { terminHint } from '../../utils/crmTermin'
import Spinner from '../Spinner'

type Props = {
  /** nazwa klienta do nagłówka */
  klient: string
  /** zadanie, które zamykamy; null = „Dodaj zadanie” na kliencie bez zadania */
  biezaceZadanie: string | null
  busy: boolean
  onConfirm: (z: CrmZamknijZadanie) => void | Promise<void>
  onCancel: () => void
}

const OPCJE: Array<{ akcja: string | null; label: string; hint: string }> = [
  { akcja: null, label: 'Nic więcej', hint: 'Klient znika z listy „Do zrobienia”; zostaje w Kontaktach' },
  { akcja: 'follow_up', label: 'Zapytaj o decyzję', hint: 'Przypomnienie za kilka dni, np. po wysłanej ofercie' },
  { akcja: 'oddzwon', label: 'Oddzwoń', hint: 'Zamknie się samo po odebranej rozmowie z Ringostatu' },
  { akcja: 'dopytaj', label: 'Dopytaj', hint: 'Brakuje danych do oferty (wymiar, kolor…)' },
  { akcja: 'przygotuj_oferte', label: 'Przygotuj ofertę', hint: 'Z notatką w karcie system sam policzy ofertę' },
]

export default function CrmZadanieDialog({ klient, biezaceZadanie, busy, onConfirm, onCancel }: Props) {
  const dodaj = biezaceZadanie == null
  const [akcja, setAkcja] = useState<string | null>(dodaj ? 'follow_up' : 'follow_up')
  const [zaDni, setZaDni] = useState<number>(CRM_FOLLOW_UP_DAYS)
  const [opis, setOpis] = useState('')
  const [wyslano, setWyslano] = useState(false)

  const opcje = dodaj ? OPCJE.filter((o) => o.akcja != null) : OPCJE
  const tytul = dodaj ? `Nowe zadanie dla ${klient}` : `Zrobione: ${CRM_AKCJA[biezaceZadanie]?.label ?? biezaceZadanie} · ${klient}`

  return (
    <section className="crm-box crm-zadanie-dialog" role="dialog" aria-label={tytul}>
      <h4>{tytul}</h4>
      <p className="crm-muted">{dodaj ? 'Co ma być następnym krokiem?' : 'Co dalej z tym klientem?'}</p>
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
            <input type="number" min={0} max={90} value={zaDni} onChange={(e) => setZaDni(Math.max(0, Math.min(90, Number(e.target.value) || 0)))} disabled={busy} />
          </label>
          {/* terminy tylko w dni robocze (trigger leady_termin_roboczy) — pokazujemy, co baza zapisze */}
          <span className="crm-muted">{terminHint(zaDni) ?? '0 = dziś · terminy tylko w dni robocze'}</span>
        </div>
      )}
      <label className="crm-pf-field">
        <span className="crm-pf-label">Co ustalono (opcjonalnie)</span>
        <textarea className="crm-fix-textarea" rows={2} value={opis} onChange={(e) => setOpis(e.target.value)} placeholder="np. klient wybiera kolor, odezwie się po weekendzie" disabled={busy} />
      </label>
      {!dodaj && (
        <label className="crm-pf-field crm-pf-field--check">
          <input type="checkbox" checked={wyslano} onChange={(e) => setWyslano(e.target.checked)} disabled={busy} />
          <span>Wysłałem ofertę poza systemem (status klienta: „Ma ofertę”)</span>
        </label>
      )}
      <div className="crm-poczta-actions">
        <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void onConfirm({ nastepna_akcja: akcja, za_dni: zaDni, opis, wyslano_oferte: wyslano })}>
          {busy ? <Spinner inline size={14} /> : <Check size={14} />} {dodaj ? 'Dodaj zadanie' : 'Zapisz'}
        </button>
        <button type="button" className="btn btn-sm btn-secondary" disabled={busy} onClick={onCancel}><X size={14} /> Anuluj</button>
      </div>
    </section>
  )
}
