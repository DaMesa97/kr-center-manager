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
