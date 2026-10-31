import { describe, expect, it } from 'vitest'
import {
  BASTION_BATCH_STAGE_DEFS,
  batchNoByOrderId,
  batchStageProgress,
  mapBastionBatchRow,
  screwingRangeLabel,
} from '../lib/bastionBatches'

describe('bastionBatches', () => {
  it('ma 7 etapów paneli/opasek bez skręcania (skręcanie jest na zleceniu)', () => {
    expect(BASTION_BATCH_STAGE_DEFS.map((d) => d.key)).toEqual([
      'panele_ciecie', 'panele_frezarki', 'panele_cnc', 'panele_lakiernia', 'panele_oklejarki', 'opaski_ciecie', 'opaski_cnc',
    ])
  })

  it('mapuje wiersz widoku: etapy jako {v,at,by}, tablice zleceń, liczby', () => {
    const b = mapBastionBatchRow({
      id: '7', batch_no: 34, status: 'open', notes: null,
      stages: { panele_ciecie: { v: 'AW', at: '2026-10-31T10:00:00Z', by: 'u1' }, panele_cnc: 'XX' },
      created_at: '2026-10-31T09:00:00Z', created_by: 'u1', updated_at: '2026-10-31T10:00:00Z', closed_at: null,
      items_count: '3', screwed_count: 1, screwed_from: '2026-10-31T12:00:00Z', screwed_to: '2026-10-31T12:00:00Z',
      order_ids: ['10', 11, 12], order_numbers: ['7235', '7236', '7237'], order_screwed: [true, false, false],
    })
    expect(b.id).toBe(7)
    expect(b.stages.panele_ciecie).toEqual({ v: 'AW', at: '2026-10-31T10:00:00Z', by: 'u1' })
    expect(b.stages.panele_cnc.v).toBe('XX')
    expect(b.order_ids).toEqual([10, 11, 12])
    expect(b.items_count).toBe(3)
    expect(batchStageProgress(b)).toBe(2)
  })

  it('zakres skręcania jak w arkuszu: jeden dzień albo od–do', () => {
    expect(screwingRangeLabel({ screwed_from: null, screwed_to: null })).toBe('')
    expect(screwingRangeLabel({ screwed_from: '2026-10-24T08:00:00', screwed_to: '2026-10-24T15:00:00' })).toBe('24.10')
    expect(screwingRangeLabel({ screwed_from: '2026-10-24T08:00:00', screwed_to: '2026-10-26T15:00:00' })).toBe('24.10–26.10')
  })

  it('zlecenie → numer partii', () => {
    const a = mapBastionBatchRow({ id: 1, batch_no: 34, status: 'open', stages: {}, order_ids: [1, 2], order_numbers: ['a', 'b'], order_screwed: [false, false] })
    const b = mapBastionBatchRow({ id: 2, batch_no: 35, status: 'closed', stages: {}, order_ids: [3], order_numbers: ['c'], order_screwed: [true] })
    const m = batchNoByOrderId([a, b])
    expect(m.get(2)).toBe(34)
    expect(m.get(3)).toBe(35)
    expect(m.has(9)).toBe(false)
  })
})
