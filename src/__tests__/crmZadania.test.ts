import { describe, expect, it } from 'vitest'
import { zadaniePoCo, zadanieRodzaj, zadanieTytul } from '../lib/crmZadania'

describe('crmZadania — lista Do zrobienia v2', () => {
  it('rodzaj zadania do filtra', () => {
    expect(zadanieRodzaj('oddzwon')).toBe('telefon')
    expect(zadanieRodzaj('dopytaj')).toBe('telefon')
    expect(zadanieRodzaj('follow_up')).toBe('telefon')
    expect(zadanieRodzaj('przygotuj_oferte')).toBe('oferta')
    expect(zadanieRodzaj('pomiar')).toBe('wizyta')
    expect(zadanieRodzaj('montaz')).toBe('wizyta')
    expect(zadanieRodzaj(null)).toBe('telefon')
  })

  it('tytuł: co i z kim', () => {
    expect(zadanieTytul('oddzwon', 'Anna Kowalczyk')).toBe('Oddzwoń: Anna Kowalczyk')
    expect(zadanieTytul('przygotuj_oferte', 'MBT')).toBe('Wyślij ofertę: MBT')
    expect(zadanieTytul('nowa_akcja', 'X', 'Coś nowego')).toBe('Coś nowego: X')
    expect(zadanieTytul(null, 'X')).toBe('Zadanie: X')
  })

  it('po co: bez powtórzonej akcji, pierwsze zdanie, skrócone', () => {
    expect(zadaniePoCo('Sprawdź ustalenia i zleć ofertę: Generalny wykonawca MBT przesłał zestawienie ilościowe. Parametry są w dokumentacji.'))
      .toBe('Generalny wykonawca MBT przesłał zestawienie ilościowe.')
    expect(zadaniePoCo('Sprawdź ustalenia i zleć ofertę: Wykonawca przesłał zestawienie ZZD4: ok. 396 drzwi, 4 szt. okien. Termin minął.'))
      .toBe('Wykonawca przesłał zestawienie ZZD4: ok. 396 drzwi, 4 szt. okien.')
    expect(zadaniePoCo('Klient z Grójca prosi o wycenę 4 szt. Drzwi antracyt z klamką.')).toBe('Klient z Grójca prosi o wycenę 4 szt. Drzwi antracyt z klamką.')
    expect(zadaniePoCo(null, 'Nieodebrane połączenie — oddzwoń do klienta')).toBe('Nieodebrane połączenie — oddzwoń do klienta')
    expect(zadaniePoCo('Wymiar: 100x210')).toBe('Wymiar: 100x210')
    expect(zadaniePoCo('a'.repeat(300), null, 20)).toBe(`${'a'.repeat(19)}…`)
    expect(zadaniePoCo('', '')).toBe('')
  })
})
