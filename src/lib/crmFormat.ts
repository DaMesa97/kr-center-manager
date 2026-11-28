// Wspólne formatowanie w ekranach CRM (noc 28.11: wydzielone z identycznych kopii).

/** „dd.mm, hh:mm” (bez roku); pusta / błędna data → „—”. */
export const fmtDateTime = (iso: string | null | undefined): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}
