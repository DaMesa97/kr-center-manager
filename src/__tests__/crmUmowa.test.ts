import { describe, expect, it } from 'vitest'
import { ofertyDoUmowy, umowaZablokowanaPowod, umowyKlienta } from '../lib/crmUmowa'

type O = Parameters<typeof umowaZablokowanaPowod>[0][number]
const of = (p: Partial<O>): O => ({ rodzaj: 'oficjalna', z_montazem: true, brutto: 12000, numer: '5/11/2026', plik_pdf: 'x.pdf', status: 'wyslana', ...p }) as O

describe('umowa na montaż — kiedy można', () => {
  it('policzona oferta oficjalna z montażem: do sprawdzenia, wysłana i zaakceptowana (po „Zamówił”)', () => {
    expect(ofertyDoUmowy([of({ status: 'do_sprawdzenia' }), of({ status: 'zaakceptowana' }), of({ status: 'odrzucona' })]).map((o) => o.status)).toEqual([
      'do_sprawdzenia',
      'zaakceptowana',
    ])
    expect(umowaZablokowanaPowod([of({})])).toBeNull()
  })
  it('podpowiedź mówi, czego brakuje', () => {
    expect(umowaZablokowanaPowod([])).toMatch(/Najpierw przygotuj ofertę z montażem/)
    expect(umowaZablokowanaPowod([of({ rodzaj: 'robocza' as O['rodzaj'] })])).toMatch(/Najpierw przygotuj/)
    expect(umowaZablokowanaPowod([of({ z_montazem: false })])).toMatch(/bez montażu/)
    expect(umowaZablokowanaPowod([of({ status: 'przelicz', plik_pdf: null })])).toMatch(/nie jest gotowa/)
    expect(umowaZablokowanaPowod([of({ status: 'odrzucona' })])).toMatch(/odrzucona, wygasła/)
  })
  it('umowy klienta bez anulowanych', () => {
    expect(umowyKlienta([{ rodzaj: 'umowa', status: 'wyslana' }, { rodzaj: 'umowa', status: 'anulowana' }, { rodzaj: 'protokol', status: 'projekt' }]).length).toBe(1)
  })
})

describe('umowa z oferty z cenami 0 zł (testy 27.11, 2. seria)', () => {
  const baza = { rodzaj: 'oficjalna', z_montazem: true, brutto: 1845, numer: '2026/11/005', plik_pdf: 'x.pdf', status: 'wyslana' } as const
  it('pozycja 0 zł blokuje umowę z podpowiedzią, „gratis” nie blokuje', () => {
    const zera = { ...baza, pozycje: [{ nazwa: 'Drzwi Verona 02', netto_szt: 0 }, { nazwa: 'Montaż', netto_szt: 1500 }] }
    expect(ofertyDoUmowy([zera])).toHaveLength(0)
    expect(umowaZablokowanaPowod([zera])).toContain('0 zł')
    const gratis = { ...baza, pozycje: [{ nazwa: 'Osłonki gratis', netto_szt: 0 }, { nazwa: 'Drzwi', netto_szt: 900 }] }
    expect(ofertyDoUmowy([gratis])).toHaveLength(1)
    expect(ofertyDoUmowy([baza])).toHaveLength(1)
  })
})

