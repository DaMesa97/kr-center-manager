import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Brak autoryzacji' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const {
      data: { user: caller },
      error: userErr,
    } = await supabaseUser.auth.getUser()
    if (userErr || !caller) {
      return new Response(JSON.stringify({ error: 'Nieautoryzowany' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceKey)

    const { data: profile, error: profErr } = await supabaseAdmin
      .from('profiles')
      .select('role, categories')
      .eq('id', caller.id)
      .single()

    // Zarządzać kontami może admin (nowe role) oraz legacy 'manager'
    // (okres przejściowy przed migracją roles.sql — bez tego migracja
    // manager→admin odcięłaby WSZYSTKICH od panelu użytkowników).
    // Kierownik działu (decyzja 2.11.2026, zgłoszenie #74): zakłada konta,
    // resetuje hasła i dezaktywuje — ale TYLKO pracowników produkcji, których
    // wszystkie kategorie mieszczą się w jego kategoriach. Profil zakłada
    // klient; pilnują tego polityki profiles_insert/update w bazie.
    const callerRole = String(profile?.role ?? '')
    const isAdmin = ['manager', 'admin'].includes(callerRole)
    const isKd = callerRole === 'kierownik_dzialu'
    if (profErr || (!isAdmin && !isKd)) {
      return new Response(JSON.stringify({ error: 'Brak uprawnień' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const kdCategories: string[] = Array.isArray(profile?.categories) ? (profile!.categories as string[]) : []

    // null = wolno; tekst = powód odmowy. allowOrphan: konto auth bez profilu
    // (sprzątanie po nieudanym insercie profilu) kierownik może usunąć.
    const kdDenyReason = async (user_id: string, allowOrphan: boolean): Promise<string | null> => {
      if (!isKd) return null
      const { data: target } = await supabaseAdmin
        .from('profiles')
        .select('role, categories')
        .eq('id', user_id)
        .maybeSingle()
      if (!target) return allowOrphan ? null : 'Nie znaleziono profilu użytkownika'
      const cats: string[] = Array.isArray(target.categories) ? (target.categories as string[]) : []
      const ok =
        String(target.role ?? '') === 'pracownik_produkcji' &&
        cats.length > 0 &&
        cats.every((c) => kdCategories.includes(c))
      return ok ? null : 'Kierownik działu zarządza tylko kontami pracowników produkcji w swoich kategoriach'
    }
    const deny = (reason: string) =>
      new Response(JSON.stringify({ error: reason }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })

    const body = (await req.json()) as Record<string, unknown>
    const action = String(body.action ?? '')

    if (action === 'create') {
      const email = String(body.email ?? '').trim().toLowerCase()
      const password = String(body.password ?? '')

      if (!email || !password) {
        return new Response(JSON.stringify({ error: 'Podaj e-mail i hasło' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      if (!email.endsWith('@krcenter.pl')) {
        return new Response(JSON.stringify({ error: 'Dozwolona jest tylko domena @krcenter.pl' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: authData, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      })

      if (createErr || !authData?.user) {
        return new Response(
          JSON.stringify({ error: createErr?.message ?? 'Błąd tworzenia konta' }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }

      return new Response(JSON.stringify({ user: { id: authData.user.id } }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Dezaktywacja (ban) — twarde usunięcie wywala się na kluczach obcych
    // (ruchy magazynowe, ZD, inwentaryzacje wskazują na profil). Ban blokuje
    // logowanie, a historia zostaje nietknięta.
    if (action === 'deactivate' || action === 'reactivate') {
      const user_id = String(body.user_id ?? '').trim()
      if (!user_id) {
        return new Response(JSON.stringify({ error: 'Brak identyfikatora użytkownika' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      if (user_id === caller.id) {
        return new Response(JSON.stringify({ error: 'Nie można dezaktywować własnego konta' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const kdReason = await kdDenyReason(user_id, false)
      if (kdReason) return deny(kdReason)
      const { error: banErr } = await supabaseAdmin.auth.admin.updateUserById(user_id, {
        // 100 lat = dezaktywacja; 'none' zdejmuje bana
        ban_duration: action === 'deactivate' ? '876000h' : 'none',
      })
      if (banErr) {
        return new Response(JSON.stringify({ error: banErr.message }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Reset hasła przez admina — wcześniej jedyna droga to panel Supabase
    if (action === 'reset_password') {
      const user_id = String(body.user_id ?? '').trim()
      const password = String(body.password ?? '')
      if (!user_id || !password) {
        return new Response(JSON.stringify({ error: 'Podaj użytkownika i nowe hasło' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      if (password.length < 6) {
        return new Response(JSON.stringify({ error: 'Hasło musi mieć co najmniej 6 znaków' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const kdReason = await kdDenyReason(user_id, false)
      if (kdReason) return deny(kdReason)
      const { error: pwErr } = await supabaseAdmin.auth.admin.updateUserById(user_id, { password })
      if (pwErr) {
        return new Response(JSON.stringify({ error: pwErr.message }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'delete') {
      const user_id = String(body.user_id ?? '').trim()
      if (!user_id) {
        return new Response(JSON.stringify({ error: 'Brak identyfikatora użytkownika' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      if (user_id === caller.id) {
        return new Response(JSON.stringify({ error: 'Nie można usunąć własnego konta' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      // kierownik działu: twarde usuwanie tylko sieroty bez profilu
      if (isKd) {
        const { data: target } = await supabaseAdmin.from('profiles').select('id').eq('id', user_id).maybeSingle()
        if (target) return deny('Usuwanie kont — tylko administrator. Użyj „Dezaktywuj".')
      }

      const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(user_id)
      if (delErr) {
        return new Response(JSON.stringify({ error: delErr.message }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ error: 'Nieznana akcja' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
