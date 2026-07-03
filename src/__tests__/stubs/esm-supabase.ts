// Stub importu 'https://esm.sh/@supabase/supabase-js' na potrzeby testów.
// Testy wstrzykują własnego fałszywego klienta przez __setSupabaseClient().
let client: unknown = {}

export const __setSupabaseClient = (c: unknown): void => {
  client = c
}

export const createClient = (..._args: unknown[]): unknown => client
