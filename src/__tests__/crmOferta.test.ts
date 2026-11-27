import { describe, expect, it } from 'vitest'
import { prosbyOferty, stanOferty, brakCenOferty, brakCenOpis, brakDoboruOferty, etykietaUstalenia, krokOferty, tekstOdpowiedzi, ustaleniaLista, wersjeOferty } from '../lib/crmOferta'

describe('crmOferta — krok oferty', () => {
  it('status → krok i podświetlony etap', () => {
    expect(krokOferty('wstrzymana', {})).toEqual({ krok: 'ustalenia', idx: 0 })
    expect(krokOferty('przelicz', {})).toEqual({ krok: 'liczenie', idx: 1 })
    expect(krokOferty('do_sprawdzenia', { pending: true })).toEqual({ krok: 'liczenie', idx: 1 })
    expect(krokOferty('do_sprawdzenia', { sysErr: true })).toEqual({ krok: 'blad', idx: 1 })
    // 24.11: produkt nie dobrany — pytania systemu zamiast spinnera; błąd systemu ma pierwszeństwo
    expect(krokOferty('do_sprawdzenia', { brakDoboru: true })).toEqual({ krok: 'dobor', idx: 1 })
    expect(krokOferty('do_sprawdzenia', { brakDoboru: true, sysErr: true })).toEqual({ krok: 'blad', idx: 1 })
    expect(krokOferty('do_sprawdzenia', {})).toEqual({ krok: 'wysylka', idx: 2 })
    expect(krokOferty('wyslana', {})).toEqual({ krok: 'decyzja', idx: 3 })
    expect(krokOferty('zaakceptowana', {})).toEqual({ krok: 'koniec', idx: 3 })
    expect(krokOferty('odrzucona', {})).toEqual({ krok: 'koniec', idx: 3 })
    expect(krokOferty('robocza', {})).toEqual({ krok: 'stara', idx: -1 })
  })
})

describe('crmOferta — brak doboru produktu (24.11, Perzanowski)', () => {
  it('oferta skończona bez produktu i ceny = pytania, nie „w przygotowaniu”', () => {
    const baza = { status: 'do_sprawdzenia', rodzaj: 'sklep', produkt: null, cena_razem: null }
    expect(brakDoboruOferty({ ...baza, sprawdz: ['System nie dobrał produktu — odpowiedz na pytania poniżej…', 'powód'], pytania: ['Titan czy Bastion?'] })).toBe(true)
    // starsza oferta sprzed pytań (Perzanowski 08:45)
    expect(brakDoboruOferty({ ...baza, sprawdz: ['System nie znalazł w sklepie produktu pasującego do potrzeby klienta — przygotuj ofertę ręcznie albo dopytaj.'], pytania: [] })).toBe(true)
    expect(brakDoboruOferty({ ...baza, sprawdz: [], pytania: ['Jaki wzór?'] })).toBe(true)
    // naprawdę w liczeniu / policzona / oficjalna / błąd — nie
    expect(brakDoboruOferty({ ...baza, sprawdz: [], pytania: [] })).toBe(false)
    expect(brakDoboruOferty({ ...baza, status: 'przelicz', pytania: ['x'] })).toBe(false)
    expect(brakDoboruOferty({ ...baza, produkt: 'Bastion A-104', cena_razem: 2600, pytania: ['x'] })).toBe(false)
    expect(brakDoboruOferty({ ...baza, rodzaj: 'oficjalna', pytania: ['x'] })).toBe(false)
  })

  it('odpowiedzi: pytanie → odpowiedź, puste pomijane, uwagi na końcu', () => {
    const pyt = ['Titan czy Bastion?', 'Jaki wzór?', 'Rozmiar?']
    expect(tekstOdpowiedzi(pyt, { 0: 'Bastion', 2: ' 80 prawe ' }, '')).toBe('Titan czy Bastion? → Bastion\nRozmiar? → 80 prawe')
    expect(tekstOdpowiedzi(pyt, {}, 'ościeżnica drewniana')).toBe('ościeżnica drewniana')
    expect(tekstOdpowiedzi(pyt, { 1: '' }, '  ')).toBe('')
  })
})

describe('crmOferta — ustalenia po polsku', () => {
  it('etykiety: znane klucze i nieznane bez podkreślników', () => {
    expect(etykietaUstalenia('kolor_skrzydla')).toBe('Kolor skrzydła')
    expect(etykietaUstalenia('wymiar_otworu')).toBe('Wymiar otworu')
    expect(etykietaUstalenia('ilosc')).toBe('Ilość')
    expect(etykietaUstalenia('nowe_pole_ai')).toBe('Nowe pole ai')
  })

  it('tylko wypełnione pola, najważniejsze najpierw, wartości czytelne', () => {
    const l = ustaleniaLista({
      inne: 'Drzwi łącznie 396 szt.',
      ilosc: 396,
      model: '',
      montaz: true,
      okucia: null,
      kolor_skrzydla: 'turner',
      oslonki: 'brak',
      termin: ['06.2027', '12.2027'],
    })
    expect(l.map((u) => u.nazwa)).toEqual(['Ilość', 'Kolor skrzydła', 'Montaż', 'Termin', 'Inne'])
    expect(l.find((u) => u.klucz === 'montaz')?.wartosc).toBe('tak')
    expect(l.find((u) => u.klucz === 'termin')?.wartosc).toBe('06.2027, 12.2027')
    expect(ustaleniaLista(null)).toEqual([])
  })
})

describe('wersjeOferty', () => {
  const x1 = { id: 'x1', poprzednia_id: null }
  const x2 = { id: 'x2', poprzednia_id: 'x1' }
  const x3 = { id: 'x3', poprzednia_id: 'x2' }
  const y1 = { id: 'y1', poprzednia_id: null }
  const wszystkie = [x1, x2, y1, x3]
  it('zostawia tylko wersje tej samej oferty', () => {
    expect(wersjeOferty(wszystkie, x1).map((w) => w.id)).toEqual(['x1', 'x2', 'x3'])
    expect(wersjeOferty(wszystkie, x3).map((w) => w.id)).toEqual(['x1', 'x2', 'x3'])
    expect(wersjeOferty(wszystkie, y1).map((w) => w.id)).toEqual(['y1'])
  })
  it('nie wiesza się na pętli i brakującym poprzedniku', () => {
    const a = { id: 'a', poprzednia_id: 'b' }
    const b = { id: 'b', poprzednia_id: 'a' }
    const c = { id: 'c', poprzednia_id: 'zniknal' }
    expect(wersjeOferty([a, b, c], c).map((w) => w.id)).toEqual(['c'])
    expect(wersjeOferty([a, b, c], a).length).toBeGreaterThan(0)
  })
})

describe('crmOferta — oferta z montażem bez cen (27.11)', () => {
  const o = { status: 'do_sprawdzenia', rodzaj: 'oficjalna', sprawdz: ['BRAK CEN: 2 pozycje nie mają ceny: „Verona 02”, „OR-2”. PDF i mail nie powstały.', 'VAT 23%'] }
  it('rozpoznaje ofertę zatrzymaną i daje krok „ceny”', () => {
    expect(brakCenOferty(o)).toBe(true)
    expect(krokOferty('do_sprawdzenia', { brakCen: true })).toEqual({ krok: 'ceny', idx: 1 })
    expect(brakCenOpis(o.sprawdz as string[])).toBe('2 pozycje nie mają ceny: „Verona 02”, „OR-2”. PDF i mail nie powstały.')
  })
  it('nie myli z innymi stanami', () => {
    expect(brakCenOferty({ ...o, rodzaj: 'sklep' })).toBe(false)
    expect(brakCenOferty({ ...o, status: 'przelicz' })).toBe(false)
    expect(brakCenOferty({ ...o, sprawdz: ['VAT 23%'] })).toBe(false)
    expect(krokOferty('przelicz', { brakCen: true })).toEqual({ krok: 'liczenie', idx: 1 })
    expect(krokOferty('do_sprawdzenia', { brakCen: true, sysErr: true })).toEqual({ krok: 'blad', idx: 1 })
  })
})

describe('crmOferta — stan oferty na liście (v3)', () => {
  it('stan, zdanie i przycisk', () => {
    expect(stanOferty({ status: 'wstrzymana' })).toMatchObject({ label: 'Sprawdź ustalenia', przycisk: 'Sprawdź', glowny: true })
    expect(stanOferty({ status: 'do_sprawdzenia', rodzaj: 'oficjalna', sprawdz: [] })).toMatchObject({ label: 'Gotowa do wysłania', opis: 'dołącz PDF do maila' })
    expect(stanOferty({ status: 'do_sprawdzenia', rodzaj: 'oficjalna', sprawdz: ['BRAK CEN: 2 pozycje'] })).toMatchObject({ label: 'Brakuje cen', przycisk: 'Wpisz ceny' })
    expect(stanOferty({ status: 'do_sprawdzenia', sprawdz: ['BŁĄD systemu: x'] })).toMatchObject({ label: 'Błąd liczenia' })
    expect(stanOferty({ status: 'wyslana', wyslano_at: '2026-11-18T10:00:00Z' })).toMatchObject({ label: 'Wysłana', opis: 'czeka na decyzję od 2026-11-18', glowny: false })
    expect(stanOferty({ status: 'zaakceptowana' }).pill).toBe('ok')
  })
})

describe('crmOferta — prośby o zmianę (v3)', () => {
  const v1 = { id: 'a', wersja: 1, status: 'robocza', poprzednia_id: null, created_at: '2026-11-20T10:00:00Z', poprawka: 'dolicz montaż 900 zł', poprawka_wynik: null }
  it('wynik prośby z wersji, bez duplikatu w starej wersji', () => {
    const v2 = { id: 'b', wersja: 2, status: 'do_sprawdzenia', poprzednia_id: 'a', created_at: '2026-11-21T10:00:00Z', poprawka: 'dolicz montaż 900 zł', poprawka_wynik: { streszczenie: 'Dodano montaż 900 zł', niezrozumiane: [] }, rodzaj: 'oficjalna', sprawdz: [] }
    const p = prosbyOferty([v1, v2])
    expect(p).toHaveLength(1)
    expect(p[0]).toMatchObject({ stan: 'zrobione', wersja: 2, tekst: 'dolicz montaż 900 zł', streszczenie: 'Dodano montaż 900 zł' })
  })
  it('niezrozumiane i brak cen widać jako „nie zrobione” z powodem; prośba w toku na górze', () => {
    const v2 = { id: 'b', wersja: 2, status: 'przelicz', poprzednia_id: 'a', created_at: '2026-11-21T10:00:00Z', updated_at: '2026-11-22T09:00:00Z', poprawka: 'Verona 610 zł', poprawka_wynik: { niezrozumiane: ['sprawdź ceny z ulotki'] }, rodzaj: 'oficjalna', sprawdz: ['BRAK CEN: 8 pozycji nie ma ceny'] }
    const p = prosbyOferty([v1, v2])
    expect(p[0]).toMatchObject({ stan: 'w_toku', tekst: 'Verona 610 zł', wersja: 3 })
    expect(p[1]).toMatchObject({ stan: 'nie', tekst: null })
    expect(p[1].powody.join(' ')).toContain('8 pozycji nie ma ceny')
    expect(p[1].powody.join(' ')).toContain('nie zrozumiałem: „sprawdź ceny z ulotki”')
  })
})
