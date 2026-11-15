import { describe, expect, it } from 'vitest'
import { terminHint, terminHintForIso, terminRoboczy } from '../utils/crmTermin'

// 2026-11-15 = niedziela; 16 pn, 20 pt, 21 sb, 22 nd, 23 pn
const pt10 = new Date(2026, 10, 20, 10, 0)
const pt18 = new Date(2026, 10, 20, 18, 0)
const sr10 = new Date(2026, 10, 18, 10, 0)
const swieta = new Set(['2026-11-11', '2026-12-24', '2026-12-25', '2026-12-26', '2027-01-01'])

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
  it('święta jak weekend: czw 24.12 → pn 28.12 (Wigilia, Boże Narodzenie, weekend)', () => {
    const r = terminRoboczy(new Date(2026, 11, 24), sr10, swieta)
    expect(r.data.getMonth()).toBe(11)
    expect(r.data.getDate()).toBe(28)
    expect(r.powod).toContain('dzień wolny')
  })
  it('bez listy świąt 24.12 zostaje (podpowiedź liczy tylko weekendy)', () => {
    expect(terminRoboczy(new Date(2026, 11, 24), sr10).przesuniety).toBe(false)
  })
  it('„dziś” po 17:00 przed świętem: powód to 17:00, data za świętami', () => {
    const r = terminRoboczy(new Date(2026, 11, 23), new Date(2026, 11, 23, 17, 30), swieta)
    expect(r.data.getDate()).toBe(28)
    expect(r.powod).toContain('17:00')
  })
})

describe('terminHint', () => {
  it('null gdy nic się nie przesuwa', () => {
    expect(terminHint(1, sr10)).toBeNull() // środa + 1 = czwartek 19.11
  })
  it('piątek + 1 dzień = sobota → poniedziałek 23.11', () => {
    expect(terminHint(1, pt10)).toBe('→ poniedziałek 23.11 (weekend przesuwa się na następny dzień roboczy)')
  })
  it('0 dni po 17:00 → jutro, w piątek do poniedziałku', () => {
    expect(terminHint(0, pt18)).toContain('poniedziałek 23.11')
  })
  it('pole daty: pusta / zła wartość = null, weekend = podpowiedź, święto = podpowiedź', () => {
    expect(terminHintForIso('', sr10)).toBeNull()
    expect(terminHintForIso('2026-11-19', sr10)).toBeNull()
    expect(terminHintForIso('2026-11-22', sr10)).toBe('→ poniedziałek 23.11 (weekend przesuwa się na następny dzień roboczy)')
    expect(terminHintForIso('2027-01-01', sr10, swieta)).toBe('→ poniedziałek 04.01 (dzień wolny przesuwa się na następny dzień roboczy)')
  })
})
