import { describe, expect, it } from 'vitest'
import {
  blFromClientOrder,
  blOrderId,
  canEditPallets,
  clientFromClientOrder,
  commonBl,
  daySummary,
  groupByBl,
  groupByDate,
  isPendingForShipment,
  nextWorkingDay,
  parseOznaczWydaneWynik,
  rozchodPrzyOznaczeniu,
  isNonWorkingDay,
  blOczekujeZaDlugo,
} from '../lib/shipments'

describe('numer BL i klient z client_order_number', () => {
  it('przed i po „/”', () => {
    expect(blFromClientOrder('57857794/GNIEWEK')).toBe('57857794')
    expect(clientFromClientOrder('57857794/GNIEWEK')).toBe('GNIEWEK')
    expect(blFromClientOrder(' 57874197 / MUSIAŁ ')).toBe('57874197')
    expect(clientFromClientOrder(' 57874197 / MUSIAŁ ')).toBe('MUSIAŁ')
  })
  it('bez „/” albo pusto', () => {
    expect(blFromClientOrder('57857794')).toBe('57857794')
    expect(clientFromClientOrder('57857794')).toBe('')
    expect(blFromClientOrder(null)).toBe('')
  })
  it('bl_order_id tylko z cyfr', () => {
    expect(blOrderId('57857794')).toBe(57857794)
    expect(blOrderId('RO/12')).toBeNull()
    expect(blOrderId('')).toBeNull()
  })
})

describe('grupowanie', () => {
  it('po BL (RACINOWSKI_1 + _2 razem), bez BL osobno', () => {
    const g = groupByBl([
      { id: 1, bl: '111' },
      { id: 2, bl: '' },
      { id: 3, bl: '111' },
      { id: 4, bl: '' },
    ])
    expect(g.map((x) => x.rows.map((r) => r.id))).toEqual([[1, 3], [2], [4]])
    expect(commonBl([{ bl: '111' }, { bl: '111' }])).toBe('111')
    expect(commonBl([{ bl: '111' }, { bl: '222' }])).toBe('')
  })
  it('po dacie rosnąco, bez daty na końcu', () => {
    const g = groupByDate([{ ship_date: '2026-12-02' }, { ship_date: null }, { ship_date: '2026-11-30' }, { ship_date: '2026-12-02' }])
    expect(g.map((x) => [x.date, x.rows.length])).toEqual([['2026-11-30', 1], ['2026-12-02', 2], [null, 1]])
  })
})

describe('najbliższy dzień roboczy', () => {
  it('piątek → poniedziałek, z dniami wolnymi', () => {
    expect(nextWorkingDay(new Date(2026, 10, 27))).toBe('2026-11-30') // pt 27.11 → pn 30.11
    expect(nextWorkingDay(new Date(2026, 10, 27), new Set(['2026-11-30']))).toBe('2026-12-01')
    expect(nextWorkingDay(new Date(2026, 10, 24))).toBe('2026-11-25')
  })
})

describe('podsumowanie dnia i statusy', () => {
  it('liczy wysyłki i palety bez anulowanych', () => {
    const s = daySummary(
      [
        { id: 1, ship_date: '2026-11-30', status: 'zaplanowana', pallets_vertical: 1, pallets_horizontal: 0 },
        { id: 2, ship_date: '2026-11-30', status: 'gotowa', pallets_vertical: 0, pallets_horizontal: 2 },
        { id: 3, ship_date: '2026-11-30', status: 'anulowana', pallets_vertical: 5, pallets_horizontal: 5 },
        { id: 4, ship_date: '2026-12-01', status: 'nadana', pallets_vertical: 3, pallets_horizontal: 0 },
      ],
      '2026-11-30',
    )
    expect(s).toEqual({ count: 2, vertical: 1, horizontal: 2 })
  })
  it('palety edytowalne do nadania', () => {
    expect(canEditPallets('zaplanowana')).toBe(true)
    expect(canEditPallets('gotowa')).toBe(true)
    expect(canEditPallets('nadana')).toBe(false)
    expect(canEditPallets('anulowana')).toBe(false)
  })
  it('zlecenie do wysyłki: nieanulowane, wydanie od dziś, nieprzypięte', () => {
    const today = '2026-11-27'
    const att = new Set([5])
    expect(isPendingForShipment({ id: 1, release_date: null }, today, att)).toBe(true)
    expect(isPendingForShipment({ id: 2, release_date: '2026-11-27' }, today, att)).toBe(true)
    expect(isPendingForShipment({ id: 3, release_date: '2026-11-26' }, today, att)).toBe(false)
    expect(isPendingForShipment({ id: 4, release_date: null, extra_fields: { cancelled: true } }, today, att)).toBe(false)
    expect(isPendingForShipment({ id: 5, release_date: null }, today, att)).toBe(false)
  })
})

describe('daty SUUS i sekcje listy (27.11)', () => {
  it('doręczenie = wysyłka + 2 dni robocze (weekend i dni wolne pomijane)', async () => {
    const { addWorkingDays } = await import('../lib/shipments')
    expect(addWorkingDays('2026-11-30', 2)).toBe('2026-12-02') // pon → śr
    expect(addWorkingDays('2026-12-03', 2)).toBe('2026-12-07') // czw → pon
    expect(addWorkingDays('2026-12-22', 2, new Set(['2026-12-24', '2026-12-25']))).toBe('2026-12-28')
    expect(addWorkingDays('zła', 2)).toBe('')
  })
  it('dzień tygodnia w polu daty', async () => {
    const { dayLabel } = await import('../lib/shipments')
    expect(dayLabel('2026-11-30')).toBe('pon. 30.11.2026')
    expect(dayLabel('2026-12-02')).toBe('śr. 02.12.2026')
    expect(dayLabel(null)).toBe('')
  })
  it('sekcje: stare (ponad 30 dni) na dole, reszta gotowe / w produkcji', async () => {
    const { pendingSection, daysSince } = await import('../lib/shipments')
    const dzis = '2026-11-27'
    expect(pendingSection({ order_date: '2026-11-20', ready: true }, dzis)).toBe('gotowe')
    expect(pendingSection({ order_date: '2026-11-20', ready: false }, dzis)).toBe('produkcja')
    expect(pendingSection({ order_date: '2026-10-14', ready: true }, dzis)).toBe('stare')
    expect(pendingSection({ order_date: null, ready: false }, dzis)).toBe('produkcja')
    expect(daysSince('2026-10-14', dzis)).toBe(44)
  })
})

describe('metoda dostawy z BaseLinkera (27.11)', () => {
  it('kurier w każdej pisowni, odbiór i montaż to inna, bez BL / bez danych to brak', async () => {
    const { rodzajDostawy } = await import('../lib/shipments')
    expect(rodzajDostawy('Kurier', true)).toBe('kurier')
    expect(rodzajDostawy('KURIER', true)).toBe('kurier')
    expect(rodzajDostawy('Kurier (PoDrzwi)', true)).toBe('kurier')
    expect(rodzajDostawy('Odbiór osobisty - Wodzisław Śląski', true)).toBe('inna')
    expect(rodzajDostawy('USŁUGA MONTAŻU DRZWI zgodnie z umową 80/11/2026', true)).toBe('inna')
    expect(rodzajDostawy(undefined, true)).toBe('brak')
    expect(rodzajDostawy('Kurier', false)).toBe('brak')
  })
})

describe('poprawki po testach 27.11', () => {
  it('nr BL = pierwszy ciąg 8 cyfr, także w środku tekstu', () => {
    expect(blFromClientOrder('1066 VIVENTO (zamówienie 55204048/Hanak)')).toBe('55204048')
    expect(clientFromClientOrder('1066 VIVENTO (zamówienie 55204048/Hanak)')).toBe('Hanak')
    expect(blFromClientOrder('1051 POL-PANEL (zamówienie 54837651/S.C)')).toBe('54837651')
    expect(blFromClientOrder('47807951/STEMPNIAK')).toBe('47807951')
  })
  it('bez 8 cyfr — pusto (nie skleja „557/…” ani „OF/…” w jedną wysyłkę)', () => {
    expect(blFromClientOrder('557/09/2026')).toBe('')
    expect(blFromClientOrder('OF/WASILEWSKI')).toBe('')
    expect(blFromClientOrder('123456789/X')).toBe('')
    expect(clientFromClientOrder('OF/WASILEWSKI')).toBe('WASILEWSKI')
  })
  it('weekend i święto w polu daty', () => {
    expect(isNonWorkingDay('2026-11-28')).toBe(true)
    expect(isNonWorkingDay('2026-11-30')).toBe(false)
    expect(isNonWorkingDay('2026-12-24', new Set(['2026-12-24']))).toBe(true)
  })
  it('„oczekuje” po 3 minutach = zawieszona (pokaż „Ponów”)', () => {
    const now = Date.parse('2026-11-27T18:00:00Z')
    expect(blOczekujeZaDlugo({ bl_status: 'oczekuje', bl_requested_at: '2026-11-27T17:59:00Z' }, now)).toBe(false)
    expect(blOczekujeZaDlugo({ bl_status: 'oczekuje', bl_requested_at: '2026-11-27T17:50:00Z' }, now)).toBe(true)
    expect(blOczekujeZaDlugo({ bl_status: 'oczekuje', bl_requested_at: null }, now)).toBe(true)
    expect(blOczekujeZaDlugo({ bl_status: 'utworzona', bl_requested_at: null }, now)).toBe(false)
  })
})

describe('D30 — oznacz jako wydane: rozchód po spisie', () => {
  it('podpowiedź: zamówione od 6.11 → rozchód, starsze i bez daty → tylko rezerwacje', () => {
    expect(rozchodPrzyOznaczeniu('2026-11-06')).toBe(true)
    expect(rozchodPrzyOznaczeniu('2026-11-20T10:00:00Z')).toBe(true)
    expect(rozchodPrzyOznaczeniu('2026-11-05')).toBe(false)
    expect(rozchodPrzyOznaczeniu(null)).toBe(false)
  })

  it('wynik funkcji bazy', () => {
    expect(parseOznaczWydaneWynik('rozchod:17')).toEqual({ rozchod: true, pozycji: 17 })
    expect(parseOznaczWydaneWynik('zamkniete_rezerwacje:8')).toEqual({ rozchod: false, pozycji: 8 })
    expect(parseOznaczWydaneWynik(null)).toBeNull()
    expect(parseOznaczWydaneWynik('cos')).toBeNull()
  })
})
