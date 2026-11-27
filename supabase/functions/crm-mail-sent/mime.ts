// Rozbiór treści maila (MIME, RFC 2045/2046/2047/2231) do czystego tekstu + listy załączników.
// Czysta logika bez Deno/Node, testowana w imap.test.mjs.
//
// Wejście: surowe nagłówki (tekst) i ciało wiadomości (bajty, może być ucięte).
// Wyjście: tekst do analizy (text/plain, a gdy go nie ma: HTML zamieniony na tekst), lista załączników
// (nazwa, typ, rozmiar) i flaga, czy ciało było ucięte.

import { dekodujSlowa, parsujNaglowki } from './imap.ts'

export type Zalacznik = { nazwa: string; typ: string; rozmiar: number }
export type TrescMaila = { tekst: string; html: string; zalaczniki: Zalacznik[]; ucieta: boolean }

/** Bajty → łańcuch 1 bajt = 1 znak (U+0000..U+00FF). Celowo NIE TextDecoder('latin1'): ta etykieta to windows-1252,
 *  które zamienia bajty 0x80-0x9F na inne znaki i psuje drugi bajt polskich liter w UTF-8 (ę = C4 99). */
export function bajtyNaLancuch(b: Uint8Array): string {
  let s = ''
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, Array.from(b.subarray(i, i + 8192)))
  return s
}

export function parsujWiadomosc(naglowkiSurowe: string, cialo: Uint8Array, ucieta = false): TrescMaila {
  const out = { teksty: [] as string[], htmle: [] as string[], zalaczniki: [] as Zalacznik[] }
  rozbierz(parsujNaglowki(naglowkiSurowe), bajtyNaLancuch(cialo), out, 0)
  const tekst = out.teksty.join('\n\n').trim()
  const html = out.htmle.join('\n').trim()
  return { tekst: tekst || htmlNaTekst(html), html, zalaczniki: out.zalaczniki, ucieta }
}

type Zbior = { teksty: string[]; htmle: string[]; zalaczniki: Zalacznik[] }

function rozbierz(h: Record<string, string>, cialo: string, out: Zbior, glebokosc: number) {
  if (glebokosc > 10) return
  const ct = parsujParametry(h['content-type'] ?? 'text/plain; charset=us-ascii')
  const typ = ct.wartosc.toLowerCase()
  const cte = (h['content-transfer-encoding'] ?? '7bit').trim().toLowerCase()
  const cd = parsujParametry(h['content-disposition'] ?? '')
  const nazwaPliku = nazwaZalacznika(cd.parametry, ct.parametry)

  if (typ.startsWith('multipart/')) {
    const granica = ct.parametry['boundary']
    if (!granica) { out.teksty.push(dekodujTekst(cialo, cte, ct.parametry['charset'])); return }
    for (const czesc of czesciMultipart(cialo, granica)) {
      const [nag, tresc] = rozdzielNaglowki(czesc)
      rozbierz(parsujNaglowki(nag), tresc, out, glebokosc + 1)
    }
    return
  }
  if (typ === 'message/rfc822' && cd.wartosc.toLowerCase() !== 'attachment') {
    const [nag, tresc] = rozdzielNaglowki(cialo)
    rozbierz(parsujNaglowki(nag), tresc, out, glebokosc + 1)
    return
  }
  const zalacznik = cd.wartosc.toLowerCase() === 'attachment' || (!!nazwaPliku && !typ.startsWith('text/')) || (!typ.startsWith('text/') && typ !== '')
  if (zalacznik) {
    out.zalaczniki.push({ nazwa: nazwaPliku || (typ.startsWith('image/') ? 'obraz' : 'plik'), typ, rozmiar: rozmiarPoDekodowaniu(cialo, cte) })
    return
  }
  const tekst = dekodujTekst(cialo, cte, ct.parametry['charset'])
  if (typ === 'text/html') out.htmle.push(tekst)
  else out.teksty.push(tekst)
}

/** Części między liniami „--granica”; ignoruje preambułę i epilog. */
export function czesciMultipart(cialo: string, granica: string): string[] {
  const linie = cialo.split(/\r?\n/)
  const out: string[] = []
  let biezaca: string[] | null = null
  for (const l of linie) {
    if (l === '--' + granica || l === '--' + granica + '--' || l.startsWith('--' + granica + '--')) {
      if (biezaca) out.push(biezaca.join('\r\n'))
      biezaca = l.startsWith('--' + granica + '--') ? null : []
      if (l.startsWith('--' + granica + '--')) break
      continue
    }
    if (biezaca) biezaca.push(l)
  }
  if (biezaca && biezaca.length) out.push(biezaca.join('\r\n'))   // ucięte ciało bez granicy końcowej
  return out
}

function rozdzielNaglowki(czesc: string): [string, string] {
  const m = /\r?\n\r?\n/.exec(czesc)
  if (!m) return czesc.startsWith('\r\n') || czesc.startsWith('\n') ? ['', czesc.replace(/^\r?\n/, '')] : [czesc, '']
  return [czesc.slice(0, m.index), czesc.slice(m.index + m[0].length)]
}

/** „text/plain; charset="utf-8"; name*=utf-8''plik.pdf” → { wartosc, parametry } (RFC 2231: składanie name*0*, name*1* i dekodowanie). */
export function parsujParametry(s: string): { wartosc: string; parametry: Record<string, string> } {
  const czesci: string[] = []
  let biez = ''
  let wCudz = false
  for (const ch of s) {
    if (ch === '"') wCudz = !wCudz
    if (ch === ';' && !wCudz) { czesci.push(biez); biez = '' } else biez += ch
  }
  czesci.push(biez)
  const wartosc = (czesci.shift() ?? '').trim()
  const surowe: Record<string, string> = {}
  for (const c of czesci) {
    const i = c.indexOf('=')
    if (i < 0) continue
    const k = c.slice(0, i).trim().toLowerCase()
    let v = c.slice(i + 1).trim()
    if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) v = v.slice(1, -1).replace(/\\(.)/g, '$1')
    surowe[k] = v
  }
  // RFC 2231: name*0*=utf-8''ab%20, name*1*=cd → name
  const parametry: Record<string, string> = {}
  const kawalki: Record<string, { i: number; v: string; kod: boolean }[]> = {}
  for (const [k, v] of Object.entries(surowe)) {
    const m = /^([^*]+)\*(\d+)(\*?)$/.exec(k)
    if (m) { (kawalki[m[1]] ??= []).push({ i: Number(m[2]), v, kod: m[3] === '*' }); continue }
    if (k.endsWith('*')) { parametry[k.slice(0, -1)] = dekoduj2231(v); continue }
    parametry[k] ??= dekodujSlowa(v)
  }
  for (const [k, lista] of Object.entries(kawalki)) {
    lista.sort((a, b) => a.i - b.i)
    let zestaw = ''
    let calosc = ''
    for (const kaw of lista) {
      if (kaw.kod) {
        let v = kaw.v
        const m = /^([^']*)'[^']*'(.*)$/.exec(v)
        if (m) { zestaw = m[1] || zestaw; v = m[2] }
        calosc += dekodujProcenty(v, zestaw)
      } else calosc += kaw.v
    }
    parametry[k] = calosc
  }
  return { wartosc, parametry }
}

function dekoduj2231(v: string): string {
  const m = /^([^']*)'[^']*'(.*)$/.exec(v)
  return m ? dekodujProcenty(m[2], m[1]) : v
}

function dekodujProcenty(v: string, zestaw: string): string {
  const bajty: number[] = []
  for (let i = 0; i < v.length; i++) {
    if (v[i] === '%' && /^[0-9A-Fa-f]{2}$/.test(v.slice(i + 1, i + 3))) { bajty.push(parseInt(v.slice(i + 1, i + 3), 16)); i += 2 } else bajty.push(v.charCodeAt(i) & 0xff)
  }
  return dekoder(zestaw).decode(new Uint8Array(bajty))
}

function nazwaZalacznika(cd: Record<string, string>, ct: Record<string, string>): string {
  return (cd['filename'] ?? ct['name'] ?? '').trim()
}

function dekoder(zestaw: string | undefined): TextDecoder {
  const z = (zestaw ?? 'utf-8').toLowerCase().trim()
  try { return new TextDecoder(z === 'us-ascii' || z === 'ascii' || z === '' ? 'utf-8' : z, { fatal: false }) } catch { return new TextDecoder('utf-8', { fatal: false }) }
}

/** Treść części (łańcuch latin1 = bajty) po zdjęciu kodowania transportowego i zestawu znaków. */
export function dekodujTekst(cialoLatin1: string, cte: string, zestaw: string | undefined): string {
  const bajty = dekodujTransport(cialoLatin1, cte)
  return dekoder(zestaw).decode(bajty).replace(/\r\n/g, '\n')
}

function dekodujTransport(s: string, cte: string): Uint8Array {
  if (cte === 'base64') {
    const czysty = s.replace(/[^A-Za-z0-9+/]/g, '')
    const pelny = czysty.slice(0, czysty.length - (czysty.length % 4))   // ucięte ciało: odrzuć niepełną czwórkę
    try {
      const bin = atob(pelny)
      const out = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
      return out
    } catch { return new Uint8Array(0) }
  }
  if (cte === 'quoted-printable') {
    const bez = s.replace(/=\r?\n/g, '')
    const out: number[] = []
    for (let i = 0; i < bez.length; i++) {
      if (bez[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(bez.slice(i + 1, i + 3))) { out.push(parseInt(bez.slice(i + 1, i + 3), 16)); i += 2 } else out.push(bez.charCodeAt(i) & 0xff)
    }
    return new Uint8Array(out)
  }
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff
  return out
}

function rozmiarPoDekodowaniu(s: string, cte: string): number {
  if (cte === 'base64') return Math.floor(s.replace(/[^A-Za-z0-9+/]/g, '').length * 3 / 4)
  return s.length
}

const ENCJE: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', bdquo: '„', rdquo: '”', ldquo: '“', rsquo: '’', lsquo: '‘', copy: '©', reg: '®', deg: '°', sup2: '²', euro: '€', middot: '·', bull: '•', oacute: 'ó', Oacute: 'Ó' }

/** HTML → tekst: bez <style>/<script>/<head>, bloki jako nowe linie, encje rozwinięte, białe znaki uporządkowane. */
export function htmlNaTekst(html: string): string {
  if (!html) return ''
  let s = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(style|script|head|title)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|tr|li|h[1-6]|blockquote|table|section|article|header|footer|pre)\s*>/gi, '\n')
    .replace(/<\s*(li)\b[^>]*>/gi, '• ')
    .replace(/<\s*(td|th)\b[^>]*>/gi, ' ')
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, tekst: string) => {
      const t = tekst.replace(/<[^>]+>/g, '').trim()
      return t && !/^https?:\/\//i.test(t) && /^https?:\/\//i.test(href) ? `${t} (${href})` : t || href
    })
    .replace(/<[^>]+>/g, '')
  s = s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, kod: string) => {
    if (kod[0] === '#') {
      const n = kod[1].toLowerCase() === 'x' ? parseInt(kod.slice(2), 16) : parseInt(kod.slice(1), 10)
      return isFinite(n) && n > 0 ? String.fromCodePoint(n) : m
    }
    return ENCJE[kod] ?? m
  })
  return s.replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

/** Odcina cytowaną historię korespondencji („Dnia … napisał(a):”, „On … wrote:”, „-----Original Message-----”, linie z „>”). */
export function usunCytaty(tekst: string): string {
  const linie = tekst.split('\n')
  let koniec = linie.length
  for (let i = 0; i < linie.length; i++) {
    const l = linie[i].trim()
    if (/^(-{2,}\s*(Original Message|Wiadomość oryginalna|Oryginalna wiadomość|Forwarded message|Przekazana wiadomość)\s*-{2,}|_{10,})$/i.test(l)
      || /^(W dniu|Dnia|On)\b.{5,160}(napisał(a|\(a\))?|wrote|pisze|a écrit):?\s*$/i.test(l)
      || /^(Od|From):\s.+$/i.test(l) && i + 3 < linie.length && /^(Wysłano|Sent|Data|Date|Do|To):/i.test(linie[i + 1].trim())
      || (l.startsWith('>') && linie.slice(i).every((x) => x.trim() === '' || x.trim().startsWith('>')))) {
      koniec = i
      break
    }
  }
  // zlepki typu „W dniu 14.11.2026 o 10:22, Jan <jan@x.pl>\nnapisał(a):” rozbite na dwie linie
  if (koniec === linie.length) {
    for (let i = 0; i + 1 < linie.length; i++) {
      if (/^(W dniu|Dnia|On)\b/i.test(linie[i].trim()) && /^(napisał|wrote|pisze)/i.test(linie[i + 1].trim())) { koniec = i; break }
    }
  }
  const out = linie.slice(0, koniec).join('\n').trim()
  return out || tekst.trim()
}
