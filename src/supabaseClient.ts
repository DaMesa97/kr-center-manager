import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://vwlabgmilckfhtuerzio.supabase.co'
const supabaseKey = 'sb_publishable_UFkZQ4rK8TjjmnBqD3cOOw_LBPCP4VQ'

export const supabase = createClient(supabaseUrl, supabaseKey)
