// Wywołanie Claude API z wymuszonym JSON-em wg schematu (structured outputs), przez zwykły fetch (Deno).
// Odpowiednik klasy AI z oferta/prototyp.py.

export const MODEL = 'claude-opus-5-5'
const CENA_USD_MTOK: [number, number] = [4.0, 20.0]   // wejście / wyjście za milion tokenów (Opus 5.5)
// testy 27.11 (runda 3): limit czasu jednej próby wywołania Claude API (mniej niż limit funkcji Edge)
const LIMIT_AI_MS = 120_000

export type Zuzycie = { input_tokens: number; output_tokens: number; model: string }

export type WynikAI<T> = { dane: T; zuzycie: Zuzycie; koszt_usd: number }

export function kosztUsd(z: Zuzycie): number {
  return (z.input_tokens * CENA_USD_MTOK[0] + z.output_tokens * CENA_USD_MTOK[1]) / 1_000_000
}

export async function claudeJson<T>(system: string, user: string, schema: unknown, effort: 'low' | 'medium' | 'high' = 'high'): Promise<WynikAI<T>> {
  const klucz = Deno.env.get('ANTHROPIC_API_KEY')
  if (!klucz) throw new Error('Brak sekretu ANTHROPIC_API_KEY')
  const naglowki: Record<string, string> = {
    'content-type': 'application/json',
    'x-api-key': klucz,
    'anthropic-version': '2026-10-21',
    'anthropic-beta': 'server-side-fallback-2026-07-01',
  }
  // Klucz użytkownika (sk-ant-usr...) wymaga wskazania workspace'u; klucz workspace'owy (sk-ant-api03...) nie.
  const ws = Deno.env.get('ANTHROPIC_WORKSPACE_ID')
  if (ws) naglowki['anthropic-workspace-id'] = ws

  const body = {
    model: MODEL,
    max_tokens: 8000,
    fallbacks: 'default',
    output_config: { effort, format: { type: 'json_schema', schema } },
    system,
    messages: [{ role: 'user', content: user }],
  }

  let ostatniBlad = ''
  for (let proba = 1; proba <= 3; proba++) {
    let resp: Response
    try {
      resp = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: naglowki, body: JSON.stringify(body), signal: AbortSignal.timeout(LIMIT_AI_MS) })
    } catch (e) {
      // brak odpowiedzi w limicie: bez kolejnych prób (następna przekroczyłaby limit funkcji), ponowi cron ponow_bledy
      if (e instanceof Error && e.name === 'TimeoutError') throw new Error(`Claude API: brak odpowiedzi w ${LIMIT_AI_MS / 1000} s`)
      throw e
    }
    if (resp.status === 429 || resp.status === 529 || resp.status >= 500) {
      ostatniBlad = `Claude API ${resp.status}: ${(await resp.text()).slice(0, 300)}`
      await new Promise((r) => setTimeout(r, 3000 * proba))
      continue
    }
    if (!resp.ok) throw new Error(`Claude API ${resp.status}: ${(await resp.text()).slice(0, 500)}`)
    const j = await resp.json()
    if (j.stop_reason === 'refusal') throw new Error('Model odmówił analizy: ' + JSON.stringify(j.stop_details ?? {}))
    const blok = (j.content as { type: string; text?: string }[]).find((b) => b.type === 'text')
    if (!blok?.text) throw new Error('Claude API: brak bloku tekstowego w odpowiedzi')
    const zuzycie: Zuzycie = { input_tokens: j.usage?.input_tokens ?? 0, output_tokens: j.usage?.output_tokens ?? 0, model: j.model ?? MODEL }
    return { dane: JSON.parse(blok.text) as T, zuzycie, koszt_usd: kosztUsd(zuzycie) }
  }
  throw new Error(ostatniBlad || 'Claude API: nieznany błąd')
}
