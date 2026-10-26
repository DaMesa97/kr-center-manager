import { describe, expect, it } from 'vitest'
import {
  catalogAllowed,
  catalogToken,
  cardStatus,
  cardToForm,
  formToPayload,
  latestBy,
  lotsForStage,
  requiredFillingFields,
  zkpTypeCode,
} from '../lib/zkpCard'
import { register624Rows } from '../lib/zkpPrint'
import type { ZkpComponent, ZkpMaterialLot } from '../lib/zkp'

describe('karta wyrobu — kod typu wyrobu (zał. 6.8), te same wyniki co zkp_type_code w bazie', () => {
  it('drzwi wewnętrzne, zewnętrzne, wyłącznie dymoszczelne', () => {
    expect(zkpTypeCode({ product_type: 'drzwi_wewn', range_code: 'EI30S', leaves: '1', opening: 'do_wewnatrz', evacuation: 'EN179' })).toBe('AS75EI-W-EI30-S-1-E')
    expect(zkpTypeCode({ product_type: 'drzwi_zewn', range_code: 'EI60', leaves: '2', opening: 'na_zewnatrz', evacuation: 'nie' })).toBe('AS75EI-Z-EI60-–-2-NZ-–')
    expect(zkpTypeCode({ product_type: 'drzwi_wewn', range_code: 'S', leaves: '1', opening: '', evacuation: 'nie' })).toBe('AS75EI-W-S-S-1-–')
    expect(zkpTypeCode({ product_type: '', range_code: 'EI30', leaves: '1', opening: '', evacuation: 'nie' })).toBe('')
  })
})

describe('lista 6.10.5 — dopasowanie nr katalogowego (jak zkp_catalog_allowed)', () => {
  const ei30 = new Set(['U278', 'U283', 'H465', 'P2423XX'])
  it('token: litera + 3–4 cyfry + kolor', () => {
    expect(catalogToken('h465 L=6000')).toBe('H465')
    expect(catalogToken('P 2423 01')).toBe('P242301')
    expect(catalogToken('brak')).toBeNull()
  })
  it('dokładnie albo przez XX (kolor)', () => {
    expect(catalogAllowed(ei30, 'U278')).toBe(true)
    expect(catalogAllowed(ei30, 'U279')).toBe(false) // U279 tylko EI60 — w EI30 spoza listy
    expect(catalogAllowed(ei30, 'P242301')).toBe(true)
    expect(catalogAllowed(ei30, 'P2423XX')).toBe(true)
    expect(catalogAllowed(ei30, 'H4651')).toBe(false)
  })
})

const comp = (id: number, kind: ZkpComponent['zkp_critical_kind']): ZkpComponent => ({
  id, code: `C${id}`, name: `Komponent ${id}`, unit: 'szt', category: null, is_active: true, zkp_critical_kind: kind, zkp_model: '', zkp_dwu_number: '',
})
const lot = (id: number, componentId: number, catalog: string, decision: ZkpMaterialLot['decision'] = 'przyjeto', received = '2026-10-01'): ZkpMaterialLot => ({
  id, received_on: received, supplier_id: 1, delivery_doc: `WZ/${id}`, component_id: componentId, catalog_no: catalog, quantity: 10,
  lot_no: `P${id}`, quality_doc_kind: 'DWU', quality_doc_no: 'D', quality_doc_path: null, conforms_to_order: true,
  conforms_to_list_6105: true, condition_ok: true, condition_notes: '', decision, decision_reason: '', pz_reference: '',
  qty_issued: 0, received_by_name: 'TW', created_at: '', decided_at: null, decided_by_name: '',
})

describe('partie do etapu', () => {
  const components = [comp(1, 'uszczelka'), comp(2, 'wklad')]
  const lots = [lot(1, 1, 'U278'), lot(2, 1, 'U279'), lot(3, 1, 'U278', 'kwarantanna'), lot(4, 2, 'H465')]
  it('tylko przyjęte, właściwego rodzaju i z listy zakresu', () => {
    expect(lotsForStage(lots, components, 'uszczelka', new Set(['U278'])).map((l) => l.id)).toEqual([1])
    expect(lotsForStage(lots, components, 'uszczelka', null).map((l) => l.id)).toEqual([1, 2])
    expect(lotsForStage(lots, components, ['wklad', 'uszczelka'], null).map((l) => l.id)).toEqual([1, 2, 4])
  })
})

describe('karta — pomocnicze', () => {
  it('bieżący wpis = najwyższe id', () => {
    const m = latestBy([{ id: 1, k: 'a', v: 1 }, { id: 3, k: 'a', v: 3 }, { id: 2, k: 'b', v: 2 }], (r) => r.k)
    expect(m.get('a')?.v).toBe(3)
    expect(m.get('b')?.v).toBe(2)
  })
  it('wymagane wypełnienia z części A', () => {
    expect(requiredFillingFields({ leaves: 1, light: 'brak' })).toEqual(['czynne'])
    expect(requiredFillingFields({ leaves: 2, light: 'doswietle_P' })).toEqual(['czynne', 'bierne', 'doswietle'])
  })
  it('status karty', () => {
    expect(cardStatus({ card_id: null, range_confirmed: null, decision: null })).toBe('brak')
    expect(cardStatus({ card_id: 1, range_confirmed: false, decision: null })).toBe('szkic')
    expect(cardStatus({ card_id: 1, range_confirmed: true, decision: null })).toBe('zakres')
    expect(cardStatus({ card_id: 1, range_confirmed: true, decision: 'zwolniony' })).toBe('zwolniony')
  })
  it('formularz: podpowiedź okna z LP, przecinek dziesiętny', () => {
    expect(cardToForm(null, { construction_type: 'okno' }).product_type).toBe('okno')
    const p = formToPayload({ ...cardToForm(null), leaf_mass_kg: ' 82,5 ', fill_thickness_mm: '20,0' })
    expect(p.leaf_mass_kg).toBe('82.5')
    expect(p.fill_thickness_mm).toBe('20.0')
  })
})

describe('rejestr przyjęć 6.24 — okres', () => {
  it('filtr dat włącznie i kolejność przyjęć', () => {
    const lots = [lot(2, 1, 'U', 'przyjeto', '2026-10-05'), lot(1, 1, 'U', 'zwrot', '2026-10-01'), lot(3, 1, 'U', 'przyjeto', '2026-11-01')]
    expect(register624Rows({ lots, components: [], suppliers: [], from: '2026-10-01', to: '2026-10-31' }).map((l) => l.id)).toEqual([1, 2])
  })
})
