// =====================================================================
// Numer telefonu klienta jako link `tel:` (Tymek 23.11): klik otwiera Ringostat Smart Phone
// (aplikacja desktopowa ustawiona w Windows jako domyślna dla protokołu TEL) z wpisanym
// numerem. W Electronie link idzie przez shell:open-external (main przepuszcza tel: tylko
// z samymi cyframi), w przeglądarce/dev przez window.open. Obok mały „kopiuj” — gdy ktoś
// nie ma Smart Phone albo dzwoni z komórki.
// =====================================================================
import { useState } from 'react'
import { Check, Copy, Phone } from 'lucide-react'
import { openExternalUrl } from '../../hooks/useAluOrders'

/** `tel:` tylko z cyframi i plusem — tyle przepuszcza bramka w Electronie */
function telHref(telefon: string): string | null {
  const t = telefon.replace(/[\s\-().]/g, '')
  return /^\+?\d{6,15}$/.test(t) ? `tel:${t}` : null
}

type Props = {
  telefon: string | null | undefined
  /** mniejszy wariant do list (bez ikony kopiowania) */
  compact?: boolean
  /** klasa dodatkowa na link */
  className?: string
}

export default function CrmTelefon({ telefon, compact = false, className }: Props) {
  const [skopiowano, setSkopiowano] = useState(false)
  const t = (telefon ?? '').trim()
  if (!t) return null
  const href = telHref(t)
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
        void openExternalUrl(href)
      }}
    >
      {compact ? null : <Phone size={13} />} {t}
    </a>
  ) : (
    <span className={`crm-copy-value${className ? ` ${className}` : ''}`}>{compact ? null : <Phone size={13} />} {t}</span>
  )
  if (compact) return link
  return (
    <span className="crm-tel-wrap">
      {link}
      <button type="button" className="crm-icon-btn crm-tel-kopiuj" onClick={() => void kopiuj()} title="Kopiuj numer" aria-label="Kopiuj numer">
        {skopiowano ? <Check size={12} /> : <Copy size={12} />}
      </button>
    </span>
  )
}
