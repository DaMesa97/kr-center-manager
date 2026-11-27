// Wspólny rysownik dokumentów Po Drzwi na pdf-lib: strony (pion/poziom), nagłówek z logo i tytułem, tekst z odstępem
// między literami (letter-spacing z szablonów HTML), akapity, listy, etykiety sekcji „— TYTUŁ”, linie, ramki.
// Używany przez dokumenty.ts (karta pomiarowa, umowa, protokół). Oferta (crm-oferta-pdf/pdf.ts) ma własne, równoważne helpery;
// zawijaj() i fmt() są tu skopiowane z tamtej funkcji (funkcje Edge nie dzielą plików).

import { PDFDocument, rgb, type PDFFont, type PDFPage, type PDFImage } from 'https://esm.sh/pdf-lib@1.17.1'
import fontkit from 'https://esm.sh/@pdf-lib/fontkit@1.1.1'

export type Czcionki = { light: Uint8Array; regular: Uint8Array; medium: Uint8Array; semibold: Uint8Array }

/** Łamanie tekstu do szerokości (po spacjach; bardzo długie słowa dzielone na siłę). Kopia z crm-oferta-pdf/pdf.ts. */
export function zawijaj(font: PDFFont, size: number, s: string, maxW: number): string[] {
  const out: string[] = []
  for (const para of String(s ?? '').replace(/\r/g, '').split('\n')) {
    const slowa = para.split(/\s+/).filter(Boolean)
    let linia = ''
    for (let w of slowa) {
      while (font.widthOfTextAtSize(w, size) > maxW) {
        let i = w.length
        while (i > 1 && font.widthOfTextAtSize(w.slice(0, i), size) > maxW) i--
        if (linia) { out.push(linia); linia = '' }
        out.push(w.slice(0, i))
        w = w.slice(i)
      }
      const proba = linia ? `${linia} ${w}` : w
      if (font.widthOfTextAtSize(proba, size) <= maxW) linia = proba
      else { if (linia) out.push(linia); linia = w }
    }
    out.push(linia)
  }
  return out.length ? out : ['']
}
/** 5310 → "5 310,00" (kopia z crm-oferta-pdf/vat.ts). */
export function fmt(x: number): string {
  const s = (Math.round((x + Number.EPSILON) * 100) / 100).toFixed(2)
  const [c, d] = s.split('.')
  const znak = c.startsWith('-') ? '-' : ''
  const cyfry = c.replace('-', '')
  let out = ''
  for (let i = 0; i < cyfry.length; i++) {
    if (i > 0 && (cyfry.length - i) % 3 === 0) out += ' '
    out += cyfry[i]
  }
  return `${znak}${out},${d}`
}

export const mm = (n: number) => n * 2.8346
export const px = (n: number) => n * 0.75
export type Kolor = ReturnType<typeof rgb>
export const K = {
  ink: rgb(0.067, 0.067, 0.067), bialy: rgb(1, 1, 1),
  g22: rgb(0.133, 0.133, 0.133), g33: rgb(0.2, 0.2, 0.2), g44: rgb(0.27, 0.27, 0.27), g55: rgb(0.33, 0.33, 0.33),
  g6b: rgb(0.42, 0.42, 0.42), g88: rgb(0.53, 0.53, 0.53), g8a: rgb(0.54, 0.54, 0.54), g9a: rgb(0.6, 0.6, 0.6),
  gb0: rgb(0.69, 0.69, 0.69), gb9: rgb(0.725, 0.725, 0.725), gc9: rgb(0.79, 0.79, 0.79), gd6: rgb(0.84, 0.84, 0.84),
  gd9: rgb(0.85, 0.85, 0.85), gdc: rgb(0.86, 0.86, 0.86), ge0: rgb(0.88, 0.88, 0.88), ge2: rgb(0.886, 0.886, 0.886),
  ge8: rgb(0.91, 0.91, 0.91), gf6: rgb(0.965, 0.965, 0.965), gfa: rgb(0.98, 0.98, 0.98),
}
export type Logo = { bajty: Uint8Array; typ: 'png' | 'jpg' } | null
export type Segment = { t: string; f?: PDFFont; c?: Kolor }   // kawałek tekstu w jednej linii z własną czcionką/kolorem

export class Rysownik {
  doc!: PDFDocument
  L!: PDFFont; R!: PDFFont; M!: PDFFont; SB!: PDFFont
  logo: PDFImage | null = null
  strony: PDFPage[] = []
  page!: PDFPage
  y = 0
  szerStrony = 595.28; wysStrony = 841.89
  ML = mm(15); MR = mm(15); MT = mm(14); MB = mm(11)
  get W() { return this.szerStrony - this.ML - this.MR }
  get X2() { return this.szerStrony - this.MR }

  static async utworz(cz: Czcionki, logo: Logo, o: { poziom?: boolean; marginesy?: { g: number; d: number; l: number; p: number } }): Promise<Rysownik> {
    const r = new Rysownik()
    r.doc = await PDFDocument.create()
    r.doc.registerFontkit(fontkit)
    r.L = await r.doc.embedFont(cz.light, { subset: true })
    r.R = await r.doc.embedFont(cz.regular, { subset: true })
    r.M = await r.doc.embedFont(cz.medium, { subset: true })
    r.SB = await r.doc.embedFont(cz.semibold, { subset: true })
    if (logo) { try { r.logo = logo.typ === 'png' ? await r.doc.embedPng(logo.bajty) : await r.doc.embedJpg(logo.bajty) } catch { r.logo = null } }
    if (o.poziom) { r.szerStrony = 841.89; r.wysStrony = 595.28 }
    if (o.marginesy) { r.MT = o.marginesy.g; r.MB = o.marginesy.d; r.ML = o.marginesy.l; r.MR = o.marginesy.p }
    r.nowaStrona()
    return r
  }

  nowaStrona(): PDFPage {
    this.page = this.doc.addPage([this.szerStrony, this.wysStrony])
    this.strony.push(this.page)
    this.y = this.wysStrony - this.MT
    return this.page
  }
  /** Gdy brakuje h punktów do dolnego marginesu: nowa strona (i opcjonalnie nagłówek na niej). */
  miejsce(h: number, naNowej?: () => void): boolean {
    if (this.y - h < this.MB) { this.nowaStrona(); naNowej?.(); return true }
    return false
  }

  // ---------------------------------------------------------------- tekst
  szer(s: string, size: number, font: PDFFont, ls = 0): number {
    return font.widthOfTextAtSize(s, size) + (s.length > 1 ? ls * (s.length - 1) : 0)
  }
  tx(s: string, x: number, base: number, size: number, font: PDFFont, color: Kolor = K.ink, ls = 0) {
    if (!s) return
    if (!ls) { this.page.drawText(s, { x, y: base, size, font, color }); return }
    let xx = x
    for (const ch of s) { this.page.drawText(ch, { x: xx, y: base, size, font, color }); xx += font.widthOfTextAtSize(ch, size) + ls }
  }
  txR(s: string, xPrawy: number, base: number, size: number, font: PDFFont, color: Kolor = K.ink, ls = 0) { this.tx(s, xPrawy - this.szer(s, size, font, ls), base, size, font, color, ls) }
  txC(s: string, xSrodek: number, base: number, size: number, font: PDFFont, color: Kolor = K.ink, ls = 0) { this.tx(s, xSrodek - this.szer(s, size, font, ls) / 2, base, size, font, color, ls) }
  /** Linia bazowa dla wiersza o wysokości lh z górną krawędzią w yTop (Poppins: descender ≈ 0,23 em). */
  baza(yTop: number, size: number, lh: number) { return yTop - lh + (lh - size) / 2 + 0.23 * size }

  /** Akapit od this.y w dół (łamanie po słowach); przesuwa this.y; zwraca wysokość. */
  akapit(s: string, x: number, maxW: number, size: number, font: PDFFont, color: Kolor = K.ink, lh = size * 1.6, dol = 0): number {
    const linie = zawijaj(font, size, s, maxW)
    for (const l of linie) {
      this.miejsce(lh)
      this.tx(l, x, this.baza(this.y, size, lh), size, font, color)
      this.y -= lh
    }
    this.y -= dol
    return linie.length * lh + dol
  }
  /** Akapit z segmentami o różnych czcionkach (np. pogrubiona kwota w zdaniu); łamanie po słowach. */
  akapitSeg(segs: Segment[], x: number, maxW: number, size: number, domyslna: PDFFont, color: Kolor = K.ink, lh = size * 1.6, dol = 0): number {
    type Slowo = { t: string; f: PDFFont; c: Kolor }
    const slowa: Slowo[] = []
    for (const s of segs) {
      const f = s.f ?? domyslna, c = s.c ?? color
      const czesci = s.t.split(/(\s+)/)
      for (const cz of czesci) if (cz) slowa.push({ t: cz, f, c })
    }
    const spacja = (f: PDFFont) => f.widthOfTextAtSize(' ', size)
    let linia: Slowo[] = [], szerL = 0, wys = 0
    const wypisz = () => {
      this.miejsce(lh)
      let xx = x
      const b = this.baza(this.y, size, lh)
      for (const w of linia) { this.tx(w.t, xx, b, size, w.f, w.c); xx += w.f.widthOfTextAtSize(w.t, size) }
      this.y -= lh; wys += lh; linia = []; szerL = 0
    }
    for (const w of slowa) {
      if (/^\s+$/.test(w.t)) { if (linia.length) { linia.push({ ...w, t: ' ' }); szerL += spacja(w.f) } ; continue }
      const sw = w.f.widthOfTextAtSize(w.t, size)
      if (linia.length && szerL + sw > maxW) { while (linia.length && linia[linia.length - 1].t === ' ') linia.pop(); wypisz() }
      linia.push(w); szerL += sw
    }
    if (linia.length) wypisz()
    this.y -= dol
    return wys + dol
  }
  /** Lista numerowana: „1.” / „a.” z wcięciem; każdy punkt to akapit (z segmentami). */
  lista(punkty: (string | Segment[])[], x: number, maxW: number, size: number, font: PDFFont, o: { litery?: boolean; wciecie?: number; lh?: number; odstep?: number; start?: number } = {}) {
    const wc = o.wciecie ?? px(16), lh = o.lh ?? size * 1.6, odstep = o.odstep ?? px(4)
    punkty.forEach((p, i) => {
      const nr = (o.litery ? String.fromCharCode(97 + i + (o.start ?? 0)) : String(i + 1 + (o.start ?? 0))) + '.'
      this.miejsce(lh)
      this.tx(nr, x, this.baza(this.y, size, lh), size, font)
      if (typeof p === 'string') this.akapit(p, x + wc, maxW - wc, size, font, K.ink, lh, odstep)
      else this.akapitSeg(p, x + wc, maxW - wc, size, font, K.ink, lh, odstep)
    })
  }
  /** Etykieta sekcji „— TYTUŁ” (.lbl). */
  etykieta(s: string, x: number, o: { size?: number; ls?: number; gora?: number; dol?: number; color?: Kolor } = {}) {
    const size = o.size ?? 6.9, lh = size * 1.5
    this.y -= o.gora ?? px(12)
    this.miejsce(lh)
    const b = this.baza(this.y, size, lh)
    this.page.drawRectangle({ x, y: b + size * 0.3 - 0.75, width: px(11), height: px(2), color: K.ink })
    this.tx(s.toUpperCase(), x + px(11) + px(7), b, size, this.SB, o.color ?? K.ink, o.ls ?? px(1.9))
    this.y -= lh + (o.dol ?? px(6))
  }
  /** Nagłówek h2 umowy/protokołu: tekst + kreska pod spodem. */
  h2(s: string, x: number, w: number, o: { size?: number; gora?: number; dol?: number } = {}) {
    const size = o.size ?? 8, lh = size * 1.6
    this.y -= o.gora ?? px(17)
    this.miejsce(lh + px(3) + 40)   // nagłówek razem z początkiem treści
    this.tx(s.toUpperCase(), x, this.baza(this.y, size, lh), size, this.SB, K.ink, px(1.6))
    this.y -= lh + px(3)
    this.linia(x, this.y, w, 0.75, K.ink)
    this.y -= o.dol ?? px(5)
  }

  // ---------------------------------------------------------------- kształty
  linia(x: number, y: number, w: number, grubosc = 0.75, color: Kolor = K.ink) {
    this.page.drawLine({ start: { x, y }, end: { x: x + w, y }, thickness: grubosc, color })
  }
  liniaPion(x: number, y1: number, y2: number, grubosc = 0.75, color: Kolor = K.ink) {
    this.page.drawLine({ start: { x, y: y1 }, end: { x, y: y2 }, thickness: grubosc, color })
  }
  prostokat(x: number, y: number, w: number, h: number, o: { wypelnienie?: Kolor; ramka?: Kolor; grubosc?: number }) {
    this.page.drawRectangle({ x, y, width: w, height: h, color: o.wypelnienie, borderColor: o.ramka, borderWidth: o.ramka ? (o.grubosc ?? 0.75) : 0 })
  }
  /** Kwadracik do odhaczenia (checkbox) + tekst; zwraca wysokość wiersza. */
  checkbox(x: number, yTop: number, bok: number, tekst: string, size: number, font: PDFFont, o: { dopisek?: string; dopisekSize?: number; grubosc?: number; lh?: number } = {}): number {
    const lh = o.lh ?? size * 1.45 + px(8)
    const yb = yTop - lh / 2 - bok / 2
    this.prostokat(x, yb, bok, bok, { ramka: K.ink, grubosc: o.grubosc ?? 1 })
    const b = this.baza(yTop, size, lh)
    this.tx(tekst, x + bok + mm(2.5), b, size, font)
    if (o.dopisek) this.tx(o.dopisek, x + bok + mm(2.5) + font.widthOfTextAtSize(tekst, size) + mm(1.4), b, o.dopisekSize ?? size * 0.85, this.R, K.g55)
    return lh
  }

  // ---------------------------------------------------------------- nagłówek strony (.top) i stopka (.foot)
  /** Logo po lewej, tytuł (1–2 linie) i podtytuł po prawej, wyrównane dołem; gruba kreska. */
  naglowek(o: { tytul: string[]; sub?: Segment[]; logoH?: number; tytulSize?: number; subSize?: number; subColor?: Kolor; nazwaFirmy?: string; tytulLs?: number; subLs?: number; subBold?: boolean }) {
    const logoH = o.logoH ?? mm(12), ts = o.tytulSize ?? 11.5, ss = o.subSize ?? 9.5
    const tLh = ts * 1.25
    const blokH = Math.max(logoH, o.tytul.length * tLh + (o.sub ? px(3) + ss * 1.2 : 0))
    const top = this.y
    if (this.logo) {
      const w = Math.min((this.logo.width / this.logo.height) * logoH, mm(60))
      this.page.drawImage(this.logo, { x: this.ML, y: top - blokH, width: w, height: logoH })
    } else {
      this.tx(o.nazwaFirmy ?? 'Po Drzwi Sp. z o.o.', this.ML, top - blokH + 8, 15, this.SB)
    }
    // tytuł od dołu bloku: sub na samym dole, nad nim linie tytułu
    let yy = top - blokH
    if (o.sub) {
      const b = yy + ss * 0.23
      let xx = this.X2
      for (const s of [...o.sub].reverse()) { const f = s.f ?? (o.subBold ? this.SB : this.R); const w = this.szer(s.t, ss, f, o.subLs ?? px(0.6)); xx -= w; this.tx(s.t, xx, b, ss, f, s.c ?? (o.subColor ?? K.ink), o.subLs ?? px(0.6)) }
      yy += ss * 1.2 + px(3)
    }
    for (let i = o.tytul.length - 1; i >= 0; i--) {
      this.txR(o.tytul[i], this.X2, yy + ts * 0.23, ts, this.SB, K.ink, o.tytulLs ?? px(2))
      yy += tLh
    }
    this.y = top - blokH - px(10)
    this.prostokat(this.ML, this.y - px(3), this.W, px(3), { wypelnienie: K.ink })
    this.y -= px(3)
  }
  /** Stopka w nurcie dokumentu: kreska + drobny tekst (łamany). */
  stopka(tekst: string, o: { size?: number; color?: Kolor; gora?: number; kreska?: Kolor; lh?: number; font?: PDFFont; pad?: number } = {}) {
    const size = o.size ?? 6.9, font = o.font ?? this.L, pad = o.pad ?? px(7)
    this.y -= o.gora ?? px(14)
    const h = zawijaj(font, size, tekst, this.W).length * (o.lh ?? size * 1.55) + pad
    this.miejsce(h)
    this.linia(this.ML, this.y, this.W, 0.75, o.kreska ?? K.ink)
    this.y -= pad
    this.akapit(tekst, this.ML, this.W, size, font, o.color ?? K.g6b, o.lh ?? size * 1.55)
  }

  /** Dołącza strony innego PDF (załącznik) i stempluje każdą podpisem u dołu. */
  async dolaczPdf(bajty: Uint8Array, stempel: string | null) {
    const src = await PDFDocument.load(bajty, { ignoreEncryption: true })
    const strony = await this.doc.copyPages(src, src.getPageIndices())
    for (const p of strony) {
      this.doc.addPage(p)
      this.strony.push(p)
      if (stempel) {
        const { width } = p.getSize()
        const s = 7.5
        p.drawText(stempel, { x: (width - this.R.widthOfTextAtSize(stempel, s)) / 2, y: mm(8), size: s, font: this.R, color: K.g44 })
      }
    }
  }

  async zapisz(): Promise<Uint8Array> { return await this.doc.save() }
}
