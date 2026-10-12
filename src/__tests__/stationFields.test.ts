import { describe, expect, it } from 'vitest'
import { fieldsForStage } from '../lib/stationLogic'
import type { Order } from '../types'

// „Moje stanowisko" — szczegóły pokazywane pracownikowi zależą od etapu:
// stanowisko ościeżnicy widzi co innego niż szklarnia czy okuwanie.

const staOrder = (): Order =>
  ({
    category: 'STA', model: 'NICOLO', wing_color: 'ANTRACYT', frame_color: 'ZŁOTY DĄB',
    width: '90', height: '2000', direction: 'PRAWE', opening: 'ONZ', system: 'NORMAL',
    threshold_color: 'SREBRNY', glazing: 'MLECZNE', hardware: 'KR', handle: 'P45',
    top_light: '900×400', side_panel_a: '370×2080', side_panel_a_glazing: 'LUSTRO',
  }) as unknown as Order

const labels = (o: Order, cat: string, key: string) => fieldsForStage(o, cat, key).map((f) => f.label)

describe('fieldsForStage — dobór szczegółów pod etap', () => {
  it('etap ościeżnicy (e1) → dane ościeżnicy, bez okuć', () => {
    const l = labels(staOrder(), 'STA', 'e1')
    expect(l).toContain('Kolor ościeżnicy')
    expect(l).toContain('Wymiar (S×W)')
    expect(l).not.toContain('Okucia')
  })

  it('etapy ościeżnicy widzą elektrozaczep (frez w ościeżnicy) — STA, ST, Bastion', () => {
    const withStrike = { ...staOrder(), electric_strike: 'TAK' } as Order
    expect(labels(withStrike, 'STA', 'e1')).toContain('Elektrozaczep')
    expect(labels(withStrike, 'ST', 'osc')).toContain('Elektrozaczep')
    expect(labels(withStrike, 'Bastion', 'oscieznica_cnc')).toContain('Elektrozaczep')
  })

  it('etap szklenia dodatków (e2_2) → naświetle i dostawka ze szkleniami', () => {
    const l = labels(staOrder(), 'STA', 'e2_2')
    expect(l).toContain('Naświetle górne')
    expect(l).toContain('Dostawka boczna')
    expect(l).toContain('Szklenie dostawki')
  })

  it('etap skrzydła (e3) → model, kolor skrzydła, okucia', () => {
    const l = labels(staOrder(), 'STA', 'e3')
    expect(l).toContain('Model')
    expect(l).toContain('Kolor skrzydła')
    expect(l).toContain('Okucia')
    expect(l).not.toContain('Kolor ościeżnicy')
  })

  it('Bastion: etapy ościeżnicy widzą typ ościeżnicy, etapy skrzydła — dane skrzydła', () => {
    const bastion = {
      category: 'Bastion', model: 'STD-01', wing_color: 'AKACJA', frame_color: 'AKACJA',
      width: '70', height: '2000', system: 'BASIC', direction: 'PRAWE', opening: 'ONZ',
      bastion_frame_type: 'DREWNIANA REGULOWANA', bastion_collection: 'BASIC LOCK PLUS',
      hardware: 'KR',
    } as unknown as Order
    expect(labels(bastion, 'Bastion', 'oscieznica_cnc')).toContain('Typ ościeżnicy')
    expect(labels(bastion, 'Bastion', 'okuwanie_skrzydla')).toContain('Kolor skrzydła')
  })

  it('uwagi są na górze każdego etapu', () => {
    const withNotes = { ...staOrder(), notes: 'BEZ ZAMKA' } as Order
    for (const key of ['e1', 'e2_2', 'e3', 'e4', 'e5']) {
      expect(fieldsForStage(withNotes, 'STA', key)[0]).toEqual({ label: 'Uwagi', value: 'BEZ ZAMKA' })
    }
    const bastion = { category: 'Bastion', notes: 'A', bastion_notes_2: 'B' } as unknown as Order
    expect(labels(bastion, 'Bastion', 'cnc').slice(0, 2)).toEqual(['Uwagi', 'Uwagi 2'])
  })

  it('skrzydło (frezowanie/okuwanie) widzi kierunek, otwieranie i wymiar', () => {
    for (const key of ['e3', 'e4']) {
      const l = labels(staOrder(), 'STA', key)
      expect(l).toContain('Kierunek')
      expect(l).toContain('Otwieranie')
      expect(l).toContain('Wymiar (S×W)')
    }
  })

  it('pakowanie (E5) widzi naświetle, dostawki i osłonki', () => {
    const l = labels({ ...staOrder(), oslonki: 'CZARNE' } as Order, 'STA', 'e5')
    expect(l).toContain('Naświetle górne')
    expect(l).toContain('Dostawka boczna')
    expect(l).toContain('Osłonki')
  })

  it('ST: CNC frezuje skrzydło → dane skrzydła', () => {
    const l = labels({ ...staOrder(), category: 'ST' } as Order, 'ST', 'cnc')
    expect(l).toContain('Okucia')
    expect(l).not.toContain('Kolor ościeżnicy')
  })

  it('Bastion: stolarnia widzi próg, Titan OKU — dane skrzydła', () => {
    const bastion = {
      category: 'Bastion', model: 'STD-01', wing_color: 'AKACJA', threshold_color: 'DĄB', hardware: 'KR',
    } as unknown as Order
    expect(labels(bastion, 'Bastion', 'stolarnia')).toContain('Próg')
    expect(labels(bastion, 'Bastion', 'tit_oku')).toContain('Okucia')
  })

  it('puste wartości są odfiltrowane (pracownik nie widzi pustych wierszy)', () => {
    const bare = { category: 'STA', frame_color: 'ZŁOTY' } as unknown as Order
    const fields = fieldsForStage(bare, 'STA', 'e1')
    for (const f of fields) expect(f.value).not.toBe('')
  })
})
