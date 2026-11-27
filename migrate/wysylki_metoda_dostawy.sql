-- 27.11: Wysyłki kurierem pokazują tylko zamówienia, które w BaseLinkerze mają metodę dostawy „Kurier”.
-- Metoda dostawy jest w crm.zamowienia_sklep (sync z BL); magazynier nie ma dostępu do CRM, więc czyta ją przez tę funkcję
-- (tylko nr BL → metoda, nic więcej). Uruchamiane konektorem (apply_migration wysylki_metoda_dostawy).
create or replace function public.metody_dostawy_bl(p_bl bigint[])
returns table (bl_id bigint, dostawa_metoda text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select z.bl_id, z.dostawa_metoda
  from crm.zamowienia_sklep z
  where auth.uid() is not null   -- odczyt: każdy zalogowany, kto widzi Wysyłki (tylko nr BL → metoda dostawy)
    and z.bl_id = any (p_bl)
$$;

revoke all on function public.metody_dostawy_bl(bigint[]) from public, anon;
grant execute on function public.metody_dostawy_bl(bigint[]) to authenticated;
