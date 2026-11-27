import { describe, expect, it } from 'vitest'
import { etapyKlienta } from '../lib/crmKarta'

const stany = (e: ReturnType<typeof etapyKlienta>) => e.map((x) => x.stan).join(',')

describe('karta klienta v3 — etapy sprawy', () => {
  it('od zapytania do decyzji', () => {
    expect(stany(etapyKlienta('nowy', [], []))).toBe('on,todo,todo,todo,todo,todo')
    expect(stany(etapyKlienta('nowy', [{ status: 'do_sprawdzenia' }], []))).toBe('done,on,todo,todo,todo,todo')
    expect(stany(etapyKlienta('oferta', [{ status: 'wyslana' }], []))).toBe('done,done,on,todo,todo,todo')
  })
  it('zamówił → umowa i pomiar → montaż → koniec', () => {
    expect(stany(etapyKlienta('wygrany', [{ status: 'zaakceptowana' }], []))).toBe('done,done,done,done,on,todo')
    expect(stany(etapyKlienta('wygrany', [], [{ rodzaj: 'umowa', status: 'podpisana' }]))).toBe('done,done,done,done,done,on')
    expect(stany(etapyKlienta('wygrany', [], [{ rodzaj: 'umowa', status: 'podpisana' }, { rodzaj: 'protokol', status: 'podpisana' }]))).toBe('done,done,done,done,done,done')
  })
  it('przegrany zatrzymuje się na decyzji', () => {
    const e = etapyKlienta('przegrany', [{ status: 'odrzucona' }], [])
    expect(stany(e)).toBe('done,done,stop,todo,todo,todo')
    expect(e[2].nazwa).toBe('Nie zamówił')
  })
})
