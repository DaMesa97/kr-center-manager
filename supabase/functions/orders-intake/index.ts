import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0'

// Helper: bezpieczny JSON parse
const safeJsonParse = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

// Puste etapy dla kategorii (zgodne z createEmptyProductionStages w aplikacji)
export const emptyStagesFor = (category: string): Record<string, string> => {
  // Mirrory Disting Plus są ASYMETRYCZNE (spójnie z aplikacją):
  // STA trzyma dist_* (podgląd ościeżnicy), Disting trzyma sta_e3/sta_e4 (podgląd skrzydła).
  if (category === 'STA') {
    return { e1: '', e2_1: '', e2_2: '', e3: '', e4: '', e5: '', dist_e1: '', dist_e2_1: '', dist_e2_2: '', dist_e5: '' }
  }
  if (category === 'Disting') {
    return { e1: '', e2_1: '', e2_2: '', e3: '', e4: '', e5: '', sta_e3: '', sta_e4: '' }
  }
  if (category === 'ST') {
    return { cnc: '', osc: '', skr: '', mon: '', mag: '', e1: '', e2: '', e3: '', e4: '', sta_e5: '' }
  }
  if (category === 'Bastion') {
    return {
      cnc: '', okleinowanie_skrzydla: '', okuwanie_skrzydla: '', oscieznica_cnc: '', oscieznica_skrecanie: '',
      magazyn_kontrola: '', stolarnia: '', magazyn_regulowana: '', regulowana_do_zlozenia: '',
    }
  }
  return {}
}

// Systemy Titana (CORE/GUARD RC2/RC3 — 'GUARD RC3' łapie też 'GUARD RC3 EI 30')
export const isTitanSystem = (system: unknown): boolean => {
  const u = String(system ?? '').toUpperCase()
  return u.includes('CORE') || u.includes('GUARD RC2') || u.includes('GUARD RC3')
}

// Rezerwacja magazynowa po utworzeniu zlecenia (best-effort — błąd nie blokuje intake'u).
// Frontend robi to samo po ręcznym zapisie; guard w RPC chroni przed dublem.
const reserveStock = async (supabase: any, orderId: number): Promise<void> => {
  try {
    const { error } = await supabase.rpc('reserve_stock_for_order', { p_order_id: orderId })
    if (error) console.error(`reserve_stock_for_order(${orderId}):`, error.message)
  } catch (e) {
    console.error(`reserve_stock_for_order(${orderId}):`, e)
  }
}

// STA Titan → dorób ST (ościeżnica) + Bastion (skrzydło do okuwania). Grupa w extra_fields.titan_group.
const createTitanLegs = async (supabase: any, orderId: number): Promise<void> => {
  const { data: base, error } = await supabase.from('orders').select('*').eq('id', orderId).single()
  if (error || !base) return
  if (!isTitanSystem(base.system)) return
  if (String(base.category) !== 'STA') return
  const ef = (base.extra_fields && typeof base.extra_fields === 'object') ? base.extra_fields as Record<string, unknown> : {}
  if (ef.titan_group) return

  const staId = base.id
  const group = staId
  const { id, created_at, updated_at, ...rest } = base as Record<string, unknown>

  const stNr = await nextOrderNumber(supabase, 'ST')
  const stPayload = {
    ...rest, order_number: stNr, category: 'ST', airtable_id: '', linked_order_id: staId,
    sta_ref: String(base.order_number ?? ''), st_sheet: '', release_date: null,
    production_stages: emptyStagesFor('ST'), extra_fields: { ...ef, titan_group: group, titan_role: 'ST' },
  }
  const { data: stRow } = await supabase.from('orders').insert([stPayload]).select('id, order_number').single()
  if (stRow) await reserveStock(supabase, Number(stRow.id))

  const bNr = await nextOrderNumber(supabase, 'Bastion')
  const bPayload = {
    ...rest, order_number: bNr, category: 'Bastion', airtable_id: '', linked_order_id: null, release_date: null,
    production_stages: emptyStagesFor('Bastion'), extra_fields: { ...ef, titan_group: group, titan_role: 'Bastion' },
  }
  const { data: bRow } = await supabase.from('orders').insert([bPayload]).select('id').single()
  if (bRow) await reserveStock(supabase, Number(bRow.id))

  const upd: Record<string, unknown> = { extra_fields: { ...ef, titan_group: group, titan_role: 'STA' } }
  if (stRow) { upd.linked_order_id = stRow.id; upd.st_sheet = stRow.order_number }
  await supabase.from('orders').update(upd).eq('id', staId)
}

// Następny numer zlecenia w danej kategorii (max numeryczny + 1)
const nextOrderNumber = async (supabase: any, category: string): Promise<string> => {
  const { data } = await supabase.from('orders').select('order_number').eq('category', category)
  let maxN = 0
  for (const r of data ?? []) {
    const n = Number((r as { order_number?: unknown }).order_number)
    if (Number.isFinite(n) && n > maxN) maxN = n
  }
  return String(maxN + 1)
}

// DISTING PLUS: po utworzeniu zlecenia tworzymy powiązanego partnera (STA↔Disting)
// — tak samo jak formularz w aplikacji, żeby konfigurator/BOT też zakładał parę.
const createDistingPlusPartner = async (supabase: any, orderId: number): Promise<void> => {
  const { data: base, error } = await supabase.from('orders').select('*').eq('id', orderId).single()
  if (error || !base) return

  const sys = String(base.system ?? '').trim().toUpperCase().replace(/\s+/g, ' ')
  if (sys !== 'DISTING PLUS') return
  if (base.linked_order_id != null) return // już sparowane

  const baseCat = String(base.category ?? '')
  const partnerCat = baseCat === 'Disting' ? 'STA' : baseCat === 'STA' ? 'Disting' : null
  if (!partnerCat) return

  const partnerNumber = await nextOrderNumber(supabase, partnerCat)

  // Kopiujemy cały wiersz bazowy bez pól tożsamości/auto i z poprawnymi referencjami
  const { id, created_at, updated_at, ...rest } = base as Record<string, unknown>
  const partnerPayload: Record<string, unknown> = {
    ...rest,
    order_number: partnerNumber,
    category: partnerCat,
    airtable_id: '', // nie duplikujemy zewnętrznego recordId (dedup intake)
    linked_order_id: base.id,
    release_date: null,
    production_stages: emptyStagesFor(partnerCat),
    // referencje krzyżowe arkuszy
    disting_sheet: partnerCat === 'STA' ? String(base.order_number ?? '') : '',
    sta_sheet: partnerCat === 'Disting' ? String(base.order_number ?? '') : '',
  }

  const { data: partnerRow, error: pErr } = await supabase
    .from('orders')
    .insert([partnerPayload])
    .select('id, order_number')
    .single()
  if (pErr || !partnerRow) {
    console.error('DISTING PLUS partner create failed:', pErr?.message)
    return
  }

  const baseUpdate: Record<string, unknown> = { linked_order_id: partnerRow.id }
  if (baseCat === 'Disting') baseUpdate.sta_sheet = partnerRow.order_number
  else baseUpdate.disting_sheet = partnerRow.order_number
  await supabase.from('orders').update(baseUpdate).eq('id', base.id)

  await reserveStock(supabase, Number(partnerRow.id))
}

// Helper: standardowa odpowiedź JSON
const jsonResponse = (body: unknown, status = 200) => {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, Authorization',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
  })
}

serve(async (req) => {
  const startTime = Date.now()

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return jsonResponse({}, 200)
  }

  // Tylko POST
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  // Pobierz API key z header
  const apiKey = req.headers.get('x-api-key') || req.headers.get('X-API-Key')
  if (!apiKey) {
    return jsonResponse({ error: 'Missing X-API-Key header' }, 401)
  }

  // Pobierz body
  const bodyText = await req.text()
  const body = safeJsonParse(bodyText) as Record<string, unknown> | null
  if (!body) {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  // Inicjalizuj Supabase admin client (service_role)
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, serviceKey)

  let apiKeyId: number | null = null
  let statusCode = 500
  let responseBody: unknown = null
  let errorMessage: string | null = null

  try {
    // 1) Weryfikuj API key
    const { data: verifyData, error: verifyError } = await supabase.rpc('verify_api_key', {
      p_raw_key: apiKey,
    })

    if (verifyError) {
      throw new Error(`verify_api_key error: ${verifyError.message}`)
    }

    const verification = verifyData?.[0]
    if (!verification?.is_valid) {
      statusCode = 401
      responseBody = { error: 'Invalid API key' }
      return jsonResponse(responseBody, statusCode)
    }

    apiKeyId = verification.key_id
    const rateLimit = verification.rate_limit_per_minute || 60

    // 2) Sprawdź rate limit
    const { data: rateLimitOk, error: rateLimitError } = await supabase.rpc('check_rate_limit', {
      p_api_key_id: apiKeyId,
      p_limit: rateLimit,
    })

    if (rateLimitError) {
      throw new Error(`check_rate_limit error: ${rateLimitError.message}`)
    }

    if (rateLimitOk === false) {
      statusCode = 429
      responseBody = { error: `Rate limit exceeded (${rateLimit} requests per minute)` }
      return jsonResponse(responseBody, statusCode)
    }

    // 3) Wywołaj create_bot_order RPC
    const intakeMetadata = {
      received_at: new Date().toISOString(),
      ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown',
      user_agent: req.headers.get('user-agent') || 'unknown',
    }

    const { data: orderData, error: orderError } = await supabase.rpc('create_bot_order', {
      p_payload: body,
      p_api_key_id: apiKeyId,
      p_intake_metadata: intakeMetadata,
    })

    if (orderError) {
      // Sprawdź czy to duplikat
      if (orderError.message.includes('juz istnieje (duplikat)')) {
        statusCode = 409
        responseBody = { error: 'Duplicate order (recordId already exists)', detail: orderError.message }
      } else {
        statusCode = 400
        responseBody = { error: 'Failed to create order', detail: orderError.message }
      }
      return jsonResponse(responseBody, statusCode)
    }

    const result = orderData?.[0]

    // 3b) DISTING PLUS → utwórz powiązanego partnera (best-effort, nie blokuje odpowiedzi)
    if (result?.order_id) {
      try {
        await createDistingPlusPartner(supabase, Number(result.order_id))
      } catch (pairErr) {
        console.error('DISTING PLUS pairing error:', pairErr)
      }
      try {
        await createTitanLegs(supabase, Number(result.order_id))
      } catch (titanErr) {
        console.error('TITAN legs error:', titanErr)
      }
      // rezerwacja magazynowa głównego zlecenia (nogi rezerwują się w helperach)
      await reserveStock(supabase, Number(result.order_id))
    }

    // 4) Sukces
    statusCode = 200
    responseBody = {
      success: true,
      order_id: result?.order_id,
      order_number: result?.order_number,
      needs_review: result?.needs_review || false,
      warnings: result?.warnings || [],
    }

    return jsonResponse(responseBody, statusCode)
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err)
    statusCode = 500
    responseBody = { error: 'Internal server error', detail: errorMessage }
    return jsonResponse(responseBody, statusCode)
  } finally {
    // Log request (best effort, ignore errors)
    try {
      await supabase.rpc('log_api_request', {
        p_api_key_id: apiKeyId,
        p_endpoint: '/orders/intake',
        p_method: 'POST',
        p_status_code: statusCode,
        p_request_body: body,
        p_response_body: responseBody,
        p_ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip'),
        p_user_agent: req.headers.get('user-agent'),
        p_duration_ms: Date.now() - startTime,
        p_error_message: errorMessage,
      })
    } catch (logErr) {
      console.error('Failed to log request:', logErr)
    }
  }
})
