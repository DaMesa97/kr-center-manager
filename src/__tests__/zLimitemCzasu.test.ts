import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  KOMUNIKAT_LIMITU_CZASU,
  LimitCzasuError,
  czyLimitCzasu,
  komunikatWyjatku,
  zLimitemCzasu,
} from '../lib/zLimitemCzasu'

describe('zLimitemCzasu (D66)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('oddaje wynik, gdy praca skończy się przed limitem', async () => {
    const p = zLimitemCzasu(new Promise<number>((r) => setTimeout(() => r(7), 1000)), 5000)
    await vi.advanceTimersByTimeAsync(1000)
    await expect(p).resolves.toBe(7)
  })

  it('przepuszcza błąd pracy bez zmian', async () => {
    const p = zLimitemCzasu(Promise.reject(new Error('RLS')), 5000)
    await expect(p).rejects.toThrow('RLS')
  })

  it('po limicie odrzuca LimitCzasuError z komunikatem „mógł się zapisać”', async () => {
    const p = zLimitemCzasu(new Promise<never>(() => {}), 30_000)
    const asercja = expect(p).rejects.toBeInstanceOf(LimitCzasuError)
    await vi.advanceTimersByTimeAsync(30_000)
    await asercja
    await p.catch((e: unknown) => {
      expect(czyLimitCzasu(e)).toBe(true)
      expect((e as LimitCzasuError).limitMs).toBe(30_000)
      expect((e as Error).message).toBe(KOMUNIKAT_LIMITU_CZASU)
      expect((e as Error).message).toMatch(/mógł się udać/)
    })
  })

  it('wynik po czasie jest ignorowany (nie zmienia odrzucenia)', async () => {
    let oddaj: (v: string) => void = () => {}
    const p = zLimitemCzasu(new Promise<string>((r) => { oddaj = r }), 100)
    const asercja = expect(p).rejects.toBeInstanceOf(LimitCzasuError)
    await vi.advanceTimersByTimeAsync(100)
    oddaj('za późno')
    await asercja
  })

  it('działa z „thenable” jak zapytanie Supabase', async () => {
    const thenable: PromiseLike<{ error: null }> = {
      then(ok, _err) { return Promise.resolve({ error: null }).then(ok, _err) },
    }
    await expect(zLimitemCzasu(thenable, 1000)).resolves.toEqual({ error: null })
  })

  it('domyślny limit to 30 s', async () => {
    const p = zLimitemCzasu(new Promise<never>(() => {}))
    let odrzucone = false
    p.catch(() => { odrzucone = true })
    await vi.advanceTimersByTimeAsync(29_999)
    expect(odrzucone).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(odrzucone).toBe(true)
  })

  it('komunikatWyjatku: limit → stały tekst, inny błąd → przedrostek + treść', () => {
    expect(komunikatWyjatku(new LimitCzasuError(1))).toBe(KOMUNIKAT_LIMITU_CZASU)
    expect(komunikatWyjatku(new Error('x'), 'Nie zapisano')).toBe('Nie zapisano: x')
    expect(komunikatWyjatku('y')).toBe('Błąd: y')
  })
})
