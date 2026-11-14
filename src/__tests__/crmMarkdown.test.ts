import { describe, expect, it } from 'vitest'
import { crmMarkdownToHtml } from '../lib/crmMarkdown'

describe('crmMarkdownToHtml (Pomoc CRM)', () => {
  it('pusta treść → pusty string', () => {
    expect(crmMarkdownToHtml(null)).toBe('')
    expect(crmMarkdownToHtml('')).toBe('')
  })

  it('nagłówki, listy, pogrubienia i tabele GFM przechodzą', () => {
    const html = crmMarkdownToHtml('# Tytuł\n\n- jeden\n- **dwa**\n\n| A | B |\n|---|---|\n| 1 | 2 |')
    expect(html).toContain('<h1>Tytuł</h1>')
    expect(html).toContain('<li>jeden</li>')
    expect(html).toContain('<strong>dwa</strong>')
    expect(html).toContain('<table>')
    expect(html).toContain('<td>2</td>')
  })

  it('surowy HTML jest pokazywany jako tekst, nie wykonywany', () => {
    const html = crmMarkdownToHtml('Uwaga <script>alert(1)</script> i <b>x</b>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<b>x</b>')
  })

  it('linki http/mailto zostają z rel, javascript: zamienia się w sam tekst', () => {
    const ok = crmMarkdownToHtml('[sklep](https://podrzwi.pl) [mail](mailto:kontakt@podrzwi.pl)')
    expect(ok).toContain('<a href="https://podrzwi.pl" rel="noopener noreferrer">sklep</a>')
    expect(ok).toContain('href="mailto:kontakt@podrzwi.pl"')
    const bad = crmMarkdownToHtml('[klik](javascript:alert(1))')
    expect(bad).not.toContain('<a ')
    expect(bad).toContain('klik')
  })
})
