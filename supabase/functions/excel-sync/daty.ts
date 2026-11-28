// D25 (28.11.2026, właściciel: TAK): hala może wpisywać w Excelu DATĘ zamiast samego „X” (ST / Bastion),
// żeby statystyki czasu realizacji miały prawdziwe daty. Ten plik czyta komórkę „X albo data” — bez zależności
// od Deno, żeby testy (vitest, src/__tests__/excelSyncDatyEtapow.test.ts) mogły go importować wprost.
//
// Przyjmowane zapisy daty:
//  - liczba seryjna Excela (komórka sformatowana jako data; 46346 = 20.11.2026; część ułamkowa = godzina, pomijana),
//  - „dd.mm.rrrr”, „dd/mm/rrrr”, „dd-mm-rrrr” (także „d.m.rrrr”), „dd.mm.rr” (= 20rr),
//  - „dd.mm” / „dd.mm.” bez roku — rok bieżący, a gdy data wypadłaby w przyszłości — rok poprzedni,
//  - ISO „rrrr-mm-dd” (opcjonalnie z godziną „rrrr-mm-ddThh:mm…” / „rrrr-mm-dd hh:mm”).
// Data niemożliwa w kalendarzu (31.11, 29.02 w roku nieprzestępnym, 15.13) albo z przyszłości (po „dziś”)
// = „zla_data” — do raportu przebiegu (zle_daty), bez zapisu.

export type KomorkaDaty =
  | { rodzaj: 'pusta' }
  | { rodzaj: 'x' }
  | { rodzaj: 'data'; iso: string }
  | { rodzaj: 'zla_data'; tekst: string }
  | { rodzaj: 'inne'; tekst: string }

const pad = (n: number, w = 2): string => String(n).padStart(w, '0')

/** RRRR-MM-DD, gdy taka data istnieje w kalendarzu; inaczej null. */
export function isoJesliIstnieje(y: number, mo: number, d: number): string | null {
  if (!Number.isInteger(y) || !Number.isInteger(mo) || !Number.isInteger(d)) return null
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null
  return `${pad(y, 4)}-${pad(mo)}-${pad(d)}`
}

/** Liczba seryjna daty Excela (system 1900) → RRRR-MM-DD; poza zakresem lat ok. 1954–2119 → null. */
export function seryjnaNaIso(v: number): string | null {
  if (!Number.isFinite(v) || v <= 20000 || v >= 80000) return null
  return new Date((Math.floor(v) - 25569) * 86400000).toISOString().slice(0, 10)
}

/**
 * Komórka „X albo data” z arkusza.
 * @param v    wartość z parsera arkusza (liczba / tekst / null)
 * @param dzis dzisiejsza data RRRR-MM-DD (strefa Europe/Warsaw) — do roku dla „dd.mm” i odrzucania przyszłych dat
 */
export function czytajDateKomorki(v: unknown, dzis: string): KomorkaDaty {
  if (v == null) return { rodzaj: 'pusta' }
  if (typeof v === 'number') {
    const iso = seryjnaNaIso(v)
    if (!iso) return { rodzaj: 'inne', tekst: String(v) }
    return iso > dzis ? { rodzaj: 'zla_data', tekst: iso } : { rodzaj: 'data', iso }
  }
  const t = String(v).trim()
  if (t === '') return { rodzaj: 'pusta' }
  if (/^x+$/i.test(t)) return { rodzaj: 'x' }

  let iso: string | null | undefined
  let m: RegExpExecArray | null
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(t))) {
    iso = isoJesliIstnieje(Number(m[1]), Number(m[2]), Number(m[3]))
  } else if ((m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(t))) {
    iso = isoJesliIstnieje(Number(m[3]), Number(m[2]), Number(m[1]))
  } else if ((m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2})$/.exec(t))) {
    iso = isoJesliIstnieje(2000 + Number(m[3]), Number(m[2]), Number(m[1]))
  } else if ((m = /^(\d{1,2})[./](\d{1,2})\.?$/.exec(t))) {
    const rok = Number(dzis.slice(0, 4))
    const d = Number(m[1]), mo = Number(m[2])
    iso = isoJesliIstnieje(rok, mo, d)
    if (iso && iso > dzis) iso = isoJesliIstnieje(rok - 1, mo, d)
  } else {
    return { rodzaj: 'inne', tekst: t }
  }
  if (!iso || iso > dzis) return { rodzaj: 'zla_data', tekst: t }
  return { rodzaj: 'data', iso }
}
