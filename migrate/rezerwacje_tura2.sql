-- =====================================================================
-- REZERWACJE — TURA 2: PODGLĄD STANÓW PRZED ZAPISEM (baner w formularzu)
-- Wymaga: rezerwacje_tura1.sql wykonane wcześniej.
--
-- preview_order_stock(p_payload jsonb) — TYLKO ODCZYT, nic nie zapisuje.
-- Payload = pola formularza jako jsonb (category, quantity, system,
-- model, wing_color, ...). Dopasowanie receptur IDENTYCZNE jak w
-- match_recipes_for_order (tam: to_jsonb(orders.*), tu: p_payload) —
-- KAŻDE kryterium spełnione, TRIM+UPPER, wygrywa najwięcej kryteriów,
-- remis → wyższe id.
--
-- ODSTĘPSTWO od briefu: zamiast preview_order_stock(p_category,
-- p_quantity, p_payload) jest JEDEN parametr jsonb — kategoria i ilość
-- siedzą w payloadzie (payload i tak musi je mieć, żeby matcher
-- działał 1:1 jak na wierszu orders). Mniej duplikacji.
-- =====================================================================

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
            and upper(trim(coalesce(p_payload ->> c.field, ''))) <> all (
              select upper(trim(v)) from unnest(c.allowed_values) v
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

-- ── WERYFIKACJA ───────────────────────────────────────────────────────
-- Podgląd na payloadzie skopiowanym z realnego zlecenia (podstaw ID):
-- select p.* from orders o, lateral preview_order_stock(to_jsonb(o.*)) p
-- where o.id = 12939;
-- Wynik ma się zgadzać komponent-w-komponent z match_recipes_for_order.
