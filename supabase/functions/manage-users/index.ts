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
    // Superadmin (CRM Po Drzwi, 14.11.2026) ma przy zarządzaniu kontami prawa admina;
    // dodatkowo tylko on rusza konta innych superadminów i kont z dostępem do CRM
    // (superadminDenyReason).
    const callerRole = String(profile?.role ?? '')
    const isAdmin = ['manager', 'admin', 'superadmin'].includes(callerRole)
    const isSuperadmin = callerRole === 'superadmin'
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
    // Konto superadministratora: dezaktywacja (ban) i reset hasła idą kluczem
    // service_role poza RLS, więc baza ich nie zablokuje — pilnuje tego funkcja.
    // Usunięcie profilu blokuje też trigger trg_protect_superadmin_role.
    // Testy 27.11 (runda 3): tak samo chronione jest konto z dostępem do CRM Po Drzwi
    // (wiersz w crm.dostep) — to osobna firma, dostęp nadaje tylko superadmin, a admin
    // KR Center resetem hasła mógłby zalogować się jako handlowiec.
    const superadminDenyReason = async (user_id: string): Promise<string | null> => {
      if (isSuperadmin) return null
      const { data: target } = await supabaseAdmin.from('profiles').select('role').eq('id', user_id).maybeSingle()
      if (String(target?.role ?? '') === 'superadmin') {
        return 'Kontem superadministratora zarządza tylko superadministrator'
      }
      const { data: crmRow, error: crmErr } = await supabaseAdmin
        .schema('crm')
        .from('dostep')
        .select('user_id')
        .eq('user_id', user_id)
        .maybeSingle()
      // nie wiemy, czy konto ma dostęp do CRM — bezpieczniej odmówić
      if (crmErr) return 'Nie udało się sprawdzić dostępu do CRM Po Drzwi — spróbuj ponownie'
      return crmRow ? 'Kontem z dostępem do CRM Po Drzwi zarządza tylko superadministrator' : null
    }
    // Testy 27.11 (runda 3): usunięcie konta z historią po cichu zerowało autora
    // (klucze obce ON DELETE SET NULL), a część kluczy (ZKP, crm.pomoc) i tak blokuje
    // usunięcie. Lista = wszystkie FK do auth.users / profiles poza kaskadowymi
    // (sprawdzone w pg_constraint 27.11; przy nowej tabeli z autorem — dopisać).
    const HISTORY_REFS: Array<{ schema: string; table: string; column: string; label: string }> = [
      { schema: 'public', table: 'warehouse_movements', column: 'created_by', label: 'ruchy magazynowe' },
      { schema: 'public', table: 'purchase_orders', column: 'created_by', label: 'zamówienia do dostawców' },
      { schema: 'public', table: 'purchase_orders', column: 'sent_by', label: 'zamówienia do dostawców' },
      { schema: 'public', table: 'inventory_sessions', column: 'created_by', label: 'inwentaryzacje' },
      { schema: 'public', table: 'inventory_sessions', column: 'closed_by', label: 'inwentaryzacje' },
      { schema: 'public', table: 'order_comments', column: 'author_id', label: 'komentarze' },
      { schema: 'public', table: 'order_documents', column: 'uploaded_by', label: 'dokumenty zleceń' },
      { schema: 'public', table: 'order_photos', column: 'uploaded_by', label: 'zdjęcia zleceń' },
      { schema: 'public', table: 'worker_stages', column: 'created_by', label: 'nadane przypisania etapów' },
      { schema: 'public', table: 'company_aliases', column: 'created_by', label: 'aliasy kontrahentów' },
      { schema: 'public', table: 'seasonal_factors', column: 'updated_by', label: 'ustawienia (sezonowość)' },
      { schema: 'public', table: 'alert_thresholds', column: 'updated_by', label: 'ustawienia (progi alertów)' },
      { schema: 'public', table: 'zkp_card_stage_records', column: 'operator_id', label: 'zapisy ZKP' },
      { schema: 'public', table: 'zkp_competencies', column: 'profile_id', label: 'kompetencje ZKP' },
      { schema: 'public', table: 'zkp_test_protocols', column: 'inspector_id', label: 'protokoły ZKP' },
      { schema: 'crm', table: 'oferty', column: 'handlowiec', label: 'oferty CRM' },
      { schema: 'crm', table: 'oferty', column: 'sprawdzil', label: 'oferty CRM' },
      { schema: 'crm', table: 'zdarzenia', column: 'kto', label: 'zdarzenia CRM' },
      { schema: 'crm', table: 'skrzynki', column: 'user_id', label: 'skrzynki pocztowe CRM' },
      { schema: 'crm', table: 'skrzynki', column: 'updated_by', label: 'skrzynki pocztowe CRM' },
      { schema: 'crm', table: 'pomoc', column: 'updated_by', label: 'strony pomocy CRM' },
      { schema: 'crm', table: 'dostep', column: 'nadal', label: 'nadane dostępy do CRM' },
    ]
    // null = brak historii; tekst = powód odmowy
    const historyDenyReason = async (user_id: string): Promise<string | null> => {
      const results = await Promise.all(
        HISTORY_REFS.map(async (r) => {
          const { count, error } = await supabaseAdmin
            .schema(r.schema)
            .from(r.table)
            .select(r.column, { count: 'exact', head: true })
            .eq(r.column, user_id)
          return { ...r, count: count ?? 0, error }
        }),
      )
      const failed = results.find((r) => r.error)
      if (failed) {
        return `Nie udało się sprawdzić historii konta (${failed.schema}.${failed.table}) — użyj „Dezaktywuj".`
      }
      const byLabel = new Map<string, number>()
      for (const r of results) {
        if (r.count > 0) byLabel.set(r.label, (byLabel.get(r.label) ?? 0) + r.count)
      }
      if (byLabel.size === 0) return null
      const parts = [...byLabel].map(([label, n]) => `${label}: ${n}`).join(', ')
      return `Konto ma historię (${parts}) — usunięcie skasowałoby autora tych wpisów. Użyj „Dezaktywuj".`
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

      // @podrzwi.pl: handlowiec Po Drzwi (moduł CRM) ma adres w tej domenie
      const ALLOWED_DOMAINS = ['@krcenter.pl', '@podrzwi.pl']
      if (!ALLOWED_DOMAINS.some((d) => email.endsWith(d))) {
        return new Response(JSON.stringify({ error: `Dozwolone są tylko domeny: ${ALLOWED_DOMAINS.join(', ')}` }), {
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

    // Testy 27.11 (runda 3): lista nie pokazywała, kto jest zablokowany (ban żyje
    // w auth, poza profiles). Zwraca per konto: banned (banned_until w przyszłości)
    // i locked (konto, którym zarządza tylko superadmin: superadmin albo dostęp do CRM;
    // dla superadmina zawsze false). Kierownik działu dostaje tylko konta, którymi zarządza.
    if (action === 'list_status') {
      const banned = new Map<string, boolean>()
      const now = Date.now()
      for (let page = 1; page <= 50; page++) {
        const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 })
        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }
        const users = data?.users ?? []
        for (const u of users) {
          const until = (u as { banned_until?: string | null }).banned_until
          banned.set(u.id, !!until && new Date(until).getTime() > now)
        }
        if (users.length < 1000) break
      }
      const { data: profs, error: profsErr } = await supabaseAdmin.from('profiles').select('id, role, categories')
      if (profsErr) {
        return new Response(JSON.stringify({ error: profsErr.message }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      let crmIds = new Set<string>()
      if (!isSuperadmin) {
        const { data: crmRows, error: crmErr } = await supabaseAdmin.schema('crm').from('dostep').select('user_id')
        // przy błędzie przyciski zostają, a odmowę i tak da superadminDenyReason
        if (!crmErr) crmIds = new Set((crmRows ?? []).map((r: { user_id: string }) => String(r.user_id)))
      }
      const rows = (profs ?? []) as Array<{ id: string; role: string | null; categories: string[] | null }>
      const users = rows
        .filter((p) => {
          if (!isKd) return true
          const cats = Array.isArray(p.categories) ? p.categories : []
          return String(p.role ?? '') === 'pracownik_produkcji' && cats.length > 0 && cats.every((c) => kdCategories.includes(c))
        })
        .map((p) => ({
          id: p.id,
          banned: banned.get(p.id) ?? false,
          locked: !isSuperadmin && (String(p.role ?? '') === 'superadmin' || crmIds.has(p.id)),
        }))
      return new Response(JSON.stringify({ users }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Dezaktywacja (ban) — dla kont z historią (ruchy magazynowe, ZD, inwentaryzacje,
    // komentarze, CRM…) usunięcie jest zablokowane (historyDenyReason). Ban blokuje
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
      const saReason = await superadminDenyReason(user_id)
      if (saReason) return deny(saReason)
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
      const saReason = await superadminDenyReason(user_id)
      if (saReason) return deny(saReason)
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
      const saReason = await superadminDenyReason(user_id)
      if (saReason) return deny(saReason)
      // konto z historią — tylko dezaktywacja (testy 27.11, runda 3)
      const historyReason = await historyDenyReason(user_id)
      if (historyReason) {
        return new Response(JSON.stringify({ error: historyReason }), {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
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
