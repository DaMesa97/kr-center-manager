// CRM: wynik klienta (Zamówił / Przegrany), grupy zadań i lejek — czysta logika
// do ekranów „Do zrobienia”, karta klienta i Kontakty (makieta 18.11.2026,
// artefakt „CRM — makieta”). Bez zapytań do bazy, łatwe do testów.

/** Powody przegranej — wartości jak w check crm.leady.wynik_powod (brief pkt 31). */
export const CRM_WYNIK_POWOD: Record<string, string> = {
  cena: 'cena',
  termin: 'termin realizacji',
  konkurencja: 'wybrał konkurencję',
  brak_kontaktu: 'brak kontaktu',
  rezygnacja: 'rezygnacja z zakupu',
  inne: 'inne',
}

export type ZadanieGrupa = 'zalegle' | 'dzis' | 'pozniej'

export const ZADANIE_GRUPY: Array<{ key: ZadanieGrupa; label: string }> = [
  { key: 'zalegle', label: 'Zaległe' },
  { key: 'dzis', label: 'Dziś' },
  { key: 'pozniej', label: 'Później' },
]

/** Termin zadania → grupa listy „Do zrobienia”; brak terminu = „Później”. `today` w formacie YYYY-MM-DD. */
export function zadanieGrupa(termin: string | null | undefined, today: string): ZadanieGrupa {
  if (!termin) return 'pozniej'
  const d = termin.slice(0, 10)
  if (d < today) return 'zalegle'
  if (d === today) return 'dzis'
  return 'pozniej'
}

type OfertaKwota = { rodzaj?: string | null; brutto?: number | null; cena_razem?: number | null }

/** Kwota oferty do pokazania: oficjalna = brutto z PDF, sklepowa = cena_razem. */
export function kwotaOferty(o: OfertaKwota | null | undefined): number | null {
  if (!o) return null
  const v = o.rodzaj === 'oficjalna' ? o.brutto : o.cena_razem
  return v == null ? null : Number(v)
}

/**
 * Wartość klienta (#162): wpisana ręcznie (crm.leady.wartosc_szac) wygrywa z kwotą ostatniej oferty;
 * 24.11 (Tymek): gdy nie ma ani jednego, ani drugiego — cena orientacyjna podana klientowi w rozmowie / mailu
 * (crm.leady.wartosc_wstepna, z analizy AI) → `wstepna: true`.
 */
export function wartoscKlienta(
  wartoscSzac: number | string | null | undefined,
  oferta: OfertaKwota | null | undefined,
  wartoscWstepna?: number | string | null,
): { kwota: number | null; reczna: boolean; wstepna: boolean } {
  if (wartoscSzac != null && String(wartoscSzac) !== '' && Number.isFinite(Number(wartoscSzac))) return { kwota: Number(wartoscSzac), reczna: true, wstepna: false }
  const zOferty = kwotaOferty(oferta)
  if (zOferty != null) return { kwota: zOferty, reczna: false, wstepna: false }
  if (wartoscWstepna != null && String(wartoscWstepna) !== '' && Number.isFinite(Number(wartoscWstepna)) && Number(wartoscWstepna) > 0) return { kwota: Number(wartoscWstepna), reczna: false, wstepna: true }
  return { kwota: null, reczna: false, wstepna: false }
}

/** Kwota wpisana przez handlowca: „12 500”, „12500,50”, „12.500 zł” → liczba; puste / bzdura / ≤ 0 → null. */
export function parseKwota(text: string): number | null {
  let t = text.replace(/zł|pln/gi, '').replace(/[\s\u00a0]/g, '')
  if (!t) return null
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(t)) t = t.replace(/\./g, '')
  t = t.replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null
  const n = Number(t)
  return n > 0 && n < 10_000_000 ? Math.round(n * 100) / 100 : null
}

type OfertaLeada = OfertaKwota & { status: string; created_at: string }

/** Ostatnia „prawdziwa” oferta klienta (bez starych wersji); gdy są tylko stare — najnowsza z nich. */
export function ostatniaOferta<T extends OfertaLeada>(oferty: T[]): T | null {
  if (!oferty.length) return null
  const sorted = [...oferty].sort((a, b) => b.created_at.localeCompare(a.created_at))
  return sorted.find((o) => o.status !== 'robocza') ?? sorted[0]
}

export type LejekStatus = 'nowy' | 'oferta' | 'wygrany' | 'przegrany'
export const LEJEK_KOLUMNY: Array<{ key: LejekStatus; label: string }> = [
  { key: 'nowy', label: 'Nowy' },
  { key: 'oferta', label: 'Ma ofertę' },
  { key: 'wygrany', label: 'Zamówił' },
  { key: 'przegrany', label: 'Przegrany' },
]

type LejekLead = {
  status: string | null
  wynik_powod?: string | null
  wartosc_szac?: number | string | null
  wartosc_wstepna?: number | string | null
  ostatnia_oferta?: OfertaKwota | null
}

/** Kolumny „Zamówił” / „Przegrany” w lejku pokazują tylko świeże wyniki (20.11: inaczej po kilku miesiącach tysiące kart). */
export const LEJEK_ZAMKNIETE_DNI = 30

/** Czy zamknięty klient (wygrany/przegrany) mieści się w oknie lejka; data wyniku, a gdy jej brak — ostatnia zmiana. */
export function swiezoZamkniety(r: { wynik_at?: string | null; updated_at?: string | null }, now: Date = new Date(), dni = LEJEK_ZAMKNIETE_DNI): boolean {
  const kiedy = r.wynik_at ?? r.updated_at
  if (!kiedy) return true
  const t = new Date(kiedy).getTime()
  if (Number.isNaN(t)) return true
  return now.getTime() - t <= dni * 86_400_000
}

export type LejekPodsumowanie = {
  kolumny: Record<LejekStatus, { n: number; suma: number }>
  wGrze: number
  wartoscWGrze: number
  wygrane: { n: number; suma: number }
  przegrane: { n: number; topPowod: string | null }
  /** % wygranych wśród zamkniętych (wygrany + przegrany); null, gdy nikt nie jest zamknięty */
  procentWygranych: number | null
}

export function lejekPodsumowanie(rows: LejekLead[]): LejekPodsumowanie {
  const kolumny: LejekPodsumowanie['kolumny'] = {
    nowy: { n: 0, suma: 0 },
    oferta: { n: 0, suma: 0 },
    wygrany: { n: 0, suma: 0 },
    przegrany: { n: 0, suma: 0 },
  }
  const powody = new Map<string, number>()
  for (const r of rows) {
    const st = (r.status ?? 'nowy') as LejekStatus
    const kol = kolumny[st] ?? kolumny.nowy
    kol.n += 1
    kol.suma += wartoscKlienta(r.wartosc_szac, r.ostatnia_oferta, r.wartosc_wstepna).kwota ?? 0
    if (st === 'przegrany' && r.wynik_powod) powody.set(r.wynik_powod, (powody.get(r.wynik_powod) ?? 0) + 1)
  }
  let topPowod: string | null = null
  let best = 0
  for (const [p, n] of powody) {
    if (n > best) {
      best = n
      topPowod = p
    }
  }
  const zamkniete = kolumny.wygrany.n + kolumny.przegrany.n
  return {
    kolumny,
    wGrze: kolumny.nowy.n + kolumny.oferta.n,
    // „Nowy” liczy się, gdy ma wartość wpisaną ręcznie (bez oferty kwota = 0)
    wartoscWGrze: kolumny.nowy.suma + kolumny.oferta.suma,
    wygrane: { n: kolumny.wygrany.n, suma: kolumny.wygrany.suma },
    przegrane: { n: kolumny.przegrany.n, topPowod },
    procentWygranych: zamkniete ? Math.round((kolumny.wygrany.n / zamkniete) * 100) : null,
  }
}

/** Opis wyniku do nagłówka / karty: „Przegrany 18.11: cena — notatka”. */
export function opisWyniku(l: { status: string | null; wynik_powod?: string | null; wynik_notatka?: string | null; wynik_at?: string | null }): string {
  const kiedy = l.wynik_at ? new Date(l.wynik_at).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' }) : ''
  if (l.status === 'wygrany') return `Zamówił${kiedy ? ` ${kiedy}` : ''}`
  if (l.status === 'przegrany') {
    const powod = l.wynik_powod ? CRM_WYNIK_POWOD[l.wynik_powod] ?? l.wynik_powod : 'bez podanego powodu'
    return `Przegrany${kiedy ? ` ${kiedy}` : ''}: ${powod}${l.wynik_notatka ? ` — ${l.wynik_notatka}` : ''}`
  }
  return ''
}

/** Klasa plakietki statusu klienta (te same kolory co statusy ofert). */
export const LEAD_STATUS_CLS: Record<string, string> = {
  nowy: 'crm-status--muted',
  oferta: 'crm-status--working',
  wygrany: 'crm-status--won',
  przegrany: 'crm-status--lost',
}

/**
 * Przeciągnięcie karty w lejku (Kontakty): co znaczy przejście z kolumny `z` do `do`.
 * - do „Zamówił” → 'wygrany' (z potwierdzeniem), do „Przegrany” → 'przegrany' (okno z powodem),
 * - z „Zamówił”/„Przegrany” do „Nowy”/„Ma ofertę” → 'w_grze' (serwer sam wybierze Nowy albo Ma ofertę),
 * - z „Nowy” do „Ma ofertę” → 'oferta' (#167: oferta wysłana poza systemem — handlowiec oznacza ręcznie),
 * - z „Ma ofertę” do „Nowy” → 'systemowy' (status cofa tylko system), ta sama kolumna → 'nic'.
 */
export type RuchLejka = 'nic' | 'wygrany' | 'przegrany' | 'w_grze' | 'oferta' | 'systemowy'
export function ruchWLejku(z: string | null | undefined, doKol: LejekStatus): RuchLejka {
  const from = (z || 'nowy') as LejekStatus
  if (from === doKol) return 'nic'
  if (doKol === 'wygrany') return 'wygrany'
  if (doKol === 'przegrany') return 'przegrany'
  if (from === 'wygrany' || from === 'przegrany') return 'w_grze'
  if (doKol === 'oferta') return 'oferta'
  return 'systemowy'
}

/**
 * Tytuł oferty (21.11, Tymek: „inwestorzy, dla których prowadzimy kilka ofert równolegle”):
 * nazwa nadana przez handlowca → produkt → pierwsze słowa streszczenia → rodzaj (+ numer PDF).
 */
export function tytulOferty(o: { nazwa?: string | null; produkt?: string | null; streszczenie?: string | null; rodzaj?: string | null; numer?: string | null } | null | undefined): string {
  if (!o) return 'Oferta'
  const n = o.nazwa?.trim()
  if (n) return n
  const p = o.produkt?.trim()
  if (p) return p
  const s = o.streszczenie?.replace(/\s+/g, ' ').trim()
  if (s) return s.length > 60 ? `${s.slice(0, 59).trimEnd()}…` : s
  return o.rodzaj === 'oficjalna' ? `Oferta z montażem${o.numer ? ` nr ${o.numer}` : ''}` : 'Oferta ze sklepu'
}
