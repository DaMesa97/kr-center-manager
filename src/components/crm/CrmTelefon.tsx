// =====================================================================
// Numer telefonu klienta jako link `tel:` (Tymek 23.11): klik otwiera Ringostat Smart Phone
// (aplikacja desktopowa ustawiona w Windows jako domyślna dla protokołu TEL) z wpisanym
// numerem. W Electronie link idzie przez shell:open-external (main przepuszcza tel: tylko
// z samymi cyframi), w przeglądarce/dev przez window.open. Obok mały „kopiuj” — gdy ktoś
// nie ma Smart Phone albo dzwoni z komórki. Przed wybraniem numeru pytamy (Tymek 23.11:
// Smart Phone dzwoni od razu, przypadkowy klik = przypadkowy telefon do klienta).
// =====================================================================
import { useState } from 'react'
import { telHref, zadzwonDo } from '../../lib/crmTelefon'

type Props = {
  telefon: string | null | undefined
  /** nazwa klienta do pytania „Zadzwonić do …?” */
  nazwa?: string | null
  /** mniejszy wariant do list (bez ikony kopiowania) */
  compact?: boolean
  /** klasa dodatkowa na link */
  className?: string
}

export default function CrmTelefon({ telefon, nazwa, compact = false, className }: Props) {
  const [skopiowano, setSkopiowano] = useState(false)
  const t = (telefon ?? '').trim()
  if (!t) return null
  const href = telHref(t)
  const zadzwon = () => void zadzwonDo(t, nazwa)
  const kopiuj = async () => {
    try {
      await navigator.clipboard.writeText(t)
      setSkopiowano(true)
      window.setTimeout(() => setSkopiowano(false), 1500)
    } catch {
      /* brak schowka (stara przeglądarka) — numer i tak da się zaznaczyć */
    }
  }
  const link = href ? (
    <a
      href={href}
      className={`crm-ext crm-tel${className ? ` ${className}` : ''}`}
      title="Zadzwoń: otwiera Ringostat Smart Phone z tym numerem (aplikacja musi być domyślna dla linków TEL w Windows — patrz Pomoc)"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        void zadzwon()
      }}
    >
      {t}
    </a>
  ) : (
    <span className={`crm-copy-value${className ? ` ${className}` : ''}`}>{t}</span>
  )
  if (compact) return link
  return (
    <span className="crm-tel-wrap">
      {link}
      <button type="button" className="crm-icon-btn crm-tel-kopiuj" onClick={() => void kopiuj()} title="Kopiuj numer" aria-label="Kopiuj numer">
        {skopiowano ? 'skopiowano' : 'kopiuj'}
      </button>
    </span>
  )
}
