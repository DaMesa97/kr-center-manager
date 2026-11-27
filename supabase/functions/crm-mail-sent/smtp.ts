// Minimalny klient SMTP do wysyłania alertów systemowych (bez zależności, Deno).
// Port 465: od razu TLS. Inny port (zwykle 587): zwykłe połączenie + STARTTLS. Logowanie AUTH PLAIN (awaryjnie AUTH LOGIN).
// Używany tylko do maili od systemu do Tymoteusza (alerty o błędach), NIE do maili do klientów (te wysyła człowiek).

const enc = new TextEncoder()
const dec = new TextDecoder()

export type ListAlertu = { od: string; do: string[]; temat: string; tresc: string }

export async function wyslijSmtp(host: string, port: number, login: string, haslo: string, list: ListAlertu, limitMs = 20_000): Promise<string> {
  let conn: Deno.Conn
  if (port === 465) {
    conn = await zLimitem(Deno.connectTls({ hostname: host, port }), limitMs, host, port)
  } else {
    const surowe = await zLimitem(Deno.connect({ hostname: host, port }), limitMs, host, port)
    const czytnik = new Czytnik(surowe, limitMs)
    await czytnik.oczekuj('220')
    await surowe.write(enc.encode(`EHLO crm.podrzwi.pl\r\n`))
    await czytnik.oczekuj('250')
    await surowe.write(enc.encode('STARTTLS\r\n'))
    await czytnik.oczekuj('220')
    conn = await zLimitem(Deno.startTls(surowe, { hostname: host }), limitMs, host, port)
  }
  const c = new Czytnik(conn, limitMs)
  try {
    if (port === 465) await c.oczekuj('220')
    await c.komenda('EHLO crm.podrzwi.pl', '250')
    const plain = btoa(`\0${login}\0${haslo}`)
    const auth = await c.komenda(`AUTH PLAIN ${plain}`, null)
    if (!auth.startsWith('235')) {
      // niektóre serwery wolą AUTH LOGIN
      await c.komenda('AUTH LOGIN', '334')
      await c.komenda(btoa(login), '334')
      const r = await c.komenda(btoa(haslo), null)
      if (!r.startsWith('235')) throw new Error('Logowanie SMTP odrzucone: ' + r.slice(0, 120))
    }
    await c.komenda(`MAIL FROM:<${list.od}>`, '250')
    for (const adres of list.do) await c.komenda(`RCPT TO:<${adres}>`, '250')
    await c.komenda('DATA', '354')
    const id = await c.komenda(zlozWiadomosc(list) + '\r\n.', '250')
    await c.komenda('QUIT', null)
    return id.trim()
  } finally {
    try { conn.close() } catch { /* już zamknięte */ }
  }
}

function zlozWiadomosc(l: ListAlertu): string {
  const data = new Date().toUTCString().replace('GMT', '+0000')
  const msgId = `<alert-${Date.now()}-${Math.random().toString(36).slice(2, 10)}@${l.od.split('@')[1] ?? 'crm'}>`
  const tresc = base64Linie(enc.encode(l.tresc.replace(/\r?\n/g, '\r\n')))
  return [
    `From: CRM Po Drzwi <${l.od}>`,
    `To: ${l.do.join(', ')}`,
    `Subject: ${kodujNaglowek(l.temat)}`,
    `Date: ${data}`,
    `Message-ID: ${msgId}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    'X-PoDrzwi-CRM: alert',
    '',
    tresc,
  ].join('\r\n').replace(/\r\n\.(?=\r\n|$)/g, '\r\n..')   // dot-stuffing: linia z samą kropką kończyłaby wiadomość
}

function kodujNaglowek(s: string): string {
  // deno-lint-ignore no-control-regex
  if (/^[\x20-\x7e]*$/.test(s)) return s
  return `=?UTF-8?B?${base64(enc.encode(s))}?=`
}

function base64(b: Uint8Array): string {
  let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return btoa(s)
}

function base64Linie(b: Uint8Array): string {
  const s = base64(b)
  const linie: string[] = []
  for (let i = 0; i < s.length; i += 76) linie.push(s.slice(i, i + 76))
  return linie.join('\r\n')
}

class Czytnik {
  private bufor = ''
  private b = new Uint8Array(8192)
  constructor(private conn: Deno.Conn, private limitMs: number) {}

  /** Czyta pełną odpowiedź SMTP (ostatnia linia ma spację po kodzie: "250 ..."). Zwraca całość. */
  async odpowiedz(): Promise<string> {
    for (;;) {
      const m = this.bufor.match(/^(\d{3})([ -])(.*)\r\n/m)
      if (m) {
        const idx = this.bufor.indexOf('\r\n')
        const linia = this.bufor.slice(0, idx)
        this.bufor = this.bufor.slice(idx + 2)
        if (linia[3] === ' ' || linia.length === 3) return linia
        continue   // linia wieloliniowej odpowiedzi ("250-...") – czytaj dalej
      }
      const n = await zLimitem(this.conn.read(this.b), this.limitMs, '', 0)
      if (n === null) throw new Error('Serwer SMTP zamknął połączenie')
      this.bufor += dec.decode(this.b.subarray(0, n))
      if (this.bufor.length > 65536) throw new Error('Za długa odpowiedź serwera SMTP')
    }
  }
  async oczekuj(kod: string): Promise<string> {
    const r = await this.odpowiedz()
    if (!r.startsWith(kod)) throw new Error(`SMTP oczekiwano ${kod}, dostano: ${r.slice(0, 160)}`)
    return r
  }
  async komenda(tekst: string, kod: string | null): Promise<string> {
    const dane = enc.encode(tekst + '\r\n')
    let i = 0
    while (i < dane.length) i += await this.conn.write(dane.subarray(i))
    const r = await this.odpowiedz()
    if (kod && !r.startsWith(kod)) throw new Error(`SMTP „${tekst.slice(0, 20)}”: oczekiwano ${kod}, dostano: ${r.slice(0, 160)}`)
    return r
  }
}

function zLimitem<T>(p: Promise<T>, ms: number, host: string, port: number): Promise<T> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(host ? `Brak połączenia SMTP z ${host}:${port} w ${ms / 1000} s` : 'Serwer SMTP nie odpowiada')), ms)
    p.then((v) => { clearTimeout(t); res(v) }, (e) => { clearTimeout(t); rej(e) })
  })
}
