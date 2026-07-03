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
    const html = await renderLabelHtml(tpl('[{{dostawka_szkl}}]'), order({ id: 1 }))
    expect(html).toContain('[-]')
    expect(html).not.toContain('{{dostawka_szkl}}')
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
