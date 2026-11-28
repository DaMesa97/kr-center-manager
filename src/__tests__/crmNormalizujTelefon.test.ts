import { describe, expect, it } from 'vitest'
import { normalizujTelefon, telefonKomorkowyPL } from '../../supabase/functions/crm-call-ingest/normalizacja'

// crm-call-ingest: numer z podpisu maila / z Ringostatu → E.164 (testy 27.11, runda 3)
describe('normalizujTelefon', () => {
  it('zwykłe numery i Ringostat (E.164) bez zmian w zachowaniu', () => {
    expect(normalizujTelefon('601 234 567')).toBe('+48601234567')
    expect(normalizujTelefon('+48 601-234-567')).toBe('+48601234567')
    expect(normalizujTelefon('0048601234567')).toBe('+48601234567')
    expect(normalizujTelefon('48601234567')).toBe('+48601234567')
    expect(normalizujTelefon('+420601234567')).toBe('+420601234567')
    expect(normalizujTelefon('0324550000')).toBe('+48324550000')
  })

  it('za krótkie, za długie, zastrzeżone → null', () => {
    expect(normalizujTelefon('123456')).toBeNull()
    expect(normalizujTelefon('1234567890123456')).toBeNull()
    expect(normalizujTelefon('anonymous')).toBeNull()
    expect(normalizujTelefon(null)).toBeNull()
    expect(normalizujTelefon('')).toBeNull()
  })

  it('kilka numerów: bierze pierwszy (przecinek, średnik, „lub”, „i”, „albo”, „or”)', () => {
    expect(normalizujTelefon('601 234 567, 602 345 678')).toBe('+48601234567')
    expect(normalizujTelefon('601 234 567; 602 345 678')).toBe('+48601234567')
    expect(normalizujTelefon('601 234 567 lub 602 345 678')).toBe('+48601234567')
    expect(normalizujTelefon('601 234 567 i 602 345 678')).toBe('+48601234567')
    expect(normalizujTelefon('601 234 567 albo 602 345 678')).toBe('+48601234567')
    expect(normalizujTelefon('601 234 567 or 602 345 678')).toBe('+48601234567')
  })

  it('„/” w zapisie numeru nie gubi go (wcześniej null)', () => {
    expect(normalizujTelefon('32/455 00 00')).toBe('+48324550000')
    expect(normalizujTelefon('tel./fax 32 455 00 00')).toBe('+48324550000')
    expect(normalizujTelefon('tel/fax: 601 234 567')).toBe('+48601234567')
    expect(normalizujTelefon('+48 32/455 00 00')).toBe('+48324550000')
  })

  it('„/” między dwoma pełnymi numerami albo po pełnym numerze: pierwszy numer', () => {
    expect(normalizujTelefon('601 234 567 / 602 345 678')).toBe('+48601234567')
    expect(normalizujTelefon('601234567/602345678')).toBe('+48601234567')
    expect(normalizujTelefon('32 455 00 00/01')).toBe('+48324550000')
  })

  it('opis przed numerem oddzielony „i” albo przecinkiem', () => {
    expect(normalizujTelefon('tel. i fax 32 455 00 00')).toBe('+48324550000')
    expect(normalizujTelefon('tel., fax: 32 455 00 00')).toBe('+48324550000')
  })
})

// D24 (28.11): mail dopinany do klienta po numerze z podpisu tylko, gdy to komórka (nie centrala firmy)
describe('telefonKomorkowyPL', () => {
  it('polskie komórki w dowolnym zapisie → tak', () => {
    for (const n of ['601 234 567', '+48 501-234-567', '0048 511 234 567', '48530123456', '573 123 456', '660123456', '691 123 456', '721 123 456', '731 123 456', '781 123 456', '791 123 456', '881 123 456', '451 123 456'])
      expect(telefonKomorkowyPL(n), n).toBe(true)
  })

  it('centrale i stacjonarne → nie (także z przedziału 4–8: 58, 61, 71, 41)', () => {
    for (const n of ['32 455 00 00', '0324550000', 'tel./fax 32 455 00 00', '22 123 45 67', '58 123 45 67', '61 123 45 67', '71 123 45 67', '41 123 45 67', '91 123 45 67'])
      expect(telefonKomorkowyPL(n), n).toBe(false)
  })

  it('zagraniczne, puste, zastrzeżone, za krótkie → nie', () => {
    for (const n of ['+420601234567', '+49 151 1234567', null, undefined, '', 'zastrzeżony', '601 234'])
      expect(telefonKomorkowyPL(n), String(n)).toBe(false)
  })

  it('dwa numery w podpisie: liczy się pierwszy (jak normalizujTelefon)', () => {
    expect(telefonKomorkowyPL('601 234 567, 32 455 00 00')).toBe(true)
    expect(telefonKomorkowyPL('32 455 00 00, 601 234 567')).toBe(false)
  })
})
