// Brief pkt 31: formularz „Przegrany” (powód obowiązkowy, przy „inne” notatka) — wspólny dla karty klienta,
// ekranu oferty i lejka w Kontaktach (przeciągnięcie do kolumny „Przegrany”).
import { useState } from 'react'
import { CRM_WYNIK_POWOD } from '../../lib/crmWynik'
import Spinner from '../Spinner'

/** Brief pkt 31: „Dlaczego przegraliśmy?” — powód obowiązkowy (bez niego nie ma statystyk), notatka opcjonalna. */
export default function WynikPrzegranyForm({ busy, hint, onConfirm, onCancel }: { busy: boolean; hint?: string; onConfirm: (powod: string, notatka: string) => void; onCancel: () => void }) {
  const [powod, setPowod] = useState('')
  const [notatka, setNotatka] = useState('')
  const [brak, setBrak] = useState(false)
  return (
    <section className="crm-box crm-wynik-form" aria-label="Oznacz jako przegrany">
      <h4>Dlaczego przegraliśmy?</h4>
      <div className="crm-chipy" role="radiogroup" aria-label="Powód przegranej">
        {Object.entries(CRM_WYNIK_POWOD).map(([k, v]) => (
          <button key={k} type="button" role="radio" aria-checked={powod === k} className={`crm-chip${powod === k ? ' crm-chip--on' : ''}`} disabled={busy} onClick={() => { setPowod(k); setBrak(false) }}>
            {v}
          </button>
        ))}
      </div>
      <label className="crm-pf-field crm-wynik-notatka">
        <span className="crm-pf-label">Notatka (opcjonalnie)</span>
        <input type="text" value={notatka} onChange={(e) => setNotatka(e.target.value)} disabled={busy} placeholder="np. „wzięła drzwi z marketu, 2 tys. taniej”" />
      </label>
      <p className="crm-muted">{hint ?? 'Zamkniemy otwarte zadanie, a wysłane oferty dostaną status „Odrzucona”. Klient zniknie z „Do zrobienia”; wróci po kliknięciu „Przywróć do gry”.'}</p>
      <div className="crm-mail-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() => {
            // serwer (brief pkt 31): powód obowiązkowy, przy „inne” także notatka
            if (!powod || (powod === 'inne' && !notatka.trim())) { setBrak(true); return }
            onConfirm(powod, notatka)
          }}
        >
          {busy ? <Spinner inline size={14} /> : null} Oznacz jako przegrany
        </button>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={onCancel}>Anuluj</button>
        {brak && <span className="crm-text-bad">{!powod ? 'Wybierz powód.' : 'Przy „inne” wpisz krótko, co się stało.'}</span>}
      </div>
    </section>
  )
}
