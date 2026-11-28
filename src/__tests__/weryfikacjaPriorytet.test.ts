import { describe, expect, it } from 'vitest'
import { podzielWeryfikacje, priorytetWeryfikacji, sortujWeryfikacje } from '../lib/weryfikacjaPriorytet'

const DUBEL = 'Mozliwy duplikat: ta sama firma i numer zamowienia klienta w ostatnich 21 dniach'
const RENUM = 'Numer 180 z arkusza był już zajęty (VENTO 12B) — nadano numer 4649'
const BRAK = 'Brak numeru zamowienia klienta'

describe('Weryfikacja: priorytety i ukrywanie starych (D35)', () => {
  it('priorytet po treści ostrzeżeń', () => {
    expect(priorytetWeryfikacji([DUBEL])).toBe('wysoki')
    expect(priorytetWeryfikacji(['MOZLIWY DUPLIKAT: identyczny payload jak zlecenie 1 (id 2)'])).toBe('wysoki')
    expect(priorytetWeryfikacji(['Numer 5 z arkusza był już zajęty przez zlecenie tej samej firmy (X) — nadano numer 6; sprawdź'])).toBe('wysoki')
    expect(priorytetWeryfikacji([RENUM])).toBe('niski')
    expect(priorytetWeryfikacji([RENUM, BRAK])).toBe('normalny')
    expect(priorytetWeryfikacji([BRAK])).toBe('normalny')
    expect(priorytetWeryfikacji([])).toBe('normalny')
    expect(priorytetWeryfikacji(null)).toBe('normalny')
  })
  it('kolejność: pilne, zwykłe, informacyjne; w grupie FIFO', () => {
    const l = [
      { id: 1, warnings: [RENUM], bot_received_at: '2026-11-01T00:00:00Z' },
      { id: 2, warnings: [BRAK], bot_received_at: '2026-11-20T00:00:00Z' },
      { id: 3, warnings: [DUBEL], bot_received_at: '2026-11-25T00:00:00Z' },
      { id: 4, warnings: [BRAK], bot_received_at: '2026-11-10T00:00:00Z' },
    ]
    expect(sortujWeryfikacje(l).map((x) => x.id)).toEqual([3, 4, 2, 1])
  })
  it('starsze niż 14 dni chowane, pilne nigdy, brak daty = aktualne', () => {
    const teraz = new Date('2026-11-28T12:00:00Z').getTime()
    const l = [
      { id: 1, warnings: [RENUM], bot_received_at: '2026-11-01T00:00:00Z' },
      { id: 2, warnings: [DUBEL], bot_received_at: '2026-10-01T00:00:00Z' },
      { id: 3, warnings: [BRAK], bot_received_at: '2026-11-27T00:00:00Z' },
      { id: 4, warnings: [BRAK], bot_received_at: null },
    ]
    const { aktualne, stare } = podzielWeryfikacje(l, teraz)
    expect(aktualne.map((x) => x.id)).toEqual([2, 3, 4])
    expect(stare.map((x) => x.id)).toEqual([1])
  })
})
