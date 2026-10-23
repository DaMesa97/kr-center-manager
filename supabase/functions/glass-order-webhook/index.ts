// Przekaźnik zamówień szyb do Make.
// Po co: URL webhooka Make był zaszyty w kliencie (każdy z binarką apki mógł
// go wyciągnąć i strzelać zamówieniami szyb bez logowania). Teraz URL żyje
// tylko tutaj, a funkcja wymaga ZALOGOWANEGO użytkownika (auth.getUser),
// nie samego anon key (verify_jwt przepuszcza też anon).
// v2 (23.10): zamawiać szyby może tylko kierownik — ta sama reguła co RLS
// (current_user_is_manager); wcześniej wystarczało dowolne konto.
import { createClient } from 'npm:@supabase/supabase-js@2'

const MAKE_WEBHOOK_URL = 'https://hook.eu2.make.com/tzy1k1wrzpkbwv32sa57sprtkv5vnogx'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

  // Tylko zalogowany użytkownik aplikacji
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
  )
  const { data: userData, error: userErr } = await supabase.auth.getUser()
  if (userErr || !userData?.user) return json(401, { error: 'Wymagane zalogowanie' })

  // Tylko kierownik (jak w RLS zleceń) — inaczej szyba wychodzi do szklarza,
  // a stempel daty i tak zostałby odrzucony
  const { data: isManager, error: roleErr } = await supabase.rpc('current_user_is_manager')
  if (roleErr) return json(500, { ok: false, error: 'Nie sprawdzono uprawnień' })
  if (isManager !== true) return json(403, { ok: false, error: 'Szyby zamawia kierownik' })

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return json(400, { error: 'Nieprawidłowy JSON' })
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 10000)
  try {
    const res = await fetch(MAKE_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    if (!res.ok) return json(502, { ok: false, status: res.status })
    return json(200, { ok: true })
  } catch (err) {
    clearTimeout(timeoutId)
    const isTimeout = err instanceof Error && err.name === 'AbortError'
    return json(504, { ok: false, error: isTimeout ? 'Timeout Make.com (10s)' : String(err) })
  }
})
