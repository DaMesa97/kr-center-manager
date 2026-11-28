import { describe, expect, it } from 'vitest'
import { zkpCanCancelConstruction, zkpCancelNcRef } from '../lib/zkpCard'

// D56: anulowanie konstrukcji po niezgodności i nowy numer (lustro zkp_cancel_construction)
describe('D56: anuluj konstrukcję / nowy numer', () => {
  it('tylko Pełnomocnik / Zastępca i nie dla karty zwolnionej', () => {
    expect(zkpCanCancelConstruction(['pelnomocnik'], { decision: 'niezgodny' })).toBe(true)
    expect(zkpCanCancelConstruction(['zastepca'], null)).toBe(true)
    expect(zkpCanCancelConstruction(['zastepca'], { decision: null })).toBe(true)
    expect(zkpCanCancelConstruction(['pelnomocnik'], { decision: 'zwolniony' })).toBe(false)
    expect(zkpCanCancelConstruction(['kierownik_produkcji', 'kontroler'], { decision: 'niezgodny' })).toBe(false)
    expect(zkpCanCancelConstruction(null, null)).toBe(false)
  })

  it('podpowiedź nr 6.20: ostatni protokół z odnośnikiem, potem karta', () => {
    const protocols = [
      { attempt: 1, nonconformity_ref: 'NC/1' },
      { attempt: 3, nonconformity_ref: '' },
      { attempt: 2, nonconformity_ref: ' NC/2 ' },
    ]
    expect(zkpCancelNcRef({ nonconformity_ref: 'NC/K' }, protocols)).toBe('NC/2')
    expect(zkpCancelNcRef({ nonconformity_ref: 'NC/K' }, [])).toBe('NC/K')
    expect(zkpCancelNcRef(null, [])).toBe('')
  })
})
