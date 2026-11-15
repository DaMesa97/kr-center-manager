import { describe, expect, it } from 'vitest'
import { terminHint, terminHintForIso, terminRoboczy } from '../utils/crmTermin'

// 2026-11-15 = niedziela; 16 pn, 20 pt, 21 sb, 22 nd, 23 pn
const pt10 = new Date(2026, 10, 20, 10, 0)
const pt18 = new Date(2026, 10, 20, 18, 0)
const sr10 = new Date(2026, 10, 18, 10, 0)

describe('terminRoboczy (odwzorowanie triggera leady_termin_roboczy)', () => {
  it('dzień roboczy w godzinach pracy zostaje', () => {
    const r = terminRoboczy(new Date(2026, 10, 18), sr10)
    expect(r.przesuniety).toBe(false)
    expect(r.data.getDate()).toBe(18)
  })
  it('sobota → poniedziałek, niedziela → poniedziałek', () => {
    expect(terminRoboczy(new Date(2026, 10, 21), sr10).data.getDate()).toBe(23)
    expect(terminRoboczy(new Date(2026, 10, 22), sr10).data.getDate()).toBe(23)
  })
  it('„dziś” po 17:00 → jutro; w piątek po 17:00 → poniedziałek', () => {
    const r = terminRoboczy(new Date(2026, 10, 20), pt18)
    expect(r.data.getDate()).toBe(23)
    expect(r.powod).toContain('17:00')
  })
  it('„dziś” przed 17:00 zostaje', () => {
    expect(terminRoboczy(new Date(2026, 10, 20), pt10).przesuniety).toBe(false)
  })
  it('termin w przeszłości (nawet weekend) nie jest ruszany', () => {
    const r = terminRoboczy(new Date(2026, 10, 15), sr10) // niedziela 15.11, dziś środa 18.11
    expect(r.przesuniety).toBe(false)
    expect(r.data.getDate()).toBe(15)
    expect(terminHintForIso('2026-11-14', sr10)).toBeNull()
  })
})

describe('terminHint', () => {
  it('null gdy nic się nie przesuwa', () => {
    expect(terminHint(1, sr10)).toBeNull() // środa + 1 = czwartek 19.11
  })
  it('piątek + 1 dzień = sobota → poniedziałek 23.11', () => {
    expect(terminHint(1, pt10)).toBe('→ poniedziałek 23.11 (weekend przesuwa się na poniedziałek)')
  })
  it('0 dni po 17:00 → jutro, w piątek do poniedziałku', () => {
    expect(terminHint(0, pt18)).toContain('poniedziałek 23.11')
  })
  it('pole daty: pusta / zła wartość = null, weekend = podpowiedź', () => {
    expect(terminHintForIso('', sr10)).toBeNull()
    expect(terminHintForIso('2026-11-19', sr10)).toBeNull()
    expect(terminHintForIso('2026-11-22', sr10)).toBe('→ poniedziałek 23.11 (weekend przesuwa się na poniedziałek)')
  })
})
