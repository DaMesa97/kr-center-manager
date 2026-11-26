-- =====================================================================
-- warehouse_components.is_stocked (kolumna i trigger importu są już w bazie)
-- — dwie rzeczy potrzebne aplikacji (Tymek 26.11.2026):
--
-- 1) set_components_stocked(ids, stocked): zmiana TYLKO pola is_stocked dla
--    kierowników (current_user_is_manager) + magazynier + pracownik działu
--    magazyn. Polityka warehouse_components_write nie obejmuje magazyniera,
--    a nie chcemy mu dawać zapisu całej kartoteki.
-- 2) open_inventory_session__impl: spis bierze tylko komponenty is_stocked
--    (kartoteki „w tle” z Optimy — ~2,5 tys. — nie idą do inwentaryzacji).
--    Dla surowców bez zmian (wszystkie mają is_stocked = true).
--
-- ADDYTYWNE / bez zmiany kolumn. Wgrane przez konektor (apply_migration
-- is_stocked_app) 26.11.2026; plik zostaje jako zapis.
-- =====================================================================

create or replace function public.set_components_stocked(p_ids bigint[], p_stocked boolean)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  if not (
    public.current_user_is_manager()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.role = 'magazynier' or (p.role = 'worker' and p.department = 'magazyn'))
    )
  ) then
    raise exception 'Brak uprawnień do zmiany „na magazynie”';
  end if;
  if p_stocked is null then
    raise exception 'Brak wartości (TAK / NIE)';
  end if;

  update public.warehouse_components
     set is_stocked = p_stocked
   where id = any(coalesce(p_ids, array[]::bigint[]))
     and is_stocked is distinct from p_stocked;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.set_components_stocked(bigint[], boolean) from public, anon;
grant execute on function public.set_components_stocked(bigint[], boolean) to authenticated;

comment on function public.set_components_stocked(bigint[], boolean) is
  'Ustawia warehouse_components.is_stocked (trzymamy na magazynie / kartoteka w tle) — kierownicy i magazyn. Zwraca liczbę zmienionych.';

create or replace function public.open_inventory_session__impl(p_notes text DEFAULT NULL::text, p_counted_date date DEFAULT CURRENT_DATE, p_warehouse_id integer DEFAULT NULL::integer)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_session_id int;
  v_is_internal boolean;
begin
  if p_warehouse_id is null then
    raise exception 'Inwentaryzację otwiera się dla konkretnego magazynu';
  end if;

  -- blokada magazynu: dwa równoległe otwarcia nie przejdą obok siebie przez "exists"
  select upper(trim(w.code)) like 'WEW%' into v_is_internal
  from warehouses w where w.id = p_warehouse_id and w.is_active
  for update;
  if not found then
    raise exception 'Magazyn % nie istnieje lub jest nieaktywny', p_warehouse_id;
  end if;

  if exists (
    select 1 from inventory_sessions
    where status = 'open' and warehouse_id = p_warehouse_id
  ) then
    raise exception 'Istnieje już otwarta sesja inwentaryzacyjna dla tego magazynu';
  end if;

  insert into inventory_sessions (status, counted_date, notes, created_by, warehouse_id)
  values ('open', p_counted_date, p_notes, auth.uid(), p_warehouse_id)
  returning id into v_session_id;

  -- Snapshot: aktywne komponenty TRZYMANE NA MAGAZYNIE (is_stocked) z półką w tym magazynie
  -- ORAZ wszystkie takie pasujące do typu magazynu (WEW* = drzwi wewnętrzne, reszta = surowce).
  -- Kartoteki „w tle” (is_stocked = false, import z Optimy) nie idą do spisu. Bez półki = stan 0.
  insert into inventory_lines (session_id, component_id, system_qty)
  select v_session_id, wc.id, coalesce(ws.quantity, 0)
  from warehouse_components wc
  left join warehouse_stock ws
    on ws.component_id = wc.id and ws.warehouse_id = p_warehouse_id
  where wc.is_active = true
    and wc.is_stocked = true
    and (
      ws.id is not null
      or (coalesce(wc.product_category, 'raw') <> 'raw') = v_is_internal
    )
  order by wc.name, wc.id;

  return v_session_id;
end;
$function$;

notify pgrst, 'reload schema';
