import { describe, expect, it } from 'vitest'
import { miesiacEtykieta, miesiaceZakresu, okresOd, statystykiCrm, type StatLead, type StatOferta } from '../lib/crmStatystyki'

const now = new Date('2026-11-21T12:00:00')

const leady: StatLead[] = [
  { id: 'a', status: 'wygrany', zrodlo: 'mail', kategoria: 'zewnetrzne', created_at: '2026-10-05T10:00:00', wynik_at: '2026-10-20T10:00:00', wynik_kto: 'u1', ostatnia_oferta: { rodzaj: 'oficjalna', brutto: 12000 } },
  { id: 'b', status: 'wygrany', zrodlo: 'formularz', kategoria: 'wewnetrzne', created_at: '2026-11-01T10:00:00', wynik_at: '2026-11-11T10:00:00', wynik_kto: 'u1', wartosc_szac: 3000, ostatnia_oferta: { rodzaj: 'sklep', cena_razem: 5000 } },
  { id: 'c', status: 'przegrany', zrodlo: 'mail', kategoria: 'zewnetrzne', created_at: '2026-11-02T10:00:00', wynik_at: '2026-11-15T10:00:00', wynik_powod: 'cena', wynik_kto: 'u2' },
  { id: 'd', status: 'przegrany', zrodlo: 'mail', created_at: '2026-11-03T10:00:00', wynik_at: '2026-11-16T10:00:00', wynik_powod: 'cena', kampania: 'jesień' },
  { id: 'e', status: 'nowy', zrodlo: 'wizyta', created_at: '2026-11-20T10:00:00' },
  { id: 'f', status: 'wygrany', zrodlo: 'mail', created_at: '2024-01-10T10:00:00', wynik_at: '2024-02-01T10:00:00', ostatnia_oferta: { rodzaj: 'sklep', cena_razem: 999 } },
]
const oferty: StatOferta[] = [
  { lead_id: 'a', wyslano_at: '2026-10-10T10:00:00', rodzaj: 'oficjalna', brutto: 12000 },
  { lead_id: 'b', wyslano_at: '2026-11-05T10:00:00', rodzaj: 'sklep', cena_razem: 5000 },
  { lead_id: 'c', wyslano_at: null, rodzaj: 'sklep', cena_razem: 1 },
]

describe('crmStatystyki — okresy', () => {
  it('początek okresu i lista miesięcy', () => {
    expect(okresOd('miesiac', now)?.getMonth()).toBe(10)
    expect(okresOd('rok', now)?.getMonth()).toBe(0)
    expect(okresOd('12m', now)?.getFullYear()).toBe(2025)
    expect(okresOd('wszystko', now)).toBeNull()
    expect(miesiaceZakresu(new Date('2026-09-15T12:00:00'), now)).toEqual(['2026-09', '2026-10', '2026-11'])
    expect(miesiacEtykieta('2026-11')).toBe('lis 2026')
  })
})

describe('crmStatystyki — liczenie', () => {
  it('KPI w ostatnich 12 miesiącach (stary wynik z 2024 poza okresem)', () => {
    const s = statystykiCrm(leady, oferty, '12m', now)
    expect(s.kpi.nowi).toBe(5)
    expect(s.kpi.zamowili).toEqual({ n: 2, suma: 15000 }) // 12000 + ręczne 3000
    expect(s.kpi.przegrani).toBe(2)
    expect(s.kpi.skutecznosc).toBe(50)
    expect(s.kpi.srWartosc).toBe(7500)
    expect(s.kpi.srDniDoZamowienia).toBe(13) // 15 i 10 dni
    expect(s.kpi.wyslane).toEqual({ n: 2, suma: 17000 })
    expect(s.miesiace).toHaveLength(12)
  })

  it('miesiące: nowi po dacie przyjścia, zamknięcia po dacie wyniku', () => {
    const s = statystykiCrm(leady, oferty, '12m', now)
    const paz = s.miesiace.find((m) => m.klucz === '2026-10')!
    const lis = s.miesiace.find((m) => m.klucz === '2026-11')!
    expect(paz).toMatchObject({ nowi: 1, zamowili: 1, wartosc: 12000, przegrani: 0, wyslane: 1, skutecznosc: 100 })
    expect(lis).toMatchObject({ nowi: 4, zamowili: 1, wartosc: 3000, przegrani: 2, wyslane: 1, skutecznosc: 33 })
  })

  it('pochodzenie, kategoria, kampania, powody i osoby', () => {
    const s = statystykiCrm(leady, oferty, '12m', now)
    expect(s.wgZrodla[0]).toMatchObject({ klucz: 'mail', nowi: 3, zamowili: 1, przegrani: 2, skutecznosc: 33 })
    expect(s.wgZrodla.find((w) => w.klucz === 'wizyta')).toMatchObject({ nowi: 1, skutecznosc: null })
    expect(s.wgKategorii.find((w) => w.klucz === 'nieznana')?.nowi).toBe(2)
    expect(s.wgKampanii).toEqual([expect.objectContaining({ klucz: 'jesień', nowi: 1, przegrani: 1 })])
    expect(s.powody).toEqual([{ powod: 'cena', n: 2, proc: 100 }])
    expect(s.wgOsoby[0]).toMatchObject({ kto: 'u1', zamowili: 2, wartosc: 15000 })
  })

  it('zamknięty bez wynik_at liczy się po dacie ostatniej zmiany', () => {
    const s = statystykiCrm([...leady, { id: 'g', status: 'wygrany', created_at: '2026-11-10T10:00:00', updated_at: '2026-11-12T10:00:00', ostatnia_oferta: { rodzaj: 'sklep', cena_razem: 1080 } }], oferty, 'miesiac', now)
    expect(s.kpi.zamowili).toEqual({ n: 2, suma: 4080 })
  })

  it('od początku: zakres od pierwszego klienta, liczy też 2024', () => {
    const s = statystykiCrm(leady, oferty, 'wszystko', now)
    expect(s.miesiace[0].klucz).toBe('2024-01')
    expect(s.kpi.zamowili.n).toBe(3)
  })
})
