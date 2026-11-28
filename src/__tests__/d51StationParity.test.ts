import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { aluSztukaKomunikat } from '../lib/alu'

describe('D51: stanowisko na komputerze i na telefonie działa tak samo', () => {
  it('licznik sztuk aluminium z wyniku bazy, nie zgadywany', () => {
    // baza zwróciła 3 zrobione (ktoś równolegle kliknął) — komunikat pokazuje 3, nie „zrobione + 1”
    expect(aluSztukaKomunikat('Cięcie', 2, 5, { e1: { done: 3 } } as never, 'e1')).toBe('Cięcie: sztuka 3/5 pozycji 2')
    expect(aluSztukaKomunikat('Cięcie', 2, 5, { e1: { done: 7 } } as never, 'e1')).toBe('Cięcie: pozycja 2 gotowa (5/5 szt.)')
    expect(aluSztukaKomunikat('Cięcie', 2, 5, null, 'e1')).toBe('Cięcie: sztuka 0/5 pozycji 2')
  })

  it('telefon oznacza lokalny zapis etapu przed każdym update_order_stage (jak komputer)', () => {
    for (const plik of ['components/mobile/MobileStationView.tsx', 'hooks/useMyStation.ts']) {
      const src = readFileSync(resolve(__dirname, '..', plik), 'utf-8').split(/\r?\n/)
      const wywolania = src.map((l, i) => (l.includes("rpc('update_order_stage'") ? i : -1)).filter((i) => i >= 0)
      expect(wywolania.length, plik).toBeGreaterThan(0)
      for (const i of wywolania) {
        const przed = src.slice(Math.max(0, i - 3), i + 1).join('\n')
        expect(przed, `${plik}:${i + 1}`).toContain('markLocalStageWrite(')
      }
    }
  })
})
