import { describe, expect, it } from 'vitest'
import type { Order } from '../types'
import { createEmptyProductionStages } from '../utils'
import { pasujeDoKlienta, slowaNazwiska, stanZamowienia, stanZlecenia, terminZamowienia, uwagiZamowienia, type ZamowienieSklep } from '../lib/crmZamowienia'

const TERAZ = Date.parse('2026-11-25T12:00:00Z')

function zlecenie(p: Partial<Order> & { stagesDone?: boolean } = {}): Order {
  const stages = createEmptyProductionStages(p.category ?? 'STA') as Record<string, string>
  if (p.stagesDone) for (const k of Object.keys(stages)) stages[k] = 'DK'
  return {
    id: 1, order_number: '4685', category: 'STA', company: 'PO DRZWI', production_day: 'CZWARTEK', system: 'NORMAL', model: 'X',
    side_panel: '', top_light: '', extra_fields: {}, release_date: null, shipped_at: null, shipped_route: null,
    ...p, production_stages: stages,
  } as unknown as Order
}

function zam(p: Partial<ZamowienieSklep> = {}): ZamowienieSklep {
  return {
    bl_id: 57582221, shop_order_id: '75199', status_id: 1, potwierdzone: true,
    data_zlozenia: '2026-11-23T10:00:00Z', data_potwierdzenia: '2026-11-23T10:00:00Z', data_statusu: null,
    klient: 'Tomasz Hamerlak', firma: null, email: 'x@example.com', telefon: '+48500000000', adres: null, kod: null, miasto: 'Bystra',
    dostawa_metoda: 'Odbiór osobisty', dostawa_cena: 0, paczka_nr: null, punkt_odbioru: null, platnosc_metoda: 'Przelew online',
    pobranie: false, oplacone: 4800, kwota: 4800, waluta: 'PLN',
    pozycje: [{ nazwa: 'Drzwi zewnętrzne Otto 01', atrybuty: null, sku: null, ilosc: 1, cena: 3800 }, { nazwa: 'Komplet okuć', atrybuty: null, sku: null, ilosc: 1, cena: 1000 }],
    uwagi_klienta: null, uwagi_sklepu: null, pola_dodatkowe: {}, strona_klienta: null, lead_id: null, synced_at: '2026-11-25T12:00:00Z',
    ...p,
  }
}

describe('stan zlecenia KR', () => {
  it('anulowane > wysłane > wydane > etapy', () => {
    expect(stanZlecenia(zlecenie({ extra_fields: { cancelled: true }, shipped_at: '2026-11-20' }))).toBe('anulowane')
    expect(stanZlecenia(zlecenie({ shipped_at: '2026-11-20' }))).toBe('wyslane')
    expect(stanZlecenia(zlecenie({ release_date: '2026-11-19' }))).toBe('gotowe')
    expect(stanZlecenia(zlecenie({ stagesDone: true }))).toBe('gotowe')
    expect(stanZlecenia(zlecenie())).toBe('prod')
  })
})

describe('status zamówienia sklepu', () => {
  it('bez zleceń: drzwi = brak zlecenia, same akcesoria = bez produkcji, anulowane w sklepie', () => {
    expect(stanZamowienia(zam(), [], 0, 'Nowe')).toBe('brak')
    expect(stanZamowienia(zam({ pozycje: [{ nazwa: 'Wkładka WILKA', atrybuty: null, sku: null, ilosc: 1, cena: 100 }] }), [], 0, 'Nowe')).toBe('bez_produkcji')
    expect(stanZamowienia(zam(), [], 0, 'Anulowane')).toBe('anulowane')
  })
  it('zestaw: część gotowa = częściowo, wszystko wyjechało = wysłane, reklamacja wygrywa', () => {
    const a = zlecenie({ id: 1, release_date: '2026-11-19' })
    const b = zlecenie({ id: 2 })
    expect(stanZamowienia(zam(), [a, b], 0, 'W produkcji')).toBe('czesc')
    expect(stanZamowienia(zam(), [zlecenie({ shipped_at: '2026-11-20' }), zlecenie({ extra_fields: { cancelled: true } })], 0, null)).toBe('wyslane')
    expect(stanZamowienia(zam(), [a], 1, null)).toBe('reklamacja')
    expect(stanZamowienia(zam(), [zlecenie({ extra_fields: { cancelled: true } })], 0, null)).toBe('anulowane')
  })
})

describe('wymaga uwagi', () => {
  it('opłacone > 24 h bez zlecenia', () => {
    const u = uwagiZamowienia(zam(), [], 'brak', 'Nowe', TERAZ)
    expect(u).toHaveLength(1)
    expect(u[0]).toMatch(/nie ma zlecenia/)
    expect(uwagiZamowienia(zam({ oplacone: 0 }), [], 'brak', 'Nowe', TERAZ)).toEqual([])
    expect(uwagiZamowienia(zam({ data_potwierdzenia: '2026-11-25T08:00:00Z' }), [], 'brak', 'Nowe', TERAZ)).toEqual([])
  })
  it('gotowe, a status sklepu stoi na produkcji; anulowane w sklepie przy otwartym zleceniu', () => {
    expect(uwagiZamowienia(zam(), [zlecenie({ release_date: '2026-11-19' })], 'gotowe', 'W produkcji', TERAZ)[0]).toMatch(/nadal „W produkcji”/)
    expect(uwagiZamowienia(zam(), [zlecenie()], 'prod', 'Anulowane', TERAZ)[0]).toMatch(/STA 4685 dalej otwarte/)
  })
})

describe('termin i dopasowanie po nazwisku', () => {
  it('termin z wyjazdu / magazynu / dnia produkcji', () => {
    expect(terminZamowienia([zlecenie({ shipped_at: '2026-11-20T07:00:00Z', shipped_route: 'ŚRODA' })])).toMatch(/^wyjechało .*\(ŚRODA\)$/)
    expect(terminZamowienia([zlecenie({ release_date: '2026-11-19' })])).toMatch(/^na magazynie od/)
    expect(terminZamowienia([zlecenie()])).toBe('produkcja: CZWARTEK')
    expect(terminZamowienia([])).toBe('—')
  })
  it('słowa nazwiska z nr zamówienia klienta', () => {
    expect(slowaNazwiska('OF/WASILEWSKI')).toEqual(['WASILEWSKI'])
    expect(slowaNazwiska('MICHALIK DARIUSZ')).toEqual(['MICHALIK', 'DARIUSZ'])
    expect(pasujeDoKlienta(zam({ klient: 'Dariusz Michalik' }), slowaNazwiska('MICHALIK DARIUSZ'))).toBe(true)
    expect(pasujeDoKlienta(zam(), slowaNazwiska('DONALSKA'))).toBe(false)
  })
})
