import { describe, expect, it } from 'vitest'
import { companiesMatch, findSuspectedDuplicates, isComparableClientNumber } from '../lib/duplicateDetect'
import type { Order } from '../types'

const mk = (over: Partial<Order>): Order =>
  ({
    order_number: '1',
    company: 'MAXDOOR',
    category: 'STA',
    client_order_number: 'B-1/09/2026',
    source: 'bot',
    ...over,
  }) as Order

describe('isComparableClientNumber — filtr numerów nadających się do porównania', () => {
  it('odrzuca puste, myślniki i za krótkie', () => {
    expect(isComparableClientNumber('')).toBe(false)
    expect(isComparableClientNumber('-')).toBe(false)
    expect(isComparableClientNumber('—')).toBe(false)
    expect(isComparableClientNumber('..')).toBe(false)
    expect(isComparableClientNumber(null)).toBe(false)
  })
  it('akceptuje realne numery', () => {
    expect(isComparableClientNumber('B-426/09/2026')).toBe(true)
    expect(isComparableClientNumber(' 39/08 ')).toBe(true)
    expect(isComparableClientNumber('KOWALCZYK')).toBe(true)
  })
})

describe('companiesMatch — tolerancyjne porównanie firm z dwóch kanałów', () => {
  it('równe i warianty z dopiskiem miasta pasują', () => {
    expect(companiesMatch('PO DRZWI', 'PO DRZWI')).toBe(true)
    expect(companiesMatch('PO DRZWI', 'PO DRZWI ŻORY')).toBe(true)
    expect(companiesMatch('po drzwi żory', ' PO DRZWI ')).toBe(true)
    expect(companiesMatch('MAJSTERPLUS ZGORZ # ŁAGÓW', 'MAJSTERPLUS ZGORZ')).toBe(true)
  })
  it('różne firmy nie pasują (także podobne prefiksy)', () => {
    expect(companiesMatch('PO DRZWI', 'POL-DRZWI Sulechów')).toBe(false)
    expect(companiesMatch('POL-DRZWI Sulechów', 'POL-DRZWI PRZENIOSŁO Bystre')).toBe(false)
    expect(companiesMatch('', 'PO DRZWI')).toBe(false)
  })
})

describe('findSuspectedDuplicates', () => {
  it('łapie dubel mimo różnie zapisanej firmy (bot: alias, excel: surowa z arkusza)', () => {
    const groups = findSuspectedDuplicates([
      mk({ id: 1, order_number: '4318', company: 'PO DRZWI', client_order_number: '49495368/Rog-stal' }),
      mk({
        id: 2, order_number: '2309', company: 'PO DRZWI ŻORY',
        client_order_number: '49495368/Rog-stal', source: 'excel' as Order['source'],
      }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].company).toBe('PO DRZWI ŻORY') // dłuższa nazwa do wyświetlenia
    expect(groups[0].orders.map((o) => o.order_number)).toEqual(['4318', '2309'])
  })

  it('zbieżny numer klienta u ZUPEŁNIE innej firmy nie skleja się z botem', () => {
    const groups = findSuspectedDuplicates([
      mk({ id: 1, company: 'PO DRZWI', client_order_number: '39/08' }),
      mk({ id: 2, company: 'ROMEX WARSZAWA', client_order_number: '39/08', source: 'excel' as Order['source'] }),
    ])
    expect(groups).toHaveLength(0)
  })

  it('łapie klasyczny dubel bot+excel (ten sam klient, firma, kategoria)', () => {
    const groups = findSuspectedDuplicates([
      mk({ id: 1, order_number: '4312', source: 'bot' }),
      mk({ id: 2, order_number: '2289', source: 'excel' as Order['source'] }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].orders.map((o) => o.order_number)).toEqual(['4312', '2289'])
  })

  it('łapie dubel bot+bot (podwójna wysyłka z konfiguratora)', () => {
    const groups = findSuspectedDuplicates([
      mk({ id: 1, order_number: '5742' }),
      mk({ id: 2, order_number: '5760' }),
    ])
    expect(groups).toHaveLength(1)
  })

  it('ignoruje grupy bez bota (ręczne/excel powtórki to inny temat)', () => {
    const groups = findSuspectedDuplicates([
      mk({ id: 1, source: 'excel' as Order['source'] }),
      mk({ id: 2, source: 'excel' as Order['source'] }),
      mk({ id: 3, source: 'manual' }),
    ])
    expect(groups).toHaveLength(0)
  })

  it('porównuje numer klienta bez wrażliwości na wielkość liter i spacje', () => {
    const groups = findSuspectedDuplicates([
      mk({ id: 1, client_order_number: ' b-426/09/2026 ' }),
      mk({ id: 2, client_order_number: 'B-426/09/2026', source: 'excel' as Order['source'] }),
    ])
    expect(groups).toHaveLength(1)
  })

  it('NIE łączy różnych kategorii ani różnych firm', () => {
    const groups = findSuspectedDuplicates([
      mk({ id: 1, category: 'STA' }),
      mk({ id: 2, category: 'Bastion', source: 'excel' as Order['source'] }),
      mk({ id: 3, company: 'INNA FIRMA', source: 'excel' as Order['source'] }),
    ])
    expect(groups).toHaveLength(0)
  })

  it('pomija numery-śmieci ("-") i zlecenia anulowane', () => {
    const groups = findSuspectedDuplicates([
      mk({ id: 1, client_order_number: '-' }),
      mk({ id: 2, client_order_number: '-', source: 'excel' as Order['source'] }),
      mk({ id: 3, extra_fields: { cancelled: true } }),
      mk({ id: 4, source: 'excel' as Order['source'] }),
    ])
    // 1+2 odpadają (numer '-'), 3 anulowane → z 4 zostaje singiel → brak grup
    expect(groups).toHaveLength(0)
  })

  it('w grupie bot jest pierwszy, świeższe grupy na górze', () => {
    const groups = findSuspectedDuplicates([
      mk({ id: 10, order_number: '2289', source: 'excel' as Order['source'], client_order_number: 'A1X' }),
      mk({ id: 11, order_number: '4312', client_order_number: 'A1X' }),
      mk({ id: 90, order_number: '2299', source: 'excel' as Order['source'], client_order_number: 'B2Y' }),
      mk({ id: 91, order_number: '4399', client_order_number: 'B2Y' }),
    ])
    expect(groups).toHaveLength(2)
    expect(groups[0].clientOrderNumber).toBe('B2Y')
    expect(groups[0].orders[0].source).toBe('bot')
  })
})
