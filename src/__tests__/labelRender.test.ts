import { describe, expect, it } from 'vitest'
import { labelPagesHtml, renderLabelHtml, type LabelTemplate } from '../lib/labelRender'
import type { AluPosition, Order } from '../types'

// Render etykiet — zgodnie z Pomocą: podstawianie pól, "-" dla pustych,
// escapowanie danych (bezpieczeństwo), QR, rozmiar strony w mm.

const tpl = (html: string, w = 100, h = 50): LabelTemplate => ({
  id: 1, category: 'STA', name: 't', html, width_mm: w, height_mm: h, is_default: true,
})
const order = (o: Record<string, unknown>): Order => o as unknown as Order

describe('renderLabelHtml', () => {
  it('podstawia pola zamówienia', async () => {
    const html = await renderLabelHtml(tpl('{{nr_zlecenia}}|{{firma}}'), order({ id: 1, order_number: '4321', company: 'TORA' }))
    expect(html).toContain('4321|TORA')
  })

  it('puste pola → "-" (zgłoszenie #9)', async () => {
    const html = await renderLabelHtml(tpl('[{{model}}]'), order({ id: 1 }))
    expect(html).toContain('[-]')
  })

  it('nieznane placeholdery → "-" (literówki nie trafiają na druk)', async () => {
    const html = await renderLabelHtml(tpl('[{{dostawka_szklo}}]'), order({ id: 1 }))
    expect(html).toContain('[-]')
    expect(html).not.toContain('{{dostawka_szklo}}')
  })

  it('pola dostawek A/B ze szkleniem (szablon STA używa {{dostawka_szkl}})', async () => {
    const t = tpl('{{dostawka}}|{{dostawka_szkl}}|{{dostawka_b}}|{{dostawka_b_szkl}}')
    const ab = await renderLabelHtml(t, order({
      id: 1, side_panel_a: '300', side_panel_a_glazing: 'MAT', side_panel_b: '400', side_panel_b_glazing: 'CLEAR',
    }))
    expect(ab).toContain('300|MAT|400|CLEAR')
    // stary układ: jedna dostawka bez A/B
    const legacy = await renderLabelHtml(t, order({ id: 1, side_panel: '350', side_panel_glazing: 'SATYNA' }))
    expect(legacy).toContain('350|SATYNA|-|-')
  })

  it('intarsja i nr z arkusza (extra_fields.sheet_number_conflict)', async () => {
    const html = await renderLabelHtml(
      tpl('{{intarsja}}|{{nr_arkusza}}'),
      order({ id: 1, intarsja: 'DWUSTRONNA', extra_fields: { sheet_number_conflict: '4145' } }),
    )
    expect(html).toContain('DWUSTRONNA|4145')
    const none = await renderLabelHtml(tpl('[{{nr_arkusza}}]'), order({ id: 1, extra_fields: null }))
    expect(none).toContain('[-]')
  })

  it('nr_partnera zależy od kategorii', async () => {
    const t = tpl('[{{nr_partnera}}]')
    const r = (o: Record<string, unknown>) => renderLabelHtml(t, order({ id: 1, ...o }))
    expect(await r({ category: 'Disting', sta_sheet: '111', disting_sheet: 'x' })).toContain('[111]')
    expect(await r({ category: 'STA', disting_sheet: '222' })).toContain('[222]')
    expect(await r({ category: 'STA', st_sheet: '333', disting_sheet: '' })).toContain('[333]')
    expect(await r({ category: 'ST', sta_ref: '444' })).toContain('[444]')
    expect(await r({ category: 'STA' })).toContain('[-]')
  })

  it('escapuje <title> etykiety', async () => {
    const html = await renderLabelHtml(tpl('x'), order({ id: 1, company: '</title><script>x</script>', order_number: '1' }))
    expect(html).not.toContain('<script>')
  })

  it('escapuje HTML w danych zamówienia (ochrona przed XSS)', async () => {
    const html = await renderLabelHtml(
      tpl('{{firma}}'),
      order({ id: 1, company: '<img src=x onerror=alert(1)>' }),
    )
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('{{qr}} generuje obrazek z kodem (data URL)', async () => {
    const html = await renderLabelHtml(tpl('<div>{{qr}}</div>'), order({ id: 9999, order_number: '1' }))
    expect(html).toContain('data:image/png')
    expect(html).toContain('<img')
  })

  it('ustawia fizyczny rozmiar etykiety w mm (@page)', async () => {
    const html = await renderLabelHtml(tpl('x', 100, 150), order({ id: 1 }))
    expect(html).toContain('size: 100mm 150mm')
  })

  it('pola panelu Bastiona są dostępne', async () => {
    const html = await renderLabelHtml(
      tpl('{{panel_boczny_k}}|{{panel_gorny}}'),
      order({ id: 1, bastion_side_panel_k: '370×2080', bastion_top_panel: '900×400' }),
    )
    expect(html).toContain('370×2080|900×400')
  })
})

describe('etykieta aluminium (per sztuka pozycji)', () => {
  const pos = {
    id: 1, order_id: 1, pos_no: 3, created_at: '', production_stages: {},
    description: 'AS75 - drzwi', construction_type: 'drzwi', system: 'AS75',
    profile_color: 'RAL7016', hardware_color: '', fillings: '', width_mm: 2360, height_mm: 2590,
    quantity: 5, weight_kg: null, u_value: null, notes: { prog: 'Aluminiowy P2601X' }, glass: [],
  } as unknown as AluPosition
  const aluOrder = order({
    id: 7, order_number: 'OF1/2026', category: 'Aluminium',
    extra_fields: { alu: { lp_number: 'LP 1/2026', deadline: '2026-11-23', realizacja: 'montaz' } },
  })

  it('sztuka k/q, wymiar, typ, próg, realizacja, załadunek dzień roboczy przed terminem', async () => {
    const html = await renderLabelHtml(
      tpl('[{{alu_poz}}|{{alu_sztuka}}|{{alu_wymiar}}|{{alu_typ}}|{{alu_prog}}|{{alu_realizacja}}|{{alu_zaladunek}}|{{alu_lp}}]'),
      aluOrder,
      { position: pos, piece: 2 },
    )
    // termin pn 23.11 → załadunek pt 20.11
    expect(html).toContain('[3|2/5|2360×2590 mm|Drzwi|Aluminiowy P2601X|MONTAŻ|20.11.2026 (pt.)|LP 1/2026]')
  })
  it('puste pole alu → „-”, bez kontekstu pozycji pola alu też „-”', async () => {
    expect(await renderLabelHtml(tpl('[{{alu_kolor_okuc}}]'), aluOrder, { position: pos, piece: 1 })).toContain('[-]')
    expect(await renderLabelHtml(tpl('[{{alu_sztuka}}]'), aluOrder)).toContain('[-]')
  })
  it('kilka etykiet = strony jednego dokumentu', () => {
    const html = labelPagesHtml(['A', 'B'], 100, 150, 'x')
    expect(html).toContain('@page { size: 100mm 150mm')
    expect(html.match(/page-break-after:always/g)?.length).toBe(1)
  })
})
