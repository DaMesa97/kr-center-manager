/**
 * Statystyki CRM (21.11, Tymek: „zamknięci znikają z bieżącego podglądu, ale musi być historia — ile wygraliśmy,
 * per miesiąc, pochodzenie”). Czyste funkcje: dane z crm.leady (+ ostatnia oferta) i wysłanych crm.oferty.
 *
 * Zasady liczenia:
 *  - miesiąc nowego klienta = created_at; zamknięcia (Zamówił / Przegrany) = wynik_at; oferta = wyslano_at;
 *  - skuteczność = zamówili / (zamówili + przegrani) w danym okresie (po dacie wyniku);
 *  - wartość zamówienia = wartość klienta (ręczna wartość albo kwota ostatniej oferty — jak w lejku);
 *  - pochodzenie i kategoria to „kohorta”: klienci, którzy PRZYSZLI w okresie, i ilu z nich już kupiło.
 */
import { kwotaOferty, wartoscKlienta } from './crmWynik'

type OfertaKw = { rodzaj?: string | null; brutto?: number | null; cena_razem?: number | null }

export type StatLead = {
  id: string
  status: string | null
  zrodlo?: string | null
  kampania?: string | null
  kategoria?: string | null
  created_at: string
  wynik_at?: string | null
  /** zamknięci przed 18.11 nie mają wynik_at — wtedy data ostatniej zmiany (jak w lejku) */
  updated_at?: string | null
  wynik_powod?: string | null
  wynik_kto?: string | null
  wartosc_szac?: number | string | null
  ostatnia_oferta?: OfertaKw | null
}

export type StatOferta = OfertaKw & { lead_id: string | null; wyslano_at: string | null }

export type Okres = '12m' | 'rok' | 'miesiac' | 'wszystko'
export const OKRESY: Array<{ key: Okres; label: string }> = [
  { key: '12m', label: 'Ostatnie 12 miesięcy' },
  { key: 'rok', label: 'Ten rok' },
  { key: 'miesiac', label: 'Ten miesiąc' },
  { key: 'wszystko', label: 'Od początku' },
]

/** „2026-11” w czasie lokalnym. */
export function miesiacKlucz(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const MIES = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru']
/** „lis 2026” */
export function miesiacEtykieta(klucz: string): string {
  const [r, m] = klucz.split('-')
  return `${MIES[Number(m) - 1] ?? m} ${r}`
}

/** Początek okresu (null = od początku danych). */
export function okresOd(okres: Okres, now: Date = new Date()): Date | null {
  if (okres === 'wszystko') return null
  if (okres === 'rok') return new Date(now.getFullYear(), 0, 1)
  if (okres === 'miesiac') return new Date(now.getFullYear(), now.getMonth(), 1)
  return new Date(now.getFullYear(), now.getMonth() - 11, 1)
}

/** Kolejne miesiące od..do włącznie. */
export function miesiaceZakresu(od: Date, now: Date): string[] {
  const out: string[] = []
  const d = new Date(od.getFullYear(), od.getMonth(), 1)
  const koniec = new Date(now.getFullYear(), now.getMonth(), 1)
  while (d <= koniec && out.length < 240) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    d.setMonth(d.getMonth() + 1)
  }
  return out
}

export type Wiersz = { klucz: string; nowi: number; zamowili: number; wartosc: number; przegrani: number; skutecznosc: number | null }
export type MiesiacStat = Wiersz & { wyslane: number; wyslaneSuma: number }
export type CrmStatystyki = {
  kpi: {
    nowi: number
    wyslane: { n: number; suma: number }
    zamowili: { n: number; suma: number }
    przegrani: number
    skutecznosc: number | null
    srWartosc: number | null
    srDniDoZamowienia: number | null
  }
  miesiace: MiesiacStat[]
  wgZrodla: Wiersz[]
  wgKategorii: Wiersz[]
  wgKampanii: Wiersz[]
  powody: Array<{ powod: string; n: number; proc: number }>
  wgOsoby: Array<{ kto: string | null; zamowili: number; wartosc: number; przegrani: number }>
}

const proc = (a: number, b: number): number | null => (b ? Math.round((a / b) * 100) : null)
const wKresie = (iso: string | null | undefined, od: Date | null, now: Date) => {
  if (!iso) return false
  const t = new Date(iso).getTime()
  return !Number.isNaN(t) && (!od || t >= od.getTime()) && t <= now.getTime()
}
const dataWyniku = (l: StatLead): string | null => l.wynik_at ?? l.updated_at ?? null
const wartoscLeada = (l: StatLead) => wartoscKlienta(l.wartosc_szac, l.ostatnia_oferta).kwota ?? 0

function grupuj(leady: StatLead[], klucz: (l: StatLead) => string): Wiersz[] {
  const m = new Map<string, Wiersz>()
  for (const l of leady) {
    const k = klucz(l)
    const w = m.get(k) ?? { klucz: k, nowi: 0, zamowili: 0, wartosc: 0, przegrani: 0, skutecznosc: null }
    w.nowi += 1
    if (l.status === 'wygrany') { w.zamowili += 1; w.wartosc += wartoscLeada(l) }
    if (l.status === 'przegrany') w.przegrani += 1
    m.set(k, w)
  }
  return [...m.values()]
    .map((w) => ({ ...w, skutecznosc: proc(w.zamowili, w.zamowili + w.przegrani) }))
    .sort((a, b) => b.nowi - a.nowi || b.wartosc - a.wartosc)
}

export function statystykiCrm(leady: StatLead[], oferty: StatOferta[], okres: Okres, now: Date = new Date()): CrmStatystyki {
  const pierwszy = leady.reduce<string | null>((min, l) => (!min || l.created_at < min ? l.created_at : min), null)
  const od = okresOd(okres, now)
  const odZakresu = od ?? (pierwszy ? new Date(pierwszy) : now)
  const miesiaceKlucze = miesiaceZakresu(odZakresu, now)
  const mies = new Map<string, MiesiacStat>(
    miesiaceKlucze.map((k) => [k, { klucz: k, nowi: 0, wyslane: 0, wyslaneSuma: 0, zamowili: 0, wartosc: 0, przegrani: 0, skutecznosc: null }]),
  )

  const nowi = leady.filter((l) => wKresie(l.created_at, od, now))
  const zamkniete = leady.filter((l) => (l.status === 'wygrany' || l.status === 'przegrany') && wKresie(dataWyniku(l), od, now))
  const wygrane = zamkniete.filter((l) => l.status === 'wygrany')
  const przegrane = zamkniete.filter((l) => l.status === 'przegrany')
  const wyslane = oferty.filter((o) => wKresie(o.wyslano_at, od, now))

  for (const l of nowi) { const r = mies.get(miesiacKlucz(l.created_at)); if (r) r.nowi += 1 }
  for (const l of wygrane) { const r = mies.get(miesiacKlucz(dataWyniku(l) as string)); if (r) { r.zamowili += 1; r.wartosc += wartoscLeada(l) } }
  for (const l of przegrane) { const r = mies.get(miesiacKlucz(dataWyniku(l) as string)); if (r) r.przegrani += 1 }
  for (const o of wyslane) { const r = mies.get(miesiacKlucz(o.wyslano_at as string)); if (r) { r.wyslane += 1; r.wyslaneSuma += kwotaOferty(o) ?? 0 } }

  const sumaWygranych = wygrane.reduce((a, l) => a + wartoscLeada(l), 0)
  const dni = wygrane
    .map((l) => (new Date(dataWyniku(l) as string).getTime() - new Date(l.created_at).getTime()) / 86_400_000)
    .filter((d) => Number.isFinite(d) && d >= 0)

  const powodyMap = new Map<string, number>()
  for (const l of przegrane) powodyMap.set(l.wynik_powod || 'nie podano', (powodyMap.get(l.wynik_powod || 'nie podano') ?? 0) + 1)
  const osoby = new Map<string | null, { kto: string | null; zamowili: number; wartosc: number; przegrani: number }>()
  for (const l of zamkniete) {
    const k = l.wynik_kto ?? null
    const o = osoby.get(k) ?? { kto: k, zamowili: 0, wartosc: 0, przegrani: 0 }
    if (l.status === 'wygrany') { o.zamowili += 1; o.wartosc += wartoscLeada(l) } else o.przegrani += 1
    osoby.set(k, o)
  }

  return {
    kpi: {
      nowi: nowi.length,
      wyslane: { n: wyslane.length, suma: wyslane.reduce((a, o) => a + (kwotaOferty(o) ?? 0), 0) },
      zamowili: { n: wygrane.length, suma: sumaWygranych },
      przegrani: przegrane.length,
      skutecznosc: proc(wygrane.length, zamkniete.length),
      srWartosc: wygrane.length ? Math.round(sumaWygranych / wygrane.length) : null,
      srDniDoZamowienia: dni.length ? Math.round(dni.reduce((a, d) => a + d, 0) / dni.length) : null,
    },
    miesiace: [...mies.values()].map((r) => ({ ...r, skutecznosc: proc(r.zamowili, r.zamowili + r.przegrani) })),
    wgZrodla: grupuj(nowi, (l) => l.zrodlo || 'nieznane'),
    wgKategorii: grupuj(nowi, (l) => l.kategoria || 'nieznana'),
    wgKampanii: grupuj(nowi.filter((l) => l.kampania), (l) => l.kampania as string),
    powody: [...powodyMap.entries()].map(([powod, n]) => ({ powod, n, proc: proc(n, przegrane.length) ?? 0 })).sort((a, b) => b.n - a.n),
    wgOsoby: [...osoby.values()].sort((a, b) => b.wartosc - a.wartosc || b.zamowili - a.zamowili),
  }
}
