/**
 * Ekran oferty v2 (21.11, makieta „v2 · Oferta”): krok oferty (Ustalenia → Liczenie → Wysyłka → Decyzja klienta)
 * i ustalenia z analizy po polsku — tylko wypełnione pola.
 */

export type KrokOferty = 'ustalenia' | 'liczenie' | 'blad' | 'wysylka' | 'decyzja' | 'koniec' | 'stara'

export const KROKI_OFERTY: Array<{ key: string; nazwa: string; opis: string }> = [
  { key: 'ustalenia', nazwa: 'Ustalenia', opis: 'sprawdź, czego chce klient' },
  { key: 'liczenie', nazwa: 'Liczenie', opis: 'system dobiera i liczy' },
  { key: 'wysylka', nazwa: 'Wysyłka', opis: 'sprawdź mail i wyślij' },
  { key: 'decyzja', nazwa: 'Decyzja klienta', opis: 'przyjął albo odmówił' },
]

/** Na którym kroku jest oferta i który z 4 kroków podświetlić (-1 = stara wersja, bez kroków). */
export function krokOferty(status: string | null | undefined, f: { sysErr?: boolean; pending?: boolean }): { krok: KrokOferty; idx: number } {
  if (status === 'robocza') return { krok: 'stara', idx: -1 }
  if (status === 'wstrzymana') return { krok: 'ustalenia', idx: 0 }
  if (f.sysErr) return { krok: 'blad', idx: 1 }
  if (f.pending || status === 'przelicz') return { krok: 'liczenie', idx: 1 }
  if (status === 'wyslana') return { krok: 'decyzja', idx: 3 }
  if (status === 'zaakceptowana' || status === 'odrzucona') return { krok: 'koniec', idx: 3 }
  return { krok: 'wysylka', idx: 2 }
}

const ETYKIETY: Record<string, string> = {
  rodzaj: 'Rodzaj drzwi', kategoria: 'Rodzaj drzwi', typ: 'Rodzaj drzwi', model: 'Model', wzor: 'Wzór', system: 'System',
  ilosc: 'Ilość', sztuk: 'Ilość', rozmiar: 'Rozmiar skrzydła', szerokosc: 'Szerokość', wymiar_otworu: 'Wymiar otworu', wymiary: 'Wymiary',
  kierunek: 'Kierunek', sposob_otwierania: 'Sposób otwierania', otwieranie: 'Otwieranie',
  kolor: 'Kolor', kolor_skrzydla: 'Kolor skrzydła', kolor_osciezy: 'Kolor ościeżnicy', kolor_oscieznicy: 'Kolor ościeżnicy',
  wariant_panelu: 'Wariant panelu', panel: 'Panel', przeszklenie: 'Przeszklenie', szyba: 'Szyba', oslonki: 'Osłonki',
  okucia: 'Okucia', klamka: 'Klamka', zamek: 'Zamek', oscieznica: 'Ościeżnica',
  montaz: 'Montaż', dostawa: 'Dostawa', termin: 'Termin', budzet: 'Budżet', miejscowosc: 'Miejscowość', adres: 'Adres',
  inne: 'Inne', uwagi: 'Uwagi', poprawka_handlowca: 'Poprawka handlowca',
}

/** Klucz z analizy → etykieta po polsku; nieznany: podkreślniki na spacje, wielka litera. */
export function etykietaUstalenia(klucz: string): string {
  const k = klucz.toLowerCase()
  if (ETYKIETY[k]) return ETYKIETY[k]
  const t = klucz.replace(/_/g, ' ').trim()
  return t ? t[0].toUpperCase() + t.slice(1) : klucz
}

const tekst = (v: unknown): string => {
  if (v == null) return ''
  if (typeof v === 'boolean') return v ? 'tak' : 'nie'
  if (Array.isArray(v)) return v.map(tekst).filter(Boolean).join(', ')
  if (typeof v === 'object') return Object.entries(v as Record<string, unknown>).map(([k, x]) => (tekst(x) ? `${etykietaUstalenia(k)}: ${tekst(x)}` : '')).filter(Boolean).join('; ')
  return String(v).trim()
}

/** Wypełnione pola ustaleń w czytelnej kolejności (najważniejsze najpierw), bez pustych. */
export function ustaleniaLista(dane: Record<string, unknown> | null | undefined): Array<{ klucz: string; nazwa: string; wartosc: string }> {
  if (!dane || typeof dane !== 'object') return []
  const kolejnosc = Object.keys(ETYKIETY)
  return Object.entries(dane)
    .map(([klucz, v]) => ({ klucz, nazwa: etykietaUstalenia(klucz), wartosc: tekst(v) }))
    .filter((u) => u.wartosc && u.wartosc !== '-' && u.wartosc.toLowerCase() !== 'brak' && u.wartosc.toLowerCase() !== 'null')
    .sort((a, b) => {
      const ia = kolejnosc.indexOf(a.klucz.toLowerCase())
      const ib = kolejnosc.indexOf(b.klucz.toLowerCase())
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib)
    })
}
