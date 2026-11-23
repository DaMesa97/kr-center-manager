// Pobranie nagrania z Ringostatu i transkrypcja w ElevenLabs Scribe (polski, z rozróżnieniem mówców).
// Nagrania NIE kopiujemy do naszej bazy (RODO): trzymamy tylko link i tekst.

const CZEKAJ_MS = 15_000
const PROBY = 3

export async function pobierzNagranie(url: string): Promise<Blob> {
  let ostatni = ''
  for (let i = 1; i <= PROBY; i++) {
    try {
      const r = await fetch(url, { redirect: 'follow' })
      if (r.ok) {
        const blob = await r.blob()
        if (blob.size > 1000) return blob
        ostatni = `plik ma tylko ${blob.size} B`
      } else {
        ostatni = `HTTP ${r.status}`
      }
    } catch (e) {
      ostatni = e instanceof Error ? e.message : String(e)
    }
    // nagranie bywa dostępne z opóźnieniem po zakończeniu rozmowy
    if (i < PROBY) await new Promise((res) => setTimeout(res, CZEKAJ_MS))
  }
  throw new Error(`Nie udało się pobrać nagrania (${ostatni})`)
}

type Slowo = { text: string; type: string; speaker_id?: string; start?: number }

export type Transkrypcja = { tekst: string; jezyk: string | null; mowcy: number }

export async function transkrybuj(nagranie: Blob, nazwaPliku = 'nagranie.wav', mowcy = 2): Promise<Transkrypcja> {
  const klucz = Deno.env.get('ELEVENLABS_API_KEY')
  if (!klucz) throw new Error('Brak sekretu ELEVENLABS_API_KEY')
  const model = Deno.env.get('ELEVENLABS_STT_MODEL') ?? 'scribe_v2'

  const form = new FormData()
  form.append('file', nagranie, nazwaPliku)
  form.append('model_id', model)
  form.append('language_code', 'pol')
  form.append('diarize', mowcy > 1 ? 'true' : 'false')
  form.append('num_speakers', String(Math.max(1, mowcy)))
  form.append('tag_audio_events', 'false')
  form.append('timestamps_granularity', 'word')

  const r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': klucz }, body: form })
  if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${(await r.text()).slice(0, 500)}`)
  const j = await r.json()
  const slowa: Slowo[] = Array.isArray(j.words) ? j.words : []
  const tekst = mowcy > 1 ? (zlozWypowiedzi(slowa) || String(j.text ?? '').trim()) : String(j.text ?? '').trim()
  return { tekst, jezyk: j.language_code ?? null, mowcy: new Set(slowa.map((s) => s.speaker_id)).size }
}

// Słowa z speaker_id → linie „Mówca 1: ...”, nowa linia przy zmianie mówcy.
export function zlozWypowiedzi(slowa: Slowo[]): string {
  const linie: string[] = []
  let obecny: string | undefined
  let bufor = ''
  const numer = new Map<string, number>()
  for (const s of slowa) {
    if (s.type === 'audio_event') continue
    if (s.speaker_id !== obecny && s.type !== 'spacing') {
      if (bufor.trim()) linie.push(`${etykieta(obecny, numer)}: ${bufor.trim()}`)
      bufor = ''
      obecny = s.speaker_id
    }
    bufor += s.text
  }
  if (bufor.trim()) linie.push(`${etykieta(obecny, numer)}: ${bufor.trim()}`)
  return linie.join('\n')
}

function etykieta(id: string | undefined, numer: Map<string, number>): string {
  const k = id ?? 'x'
  if (!numer.has(k)) numer.set(k, numer.size + 1)
  return `Mówca ${numer.get(k)}`
}
