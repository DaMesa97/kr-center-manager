import { describe, expect, it, beforeEach } from 'vitest'
import { ALERTS_BADGE_TTL_MS, alertsBadgeThrottled, parseAlertsSummary, resetAlertsBadgeForTests } from '../lib/alertsBadge'

describe('parseAlertsSummary', () => {
  it('czyta licznik z tablicy i z pojedynczego wiersza', () => {
    expect(parseAlertsSummary([{ r_total_needs_attention: 7 }])).toBe(7)
    expect(parseAlertsSummary({ r_total_needs_attention: '3' })).toBe(3)
  })
  it('brak danych = null, śmieci = 0', () => {
    expect(parseAlertsSummary(null)).toBeNull()
    expect(parseAlertsSummary([])).toBeNull()
    expect(parseAlertsSummary([{ r_total_needs_attention: 'abc' }])).toBe(0)
  })
})

describe('alertsBadgeThrottled', () => {
  beforeEach(() => resetAlertsBadgeForTests())

  it('w oknie TTL nie woła bazy drugi raz', async () => {
    let calls = 0
    const load = async () => { calls += 1; return 5 }
    expect(await alertsBadgeThrottled(load, { now: 1000 })).toBe(5)
    expect(await alertsBadgeThrottled(load, { now: 1000 + ALERTS_BADGE_TTL_MS - 1 })).toBe(5)
    expect(calls).toBe(1)
  })

  it('po TTL woła ponownie', async () => {
    let calls = 0
    const load = async () => { calls += 1; return calls }
    await alertsBadgeThrottled(load, { now: 0 })
    // cache zapisany z Date.now(); przesuwamy „teraz” daleko w przyszłość
    expect(await alertsBadgeThrottled(load, { now: Date.now() + ALERTS_BADGE_TTL_MS + 1 })).toBe(2)
    expect(calls).toBe(2)
  })

  it('równoległe wywołania dzielą jedno zapytanie', async () => {
    let calls = 0
    let release: (v: number) => void = () => {}
    const load = () => new Promise<number>((res) => { calls += 1; release = res })
    const a = alertsBadgeThrottled(load, { now: 0 })
    const b = alertsBadgeThrottled(load, { now: 0 })
    release(9)
    expect(await a).toBe(9)
    expect(await b).toBe(9)
    expect(calls).toBe(1)
  })

  it('błąd (null) nie zapisuje się w pamięci, fresh omija pamięć i przekazuje flagę do bazy', async () => {
    let calls = 0
    const seen: boolean[] = []
    const load = async (fresh: boolean) => { calls += 1; seen.push(fresh); return calls === 1 ? null : 4 }
    expect(await alertsBadgeThrottled(load, { now: 0 })).toBeNull()
    expect(await alertsBadgeThrottled(load, { now: 0 })).toBe(4)
    expect(await alertsBadgeThrottled(load, { now: 0, fresh: true })).toBe(4)
    expect(calls).toBe(3)
    expect(seen).toEqual([false, false, true])
  })
})

describe('spóźniona odpowiedź (testy 27.11)', () => {
  it('stare zwykłe zapytanie nie nadpisuje świeżego po PZ', async () => {
    resetAlertsBadgeForTests()
    let resolveOld: (v: number) => void = () => {}
    const old = alertsBadgeThrottled(() => new Promise<number>((r) => { resolveOld = r }))
    const fresh = await alertsBadgeThrottled(async () => 7, { fresh: true })
    expect(fresh).toBe(7)
    resolveOld(3)
    await old
    expect(await alertsBadgeThrottled(async () => 99)).toBe(7)
  })
})
