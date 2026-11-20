/**
 * Lista „Do zrobienia” v2 (makieta „CRM — makieta” v2, 20.11): wiersz = „Akcja: Klient” + jedno zdanie po co
 * + termin + jeden przycisk. Filtr po rodzaju: telefony / oferty / pomiary i montaże.
 */

export type ZadanieRodzaj = 'telefon' | 'oferta' | 'wizyta'

export const ZADANIE_RODZAJE: Array<{ key: ZadanieRodzaj; label: string }> = [
  { key: 'telefon', label: 'Telefony' },
  { key: 'oferta', label: 'Oferty' },
  { key: 'wizyta', label: 'Pomiary i montaże' },
]

export function zadanieRodzaj(akcja: string | null | undefined): ZadanieRodzaj {
  if (akcja === 'przygotuj_oferte') return 'oferta'
  if (akcja === 'pomiar' || akcja === 'montaz') return 'wizyta'
  return 'telefon'
}

const CZASOWNIK: Record<string, string> = {
  oddzwon: 'Oddzwoń',
  dopytaj: 'Dopytaj',
  przygotuj_oferte: 'Wyślij ofertę',
  follow_up: 'Zapytaj o decyzję',
  reklamacja: 'Reklamacja',
  pomiar: 'Pomiar',
  montaz: 'Montaż',
}

/** „Oddzwoń: Anna Kowalczyk” — co i z kim w jednym zdaniu. */
export function zadanieTytul(akcja: string | null | undefined, klient: string, label?: string): string {
  const co = (akcja && CZASOWNIK[akcja]) || label || 'Zadanie'
  return `${co}: ${klient}`
}

/**
 * Jedno zdanie „po co” z opisu zadania: bez powtórzonej nazwy akcji przed dwukropkiem
 * („Sprawdź ustalenia i zleć ofertę: Generalny wykonawca…” → „Generalny wykonawca…”), pierwsze zdanie, max `n` znaków.
 */
export function zadaniePoCo(opis: string | null | undefined, hint?: string | null, n = 140): string {
  let t = (opis || hint || '').replace(/\s+/g, ' ').trim()
  const dw = t.indexOf(': ')
  // przedrostek-akcja ma kilka słów („Sprawdź ustalenia i zleć ofertę”, „Follow-up po ofercie v3 (8220 zł)”);
  // krótkie „Wymiar: …”, „Kolor: …” to treść i zostają
  if (dw >= 15 && dw <= 60 && t.length - dw > 8) t = t.slice(dw + 2).trim()
  // koniec zdania = kropka/!/? i wielka litera po spacji („ok. 396 drzwi”, „4 szt. drzwi”, „np. kolor” to nie koniec)
  const re = /[.!?](?=\s+[A-ZĄĆĘŁŃÓŚŹŻ])/g
  let m: RegExpExecArray | null
  while ((m = re.exec(t))) {
    const slowo = t.slice(0, m.index).split(/\s/).pop() ?? ''
    if (m.index > 20 && !/^(ok|szt|np|nr|ul|tj|tzn|godz|ok|m\.in|im|św|dr|inż|mgr|p)$/i.test(slowo)) {
      t = t.slice(0, m.index + 1)
      break
    }
  }
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t
}
