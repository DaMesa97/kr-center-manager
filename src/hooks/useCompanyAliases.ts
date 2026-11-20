import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { buildCompanyAliases, companyKey } from '../lib/companyStats'

// Aliasy nazw firm (tabela company_aliases): ta sama, z której trigger trg_apply_company_alias
// podmienia nazwę przy zleceniu z konfiguratora (alias_name = lower(trim(nazwa)) → company_name).
// Statystyki → Firmy używają jej do liczenia wariantów pisowni razem i pozwalają kierownikowi
// dopisać scalenia („Porządek nazw firm”). Istniejących zleceń nie zmieniamy.

export type CompanyAliasRow = { id: number; alias_name: string; company_name: string }

export function useCompanyAliases() {
  const [rows, setRows] = useState<CompanyAliasRow[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('company_aliases').select('id, alias_name, company_name').order('company_name').order('alias_name')
    if (error) console.warn('[company_aliases]', error.message)
    else setRows((data ?? []) as CompanyAliasRow[])
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const aliases = useMemo(() => buildCompanyAliases(rows), [rows])

  /** Scal pisownie pod jedną nazwę. Pomija warianty, które companyKey i tak skleja z nazwą docelową. Zwraca komunikat błędu albo null. */
  const merge = useCallback(
    async (variants: string[], canonical: string, userId: string | null): Promise<string | null> => {
      const canon = canonical.trim()
      if (!canon) return 'Brak nazwy docelowej'
      const names = [...new Set(variants.map((v) => v.trim().toLowerCase()).filter((v) => v && companyKey(v) !== companyKey(canon)))]
      if (names.length === 0) return null
      const { error } = await supabase
        .from('company_aliases')
        .upsert(names.map((alias_name) => ({ alias_name, company_name: canon, created_by: userId })), { onConflict: 'alias_name' })
      if (error) return error.message
      await load()
      return null
    },
    [load],
  )

  const remove = useCallback(
    async (id: number): Promise<string | null> => {
      const { error } = await supabase.from('company_aliases').delete().eq('id', id)
      if (error) return error.message
      await load()
      return null
    },
    [load],
  )

  return { rows, aliases, loading, merge, remove, reload: load }
}
