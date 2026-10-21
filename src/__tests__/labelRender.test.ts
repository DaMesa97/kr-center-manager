import { describe, expect, it } from 'vitest'
import { renderLabelHtml, type LabelTemplate } from '../lib/labelRender'
import type { Order } from '../types'

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
