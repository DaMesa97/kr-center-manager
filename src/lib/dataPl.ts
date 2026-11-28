// D51 (28.11): wspólne formatowanie dat w ZKP i magazynie. Wcześniej kopie dawały „Invalid Date” przy złych danych
// i raz '' raz '—' dla pustej daty. Teraz: pusta → '—' (albo podany zamiennik), niepoprawna → tekst z bazy bez zmian.

/** 'RRRR-MM-DD…' → 'DD.MM.RRRR'; pusta → `pusto`; nierozpoznana → tekst bez zmian. */
export function dataPl(ymd: string | null | undefined, pusto = '—'): string {
  const s = String(ymd ?? '').trim()
  if (!s) return pusto
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : s
}

/** Data z godziną (krótko, po polsku); pusta → `pusto`; niepoprawna → tekst bez zmian (nie „Invalid Date”). */
export function dataCzasPl(iso: string | null | undefined, pusto = '—'): string {
  const s = String(iso ?? '').trim()
  if (!s) return pusto
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })
}
