// Załączniki maila w CRM (27.11): klik otwiera plik (PDF, zdjęcie…) w domyślnym programie. Plik pobiera funkcja
// crm-mail-sent ze skrzynki pocztowej przy pierwszym kliknięciu, potem leży w CRM. Obrazki ze stopki (image001.png
// itp.) są schowane pod „obrazki ze stopki”.
import { useState } from 'react'
import { linkZalacznika } from '../../hooks/useCrm'
import { openExternalUrl } from '../../hooks/useAluOrders'
import { czyObrazekStopki, rozmiarPliku } from '../../lib/crmZalaczniki'

type Zal = { nazwa?: string; typ?: string; rozmiar?: number }

export default function CrmZalaczniki({ mailId, zalaczniki, kompakt = false }: { mailId: string; zalaczniki: Zal[] | null; kompakt?: boolean }) {
  const [laduje, setLaduje] = useState<number | null>(null)
  const [blad, setBlad] = useState<string | null>(null)
  const [stopka, setStopka] = useState(false)
  const lista = (zalaczniki ?? []).map((z, nr) => ({ z, nr }))
  if (lista.length === 0) return null
  const glowne = lista.filter((x) => !czyObrazekStopki(x.z))
  const zeStopki = lista.filter((x) => czyObrazekStopki(x.z))
  const widoczne = stopka ? lista : glowne

  const otworz = async (nr: number) => {
    setLaduje(nr)
    setBlad(null)
    const r = await linkZalacznika(mailId, nr)
    setLaduje(null)
    if ('url' in r) {
      const ok = await openExternalUrl(r.url)
      if (!ok) setBlad('Nie udało się otworzyć pliku')
    } else setBlad(r.blad)
  }

  return (
    <div className={`crm-zal${kompakt ? ' crm-zal--kompakt' : ''}`} onClick={(e) => e.stopPropagation()}>
      {widoczne.map(({ z, nr }) => (
        <button key={nr} type="button" className="crm-zal-plik" disabled={laduje !== null} onClick={() => void otworz(nr)} title={`Otwórz ${z.nazwa || 'plik'}`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
          <span className="crm-zal-nazwa">{z.nazwa || 'plik'}</span>
          {z.rozmiar ? <span className="crm-zal-rozmiar">{rozmiarPliku(z.rozmiar)}</span> : null}
          {laduje === nr && <span className="crm-zal-rozmiar">pobieram…</span>}
        </button>
      ))}
      {zeStopki.length > 0 && (
        <button type="button" className="crm-link crm-zal-stopka" onClick={() => setStopka((s) => !s)} aria-expanded={stopka}>
          {stopka ? 'ukryj obrazki ze stopki' : `obrazki ze stopki (${zeStopki.length})`}
        </button>
      )}
      {blad && <span className="crm-zal-blad" role="alert">{blad}</span>}
    </div>
  )
}
