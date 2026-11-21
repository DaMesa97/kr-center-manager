import { describe, expect, it } from 'vitest'
import { ileOdm, odmiana } from '../utils/odmiana'

describe('odmiana', () => {
  it('liczebniki', () => {
    const z = (n: number) => odmiana(n, 'zadanie', 'zadania', 'zadań')
    expect([0, 1, 2, 4, 5, 11, 12, 14, 21, 22, 24, 25, 104, 112].map(z)).toEqual([
      'zadań', 'zadanie', 'zadania', 'zadania', 'zadań', 'zadań', 'zadań', 'zadań', 'zadań', 'zadania', 'zadania', 'zadań', 'zadania', 'zadań',
    ])
    expect(ileOdm(1, 'oferta', 'oferty', 'ofert')).toBe('1 oferta')
    expect(ileOdm(3, 'firma', 'firmy', 'firm')).toBe('3 firmy')
  })
})
