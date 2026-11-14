// Normalizacja telefonu dla CRM Po Drzwi (brief pkt 13.1): crm.leady.telefon jest
// UNIQUE i trzymany jako +48XXXXXXXXX (tak zapisuje go ingest z Ringostatu), więc
// numer z formularza „Dodaj klienta” musi mieć ten sam kształt, inaczej powstałby dubel.
// Zwraca null, gdy z wpisu nie da się zrobić sensownego numeru.
export function normalizePlPhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  const plus = trimmed.startsWith('+') || trimmed.startsWith('00')
  let digits = trimmed.replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  // polski numer: 9 cyfr (z opcjonalnym 48 / 0 z przodu)
  if (digits.length === 9) return `+48${digits}`
  if (digits.length === 10 && digits.startsWith('0')) return `+48${digits.slice(1)}`
  if (digits.length === 11 && digits.startsWith('48')) return `+${digits}`
  // zagraniczny — tylko gdy wpisano z prefiksem międzynarodowym
  if (plus && digits.length >= 10 && digits.length <= 15) return `+${digits}`
  return null
}
