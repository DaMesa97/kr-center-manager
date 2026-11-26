import { describe, expect, it } from 'vitest'
import {
  classifyTrend,
  distribution,
  filterRows,
  monthsEndingAt,
  monthLabel,
  periodLabel,
  rankGroups,
  shortageLabel,
  sortShortagesHist,
  sortShortagesNow,
  sortZewShortages,
  trendCompare,
  trendPeriods,
  wewTrend,
  zewTrend,
  monthlySeries,
  formatPct,
  formatDays,
  type WewBrakRow,
  type WewMiesiacRow,
  type WewSprzedazRow,
  type ZewBrakRow,
  type ZewMiesiacRow,
} from '../lib/salesStats'

const now = new Date('2026-11-26T12:00:00')

const row = (p: Partial<WewSprzedazRow>): WewSprzedazRow => ({
  item_type: 'door_wing', grupa: 'VERONA', model: 'VERONA BLACK', linia: 'BLACK', wykonanie: 'WEW',
  kolor: 'DĄB PRO', rozmiar: '80', rozpoznane: true, szt: 10, zlecenia: 5, ...p,
})

const sprzedaz: WewSprzedazRow[] = [
  row({ szt: 100, kolor: 'DĄB PRO', rozmiar: '80' }),
  row({ szt: 40, kolor: 'KASZMIR PRO', rozmiar: '70' }),
  row({ szt: 10, kolor: 'DĄB PRO', rozmiar: '90', wykonanie: 'NSTD', linia: null, model: 'VERONA' }),
  row({ grupa: 'CLASSIC', model: 'CLASSIC', linia: null, szt: 60, kolor: 'BIAŁY', rozmiar: '80' }),
  row({ grupa: null, model: null, rozpoznane: false, szt: 5, kolor: null, rozmiar: null, wykonanie: null }),
  row({ item_type: 'door_frame', grupa: 'OR3', model: 'OR3 (140-180)', linia: null, wykonanie: null, szt: 70, kolor: 'BIAŁY', rozmiar: null }),
]

describe('salesStats — filtr i ranking', () => {
  it('filtruje po typie i wykonaniu (pozycje bez wykonania zostają)', () => {
    expect(filterRows(sprzedaz, 'door_wing', 'all')).toHaveLength(5)
    expect(filterRows(sprzedaz, 'door_wing', 'WEW').map((r) => r.szt)).toEqual([100, 40, 60, 5])
    expect(filterRows(sprzedaz, 'door_wing', 'NSTD').map((r) => r.szt)).toEqual([10, 5])
    expect(filterRows(sprzedaz, 'all', 'all')).toHaveLength(6)
  })

  it('ranking grup z udziałem, nierozpoznane jako osobna pozycja', () => {
    const r = rankGroups(filterRows(sprzedaz, 'door_wing', 'all'))
    expect(r.map((x) => x.nazwa)).toEqual(['VERONA', 'CLASSIC', '(nierozpoznane)'])
    expect(r[0].szt).toBe(150)
    expect(r[0].zlecenia).toBe(15)
    expect(Math.round(r[0].udzial)).toBe(70) // 150 / 215
  })

  it('rozkład kolorów w grupie i rozmiarów rosnąco', () => {
    const kolory = distribution(sprzedaz, 'kolor', 'VERONA')
    expect(kolory.map((k) => [k.nazwa, k.szt])).toEqual([['DĄB PRO', 110], ['KASZMIR PRO', 40]])
    const rozmiary = distribution(sprzedaz, 'rozmiar', 'VERONA')
    expect(rozmiary.map((k) => k.nazwa)).toEqual(['70', '80', '90'])
    const linie = distribution(sprzedaz, 'linia', 'VERONA')
    expect(linie.map((k) => [k.nazwa, k.szt])).toEqual([['BLACK', 140], ['standard', 10]])
    // bez grupy: całość, puste wartości jako „(brak)”
    expect(distribution(sprzedaz, 'rozmiar').find((k) => k.nazwa === '(brak)')?.szt).toBe(75)
  })
})

describe('salesStats — okresy i trend', () => {
  it('miesiące i etykiety', () => {
    expect(monthsEndingAt(new Date(2026, 10, 1), 3)).toEqual(['2026-09', '2026-10', '2026-11'])
    expect(monthsEndingAt(new Date(2026, 0, 1), 2)).toEqual(['2025-12', '2026-01'])
    expect(monthLabel('2026-10')).toBe('paź 2026')
    expect(periodLabel(['2026-08', '2026-09', '2026-10'])).toBe('sie 2026 – paź 2026')
    expect(periodLabel(['2026-10'])).toBe('paź 2026')
  })

  it('okresy porównania bez bieżącego miesiąca (domyślnie) i z nim', () => {
    expect(trendPeriods('3m', now)).toEqual({ teraz: ['2026-08', '2026-09', '2026-10'], poprzednio: ['2026-05', '2026-06', '2026-07'] })
    expect(trendPeriods('1m', now)).toEqual({ teraz: ['2026-10'], poprzednio: ['2026-09'] })
    expect(trendPeriods('3m', now, true)).toEqual({ teraz: ['2026-09', '2026-10', '2026-11'], poprzednio: ['2026-06', '2026-07', '2026-08'] })
  })

  it('klasyfikacja: próg ±10 %, mało danych, nowe, znika', () => {
    expect(classifyTrend(1216, 1041).kierunek).toBe('rośnie')
    expect(classifyTrend(801, 966).kierunek).toBe('spada')
    expect(classifyTrend(1061, 1051).kierunek).toBe('stabilne')
    expect(classifyTrend(105, 100, { prog: 10 }).kierunek).toBe('stabilne')
    expect(classifyTrend(5, 8).kierunek).toBe('mało danych')
    expect(classifyTrend(50, 0).kierunek).toBe('nowe')
    expect(classifyTrend(0, 50)).toEqual({ kierunek: 'znika', zmianaPct: -100 })
    expect(classifyTrend(30, 10, { min: 5, prog: 25 })).toEqual({ kierunek: 'rośnie', zmianaPct: 200 })
  })

  it('porównanie okresów po grupach: kolejność spada → rośnie → stabilne', () => {
    const rows: WewMiesiacRow[] = []
    const push = (miesiac: string, grupa: string, szt: number) => rows.push({ miesiac, item_type: 'door_wing', grupa, wykonanie: 'WEW', szt, zlecenia: 1 })
    // MODERNA spada: 300 → 200; CLASSIC rośnie: 300 → 400; CREDIS stabilne: 300 → 305; bieżący miesiąc ignorowany
    for (const m of ['2026-05-01', '2026-06-01', '2026-07-01']) { push(m, 'MODERNA', 100); push(m, 'CLASSIC', 100); push(m, 'CREDIS', 100) }
    for (const m of ['2026-08-01', '2026-09-01', '2026-10-01']) { push(m, 'MODERNA', 66); push(m, 'CLASSIC', 133); push(m, 'CREDIS', 101) }
    push('2026-10-01', 'MODERNA', 2); push('2026-10-01', 'CLASSIC', 1); push('2026-10-01', 'CREDIS', 2)
    push('2026-11-01', 'MODERNA', 999)
    push('2026-01-01', 'STARE', 500)
    const t = wewTrend(rows, '3m', now)
    expect(t.map((x) => [x.nazwa, x.kierunek, x.poprzednio, x.teraz])).toEqual([
      ['MODERNA', 'spada', 300, 200],
      ['CLASSIC', 'rośnie', 300, 400],
      ['CREDIS', 'stabilne', 300, 305],
    ])
    expect(Math.round(t[0].zmianaPct ?? 0)).toBe(-33)
    expect(t[0].seria).toEqual([100, 100, 100, 66, 66, 68])
    expect(t[0].miesiace).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'])
  })

  it('trend zewnętrznych liczy tylko wybrany wymiar', () => {
    const rows: ZewMiesiacRow[] = [
      { miesiac: '2026-09-01', wymiar: 'system', wartosc: 'NORMAL', zlecenia: 50, szt: 50 },
      { miesiac: '2026-10-01', wymiar: 'system', wartosc: 'NORMAL', zlecenia: 80, szt: 80 },
      { miesiac: '2026-10-01', wymiar: 'model', wartosc: 'ASTRE 12', zlecenia: 80, szt: 80 },
    ]
    const t = zewTrend(rows, 'system', '1m', now)
    expect(t).toHaveLength(1)
    expect(t[0]).toMatchObject({ nazwa: 'NORMAL', kierunek: 'rośnie', poprzednio: 50, teraz: 80 })
    expect(trendCompare([], '1m', now)).toEqual([])
  })

  it('seria miesięczna uzupełnia puste miesiące zerem', () => {
    const s = monthlySeries([{ miesiac: '2026-10-01', szt: 5 }, { miesiac: '2026-10-15', szt: 2 }], ['2026-09', '2026-10'])
    expect(s).toEqual([{ miesiac: '2026-09', etykieta: 'wrz 2026', szt: 0 }, { miesiac: '2026-10', etykieta: 'paź 2026', szt: 7 }])
  })

  it('formaty', () => {
    expect(formatPct(17.4)).toBe('+17 %')
    expect(formatPct(-16.6)).toBe('-17 %')
    expect(formatPct(null)).toBe('—')
    expect(formatDays(98.14)).toBe('98.1 dn.')
    expect(formatDays(3)).toBe('3 dn.')
    expect(formatDays(null)).toBe('—')
  })
})

describe('salesStats — braki', () => {
  const brak = (p: Partial<WewBrakRow>): WewBrakRow => ({
    optima_code: 'X', optima_name: 'NAZWA X', item_type: 'door_wing', grupa: 'VERONA', model: 'VERONA BLACK', kolor: 'DĄB PRO', rozmiar: '80', wykonanie: 'WEW',
    component_id: 1, is_stocked: false, stan: 0,
    otwarte_zlecenia: 0, otwarte_szt: 0, otwarte_sr_dni: null, otwarte_max_dni: null, otwarte_najstarsze: null,
    hist_zlecenia: 0, hist_czekaly: 0, hist_sr_dni: null, hist_max_dni: null, ...p,
  })
  const rows = [
    brak({ optima_code: 'A', otwarte_zlecenia: 10, otwarte_sr_dni: 41 }),
    brak({ optima_code: 'B', otwarte_zlecenia: 9, otwarte_sr_dni: 102 }),
    brak({ optima_code: 'C', otwarte_zlecenia: 0, hist_czekaly: 51, hist_sr_dni: 8.9 }),
    brak({ optima_code: 'D', hist_czekaly: 10, hist_sr_dni: 14.7 }),
  ]

  it('teraz czekają: zlecenia × średnie dni; historia osobno', () => {
    expect(sortShortagesNow(rows).map((r) => r.optima_code)).toEqual(['B', 'A'])
    expect(sortShortagesHist(rows).map((r) => r.optima_code)).toEqual(['C', 'D'])
  })

  it('etykieta pozycji: model · kolor · rozmiar, a bez grupy nazwa z Optimy', () => {
    expect(shortageLabel(rows[0])).toBe('VERONA BLACK · DĄB PRO · 80')
    expect(shortageLabel(brak({ grupa: null, model: null, optima_name: 'ZABUDOWA OŚC ZOS' }))).toBe('ZABUDOWA OŚC ZOS')
    expect(shortageLabel(brak({ grupa: null, model: null, optima_name: null, optima_code: 'INNE 350 KPL' }))).toBe('INNE 350 KPL')
  })

  it('braki zewnętrzne: po liczbie zleceń, potem po sztukach', () => {
    const z = (p: Partial<ZewBrakRow>): ZewBrakRow => ({
      component_id: 1, kod: 'K', nazwa: 'N', kategoria: 'USZCZELKI', zlecenia: 1, wydania: 1, brak_szt: 1, pierwsze: null, ostatnie: null,
      sr_realizacja: null, sr_realizacja_kat: null, stan: null, rezerwacje: null, dostepne: null, ...p,
    })
    const s = sortZewShortages([z({ kod: 'a', zlecenia: 5, brak_szt: 1 }), z({ kod: 'b', zlecenia: 300, brak_szt: 2 }), z({ kod: 'c', zlecenia: 5, brak_szt: 9 })])
    expect(s.map((r) => r.kod)).toEqual(['b', 'c', 'a'])
  })
})
