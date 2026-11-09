-- 2026-11-09: Magazyn — poziomy braków na półkach (widok „Magazyn — stany”).
--
-- Dziś ~850 półek (warehouse_stock: komponent × magazyn), 148 z dostępnym < 0,
-- 478 z 0 — i aplikacja nie odróżnia „brak krytyczny” od „pusta półka, której
-- nikt nie pilnuje”, bo nie ma minimum PER PÓŁKA (warehouse_components.
-- min_stock_level jest globalne i puste; Smart ROP daje próg dla 9 komponentów).
--
-- 1) warehouse_stock.min_quantity — minimum półki (null = nie pilnujemy).
--    Realtime / RLS warehouse_stock bez zmian.
-- 2) stock_level(quantity, reserved, incoming, min) → text:
--      available = quantity − reserved; projected = available + incoming
--      'critical' — available < 0 i w drodze nie dociąga (projected < 0)
--      'covered'  — available < 0, ale dostawa w drodze pokrywa brak
--      'low'      — available >= 0, jest minimum i projected < minimum
--      'inactive' — 0/0, bez minimum i bez dostaw (pusta półka, nikt nie pilnuje)
--      'ok'       — reszta
--    stock_shortage(...) → „do zamówienia” = greatest(0, coalesce(min,0) − projected).
-- 3) stock_incoming_for(warehouse, component) — „w drodze” dla JEDNEJ półki
--    (ten sam filtr co get_incoming_stock_per_warehouse(); lekkie — pod trigger).
-- 4) stock_min_effective(warehouse, component, shelf_min) → (min_source, min_effective)
--    JEDYNE miejsce z hierarchią minimum: półka ('shelf') → Smart ROP ('smart',
--    jak get_all_smart_rop: komponent aktywny, smart_status = 'smart') →
--    warehouse_components.min_stock_level ('component') → null.
--    Używana przez widok (per wiersz, ~65 ms na 850 półek) i przez trigger
--    powiadomień (migrate/magazyn_powiadomienia_krytyczne.sql).
-- 5) v_stock_levels — jeden wiersz na półkę: stan, rezerwacje, w drodze
--    (get_incoming_stock_per_warehouse()), minimum + źródło, level, shortage.
--    security_invoker = true → RLS warehouse_stock / warehouses / warehouse_components
--    działa jak przy zwykłym SELECT zalogowanego.
-- 6) set_stock_minimums(jsonb) — kierownik ustawia minimum wielu półek naraz;
--    brak półki → insert 0/0 z minimum (można pilnować czegoś, czego jeszcze
--    nie ma na stanie). SECURITY DEFINER z guardem current_user_is_manager().
-- Nie rusza rezerwacji (reserve_stock_for_order / release_* / cancel_*),
-- triggerów na stock_reservations ani polityk RLS. Idempotentne.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Minimum półki
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.warehouse_stock
  add column if not exists min_quantity numeric null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'warehouse_stock_min_quantity_check'
      and conrelid = 'public.warehouse_stock'::regclass
  ) then
    alter table public.warehouse_stock
      add constraint warehouse_stock_min_quantity_check check (min_quantity is null or min_quantity >= 0);
  end if;
end $$;

comment on column public.warehouse_stock.min_quantity is
  'Minimum półki (komponent × magazyn); null = nie pilnujemy. Ustawiane przez set_stock_minimums().';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Klasyfikacja poziomu i „do zamówienia” — czyste funkcje
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.stock_level(
  p_quantity numeric,
  p_reserved numeric,
  p_incoming numeric,
  p_min      numeric
) returns text
language sql
immutable
as $$
  select case
    when (p_quantity - coalesce(p_reserved, 0)) < 0
     and (p_quantity - coalesce(p_reserved, 0) + coalesce(p_incoming, 0)) < 0 then 'critical'
    when (p_quantity - coalesce(p_reserved, 0)) < 0 then 'covered'
    when p_min is not null
     and (p_quantity - coalesce(p_reserved, 0) + coalesce(p_incoming, 0)) < p_min then 'low'
    when p_quantity = 0 and coalesce(p_reserved, 0) = 0
     and p_min is null and coalesce(p_incoming, 0) = 0 then 'inactive'
    else 'ok'
  end;
$$;

comment on function public.stock_level(numeric, numeric, numeric, numeric) is
  'Poziom półki: critical / covered / low / inactive / ok (available = quantity − reserved, projected = available + incoming).';

create or replace function public.stock_shortage(
  p_quantity numeric,
  p_reserved numeric,
  p_incoming numeric,
  p_min      numeric
) returns numeric
language sql
immutable
as $$
  select greatest(
    0,
    coalesce(p_min, 0) - (p_quantity - coalesce(p_reserved, 0) + coalesce(p_incoming, 0))
  );
$$;

comment on function public.stock_shortage(numeric, numeric, numeric, numeric) is
  'Ile trzeba domówić, żeby projected (available + w drodze) doszło do minimum (bez minimum: do zera).';

revoke all on function public.stock_level(numeric, numeric, numeric, numeric) from public, anon;
revoke all on function public.stock_shortage(numeric, numeric, numeric, numeric) from public, anon;
grant execute on function public.stock_level(numeric, numeric, numeric, numeric) to authenticated, service_role;
grant execute on function public.stock_shortage(numeric, numeric, numeric, numeric) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) „W drodze” dla jednej półki (lekkie — pod trigger)
--    UWAGA: filtr identyczny z get_incoming_stock_per_warehouse() — zmieniając
--    jedno, zmień drugie.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.stock_incoming_for(
  p_warehouse_id bigint,
  p_component_id bigint
) returns numeric
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(sum(i.quantity_ordered - i.quantity_received), 0)
  from purchase_order_items i
  join purchase_orders po on po.id = i.purchase_order_id
  where po.warehouse_id = p_warehouse_id
    and i.component_id = p_component_id
    and po.status in ('sent', 'partial')
    and i.status_per_item in ('pending', 'partial')
    and (i.quantity_ordered - i.quantity_received) > 0;
$$;

revoke all on function public.stock_incoming_for(bigint, bigint) from public, anon;
grant execute on function public.stock_incoming_for(bigint, bigint) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Minimum efektywne — JEDNO miejsce z hierarchią (widok + trigger)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.stock_min_effective(
  p_warehouse_id bigint,
  p_component_id bigint,
  p_shelf_min    numeric
) returns table (min_source text, min_effective numeric)
language sql
stable
security definer
set search_path to 'public'
as $$
  with comp as (
    select c.min_stock_level, c.is_active
    from warehouse_components c
    where c.id = p_component_id
  ),
  smart as (
    -- to samo co get_all_smart_rop(): tylko komponent aktywny, smart_status = 'smart'
    select r.rop::numeric as smart_min
    from comp
    cross join lateral calculate_dynamic_rop(p_component_id) r
    where comp.is_active and r.smart_status = 'smart' and r.rop is not null
  )
  select
    case
      when p_shelf_min is not null then 'shelf'
      when (select smart_min from smart) is not null then 'smart'
      when (select min_stock_level from comp) is not null then 'component'
      else null
    end as min_source,
    coalesce(
      p_shelf_min,
      (select smart_min from smart),
      (select min_stock_level from comp)
    ) as min_effective;
$$;

comment on function public.stock_min_effective(bigint, bigint, numeric) is
  'Minimum półki wg hierarchii: shelf (warehouse_stock.min_quantity) → smart (Smart ROP) → component (warehouse_components.min_stock_level) → null.';

revoke all on function public.stock_min_effective(bigint, bigint, numeric) from public, anon;
grant execute on function public.stock_min_effective(bigint, bigint, numeric) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Widok: jeden wiersz na półkę
-- ─────────────────────────────────────────────────────────────────────────────
drop view if exists public.v_stock_levels;

create view public.v_stock_levels
with (security_invoker = true)
as
select
  s.id                            as stock_id,
  s.warehouse_id,
  w.code                          as warehouse_code,
  s.component_id,
  c.code                          as component_code,
  c.name                          as component_name,
  c.unit                          as component_unit,
  c.category                      as component_category,
  c.supplier_id,
  c.is_active,
  s.quantity,
  s.reserved_quantity,
  s.available_quantity,
  coalesce(inc.r_incoming_qty, 0) as incoming_qty,
  inc.r_earliest_eta              as earliest_eta,
  coalesce(inc.r_open_pos, 0)     as open_pos,
  s.min_quantity,
  m.min_source,
  m.min_effective,
  public.stock_level(s.quantity, s.reserved_quantity, coalesce(inc.r_incoming_qty, 0), m.min_effective)    as level,
  public.stock_shortage(s.quantity, s.reserved_quantity, coalesce(inc.r_incoming_qty, 0), m.min_effective) as shortage,
  s.updated_at
from public.warehouse_stock s
join public.warehouses w            on w.id = s.warehouse_id
join public.warehouse_components c  on c.id = s.component_id
left join public.get_incoming_stock_per_warehouse() inc
       on inc.r_warehouse_id = s.warehouse_id and inc.r_component_id = s.component_id
cross join lateral public.stock_min_effective(s.warehouse_id, s.component_id, s.min_quantity) m;

comment on view public.v_stock_levels is
  'Magazyn — stany: półka + w drodze + minimum (shelf/smart/component) + level (critical/covered/low/inactive/ok) + shortage.';

-- domyślne przywileje Supabase dają authenticated ALL na nowych widokach — zostaje tylko SELECT
revoke all on public.v_stock_levels from public, anon, authenticated, service_role;
grant select on public.v_stock_levels to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) RPC: ustawianie minimum wielu półek naraz (kierownik)
--    p_items = [{ "warehouse_id": 1, "component_id": 91, "min_quantity": 10 | null }, ...]
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.set_stock_minimums(p_items jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_item     jsonb;
  v_wh       bigint;
  v_comp     bigint;
  v_min      numeric;
  v_count    integer := 0;
  v_affected integer;
begin
  if not (public.current_user_is_manager() or auth.role() = 'service_role') then
    raise exception 'Tylko kierownik może ustawiać minimum';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Nieprawidłowe dane: oczekiwano listy pozycji';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Nieprawidłowa pozycja: %', v_item;
    end if;

    begin
      v_wh   := (v_item ->> 'warehouse_id')::bigint;
      v_comp := (v_item ->> 'component_id')::bigint;
      v_min  := nullif(v_item ->> 'min_quantity', '')::numeric;
    exception when others then
      raise exception 'Nieprawidłowa pozycja (warehouse_id / component_id / min_quantity): %', v_item;
    end;

    if v_wh is null or v_comp is null then
      raise exception 'Pozycja bez magazynu lub komponentu: %', v_item;
    end if;
    if v_min is not null and v_min < 0 then
      raise exception 'Minimum nie może być ujemne (magazyn %, komponent %)', v_wh, v_comp;
    end if;
    if not exists (select 1 from public.warehouses where id = v_wh) then
      raise exception 'Magazyn o id % nie istnieje', v_wh;
    end if;
    if not exists (select 1 from public.warehouse_components where id = v_comp) then
      raise exception 'Komponent o id % nie istnieje', v_comp;
    end if;

    insert into public.warehouse_stock (warehouse_id, component_id, quantity, reserved_quantity, min_quantity)
    values (v_wh, v_comp, 0, 0, v_min)
    on conflict (warehouse_id, component_id) do update
      set min_quantity = excluded.min_quantity,
          updated_at   = now()
      where public.warehouse_stock.min_quantity is distinct from excluded.min_quantity;

    get diagnostics v_affected = row_count;
    v_count := v_count + v_affected;
  end loop;

  return v_count;
end;
$$;

comment on function public.set_stock_minimums(jsonb) is
  'Kierownik: ustaw minimum półek [{warehouse_id, component_id, min_quantity|null}]. Brak półki → insert 0/0 z minimum. Zwraca liczbę zmienionych.';

revoke all on function public.set_stock_minimums(jsonb) from public, anon;
grant execute on function public.set_stock_minimums(jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
