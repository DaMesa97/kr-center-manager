// Markdown → HTML dla stron pomocy CRM (crm.pomoc). Treść pisze superadmin, ale
// zasada z briefu: „bez HTML” — surowe znaczniki w treści są pokazywane jako tekst,
// a linki przechodzą tylko z http(s)/mailto (javascript: itp. zostają samym tekstem).
// Tabele (GFM), nagłówki, listy, pogrubienia działają normalnie.
import { marked } from 'marked'

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const SAFE_HREF = /^(https?:\/\/|mailto:)/i

export function crmMarkdownToHtml(md: string | null | undefined): string {
  if (!md) return ''
  // surowy HTML → tekst (marked nie sanituje). Autolinki <https://…> też stają się tekstem — świadomie.
  const src = escapeHtml(md)
  const html = marked.parse(src, { async: false, gfm: true, breaks: true }) as string
  // linki: tylko bezpieczne schematy; niebezpieczny link → sam tekst
  return html.replace(/<a\s+href="([^"]*)"([^>]*)>([\s\S]*?)<\/a>/gi, (_whole, href: string, rest: string, text: string) => {
    const h = href.replace(/&amp;/g, '&')
    if (!SAFE_HREF.test(h)) return text
    return `<a href="${href}"${rest} rel="noopener noreferrer">${text}</a>`
  })
}
