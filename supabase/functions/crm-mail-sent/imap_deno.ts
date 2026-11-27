// Połączenie dla klienta IMAP w środowisku Deno (Supabase Edge Functions).
// Port 993: od razu TLS. Inny port (zwykle 143): zwykłe połączenie + komenda STARTTLS, potem TLS.
// Jeśli na porcie 993 serwer odpowie zwykłym tekstem (typowy objaw: „corrupt message of type InvalidContentType”),
// zgłaszamy zrozumiały komunikat o porcie.
import type { Polaczenie } from './imap.ts'

const enc = new TextEncoder()
const dec = new TextDecoder('latin1')

export async function polaczTls(host: string, port: number, limitMs = 15_000): Promise<Polaczenie> {
  if (port === 993) {
    const conn = await zLimitem(Deno.connectTls({ hostname: host, port }), limitMs, host, port)
    return opakuj(conn, null, host, port)
  }
  // STARTTLS: łączymy się bez szyfrowania, czekamy na powitanie, prosimy o TLS, a powitanie oddajemy klientowi jako pierwszą porcję.
  const surowe = await zLimitem(Deno.connect({ hostname: host, port }), limitMs, host, port)
  const powitanie = await czytajLinie(surowe, limitMs)
  if (!/^\* (OK|PREAUTH)/i.test(powitanie)) { surowe.close(); throw new Error(`Serwer ${host}:${port} nie przywitał się jak serwer IMAP: ${powitanie.slice(0, 100)}`) }
  await surowe.write(enc.encode('S001 STARTTLS\r\n'))
  for (;;) {
    const l = await czytajLinie(surowe, limitMs)
    if (/^S001 OK/i.test(l)) break
    if (/^S001 (NO|BAD)/i.test(l)) { surowe.close(); throw new Error(`Serwer ${host}:${port} nie obsługuje STARTTLS (${l.slice(0, 100)}). Użyj portu 993.`) }
  }
  const conn = await zLimitem(Deno.startTls(surowe, { hostname: host }), limitMs, host, port)
  return opakuj(conn, enc.encode(powitanie + '\r\n'), host, port)
}

function opakuj(conn: Deno.Conn, pierwsza: Uint8Array | null, host: string, port: number): Polaczenie {
  const bufor = new Uint8Array(64 * 1024)
  let oddane = pierwsza === null
  return {
    async czytaj() {
      if (!oddane) { oddane = true; return pierwsza }
      try {
        const n = await conn.read(bufor)
        return n === null ? null : bufor.slice(0, n)
      } catch (e) { throw ladniejszyBlad(e, host, port) }
    },
    async pisz(dane) {
      try {
        let i = 0
        while (i < dane.length) i += await conn.write(dane.subarray(i))
      } catch (e) { throw ladniejszyBlad(e, host, port) }
    },
    zamknij() { try { conn.close() } catch { /* już zamknięte */ } },
  }
}

/** Czyta jedną linię (do CRLF) z niezaszyfrowanego połączenia; używane tylko przed STARTTLS. */
async function czytajLinie(conn: Deno.Conn, limitMs: number): Promise<string> {
  let tekst = ''
  const b = new Uint8Array(4096)
  while (!tekst.includes('\r\n')) {
    const n = await zLimitem(conn.read(b), limitMs, '', 0)
    if (n === null) throw new Error('Serwer zamknął połączenie przed STARTTLS')
    tekst += dec.decode(b.subarray(0, n))
    if (tekst.length > 65536) throw new Error('Za długie powitanie serwera')
  }
  return tekst.slice(0, tekst.indexOf('\r\n'))
}

function ladniejszyBlad(e: unknown, host: string, port: number): Error {
  const msg = e instanceof Error ? e.message : String(e)
  if (/InvalidContentType|corrupt message|handshake|record overflow/i.test(msg)) {
    return new Error(`Serwer ${host} na porcie ${port} nie odpowiada szyfrowaniem TLS (${msg}). Sprawdź port: 993 to SSL/TLS, 143 to STARTTLS.`)
  }
  return e instanceof Error ? e : new Error(msg)
}

function zLimitem<T>(p: Promise<T>, ms: number, host: string, port: number): Promise<T> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(host ? `Brak połączenia z ${host}:${port} w ${ms / 1000} s` : 'Serwer poczty nie odpowiada')), ms)
    p.then((v) => { clearTimeout(t); res(v) }, (e) => { clearTimeout(t); rej(host ? ladniejszyBlad(e, host, port) : e) })
  })
}
