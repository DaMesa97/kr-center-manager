import { describe, expect, it } from 'vitest'
import { kwotaOferty, lejekPodsumowanie, opisWyniku, ostatniaOferta, zadanieGrupa } from '../lib/crmWynik'

describe('crmWynik — grupy zadań', () => {
  it('termin przed dziś = zaległe, dziś = dziś, potem i brak = później', () => {
    expect(zadanieGrupa('2026-11-17', '2026-11-18')).toBe('zalegle')
    expect(zadanieGrupa('2026-11-18', '2026-11-18')).toBe('dzis')
    expect(zadanieGrupa('2026-11-18T09:00:00+01:00', '2026-11-18')).toBe('dzis')
    expect(zadanieGrupa('2026-11-20', '2026-11-18')).toBe('pozniej')
    expect(zadanieGrupa(null, '2026-11-18')).toBe('pozniej')
  })
})

describe('crmWynik — oferty', () => {
  it('kwota: oficjalna = brutto, sklep = cena_razem', () => {
    expect(kwotaOferty({ rodzaj: 'oficjalna', brutto: 13073.4, cena_razem: 1 })).toBe(13073.4)
    expect(kwotaOferty({ rodzaj: 'sklep', brutto: null, cena_razem: 8220 })).toBe(8220)
    expect(kwotaOferty(null)).toBeNull()
  })

  it('ostatnia oferta pomija stare wersje, chyba że innych nie ma', () => {
    const o = [
      { id: 'a', status: 'robocza', created_at: '2026-11-18T13:00:00Z' },
      { id: 'b', status: 'wyslana', created_at: '2026-11-18T12:00:00Z' },
      { id: 'c', status: 'robocza', created_at: '2026-11-17T10:00:00Z' },
    ]
    expect(ostatniaOferta(o)?.id).toBe('b')
    expect(ostatniaOferta([o[0], o[2]])?.id).toBe('a')
    expect(ostatniaOferta([])).toBeNull()
  })
})

describe('crmWynik — lejek', () => {
  const rows = [
    { status: 'nowy' },
    { status: 'oferta', ostatnia_oferta: { rodzaj: 'sklep', cena_razem: 5000 } },
    { status: 'oferta', ostatnia_oferta: { rodzaj: 'oficjalna', brutto: 13000 } },
    { status: 'wygrany', ostatnia_oferta: { rodzaj: 'sklep', cena_razem: 6000 } },
    { status: 'przegrany', wynik_powod: 'cena', ostatnia_oferta: { rodzaj: 'sklep', cena_razem: 4000 } },
    { status: 'przegrany', wynik_powod: 'cena' },
    { status: 'przegrany', wynik_powod: 'konkurencja' },
  ]

  it('liczy kolumny, wartość w grze, wygrane, najczęstszy powód i % wygranych', () => {
    const s = lejekPodsumowanie(rows)
    expect(s.kolumny.nowy.n).toBe(1)
    expect(s.kolumny.oferta).toEqual({ n: 2, suma: 18000 })
    expect(s.wGrze).toBe(3)
    expect(s.wartoscWGrze).toBe(18000)
    expect(s.wygrane).toEqual({ n: 1, suma: 6000 })
    expect(s.przegrane).toEqual({ n: 3, topPowod: 'cena' })
    expect(s.procentWygranych).toBe(25)
  })

  it('bez zamkniętych procent = null; nieznany status trafia do „Nowy”', () => {
    const s = lejekPodsumowanie([{ status: null }, { status: 'oferta' }])
    expect(s.procentWygranych).toBeNull()
    expect(s.kolumny.nowy.n).toBe(1)
  })
})

describe('crmWynik — opis wyniku', () => {
  it('przegrany z powodem i notatką, wygrany z datą, otwarty pusty', () => {
    expect(opisWyniku({ status: 'przegrany', wynik_powod: 'cena', wynik_notatka: 'market taniej', wynik_at: '2026-11-18T10:00:00Z' })).toBe('Przegrany 18.11: cena — market taniej')
    expect(opisWyniku({ status: 'przegrany' })).toBe('Przegrany: bez podanego powodu')
    expect(opisWyniku({ status: 'wygrany', wynik_at: '2026-11-18T10:00:00Z' })).toBe('Zamówił 18.11')
    expect(opisWyniku({ status: 'oferta' })).toBe('')
  })
})

describe('crmWynik — przeciąganie w lejku', () => {
  it('mapuje ruchy kart na akcje wyniku', async () => {
    const { ruchWLejku } = await import('../lib/crmWynik')
    expect(ruchWLejku('oferta', 'oferta')).toBe('nic')
    expect(ruchWLejku(null, 'nowy')).toBe('nic')
    expect(ruchWLejku('oferta', 'wygrany')).toBe('wygrany')
    expect(ruchWLejku('nowy', 'przegrany')).toBe('przegrany')
    expect(ruchWLejku('wygrany', 'przegrany')).toBe('przegrany')
    expect(ruchWLejku('przegrany', 'oferta')).toBe('w_grze')
    expect(ruchWLejku('wygrany', 'nowy')).toBe('w_grze')
    // #167: oferta wysłana poza systemem — ręcznie do „Ma ofertę”; powrót do „Nowy” tylko systemowo
    expect(ruchWLejku('nowy', 'oferta')).toBe('oferta')
    expect(ruchWLejku(null, 'oferta')).toBe('oferta')
    expect(ruchWLejku('oferta', 'nowy')).toBe('systemowy')
  })
})

describe('crmWynik — wartość klienta (#162)', () => {
  it('ręczna wartość wygrywa z ofertą, bez ręcznej = kwota oferty', async () => {
    const { wartoscKlienta } = await import('../lib/crmWynik')
    expect(wartoscKlienta(12500, { rodzaj: 'oficjalna', brutto: 13073 })).toEqual({ kwota: 12500, reczna: true, wstepna: false })
    expect(wartoscKlienta('9800.50', null)).toEqual({ kwota: 9800.5, reczna: true, wstepna: false })
    expect(wartoscKlienta(null, { rodzaj: 'sklep', cena_razem: 8220 })).toEqual({ kwota: 8220, reczna: false, wstepna: false })
    expect(wartoscKlienta(undefined, null)).toEqual({ kwota: null, reczna: false, wstepna: false })
    // 24.11: cena orientacyjna z rozmowy liczy się tylko, gdy nie ma oferty ani wpisu ręcznego
    expect(wartoscKlienta(null, null, 3850)).toEqual({ kwota: 3850, reczna: false, wstepna: true })
    expect(wartoscKlienta(null, { rodzaj: 'sklep', cena_razem: 3500 }, 3850)).toEqual({ kwota: 3500, reczna: false, wstepna: false })
    expect(wartoscKlienta(4000, null, 3850)).toEqual({ kwota: 4000, reczna: true, wstepna: false })
    expect(wartoscKlienta(null, null, 0)).toEqual({ kwota: null, reczna: false, wstepna: false })
  })

  it('parsuje kwoty wpisane przez handlowca', async () => {
    const { parseKwota } = await import('../lib/crmWynik')
    expect(parseKwota('12 500')).toBe(12500)
    expect(parseKwota('12\u00a0500 zł')).toBe(12500)
    expect(parseKwota('12500,50')).toBe(12500.5)
    expect(parseKwota('12.500')).toBe(12500)
    expect(parseKwota('1.250.000,99')).toBe(1250000.99)
    expect(parseKwota('99.5')).toBe(99.5)
    expect(parseKwota('')).toBeNull()
    expect(parseKwota('abc')).toBeNull()
    expect(parseKwota('0')).toBeNull()
    expect(parseKwota('-5')).toBeNull()
  })

  it('lejek liczy ręczną wartość, także klientowi bez oferty', async () => {
    const { lejekPodsumowanie } = await import('../lib/crmWynik')
    const s = lejekPodsumowanie([
      { status: 'nowy', wartosc_szac: 4000 },
      { status: 'oferta', wartosc_szac: 10000, ostatnia_oferta: { rodzaj: 'oficjalna', brutto: 13000 } },
      { status: 'wygrany', ostatnia_oferta: { rodzaj: 'sklep', cena_razem: 6000 } },
    ])
    expect(s.kolumny.nowy.suma).toBe(4000)
    expect(s.kolumny.oferta.suma).toBe(10000)
    expect(s.wartoscWGrze).toBe(14000)
    expect(s.wygrane.suma).toBe(6000)
  })
})

describe('crmWynik — okno zamkniętych w lejku', () => {
  it('pokazuje wyniki z ostatnich 30 dni; bez daty — pokazuje', async () => {
    const { swiezoZamkniety } = await import('../lib/crmWynik')
    const now = new Date('2026-11-20T12:00:00Z')
    expect(swiezoZamkniety({ wynik_at: '2026-11-01T10:00:00Z' }, now)).toBe(true)
    expect(swiezoZamkniety({ wynik_at: '2026-10-15T10:00:00Z' }, now)).toBe(false)
    expect(swiezoZamkniety({ wynik_at: null, updated_at: '2026-09-01T10:00:00Z' }, now)).toBe(false)
    expect(swiezoZamkniety({}, now)).toBe(true)
  })
})

describe('crmWynik — tytuł oferty', () => {
  it('nazwa handlowca → produkt → streszczenie → rodzaj', async () => {
    const { tytulOferty } = await import('../lib/crmWynik')
    expect(tytulOferty({ nazwa: ' Budynek W1 — drzwi do mieszkań ', produkt: 'Otto 31B' })).toBe('Budynek W1 — drzwi do mieszkań')
    expect(tytulOferty({ nazwa: '', produkt: 'Otto 31B' })).toBe('Otto 31B')
    expect(tytulOferty({ streszczenie: 'Drzwi zewnętrzne z montażem w kolorze turner z antabą 1600, montaż do końca stycznia, dom w Bielsku' })).toBe('Drzwi zewnętrzne z montażem w kolorze turner z antabą 1600,…')
    expect(tytulOferty({ rodzaj: 'oficjalna', numer: '2026/11/003' })).toBe('Oferta z montażem nr 2026/11/003')
    expect(tytulOferty({ rodzaj: 'sklep' })).toBe('Oferta ze sklepu')
    expect(tytulOferty(null)).toBe('Oferta')
  })
})
