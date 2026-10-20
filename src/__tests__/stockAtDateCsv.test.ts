import { describe, expect, it } from 'vitest'
import { buildStockAtDateCsv } from '../lib/stockAtDateCsv'

describe('buildStockAtDateCsv — eksport stanu na dzień', () => {
  const csv = buildStockAtDateCsv(
    [
      { warehouse_code: 'MAG1', component_code: 'SKR-01', component_name: 'Skrzydło DĄB ZŁOTY', category: 'SKRZYDŁA', unit: 'szt', quantity: '12.500' },
      { warehouse_code: 'MAG1', component_code: 'PR;02', component_name: 'Profil "Winchester"', category: null, unit: 'mb', quantity: -3 },
    ],
    '2026-10-01',
  )
  const lines = csv.replace('﻿', '').trim().split('\r\n')

  it('BOM dla Excela i nagłówek z datą', () => {
    expect(csv.startsWith('﻿')).toBe(true)
    expect(lines[0]).toBe('Magazyn;Kod;Nazwa;Kategoria;Jednostka;Stan na 2026-10-01')
  })

  it('ilość z przecinkiem dziesiętnym, bez zbędnych zer; ujemne zostają', () => {
    expect(lines[1]).toBe('MAG1;SKR-01;Skrzydło DĄB ZŁOTY;SKRZYDŁA;szt;12,5')
    expect(lines[2].endsWith(';-3')).toBe(true)
  })

  it('średnik i cudzysłów w tekście są cytowane', () => {
    expect(lines[2]).toBe('MAG1;"PR;02";"Profil ""Winchester""";;mb;-3')
  })
})
