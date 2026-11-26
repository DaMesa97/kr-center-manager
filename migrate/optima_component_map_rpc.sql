-- =====================================================================
-- Drzwi wewnętrzne z Optimy: powiązanie „kod Optimy → komponent magazynu"
-- jedną transakcją (aplikacja: lib/optimaRo.ts → mapOptimaCode).
--
-- PO CO: zapis do optima_component_map mają role z polityki ocm_write (w tym
-- MAGAZYNIER), ale UPDATE na order_internal_door_items daje polityka
-- oidi_modify_mgr_seller — bez magazyniera. Bez tej funkcji magazynier zapisze
-- powiązanie, ale pozycje dostaną komponent dopiero przy następnej zmianie RO
-- w Optimie. Funkcja robi upsert mapy + przepięcie pozycji naraz.
--
-- ADDYTYWNE: nowa funkcja, żadnych zmian w tabelach, politykach, imporcie
-- (optima-ro-import), optima_ro_sync_state, optima_items_cache,
-- optima_item_groups ani cronach. Aplikacja działa też BEZ tej migracji
-- (wtedy robi upsert + update z klienta — wystarczy kierownikom).
--
-- Uruchomić raz w Supabase SQL Editor. Bezpieczne do ponownego uruchomienia.
-- =====================================================================

create or replace function public.optima_map_component(p_code text, p_component_id bigint)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := nullif(btrim(p_code), '');
  v_n integer;
begin
  if v_code is null then
    raise exception 'Pusty kod Optimy';
  end if;

  -- te same role co polityka ocm_write na optima_component_map
  if not exists (
    select 1 from profiles p
    where p.id = auth.uid()
      and p.role in ('superadmin', 'admin', 'manager', 'kierownik_magazynu', 'kierownik_produkcji',
                     'kierownik_firmowy', 'magazynier')
  ) then
    raise exception 'Brak uprawnień do powiązań kodów Optimy';
  end if;

  if p_component_id is null then
    -- usunięcie powiązania: pozycje z tym kodem wracają do „bez komponentu"
    -- (import i tak spróbuje je dopiąć po warehouse_components.code = kod)
    delete from optima_component_map where optima_code = v_code;
  else
    if not exists (select 1 from warehouse_components where id = p_component_id) then
      raise exception 'Nie ma komponentu magazynu o id %', p_component_id;
    end if;
    insert into optima_component_map (optima_code, component_id, created_by, created_at)
    values (v_code, p_component_id, auth.uid(), now())
    on conflict (optima_code) do update
      set component_id = excluded.component_id,
          created_by   = excluded.created_by,
          created_at   = excluded.created_at;
  end if;

  update order_internal_door_items
     set component_id = p_component_id
   where optima_code = v_code
     and component_id is distinct from p_component_id;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.optima_map_component(text, bigint) from public, anon;
grant execute on function public.optima_map_component(text, bigint) to authenticated;

comment on function public.optima_map_component(text, bigint) is
  'Powiązanie kodu towaru z Optimy z komponentem magazynu (NULL = usuń) + przepięcie wszystkich pozycji order_internal_door_items z tym kodem. Zwraca liczbę zmienionych pozycji. Role jak ocm_write.';

-- PostgREST: odśwież cache schematu, żeby aplikacja od razu widziała funkcję
notify pgrst, 'reload schema';
