// D47 (28.11, decyzja „ROBIMY B”): Statystyki zleceń liczone agregatami w bazie zamiast ładowania tabeli orders
// do przeglądarki (67 MB / 4,3 s przy `select *`, 7 MB przy 15 kolumnach — rośnie z każdym dniem).
//
//  * baza: `stat_zlecenia_podsumowanie()` (migracja 20261128051100) zwraca PodsumowanieZlecen — dla każdej kategorii
//    gotowe sumy (status, czasy realizacji per miesiąc wydania, produkcja per miesiąc, systemy, firmy, dni tygodnia,
//    top modeli / kolorów) i liczniki pisowni firm (Statystyki → Firmy, scalanie nazw);
//  * stara baza (PGRST202): useStats ładuje zlecenia jak dotąd i liczy TO SAMO tu — `podsumujZlecenia`;
//  * ekran (CategoryStatsDashboard) w obu przypadkach rysuje z `widokKategorii` (okno miesięcy, top firm po scaleniu nazw).
// Reguły są przepisane 1:1 z dawnego CategoryStatsDashboard — test `statsAgregaty.test.ts` porównuje wynik ze starym liczeniem.
import type { Order } from '../types'
import { companyNameCounts, type CompanyNameCount } from './companyStats'
import { isMrProfilOrder, isOptimaClosed } from './optimaRo'
import { isReleaseDateEmpty } from '../utils'

export type NazwaWartosc = { name: string; value: number }
/** Czasy realizacji (dni od zamówienia do wydania) zleceń wydanych w miesiącu m (RRRR-MM). */
export type MiesiacRealizacji = { m: string; suma: number; n: number; min: number; max: number }
/** Firma (pisownia po trim, może być pusta) z sumą sztuk; `first` = najmniejsze id (kolejność jak w starym liczeniu). */
export type FirmaKategorii = { name: string; value: number; first: number }

export type PodsumowanieKategorii = {
  status: { zrealizowane: number; w_produkcji: number; anulowane: number }
  /** wydane z datą „z dnia synchronizacji Excela” (release_date_szacunkowa) — pomijane w czasach i produkcji */
  bez_daty: number
  realizacja: MiesiacRealizacji[]
  produkcja: Array<{ m: string; szt: number }>
  systemy: NazwaWartosc[]
  firmy: FirmaKategorii[]
  /** sztuki wg dnia tygodnia zamówienia, indeks jak Date#getDay (0 = niedziela) */
  dni: number[]
  modele: NazwaWartosc[]
  kolory: NazwaWartosc[]
}

export type PodsumowanieZlecen = {
  kategorie: Record<string, PodsumowanieKategorii>
  firmy: CompanyNameCount[]
  /** liczba zleceń w statystykach (bez RO MR Profil) */
  liczba: number
}

export const TOP_MODELI = 15
export const TOP_FIRM = 10

const anulowane = (o: Order) => (o.extra_fields as Record<string, unknown> | null | undefined)?.cancelled === true
const szacunkowa = (o: Order) => (o.extra_fields as Record<string, unknown> | null | undefined)?.release_date_szacunkowa === true
const mies = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

function dodaj<K>(m: Map<K, { v: number; f: number }>, k: K, v: number, id: number) {
  const e = m.get(k)
  if (e) e.v += v
  else m.set(k, { v, f: id })
}
const posortowane = (m: Map<string, { v: number; f: number }>, limit = Infinity): NazwaWartosc[] =>
  Array.from(m.entries())
    .map(([name, { v, f }]) => ({ name, value: v, f }))
    .sort((a, b) => b.value - a.value || a.f - b.f)
    .slice(0, limit)
    .map(({ name, value }) => ({ name, value }))

/** Pusta kategoria (brak zleceń). */
export function pustePodsumowanie(): PodsumowanieKategorii {
  return {
    status: { zrealizowane: 0, w_produkcji: 0, anulowane: 0 },
    bez_daty: 0,
    realizacja: [],
    produkcja: [],
    systemy: [],
    firmy: [],
    dni: [0, 0, 0, 0, 0, 0, 0],
    modele: [],
    kolory: [],
  }
}

/**
 * Ścieżka zapasowa (baza bez funkcji D47): to samo co `stat_zlecenia_podsumowanie`, liczone z listy zleceń.
 * Zlecenia RO MR Profil pomijane (D10), jak dotąd w useStats.
 */
export function podsumujZlecenia(wszystkie: Order[]): PodsumowanieZlecen {
  const orders = [...wszystkie].filter((o) => !isMrProfilOrder(o)).sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0))
  type Robocze = {
    p: PodsumowanieKategorii
    real: Map<string, MiesiacRealizacji>
    prod: Map<string, number>
    sys: Map<string, { v: number; f: number }>
    firmy: Map<string, { v: number; f: number }>
    modele: Map<string, { v: number; f: number }>
    kolory: Map<string, { v: number; f: number }>
  }
  const kat = new Map<string, Robocze>()
  for (const o of orders) {
    if (o.category == null) continue
    const k = String(o.category)
    let r = kat.get(k)
    if (!r) {
      r = { p: pustePodsumowanie(), real: new Map(), prod: new Map(), sys: new Map(), firmy: new Map(), modele: new Map(), kolory: new Map() }
      kat.set(k, r)
    }
    const id = Number(o.id) || 0
    const q0 = Number(o.quantity) || 0
    const q1 = Number(o.quantity) || 1
    const wydane = !isReleaseDateEmpty(o.release_date)
    // status: wszystkie zlecenia kategorii
    if (anulowane(o)) {
      r.p.status.anulowane += q0
      continue
    }
    if (wydane || isOptimaClosed(o)) r.p.status.zrealizowane += q0
    else r.p.status.w_produkcji += q0
    // nieanulowane
    dodaj(r.firmy, String(o.company || '').trim(), q0, id)
    dodaj(r.modele, o.model?.trim() || '(brak)', q1, id)
    dodaj(r.kolory, o.wing_color?.trim() || '(brak)', q1, id)
    const createdStr = o.order_date || (o as { created_at?: string }).created_at
    const dow = createdStr ? new Date(createdStr).getDay() : NaN
    if (!Number.isNaN(dow)) r.p.dni[dow] += q1
    if (!wydane) continue
    // wydane (nieanulowane)
    dodaj(r.sys, (o.system || '').trim() || '(brak)', q0, id)
    if (szacunkowa(o)) {
      r.p.bez_daty += 1
      continue
    }
    const kluczProd = String(o.release_date ?? '').slice(0, 7)
    r.prod.set(kluczProd, (r.prod.get(kluczProd) ?? 0) + q0)
    if (!createdStr) continue
    const released = new Date(String(o.release_date))
    // „+ 0”: Math.round(-0,3) daje -0 (wyświetla się jako 0) — baza zwraca 0; NaN zostaje NaN
    const days = Math.round((released.getTime() - new Date(createdStr).getTime()) / (1000 * 60 * 60 * 24)) + 0
    if (days < 0 || Number.isNaN(days)) continue
    const m = mies(released)
    const e = r.real.get(m)
    if (e) {
      e.suma += days
      e.n += 1
      e.min = Math.min(e.min, days)
      e.max = Math.max(e.max, days)
    } else r.real.set(m, { m, suma: days, n: 1, min: days, max: days })
  }
  const kategorie: Record<string, PodsumowanieKategorii> = {}
  for (const [k, r] of kat) {
    kategorie[k] = {
      ...r.p,
      realizacja: Array.from(r.real.values()).sort((a, b) => a.m.localeCompare(b.m)),
      produkcja: Array.from(r.prod.entries()).map(([m, szt]) => ({ m, szt })).sort((a, b) => a.m.localeCompare(b.m)),
      systemy: posortowane(r.sys),
      firmy: Array.from(r.firmy.entries()).map(([name, { v, f }]) => ({ name, value: v, first: f })).sort((a, b) => a.first - b.first),
      modele: posortowane(r.modele, TOP_MODELI),
      kolory: posortowane(r.kolory, TOP_MODELI),
    }
  }
  return { kategorie, firmy: companyNameCounts(orders), liczba: orders.length }
}

const liczba = (v: unknown) => Number(v) || 0
const tablica = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const nw = (v: unknown): NazwaWartosc[] =>
  tablica(v).map((x) => ({ name: String((x as NazwaWartosc).name ?? ''), value: liczba((x as NazwaWartosc).value) }))

/** Wynik RPC `stat_zlecenia_podsumowanie` → typy aplikacji (odporne na brakujące pola). */
export function normalizujPodsumowanie(raw: unknown): PodsumowanieZlecen {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const kategorie: Record<string, PodsumowanieKategorii> = {}
  const kat = (r.kategorie && typeof r.kategorie === 'object' ? r.kategorie : {}) as Record<string, Record<string, unknown>>
  for (const [k, p] of Object.entries(kat)) {
    const s = (p?.status ?? {}) as Record<string, unknown>
    const dni = tablica(p?.dni).map(liczba)
    kategorie[k] = {
      status: { zrealizowane: liczba(s.zrealizowane), w_produkcji: liczba(s.w_produkcji), anulowane: liczba(s.anulowane) },
      bez_daty: liczba(p?.bez_daty),
      realizacja: tablica(p?.realizacja).map((x) => {
        const e = x as Record<string, unknown>
        return { m: String(e.m ?? ''), suma: liczba(e.suma), n: liczba(e.n), min: liczba(e.min), max: liczba(e.max) }
      }),
      produkcja: tablica(p?.produkcja).map((x) => ({ m: String((x as { m?: unknown }).m ?? ''), szt: liczba((x as { szt?: unknown }).szt) })),
      systemy: nw(p?.systemy),
      firmy: tablica(p?.firmy).map((x) => {
        const e = x as Record<string, unknown>
        return { name: String(e.name ?? ''), value: liczba(e.value), first: liczba(e.first) }
      }),
      dni: [0, 1, 2, 3, 4, 5, 6].map((i) => dni[i] ?? 0),
      modele: nw(p?.modele),
      kolory: nw(p?.kolory),
    }
  }
  const firmy = tablica(r.firmy).map((x) => ({ name: String((x as CompanyNameCount).name ?? ''), count: liczba((x as CompanyNameCount).count) }))
  return { kategorie, firmy, liczba: liczba(r.liczba) }
}

export type WidokKategorii = {
  bezPrawdziwejDaty: number
  productionData: Array<{ month: string; qty: number }>
  systemData: NazwaWartosc[]
  statusData: Array<{ name: string; value: number; color: string }>
  topCompaniesData: NazwaWartosc[]
  /** null = brak zleceń z prawdziwą datą wydania */
  realizacja: { avg: number; min: number; max: number; count: number } | null
  avgRealizationByMonth: Array<{ month: string; avg: number }>
  byWeekday: NazwaWartosc[]
  byModel: NazwaWartosc[]
  byWingColor: NazwaWartosc[]
}

/** Klucze ostatnich `rangeMonths` miesięcy (od najstarszego), jak dawne wykresy. */
function oknoMiesiecy(rangeMonths: number, now: Date): string[] {
  const out: string[] = []
  for (let i = rangeMonths - 1; i >= 0; i--) out.push(mies(new Date(now.getFullYear(), now.getMonth() - i, 1)))
  return out
}

/** Dane wykresów Statystyk kategorii z podsumowania (z bazy albo z podsumujZlecenia). */
export function widokKategorii(
  p: PodsumowanieKategorii | undefined,
  rangeMonths: number,
  now: Date = new Date(),
  canon?: (name: unknown) => string,
): WidokKategorii {
  const s = p ?? pustePodsumowanie()
  const okno = oknoMiesiecy(rangeMonths, now)

  const prod = new Map(s.produkcja.map((x) => [x.m, x.szt]))
  const productionData = okno.map((month) => ({ month, qty: prod.get(month) ?? 0 }))

  const firmy = new Map<string, number>()
  for (const f of s.firmy) {
    const company = (canon ? canon(f.name) : (f.name || '').trim()) || '(brak)'
    firmy.set(company, (firmy.get(company) ?? 0) + f.value)
  }
  const topCompaniesData = Array.from(firmy.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, TOP_FIRM)

  let suma = 0
  let n = 0
  let min = Infinity
  let max = -Infinity
  for (const r of s.realizacja) {
    suma += r.suma
    n += r.n
    min = Math.min(min, r.min)
    max = Math.max(max, r.max)
  }
  const real = new Map(s.realizacja.map((r) => [r.m, r]))
  const avgRealizationByMonth = okno.map((month) => {
    const r = real.get(month)
    return { month, avg: r && r.n > 0 ? Math.round(r.suma / r.n) : 0 }
  })

  const d = s.dni
  return {
    bezPrawdziwejDaty: s.bez_daty,
    productionData,
    systemData: s.systemy,
    statusData: [
      { name: 'Zrealizowane', value: s.status.zrealizowane, color: '#10b981' },
      { name: 'W produkcji', value: s.status.w_produkcji, color: '#3b82f6' },
      { name: 'Anulowane', value: s.status.anulowane, color: '#ef4444' },
    ],
    topCompaniesData,
    realizacja: n > 0 ? { avg: Math.round(suma / n), min, max, count: n } : null,
    avgRealizationByMonth,
    byWeekday: [
      { name: 'Pon', value: d[1] ?? 0 },
      { name: 'Wt', value: d[2] ?? 0 },
      { name: 'Śr', value: d[3] ?? 0 },
      { name: 'Czw', value: d[4] ?? 0 },
      { name: 'Pt', value: d[5] ?? 0 },
      { name: 'Sob', value: d[6] ?? 0 },
      { name: 'Ndz', value: d[0] ?? 0 },
    ],
    byModel: s.modele,
    byWingColor: s.kolory,
  }
}
