import { describe, expect, it } from 'vitest'
import {
  findBestCompanyMatch,
  isCompanyInBase,
  isReleaseDateEmpty,
  isRushOrderSequence,
  mergeOrderExtraFields,
  parseProductionStages,
} from '../utils'
import type { Company } from '../types'

const company = (name: string): Company => ({ name }) as unknown as Company

describe('dopasowanie kontrahenta (aliasowanie nazw z konfiguratora)', () => {
  const base = [company('ADAM KOŚCIELNY Wodzisław Śl.'), company('TORA SIERADZ'), company('FIDO LINE KŁODZKO')]

  it('dokładne dopasowanie ignoruje wielkość liter i nadmiarowe spacje', () => {
    expect(isCompanyInBase('tora sieradz', base)).toBe(true)
    expect(isCompanyInBase('  TORA   SIERADZ ', base)).toBe(true)
  })

  it('częściowe dopasowanie (jedna nazwa zawiera drugą)', () => {
    const m = findBestCompanyMatch('TORA SIERADZ # SIERADZ', base)
    expect(m?.name).toBe('TORA SIERADZ')
  })

  it('brak dopasowania → null (wtedy UI proponuje ręczny wybór / utworzenie)', () => {
    expect(findBestCompanyMatch('ZUPEŁNIE OBCA FIRMA', base)).toBeNull()
    expect(isCompanyInBase('', base)).toBe(false)
  })
})

describe('wydanie / pilne', () => {
  it('isReleaseDateEmpty: null, "" i spacje = niewydane', () => {
    expect(isReleaseDateEmpty(null)).toBe(true)
    expect(isReleaseDateEmpty('')).toBe(true)
    expect(isReleaseDateEmpty('  ')).toBe(true)
    expect(isReleaseDateEmpty('2026-07-03')).toBe(false)
  })
  it('pilne = sekwencja "X"', () => {
    expect(isRushOrderSequence('X')).toBe(true)
    expect(isRushOrderSequence(' x ')).toBe(true)
    expect(isRushOrderSequence('')).toBe(false)
    expect(isRushOrderSequence('1')).toBe(false)
  })
})

describe('mergeOrderExtraFields — nie gubi istniejących pól JSON', () => {
  it('scala nowe z istniejącymi (np. cancelled nie kasuje titan_group)', () => {
    const merged = mergeOrderExtraFields({ titan_group: 7, wykonawca: 'Center' }, { cancelled: true })
    expect(merged).toMatchObject({ titan_group: 7, wykonawca: 'Center', cancelled: true })
  })
  it('pusta/nie-obiektowa baza → sam patch (jsonb z Supabase zawsze przychodzi obiektem)', () => {
    expect(mergeOrderExtraFields(null, { a: 1 })).toMatchObject({ a: 1 })
    expect(mergeOrderExtraFields('{"b":2}', { a: 1 })).toMatchObject({ a: 1 })
  })
})

describe('parseProductionStages — odporne na formaty z bazy', () => {
  it('obiekt przechodzi wprost, string JSON jest parsowany', () => {
    expect(parseProductionStages({ e1: 'TW' }, 'STA').e1).toBe('TW')
    expect(parseProductionStages('{"e1":"XY"}', 'STA').e1).toBe('XY')
  })
  it('śmieci/null → pusty obiekt (nie wywala UI)', () => {
    expect(parseProductionStages(null, 'STA')).toEqual(expect.any(Object))
    expect(parseProductionStages('nie-json', 'STA')).toEqual(expect.any(Object))
  })
})
