import { describe, expect, it } from 'vitest'
import { buildCombinedPdfHtml } from '../lib/printBundle'

describe('buildCombinedPdfHtml', () => {
  it('escapuje tytuł (nazwa firmy może zawierać znaki HTML)', () => {
    const html = buildCombinedPdfHtml([{ widthMm: 100, heightMm: 50, bodyHtml: 'x' }], 'A&B </title><script>1</script>')
    expect(html).toContain('<title>A&amp;B &lt;/title&gt;&lt;script&gt;1&lt;/script&gt;</title>')
    expect(html).not.toContain('<script>')
  })

  it('jedna reguła @page na rozmiar + powtórzenia sekcji', () => {
    const html = buildCombinedPdfHtml(
      [
        { widthMm: 100, heightMm: 150, bodyHtml: 'L', repeat: 2 },
        { widthMm: 210, heightMm: 297, bodyHtml: 'D' },
        { widthMm: 100, heightMm: 150, bodyHtml: 'L2' },
      ],
      't',
    )
    expect(html.match(/@page pg\d/g)).toHaveLength(2)
    expect(html.match(/page: pg0;/g)).toHaveLength(3)
    expect(html.match(/page: pg1;/g)).toHaveLength(1)
  })
})
