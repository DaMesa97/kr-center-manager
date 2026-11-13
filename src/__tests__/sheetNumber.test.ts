import { describe, expect, it } from 'vitest'
import type { Order } from '../types'
import { getSheetNumber, sheetNumberTitle } from '../utils/botOrder'

// #119 (Tymek 13.11.2026): numer z arkusza Excel obok numeru zlecenia — wiążący jest numer
// z aplikacji, numer z arkusza to informacja (synchronizacja > numer z chwili importu).

const order = (o: Record<string, unknown>): Order => o as unknown as Order

describe('getSheetNumber', () => {
  it('brak numeru z arkusza → null', () => {
    expect(getSheetNumber(order({ order_number: '5463' }))).toBeNull()
    expect(getSheetNumber(order({ order_number: '5463', extra_fields: {} }))).toBeNull()
    expect(getSheetNumber(null)).toBeNull()
  })

  it('numer z chwili importu (sheet_number_conflict), zanim synchronizacja go potwierdzi', () => {
    const info = getSheetNumber(order({ order_number: '5463', extra_fields: { sheet_number_conflict: '5449' } }))
    expect(info).toEqual({ number: '5449', sheet: undefined, at: undefined, fromImport: true })
  })

  it('numer z synchronizacji ma pierwszeństwo przed numerem z importu', () => {
    const info = getSheetNumber(
      order({
        order_number: '5463',
        extra_fields: { sheet_number_conflict: '5449', sheet_number: '5452', sheet_number_sheet: 'Center', sheet_number_at: '2026-11-14T19:00:00Z' },
      }),
    )
    expect(info).toEqual({ number: '5452', sheet: 'Center', at: '2026-11-14T19:00:00Z', fromImport: false })
  })

  it('taki sam numer jak w aplikacji → brak plakietki; numer liczbowy też działa', () => {
    expect(getSheetNumber(order({ order_number: '5463', extra_fields: { sheet_number: '5463' } }))).toBeNull()
    expect(getSheetNumber(order({ order_number: '5463', extra_fields: { sheet_number_conflict: 5449 } }))?.number).toBe('5449')
  })

  it('podpowiedź mówi, który numer jest wiążący', () => {
    const o = order({ order_number: '5463', extra_fields: { sheet_number: '5452', sheet_number_sheet: 'Center' } })
    const title = sheetNumberTitle(o, getSheetNumber(o)!)
    expect(title).toContain('5452')
    expect(title).toContain('Center')
    expect(title).toContain('numer z aplikacji (5463)')
    const imp = order({ order_number: '5463', extra_fields: { sheet_number_conflict: '5449' } })
    expect(sheetNumberTitle(imp, getSheetNumber(imp)!)).toContain('najbliższej synchronizacji')
  })
})
