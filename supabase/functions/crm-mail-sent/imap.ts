// Minimalny klient IMAP (RFC 3501) do czytania nagłówków maili z jednego folderu.
// Bez zależności i bez odwołań do Deno/Node: połączenie dostaje z zewnątrz (interfejs Polaczenie),
// dzięki czemu ten sam kod działa w Supabase (imap_deno.ts) i w teście lokalnym (imap.test.mjs, Node).
//
// Umie: powitanie, LOGIN, LIST (lista folderów), SELECT/EXAMINE (UIDVALIDITY, UIDNEXT, EXISTS),
// UID FETCH nagłówków (FROM, TO, CC, SUBJECT, DATE, MESSAGE-ID + INTERNALDATE), UID FETCH całej wiadomości
// (pełne nagłówki + ciało z limitem bajtów; rozbiór MIME robi mime.ts), LOGOUT.
// Rozumie literały {N}, nazwy folderów w zmodyfikowanym UTF-7 (np. „Wys&AUI-ane”) i słowa kodowane RFC 2047 w tematach.

export interface Polaczenie {
  /** Czyta porcję bajtów; null = koniec połączenia. */
  czytaj(): Promise<Uint8Array | null>
  pisz(dane: Uint8Array): Promise<void>
  zamknij(): void
}

export type Folder = { nazwa: string; surowa: string; flagi: string[]; separator: string }
export type StanFolderu = { exists: number; uidvalidity: number; uidnext: number }
export type Naglowki = {
  uid: number
  od: string
  do: string
  cc: string
  temat: string
  data: Date | null
  message_id: string
}
/** Cała wiadomość: surowe nagłówki + ciało (może być ucięte do limitu bajtów). */
export type Wiadomosc = {
  uid: number
  naglowki: string
  cialo: Uint8Array
  ucieta: boolean
  rozmiar: number
  internaldate: Date | null
}

type Odpowiedz = { status: 'OK' | 'NO' | 'BAD'; tekst: string; linie: Czesc[][] }
/** Jedna linia odpowiedzi serwera: naprzemiennie tekst i literały. */
type Czesc = { tekst: string } | { literal: Uint8Array }

const enc = new TextEncoder()
const utf8 = new TextDecoder('utf-8', { fatal: false })
/** 1 bajt = 1 znak; nie TextDecoder('latin1'), bo to windows-1252 (psuje 0x80-0x9F). */
function bajtyNaLancuch(b: Uint8Array): string {
  let s = ''
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, Array.from(b.subarray(i, i + 8192)))
  return s
}

export class Imap {
  private p: Polaczenie
  private bufor: Uint8Array = new Uint8Array(0)
  private licznik = 0
  private limitMs: number
  dziennik: string[] = []

  constructor(p: Polaczenie, limitMs = 20_000) {
    this.p = p
    this.limitMs = limitMs
  }

  // ---------------------------------------------------------------- komendy wysokiego poziomu
  async powitanie(): Promise<void> {
    const linia = await this.czytajLinie()
    const t = tekstLinii(linia)
    if (/^\* (OK|PREAUTH)/i.test(t)) return
    throw new Error('Serwer nie przywitał się poprawnie: ' + t.slice(0, 120))
  }

  async login(uzytkownik: string, haslo: string): Promise<void> {
    const r = await this.komenda(`LOGIN ${this.argument(uzytkownik)} ${this.argument(haslo)}`, [uzytkownik, haslo])
    if (r.status !== 'OK') throw new Error('Logowanie odrzucone: ' + r.tekst)
  }

  async foldery(): Promise<Folder[]> {
    const r = await this.komenda('LIST "" "*"')
    if (r.status !== 'OK') throw new Error('LIST: ' + r.tekst)
    const out: Folder[] = []
    for (const linia of r.linie) {
      const tok = tokenizuj(linia)
      // * LIST (\HasNoChildren \Sent) "/" "Sent"
      if (tok.length < 5 || tok[0] !== '*' || String(tok[1]).toUpperCase() !== 'LIST') continue
      const flagi = Array.isArray(tok[2]) ? (tok[2] as Token[]).map(String) : []
      const separator = tok[3] === null ? '' : String(tok[3])
      const surowa = String(tok[4])
      out.push({ nazwa: zUtf7(surowa), surowa, flagi, separator })
    }
    return out
  }

  /** EXAMINE = tylko do odczytu (nie zmienia flagi \Seen przy FETCH BODY.PEEK i tak nie zmienia, ale EXAMINE jest bezpieczniejsze). */
  async wybierz(folder: string): Promise<StanFolderu> {
    const r = await this.komenda(`EXAMINE ${this.argument(naUtf7(folder))}`)
    if (r.status !== 'OK') throw new Error(`Nie można otworzyć folderu „${folder}”: ${r.tekst}`)
    const stan: StanFolderu = { exists: 0, uidvalidity: 0, uidnext: 0 }
    for (const linia of r.linie) {
      const t = tekstLinii(linia)
      let m = /^\* (\d+) EXISTS/i.exec(t)
      if (m) stan.exists = Number(m[1])
      m = /\[UIDVALIDITY (\d+)\]/i.exec(t)
      if (m) stan.uidvalidity = Number(m[1])
      m = /\[UIDNEXT (\d+)\]/i.exec(t)
      if (m) stan.uidnext = Number(m[1])
    }
    const m = /\[UIDNEXT (\d+)\]/i.exec(r.tekst)
    if (m) stan.uidnext = Number(m[1])
    const v = /\[UIDVALIDITY (\d+)\]/i.exec(r.tekst)
    if (v) stan.uidvalidity = Number(v[1])
    if (!stan.uidvalidity) throw new Error('Serwer nie podał UIDVALIDITY folderu')
    return stan
  }

  /** Nagłówki maili o UID ≥ od (serwer dla zakresu „od:*” zawsze zwraca też ostatni mail – filtrujemy). */
  async naglowki(odUid: number, maks = 50): Promise<Naglowki[]> {
    const r = await this.komenda(`UID FETCH ${odUid}:* (UID INTERNALDATE BODY.PEEK[HEADER.FIELDS (FROM TO CC SUBJECT DATE MESSAGE-ID)])`)
    if (r.status !== 'OK') throw new Error('FETCH: ' + r.tekst)
    const out: Naglowki[] = []
    for (const linia of r.linie) {
      const tok = tokenizuj(linia)
      if (tok.length < 4 || tok[0] !== '*' || String(tok[2]).toUpperCase() !== 'FETCH' || !Array.isArray(tok[3])) continue
      const lista = tok[3] as Token[]
      let uid = 0
      let internal = ''
      let naglowki = ''
      for (let i = 0; i < lista.length; i++) {
        const k = String(lista[i]).toUpperCase()
        if (k === 'UID') uid = Number(lista[++i])
        else if (k === 'INTERNALDATE') internal = String(lista[++i])
        else if (k.startsWith('BODY[')) {
          // BODY[HEADER.FIELDS (…)] – tokenizer zwraca "BODY[HEADER.FIELDS" , [lista pól], "]" , wartość
          while (i + 1 < lista.length && String(lista[i]) !== ']') i++
          const w = lista[++i]
          naglowki = w instanceof Uint8Array ? utf8.decode(w) : String(w ?? '')
        }
      }
      if (!uid || uid < odUid) continue
      const h = parsujNaglowki(naglowki)
      out.push({
        uid,
        od: h['from'] ?? '',
        do: h['to'] ?? '',
        cc: h['cc'] ?? '',
        temat: h['subject'] ?? '',
        data: parsujDate(h['date']) ?? parsujInternalDate(internal),
        message_id: (h['message-id'] ?? '').trim(),
      })
    }
    out.sort((a, b) => a.uid - b.uid)
    return out.slice(0, maks)
  }

  /** Jedna wiadomość w całości: pełne nagłówki i ciało (pierwsze `maksBajtow` bajtów). null, gdy UID nie istnieje. */
  async wiadomosc(uid: number, maksBajtow = 300_000): Promise<Wiadomosc | null> {
    const r = await this.komenda(`UID FETCH ${uid} (UID INTERNALDATE RFC822.SIZE BODY.PEEK[HEADER] BODY.PEEK[TEXT]<0.${maksBajtow}>)`)
    if (r.status !== 'OK') throw new Error('FETCH: ' + r.tekst)
    for (const linia of r.linie) {
      const tok = tokenizuj(linia)
      if (tok.length < 4 || tok[0] !== '*' || String(tok[2]).toUpperCase() !== 'FETCH' || !Array.isArray(tok[3])) continue
      const p = polaFetch(tok[3] as Token[])
      if (p.uid !== uid) continue
      const naglowki = jakoTekst(p.sekcje['HEADER'])
      const cialo = jakoBajty(p.sekcje['TEXT'])
      return { uid, naglowki, cialo, ucieta: cialo.length >= maksBajtow, rozmiar: p.rozmiar, internaldate: parsujInternalDate(p.internaldate) }
    }
    return null
  }

  async wyloguj(): Promise<void> {
    try { await this.komenda('LOGOUT') } catch { /* serwer mógł już zamknąć */ }
    try { this.p.zamknij() } catch { /* ignoruj */ }
  }

  // ---------------------------------------------------------------- warstwa protokołu
  /** Wysyła komendę z tagiem i zbiera odpowiedź do linii z tym tagiem. `literaly` = argumenty wysłane jako {N} (czeka na „+”). */
  private async komenda(cmd: string, kandydaciLiteralow: string[] = []): Promise<Odpowiedz> {
    const tag = 'A' + String(++this.licznik).padStart(3, '0')
    // argumenty nie-ASCII idą jako literały: komenda ma w sobie znacznik \u0000N\u0000
    const czesci = cmd.split('\u0000')
    this.dziennik.push('> ' + tag + ' ' + maskuj(cmd, kandydaciLiteralow))
    await this.p.pisz(enc.encode(tag + ' ' + czesci[0] + (czesci.length > 1 ? '' : '\r\n')))
    for (let i = 1; i < czesci.length; i += 2) {
      const bajty = enc.encode(czesci[i])
      await this.p.pisz(enc.encode(`{${bajty.length}}\r\n`))
      const odp = await this.czytajLinie()
      const t = tekstLinii(odp)
      if (!t.startsWith('+')) throw new Error('Serwer nie przyjął literału: ' + t.slice(0, 120))
      await this.p.pisz(bajty)
      await this.p.pisz(enc.encode(czesci[i + 1] + (i + 2 >= czesci.length ? '\r\n' : '')))
    }
    const linie: Czesc[][] = []
    for (;;) {
      const linia = await this.czytajLinie()
      const t = tekstLinii(linia)
      if (t.startsWith(tag + ' ')) {
        const m = /^\S+ (OK|NO|BAD)\b\s*(.*)$/is.exec(t)
        if (!m) throw new Error('Niezrozumiała odpowiedź: ' + t.slice(0, 120))
        this.dziennik.push('< ' + t.slice(0, 200))
        return { status: m[1].toUpperCase() as Odpowiedz['status'], tekst: m[2].trim(), linie }
      }
      if (/^\* BYE/i.test(t)) throw new Error('Serwer zakończył połączenie: ' + t.slice(0, 120))
      linie.push(linia)
    }
  }

  /** Argument komendy: w cudzysłowie, gdy to możliwe; inaczej literał (znaczniki \u0000 obsługuje komenda()). */
  private argument(s: string): string {
    // deno-lint-ignore no-control-regex
    if (/^[\x20-\x7e]*$/.test(s) && !/["\\\r\n]/.test(s)) return `"${s}"`
    return '\u0000' + s + '\u0000'
  }

  /** Czyta jedną logiczną linię odpowiedzi, razem z literałami {N}, które do niej należą. */
  private async czytajLinie(): Promise<Czesc[]> {
    const czesci: Czesc[] = []
    for (;;) {
      const linia = await this.czytajDoCRLF()
      const m = /\{(\d+)\}$/.exec(linia)
      if (!m) {
        czesci.push({ tekst: linia })
        return czesci
      }
      czesci.push({ tekst: linia.slice(0, -m[0].length) })
      czesci.push({ literal: await this.czytajBajty(Number(m[1])) })
    }
  }

  private async czytajDoCRLF(): Promise<string> {
    for (;;) {
      const i = indeksCRLF(this.bufor)
      if (i >= 0) {
        const linia = bajtyNaLancuch(this.bufor.subarray(0, i))
        this.bufor = this.bufor.subarray(i + 2)
        return linia
      }
      await this.dolacz()
    }
  }

  private async czytajBajty(n: number): Promise<Uint8Array> {
    while (this.bufor.length < n) await this.dolacz()
    const out = this.bufor.slice(0, n)
    this.bufor = this.bufor.subarray(n)
    return out
  }

  private async dolacz(): Promise<void> {
    const porcja = await zLimitem(this.p.czytaj(), this.limitMs, 'Serwer poczty nie odpowiada')
    if (!porcja) throw new Error('Serwer poczty zamknął połączenie')
    const nowy = new Uint8Array(this.bufor.length + porcja.length)
    nowy.set(this.bufor)
    nowy.set(porcja, this.bufor.length)
    this.bufor = nowy
  }
}

// ---------------------------------------------------------------- pomocnicze: protokół
type Token = string | null | Uint8Array | Token[]

function tekstLinii(l: Czesc[]): string {
  return l.map((c) => 'tekst' in c ? c.tekst : `{${c.literal.length}}`).join('')
}

/** Rozbija linię odpowiedzi na tokeny: atomy, "ciągi", (listy), NIL → null, literały → Uint8Array. */
function tokenizuj(linia: Czesc[]): Token[] {
  const korzen: Token[] = []
  const stos: Token[][] = [korzen]
  for (const c of linia) {
    if ('literal' in c) { stos[stos.length - 1].push(c.literal); continue }
    const s = c.tekst
    let i = 0
    while (i < s.length) {
      const ch = s[i]
      if (ch === ' ') { i++; continue }
      if (ch === '(' || ch === '[') {
        if (ch === '[') {
          // BODY[HEADER.FIELDS (…)] – trzymamy jako atom "BODY[HEADER.FIELDS", potem lista, potem "]"
          const poprz = stos[stos.length - 1]
          const ost = poprz[poprz.length - 1]
          if (typeof ost === 'string') { poprz[poprz.length - 1] = ost + '['; i++; continue }
        }
        const nowa: Token[] = []
        stos[stos.length - 1].push(nowa)
        stos.push(nowa)
        i++
        continue
      }
      if (ch === ')') { if (stos.length > 1) stos.pop(); i++; continue }
      if (ch === ']') { stos[stos.length - 1].push(']'); i++; continue }
      if (ch === '"') {
        let j = i + 1
        let w = ''
        while (j < s.length && s[j] !== '"') {
          if (s[j] === '\\' && j + 1 < s.length) { w += s[j + 1]; j += 2 } else { w += s[j]; j++ }
        }
        stos[stos.length - 1].push(w)
        i = j + 1
        continue
      }
      let j = i
      while (j < s.length && !' ()[]"'.includes(s[j])) j++
      if (j === i) { i++; continue }
      const atom = s.slice(i, j)
      stos[stos.length - 1].push(atom.toUpperCase() === 'NIL' ? null : atom)
      i = j
    }
  }
  return korzen
}

/** Pola odpowiedzi FETCH: UID, INTERNALDATE, RFC822.SIZE i sekcje BODY[...] (klucz = pierwszy atom sekcji, np. HEADER, TEXT, HEADER.FIELDS). */
function polaFetch(lista: Token[]): { uid: number; internaldate: string; rozmiar: number; sekcje: Record<string, Token> } {
  const out = { uid: 0, internaldate: '', rozmiar: 0, sekcje: {} as Record<string, Token> }
  for (let i = 0; i < lista.length; i++) {
    const k = String(lista[i]).toUpperCase()
    if (k === 'UID') out.uid = Number(lista[++i])
    else if (k === 'INTERNALDATE') out.internaldate = String(lista[++i])
    else if (k === 'RFC822.SIZE') out.rozmiar = Number(lista[++i])
    else if (k.startsWith('BODY[')) {
      // "BODY[" , SEKCJA, [pola], "]", ewentualnie "<0>", wartość
      const sekcja = k.length > 5 ? k.slice(5) : String(lista[++i] ?? '').toUpperCase()
      while (i + 1 < lista.length && String(lista[i]) !== ']') i++
      let w = lista[++i]
      if (typeof w === 'string' && /^<\d+>$/.test(w)) w = lista[++i]
      out.sekcje[sekcja] = w ?? null
    }
  }
  return out
}

function jakoBajty(t: Token | undefined): Uint8Array {
  if (t instanceof Uint8Array) return t
  if (typeof t === 'string') return enc.encode(t)
  return new Uint8Array(0)
}

function jakoTekst(t: Token | undefined): string {
  if (t instanceof Uint8Array) return utf8.decode(t)
  return typeof t === 'string' ? t : ''
}

function indeksCRLF(b: Uint8Array): number {
  for (let i = 0; i + 1 < b.length; i++) if (b[i] === 13 && b[i + 1] === 10) return i
  return -1
}

function zLimitem<T>(p: Promise<T>, ms: number, opis: string): Promise<T> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(opis)), ms)
    p.then((v) => { clearTimeout(t); res(v) }, (e) => { clearTimeout(t); rej(e) })
  })
}

function maskuj(cmd: string, sekrety: string[]): string {
  let s = cmd.replace(/\u0000[^\u0000]*\u0000/g, '{…}')
  for (const sek of sekrety) if (sek) s = s.split(`"${sek}"`).join('"…"')
  return s.slice(0, 200)
}

// ---------------------------------------------------------------- pomocnicze: nagłówki (RFC 5322 / 2047)
export function parsujNaglowki(surowe: string): Record<string, string> {
  const out: Record<string, string> = {}
  const linie = surowe.replace(/\r\n[ \t]+/g, ' ').split(/\r?\n/)
  for (const l of linie) {
    const i = l.indexOf(':')
    if (i <= 0) continue
    const nazwa = l.slice(0, i).trim().toLowerCase()
    const wartosc = dekodujSlowa(l.slice(i + 1).trim())
    out[nazwa] = out[nazwa] ? out[nazwa] + ', ' + wartosc : wartosc
  }
  return out
}

/** =?utf-8?B?…?= / =?iso-8859-2?Q?…?= → tekst. Sąsiednie słowa kodowane łączą się bez spacji (RFC 2047 §6.2). */
export function dekodujSlowa(s: string): string {
  if (!s.includes('=?')) return s
  return s.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=(\s+(?==\?))?/g, (_m, zestaw: string, typ: string, dane: string) => {
    try {
      const bajty = typ.toUpperCase() === 'B' ? zBase64(dane) : zQ(dane)
      const etykieta = zestaw.toLowerCase().replace(/\*.*$/, '')
      return new TextDecoder(etykieta === 'us-ascii' ? 'utf-8' : etykieta, { fatal: false }).decode(bajty)
    } catch {
      return utf8.decode(typ.toUpperCase() === 'B' ? zBase64(dane) : zQ(dane))
    }
  })
}

function zBase64(s: string): Uint8Array {
  const czysty = s.replace(/[^A-Za-z0-9+/=]/g, '')
  const bin = atob(czysty)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function zQ(s: string): Uint8Array {
  const out: number[] = []
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '_') out.push(32)
    else if (ch === '=' && i + 2 < s.length && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) { out.push(parseInt(s.slice(i + 1, i + 3), 16)); i += 2 }
    else out.push(ch.charCodeAt(0) & 0xff)
  }
  return new Uint8Array(out)
}

export function parsujDate(s: string | undefined): Date | null {
  if (!s) return null
  const d = new Date(s.replace(/\s*\([^)]*\)\s*$/, ''))
  return isNaN(d.getTime()) ? null : d
}

/** INTERNALDATE: "14-Nov-2026 10:22:33 +0100" */
export function parsujInternalDate(s: string): Date | null {
  const m = /^\s*(\d{1,2})-([A-Za-z]{3})-(\d{4}) (\d{2}):(\d{2}):(\d{2}) ([+-]\d{4})\s*$/.exec(s)
  if (!m) return null
  const d = new Date(`${m[1]} ${m[2]} ${m[3]} ${m[4]}:${m[5]}:${m[6]} GMT${m[7]}`)
  return isNaN(d.getTime()) ? null : d
}

// ---------------------------------------------------------------- pomocnicze: zmodyfikowany UTF-7 (RFC 3501 §5.1.3)
const B64M = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+,'

export function zUtf7(s: string): string {
  return s.replace(/&([^-]*)-/g, (_m, b: string) => {
    if (b === '') return '&'
    const bity: number[] = []
    for (const ch of b) {
      const v = B64M.indexOf(ch)
      if (v < 0) return _m
      bity.push(v)
    }
    const bajty: number[] = []
    let akum = 0
    let n = 0
    for (const v of bity) {
      akum = (akum << 6) | v
      n += 6
      if (n >= 8) { n -= 8; bajty.push((akum >> n) & 0xff) }
    }
    let out = ''
    for (let i = 0; i + 1 < bajty.length; i += 2) out += String.fromCharCode((bajty[i] << 8) | bajty[i + 1])
    return out
  })
}

export function naUtf7(s: string): string {
  // deno-lint-ignore no-control-regex
  if (/^[\x20-\x7e]*$/.test(s) && !s.includes('&')) return s
  let out = ''
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (ch === '&') { out += '&-'; i++; continue }
    const kod = s.charCodeAt(i)
    if (kod >= 0x20 && kod <= 0x7e) { out += ch; i++; continue }
    const bajty: number[] = []
    while (i < s.length) {
      const k = s.charCodeAt(i)
      if (k >= 0x20 && k <= 0x7e) break
      bajty.push(k >> 8, k & 0xff)
      i++
    }
    let b64 = ''
    let akum = 0
    let n = 0
    for (const b of bajty) {
      akum = (akum << 8) | b
      n += 8
      while (n >= 6) { n -= 6; b64 += B64M[(akum >> n) & 63] }
    }
    if (n > 0) b64 += B64M[(akum << (6 - n)) & 63]
    out += '&' + b64 + '-'
  }
  return out
}
