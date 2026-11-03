// „Ponów wysyłkę do Optimy" — przekaźnik do webhooka Make (scenariusz zakłada
// RO ponownie na podstawie rekordu Airtable). Adres webhooka NIE siedzi w
// kliencie ani w kodzie: admin wkleja go w Konfiguracja → Integracje
// (integration_settings.erp_retry_webhook_url), funkcja czyta go service_role.
// Wysłać może tylko kierownik (current_user_is_manager), zlecenie musi mieć
// airtable_id i status NIEPOMYŚLNY. Kolumn erp_* NIE ruszamy — zapisze je Make
// przez erp-status, gdy ponowienie się skończy. Każde wysłanie ląduje w audit_log.
import { createClient } from 'npm:@supabase/supabase-js@2'

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

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { data: userData, error: userErr } = await userClient.auth.getUser()
  if (userErr || !userData?.user) return json(401, { error: 'Wymagane zalogowanie' })

  const { data: isManager, error: roleErr } = await userClient.rpc('current_user_is_manager')
  if (roleErr) return json(500, { error: 'Nie sprawdzono uprawnień' })
  if (isManager !== true) return json(403, { error: 'Ponowić wysyłkę do Optimy może kierownik' })

  let body: { order_id?: unknown }
  try {
    body = (await req.json()) as { order_id?: unknown }
  } catch {
    return json(400, { error: 'Nieprawidłowy JSON' })
  }
  const orderId = Number(body.order_id)
  if (!Number.isFinite(orderId) || orderId <= 0) return json(400, { error: 'Brak identyfikatora zlecenia' })

  const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: setting } = await admin
    .from('integration_settings')
    .select('value')
    .eq('key', 'erp_retry_webhook_url')
    .maybeSingle()
  const webhookUrl = String(setting?.value ?? '').trim()
  if (!/^https:\/\//i.test(webhookUrl)) {
    return json(409, {
      error: 'Brak adresu webhooka Make. Administrator wkleja go w Konfiguracja → Integracje („Ponów wysyłkę do Optimy").',
    })
  }

  const { data: order, error: orderErr } = await admin
    .from('orders')
    .select('id, order_number, category, company, airtable_id, erp_status, erp_error')
    .eq('id', orderId)
    .maybeSingle()
  if (orderErr) return json(500, { error: orderErr.message })
  if (!order) return json(404, { error: 'Zlecenie nie istnieje' })
  const airtableId = String(order.airtable_id ?? '').trim()
  if (!airtableId) {
    return json(409, { error: 'To zlecenie nie ma rekordu w Airtable (airtable_id) — nie przyszło z konfiguratora, Optima nie dostanie go automatem.' })
  }
  if (String(order.erp_status ?? '') !== 'NIEPOMYŚLNY') {
    return json(409, { error: `Zlecenie nie ma błędu ERP (status: ${order.erp_status ?? 'brak'}) — nie ma czego ponawiać.` })
  }

  const payload = {
    action: 'erp_retry',
    airtable_id: airtableId,
    order_id: order.id,
    order_number: order.order_number,
    category: order.category,
    company: order.company,
    previous_error: order.erp_error,
    requested_by: userData.user.email ?? userData.user.id,
    requested_at: new Date().toISOString(),
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 10000)
  let status = 0
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    status = res.status
    if (!res.ok) return json(502, { error: `Make odpowiedział ${res.status}` })
  } catch (err) {
    clearTimeout(timeoutId)
    const isTimeout = err instanceof Error && err.name === 'AbortError'
    return json(504, { error: isTimeout ? 'Make nie odpowiedział w 10 s' : String(err) })
  }

  try {
    await admin.from('audit_log').insert({
      table_name: 'orders',
      record_id: String(order.id),
      operation: 'UPDATE',
      user_id: userData.user.id,
      user_email: userData.user.email ?? null,
      new_data: { action: 'erp_retry', order_number: order.order_number, category: order.category, airtable_id: airtableId, make_status: status },
    })
  } catch {
    // audyt nie może zablokować ponowienia
  }

  return json(200, { ok: true })
})
