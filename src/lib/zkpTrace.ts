// Wyszukiwarka „od tabliczki" (ZKP 5.9 / zał. 6.26): numer konstrukcji RRRR/ZZ/PP
// z tabliczki znamionowej → zlecenie, pozycja, teczka. Przyjmuje też numer
// zlecenia w roku (RRRR/ZZ), numer OF z LP i ID zlecenia z kodu QR etykiety.

export type TraceQuery =
  | { kind: 'construction'; year: number; zz: number; pp: number }
  | { kind: 'production'; year: number; zz: number }
  | { kind: 'order'; orderNumber: string }
  | { kind: 'orderId'; id: number }

const SEP = String.raw`\s*[\/\-.]\s*`
const CONSTRUCTION_RE = new RegExp(String.raw`(?:^|\D)((?:19|20)\d{2})${SEP}(\d{1,4})${SEP}(\d{1,4})(?!\d)`)
const PRODUCTION_RE = new RegExp(String.raw`^((?:19|20)\d{2})${SEP}(\d{1,4})$`)
const OF_RE = /^OF\s*(\d+)\s*\/\s*(\d{4})\b/i
const BARE_OF_RE = /^(\d{1,5})\s*\/\s*((?:19|20)\d{2})$/

/** Rozpoznaje wpisany / zeskanowany tekst; null = nie wiadomo, czego szukać. */
export function parseTraceQuery(input: string): TraceQuery | null {
  const s = input.trim()
  if (!s) return null

  const of = OF_RE.exec(s)
  if (of) return { kind: 'order', orderNumber: `OF${Number(of[1])}/${of[2]}` }

  const c = CONSTRUCTION_RE.exec(s)
  if (c) {
    const [year, zz, pp] = [Number(c[1]), Number(c[2]), Number(c[3])]
    return zz > 0 && pp > 0 ? { kind: 'construction', year, zz, pp } : null
  }

  const p = PRODUCTION_RE.exec(s)
  if (p) {
    const [year, zz] = [Number(p[1]), Number(p[2])]
    return zz > 0 ? { kind: 'production', year, zz } : null
  }

  // „341/2026" — numer OF bez przedrostka (rok na końcu, więc nie myli się z RRRR/ZZ)
  const bare = BARE_OF_RE.exec(s)
  if (bare) return { kind: 'order', orderNumber: `OF${Number(bare[1])}/${bare[2]}` }

  // kod QR etykiety niesie ID zlecenia
  if (/^\d{1,9}$/.test(s)) return { kind: 'orderId', id: Number(s) }

  return null
}

/** Opis zapytania do komunikatu „nie znaleziono …". */
export function describeTraceQuery(q: TraceQuery): string {
  const two = (n: number) => (n < 10 ? `0${n}` : String(n))
  switch (q.kind) {
    case 'construction':
      return `konstrukcji ${q.year}/${two(q.zz)}/${two(q.pp)}`
    case 'production':
      return `zlecenia ${q.year}/${two(q.zz)}`
    case 'order':
      return `zlecenia ${q.orderNumber}`
    case 'orderId':
      return `zlecenia o ID ${q.id}`
  }
}
