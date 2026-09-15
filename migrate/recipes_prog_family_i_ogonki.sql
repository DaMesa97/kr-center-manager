-- =====================================================================
-- RODZINA RECEPTUR PROGOWYCH → część 'prog' + OGONKI w matcherze
-- (2026-09-14, ciąg dalszy recipes_part_prog.sql)
--
-- Dwa odkrycia po pierwszej naprawie (#6):
-- 1. #6 ma RODZINĘ: receptury progów innych kolorów (INOX #5, PATINA...)
--    też siedzą na części 'frame' z kryterium po kolorze PROGU i wygrywają
--    remisy z profilami o niższym id (ANTRACYT #1 przegrywał z #5).
--    → przenosimy hurtem PO CESZE (part='frame' + kryterium threshold_color).
-- 2. OGONKI: zlecenia z Excela mają 'DAB ZLOTY'/'DAB TURNER' (ASCII),
--    kryteria 'DĄB ZŁOTY'/'DĄB TURNER' — TRIM+UPPER nie skleja polskich
--    znaków → dobór ślepy. Fix: składanie diakrytyków w OBU matcherach
--    (match_recipes_for_order + preview_order_stock — muszą być identyczne).
--
-- Odpal CAŁOŚĆ w jednym wklejeniu (jedna transakcja).
-- =====================================================================

-- ── A. PODGLĄD: co się przeniesie (frame + kryterium koloru progu) ──────
select r.id, r.category, r.part, r.name,
       (select string_agg(wc.name, ' | ') from warehouse_recipe_components rc
         join warehouse_components wc on wc.id = rc.component_id
         where rc.recipe_id = r.id) as komponenty
from warehouse_recipes r
where r.part = 'frame'
  and exists (select 1 from warehouse_recipe_criteria c
              where c.recipe_id = r.id and c.field = 'threshold_color');

-- ── B. Przypisania magazynu 'prog' dla każdej dotkniętej kategorii ──────
-- (WHERE NOT EXISTS zamiast ON CONFLICT — unikalność pilnuje partial index
-- idx_warehouse_assignment_default po (category, part), którego ON CONFLICT
-- z listą kolumn nie łapie)
insert into warehouse_assignment (category, system, part, warehouse_id)
select distinct r.category, null, 'prog', wa.warehouse_id
from warehouse_recipes r
join warehouse_assignment wa
  on wa.category = r.category and wa.part = 'frame' and wa.system is null
where r.part = 'frame'
  and exists (select 1 from warehouse_recipe_criteria c
              where c.recipe_id = r.id and c.field = 'threshold_color')
  and not exists (
    select 1 from warehouse_assignment wa2
    where wa2.category = r.category and wa2.part = 'prog' and wa2.system is null
  );

-- ── C. Przeniesienie rodziny + uczciwe nazwy ────────────────────────────
update warehouse_recipes r
set part = 'prog',
    name = replace(r.name, '/ Ościeżnica /', '/ Próg + wykończenie /')
where r.part = 'frame'
  and exists (select 1 from warehouse_recipe_criteria c
              where c.recipe_id = r.id and c.field = 'threshold_color');

-- ── D. Matcher ze składaniem polskich znaków ────────────────────────────
-- 'DAB ZLOTY' = 'DĄB ZŁOTY'; porównanie: TRIM+UPPER+translate(ĄĆĘŁŃÓŚŹŻ→ACELNOSZZ)
create or replace function public.match_recipes_for_order(p_order_id bigint)
returns table(recipe_id bigint, part text)
language sql
stable
security definer
set search_path = public
as $$
  with o as (
    select to_jsonb(orders.*) as j, orders.category
    from orders
    where orders.id = p_order_id
  ),
  cand as (
    select
      r.id,
      r.part,
      (select count(*) from warehouse_recipe_criteria c where c.recipe_id = r.id) as crit_count
    from warehouse_recipes r, o
    where r.is_active
      and r.category = o.category
      and not exists (
        select 1
        from warehouse_recipe_criteria c
        where c.recipe_id = r.id
          and translate(upper(trim(coalesce(o.j ->> c.field, ''))), 'ĄĆĘŁŃÓŚŹŻ', 'ACELNOSZZ') <> all (
            select translate(upper(trim(v)), 'ĄĆĘŁŃÓŚŹŻ', 'ACELNOSZZ') from unnest(c.allowed_values) v
          )
      )
  )
  select distinct on (cand.part) cand.id, cand.part
  from cand
  order by cand.part, cand.crit_count desc, cand.id desc
$$;

-- ── E. preview_order_stock — identyczna zmiana porównania ───────────────
create or replace function public.preview_order_stock(p_payload jsonb)
returns table(
  r_part text,
  r_component_id bigint,
  r_component_name text,
  r_component_code text,
  r_required numeric,
  r_available numeric,
  r_shortage numeric,
  r_incoming_qty numeric,
  r_earliest_eta date,
  r_status text  -- ok | insufficient | missing_recipe | no_recipe | no_warehouse
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_category text := p_payload ->> 'category';
  v_system text := p_payload ->> 'system';
  v_qty numeric := coalesce(nullif(p_payload ->> 'quantity', '')::numeric, 1);
  v_match record;
  v_rec_comp record;
  v_wh_id bigint;
  v_stock record;
  v_incoming record;
  v_available numeric;
  v_any_recipe boolean := false;
  v_matched_parts text[] := array[]::text[];
  v_expected_parts text[] := array['wing','frame','hardware'];
  v_missing_part text;
begin
  if coalesce(trim(v_category), '') = '' then
    return;
  end if;

  for v_match in
    with cand as (
      select
        r.id,
        r.part,
        (select count(*) from warehouse_recipe_criteria c where c.recipe_id = r.id) as crit_count
      from warehouse_recipes r
      where r.is_active
        and r.category = v_category
        and not exists (
          select 1
          from warehouse_recipe_criteria c
          where c.recipe_id = r.id
            and translate(upper(trim(coalesce(p_payload ->> c.field, ''))), 'ĄĆĘŁŃÓŚŹŻ', 'ACELNOSZZ') <> all (
              select translate(upper(trim(v)), 'ĄĆĘŁŃÓŚŹŻ', 'ACELNOSZZ') from unnest(c.allowed_values) v
            )
        )
    )
    select distinct on (cand.part) cand.id as recipe_id, cand.part
    from cand
    order by cand.part, cand.crit_count desc, cand.id desc
  loop
    v_any_recipe := true;
    v_matched_parts := array_append(v_matched_parts, v_match.part);

    v_wh_id := resolve_warehouse_for_part(v_category, v_system, v_match.part);

    for v_rec_comp in
      select rc.component_id as comp_id, rc.quantity as per_unit,
             c.name, c.code as comp_code
      from warehouse_recipe_components rc
      join warehouse_components c on c.id = rc.component_id
      where rc.recipe_id = v_match.recipe_id
    loop
      r_part := v_match.part;
      r_component_id := v_rec_comp.comp_id;
      r_component_name := v_rec_comp.name;
      r_component_code := v_rec_comp.comp_code;
      r_required := v_rec_comp.per_unit * v_qty;

      if v_wh_id is null then
        r_available := null;
        r_shortage := 0;
        r_incoming_qty := 0;
        r_earliest_eta := null;
        r_status := 'no_warehouse';
        return next;
        continue;
      end if;

      select ws.quantity, ws.reserved_quantity into v_stock
      from warehouse_stock ws
      where ws.warehouse_id = v_wh_id and ws.component_id = v_rec_comp.comp_id;

      v_available := coalesce(v_stock.quantity, 0) - coalesce(v_stock.reserved_quantity, 0);

      select i.r_incoming_qty, i.r_earliest_eta into v_incoming
      from get_incoming_stock_per_component() i
      where i.r_component_id = v_rec_comp.comp_id;

      r_available := v_available;
      -- brak TEGO zamówienia (cap na required): dostępne -2, potrzeba 1 → brakuje 1, nie 3
      r_shortage := least(r_required, greatest(0, r_required - v_available));
      r_incoming_qty := coalesce(v_incoming.r_incoming_qty, 0);
      r_earliest_eta := v_incoming.r_earliest_eta;
      r_status := case when r_shortage > 0 then 'insufficient' else 'ok' end;
      return next;
    end loop;
  end loop;

  -- brakujące części receptur (jak w reserve/consume)
  foreach v_missing_part in array v_expected_parts loop
    if not (v_missing_part = any(v_matched_parts)) then
      r_part := v_missing_part;
      r_component_id := null;
      r_component_name := null;
      r_component_code := null;
      r_required := 0;
      r_available := null;
      r_shortage := 0;
      r_incoming_qty := 0;
      r_earliest_eta := null;
      r_status := 'missing_recipe';
      return next;
    end if;
  end loop;

  if not v_any_recipe then
    r_part := null;
    r_component_id := null;
    r_component_name := null;
    r_component_code := null;
    r_required := 0;
    r_available := null;
    r_shortage := 0;
    r_incoming_qty := 0;
    r_earliest_eta := null;
    r_status := 'no_recipe';
    return next;
  end if;

  return;
end;
$$;

grant execute on function public.preview_order_stock(jsonb) to authenticated;

-- ── F. Przeliczenie rezerwacji STA NORMAL* od startu modelu ─────────────
do $$
declare
  v_o record;
  v_cnt integer := 0;
begin
  for v_o in
    select o.id
    from orders o
    where o.category = 'STA'
      and upper(trim(o.system)) like 'NORMAL%'
      and o.created_at >= '2026-09-04'
      and o.release_date is null
      and coalesce((o.extra_fields ->> 'cancelled')::boolean, false) = false
      and not exists (
        select 1 from stock_reservations sr
        where sr.order_id = o.id and sr.quantity_released > 0
      )
  loop
    perform cancel_order_reservations(v_o.id);
    perform 1 from reserve_stock_for_order(v_o.id);
    v_cnt := v_cnt + 1;
  end loop;
  raise notice 'Przeliczono rezerwacje % zleceń STA NORMAL*', v_cnt;
end $$;

-- ── G1. Kontrola: NORMAL* wciąż bez profilu (mają zostać tylko kolory
--        bez receptury profilu + pominięte z wydaniami) ─────────────────
select o.id, o.order_number, o.frame_color, o.threshold_color, o.created_at::date
from orders o
where o.category = 'STA'
  and upper(trim(o.system)) like 'NORMAL%'
  and o.created_at >= '2026-09-04'
  and o.release_date is null
  and coalesce((o.extra_fields ->> 'cancelled')::boolean, false) = false
  and not exists (
    select 1 from stock_reservations sr
    join warehouse_components wc on wc.id = sr.component_id
    where sr.order_id = o.id and sr.status = 'reserved'
      and wc.name ilike 'PROFIL ALU%OŚCIEŻNICA%'
  )
order by o.id desc;

-- ── G2. Pominięte z wydaniami (dokładka DO-blockiem — sekcja 5
--        w recipes_part_prog.sql, podmień listę id) ─────────────────────
select distinct o.id, o.order_number, o.frame_color, o.threshold_color
from orders o
join stock_reservations sr on sr.order_id = o.id and sr.quantity_released > 0
where o.category = 'STA'
  and upper(trim(o.system)) like 'NORMAL%'
  and o.created_at >= '2026-09-04'
  and o.release_date is null
order by o.id desc;
