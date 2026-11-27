// NIP firmy klienta (CRM, 27.11.2026): zapis jako 10 cyfr, kontrola sumy, wyświetlanie 123-456-78-90.

/** „PL 774-000-14-54” → „7740001454”; puste → '' */
export function normalizujNip(s: string | null | undefined): string {
  return String(s ?? '').trim().replace(/^PL/i, '').replace(/\D/g, '')
}

/** 10 cyfr + suma kontrolna (wagi 6 5 7 2 3 4 5 6 7, mod 11). */
export function nipPoprawny(s: string | null | undefined): boolean {
  const nip = normalizujNip(s)
  if (!/^\d{10}$/.test(nip)) return false
  const w = [6, 5, 7, 2, 3, 4, 5, 6, 7]
  const suma = w.reduce((acc, x, i) => acc + x * Number(nip[i]), 0)
  return suma % 11 === Number(nip[9])
}

/** 7740001454 → 774-000-14-54 (inne wartości bez zmian) */
export function formatNip(s: string | null | undefined): string {
  const nip = normalizujNip(s)
  return /^\d{10}$/.test(nip) ? `${nip.slice(0, 3)}-${nip.slice(3, 6)}-${nip.slice(6, 8)}-${nip.slice(8)}` : String(s ?? '')
}

/** Adres firmy w jednej linii: „ul. Rybnicka 12, 44-200 Żory”. */
export function adresFirmy(f: { firma_ulica?: string | null; firma_kod?: string | null; firma_miasto?: string | null }): string {
  const miasto = [f.firma_kod, f.firma_miasto].filter((x) => (x ?? '').trim()).join(' ')
  return [f.firma_ulica, miasto].filter((x) => (x ?? '').trim()).join(', ')
}

/** skąd dane firmy na karcie klienta (crm.leady.firma_zrodlo) */
export const ZRODLO_FIRMY: Record<string, string> = { gus: 'GUS (REGON)', mf: 'wykaz podatników VAT', reczne: 'wpisane ręcznie' }
