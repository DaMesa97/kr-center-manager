-- =====================================================================
-- „Nie dotyczy" zwalnia rezerwację magazynową etapu (Tymek, 3.11.2026).
--
-- Etap '#ND' → rezerwacje tego etapu (stock_reservations.stage_key) idą
-- w 'cancelled' z cancel_reason = 'stage_na', reserved_quantity spada.
-- Zdjęcie '#ND' (Wznów / inna wartość) → te rezerwacje wracają.
-- Przeliczenie rezerwacji po edycji zlecenia (reserve_stock_for_order)
-- zakłada wiersze etapu '#ND' od razu jako zwolnione, więc Wznów ma co
-- przywrócić. Rezerwacje bez stage_key (fallback) zostają bez zmian.
-- update_order_stage zwraca teraz jsonb {freed, restored} (było void) —
-- klienci beta.82/83 ignorują wynik, więc to bezpieczne.
-- Idempotentne. Test: scratchpad zwiad7/test_nd_rezerwacje.sql (ROLLBACK).
-- =====================================================================

alter table public.stock_reservations drop constraint if exists stock_reservations_cancel_reason_check;
alter table public.stock_reservations add constraint stock_reservations_cancel_reason_check
  check (cancel_reason is null or cancel_reason in ('order_cancelled', 'superseded', 'manual', 'stage_na'));

-- status braków zlecenia z aktywnych rezerwacji (ta sama logika co restore_order_reservations)
create or replace function public.recompute_order_stock_status(p_order_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_issues jsonb;
  v_n int;
  v_status text;
begin
  select stock_status into v_status from orders where id = p_order_id;
  -- bez receptur / z częściową recepturą — nie ruszamy (to nie jest kwestia stanów)
  if v_status in ('no_recipe', 'partial_recipe') then
    return;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'type', 'shortage', 'component_code', c.code, 'component_name', c.name,
           'shortage', least(x.own, ws.reserved_quantity - ws.quantity), 'warehouse', w.code, 'part', 'other')), '[]'::jsonb),
         count(*)
  into v_issues, v_n
  from (
    select sr.component_id, sr.warehouse_id, sum(sr.quantity_reserved - sr.quantity_released) as own
    from stock_reservations sr
    where sr.order_id = p_order_id and sr.status in ('reserved', 'partially_released')
    group by 1, 2
  ) x
  join warehouse_stock ws on ws.component_id = x.component_id and ws.warehouse_id = x.warehouse_id
  join warehouse_components c on c.id = x.component_id
  join warehouses w on w.id = x.warehouse_id
  where ws.quantity - ws.reserved_quantity < 0 and x.own > 0;
  update orders
  set stock_status = case when v_n > 0 then 'insufficient' else 'ok' end,
      stock_issues = case when v_n > 0 then v_issues else null end
  where id = p_order_id;
end;
$function$;

-- zwolnij rezerwacje etapu (nie dotyczy)
create or replace function public.cancel_stage_reservations__impl(p_order_id bigint, p_stage_key text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_res record;
  v_rest numeric;
  v_count integer := 0;
begin
  for v_res in
    select sr.id, sr.warehouse_id, sr.component_id, sr.quantity_reserved, sr.quantity_released
    from stock_reservations sr
    where sr.order_id = p_order_id and sr.stage_key = p_stage_key
      and sr.status in ('reserved', 'partially_released')
    for update of sr
  loop
    v_rest := v_res.quantity_reserved - v_res.quantity_released;
    if v_rest > 0 then
      update warehouse_stock ws
      set reserved_quantity = ws.reserved_quantity - v_rest, updated_at = now()
      where ws.warehouse_id = v_res.warehouse_id and ws.component_id = v_res.component_id;
    end if;
    update stock_reservations sr
    set status = 'cancelled', cancel_reason = 'stage_na', updated_at = now()
    where sr.id = v_res.id;
    v_count := v_count + 1;
  end loop;
  if v_count > 0 then
    perform public.recompute_order_stock_status(p_order_id);
    begin
      insert into audit_log (table_name, record_id, operation, user_id, new_data)
      values ('stock_reservations', p_order_id::text, 'UPDATE', auth.uid(),
              jsonb_build_object('action', 'stage_not_applicable', 'order_id', p_order_id,
                                 'stage_key', p_stage_key, 'cancelled_count', v_count));
    exception when others then null;
    end;
  end if;
  return v_count;
end;
$function$;

-- przywróć rezerwacje etapu zwolnione przez „nie dotyczy"
create or replace function public.restore_stage_reservations__impl(p_order_id bigint, p_stage_key text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_res record;
  v_rest numeric;
  v_count integer := 0;
begin
  for v_res in
    select sr.id, sr.warehouse_id, sr.component_id, sr.quantity_reserved, sr.quantity_released
    from stock_reservations sr
    where sr.order_id = p_order_id and sr.stage_key = p_stage_key
      and sr.status = 'cancelled' and sr.cancel_reason = 'stage_na'
      and sr.quantity_reserved - sr.quantity_released > 0
    for update of sr
  loop
    v_rest := v_res.quantity_reserved - v_res.quantity_released;
    insert into warehouse_stock as ws (warehouse_id, component_id, quantity, reserved_quantity)
    values (v_res.warehouse_id, v_res.component_id, 0, v_rest)
    on conflict (warehouse_id, component_id)
    do update set reserved_quantity = ws.reserved_quantity + v_rest, updated_at = now();
    update stock_reservations sr
    set status = case when v_res.quantity_released > 0 then 'partially_released' else 'reserved' end,
        cancel_reason = null, updated_at = now()
    where sr.id = v_res.id;
    v_count := v_count + 1;
  end loop;
  if v_count > 0 then
    perform public.recompute_order_stock_status(p_order_id);
    begin
      insert into audit_log (table_name, record_id, operation, user_id, new_data)
      values ('stock_reservations', p_order_id::text, 'UPDATE', auth.uid(),
              jsonb_build_object('action', 'stage_applicable_again', 'order_id', p_order_id,
                                 'stage_key', p_stage_key, 'restored_count', v_count));
    exception when others then null;
    end;
  end if;
  return v_count;
end;
$function$;

-- update_order_stage: zmiana typu wyniku (void → jsonb) wymaga DROP
drop function if exists public.update_order_stage(bigint, text, text);
create function public.update_order_stage(p_order_id bigint, p_stage_key text, p_stage_value text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cur text;
  v_new text := coalesce(trim(p_stage_value), '');
  v_mirror boolean := p_stage_key like 'sta\_%' or p_stage_key like 'dist\_%';
  v_special boolean;
  v_freed integer := 0;
  v_restored integer := 0;
begin
  if not public.can_write_order_stage(p_order_id) then
    raise exception 'Brak uprawnień do oznaczania etapów tego zlecenia (etap nie jest przypisany do Twojego stanowiska)';
  end if;
  select coalesce(trim(production_stages->>p_stage_key), '') into v_cur
  from orders where id = p_order_id for update;
  if not found then
    raise exception 'Zlecenie % nie istnieje', p_order_id;
  end if;
  v_special := v_new like '#%' or v_cur like '#%';
  -- stany specjalne (nie dotyczy / wstrzymane) ustawia i zdejmuje kierownik
  if v_special
     and not (coalesce(auth.role(), '') = 'service_role' or session_user = 'postgres' or public.current_user_is_manager()) then
    raise exception 'Stan „nie dotyczy" / „wstrzymane" ustawia i zdejmuje kierownik.' using errcode = 'P0404';
  end if;
  -- konflikt dwóch osób: tylko między inicjałami (stan specjalny kierownik nadpisuje swobodnie)
  if v_new <> '' and v_cur <> '' and upper(v_cur) <> upper(v_new) and not v_mirror
     and v_cur not like '#%' and v_new not like '#%' then
    raise exception 'Ten etap jest już oznaczony (%). Lista się odświeży.', v_cur using errcode = 'P0402';
  end if;
  if v_new = '' and v_cur <> '' and v_cur not like '#%' and not public.stage_value_owned_by_caller(v_cur) then
    raise exception 'To wpis innej osoby (%). Cofnąć może % albo kierownik.', v_cur, v_cur using errcode = 'P0403';
  end if;
  update orders
  set production_stages = coalesce(production_stages, '{}'::jsonb)
    || jsonb_build_object(p_stage_key, p_stage_value)
  where id = p_order_id;
  -- „nie dotyczy": rezerwacja części na ten etap wraca na magazyn; zdjęcie — wraca rezerwacja
  if not v_mirror then
    if upper(v_new) = '#ND' and upper(v_cur) <> '#ND' then
      v_freed := public.cancel_stage_reservations__impl(p_order_id, p_stage_key);
    elsif upper(v_cur) = '#ND' and upper(v_new) <> '#ND' then
      v_restored := public.restore_stage_reservations__impl(p_order_id, p_stage_key);
    end if;
  end if;
  return jsonb_build_object('freed', v_freed, 'restored', v_restored);
end;
$function$;
revoke all on function public.update_order_stage(bigint, text, text) from public, anon;
grant execute on function public.update_order_stage(bigint, text, text) to authenticated, service_role;

-- reserve_stock_for_order: etap '#ND' → wiersz od razu zwolniony (stage_na), bez reserved_quantity
create or replace function public.reserve_stock_for_order(p_order_id bigint)
returns table(r_component_id bigint, r_component_name text, r_component_code text, r_quantity_reserved numeric, r_warehouse_code text, r_part text, r_stage_key text, r_available_after numeric, r_incoming_qty numeric, r_earliest_eta date, r_insufficient boolean, r_status text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order record;
  v_match record;
  v_rec_comp record;
  v_wh_id bigint;
  v_wh_code text;
  v_total numeric;
  v_stock record;
  v_available_after numeric;
  v_any_recipe boolean := false;
  v_matched_parts text[] := array[]::text[];
  v_expected_parts text[];
  v_missing_part text;
  v_issues jsonb := '[]'::jsonb;
  v_final_status text;
  v_incoming record;
  v_stage_na boolean;
begin
  -- blokada zlecenia: dwa równoległe wywołania (podwójny zapis / retry) idą po kolei
  select o.id, o.category, o.system, o.quantity, o.order_number, o.production_stages
  into v_order
  from orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'Zamówienie % nie istnieje', p_order_id;
  end if;
  v_expected_parts := public.expected_parts_for_category(v_order.category);

  if exists (select 1 from stock_reservations sr where sr.order_id = p_order_id and sr.status <> 'cancelled') then
    r_component_id := null; r_component_name := 'Zamówienie ma już rezerwacje — pominięto'; r_component_code := '';
    r_quantity_reserved := 0; r_warehouse_code := ''; r_part := ''; r_stage_key := null; r_available_after := 0;
    r_incoming_qty := 0; r_earliest_eta := null; r_insufficient := false; r_status := 'already_reserved';
    return next;
    return;
  end if;

  -- poprzednia generacja rezerwacji (po edycji / przeliczeniu): wiersze „nie dotyczy"
  -- stają się superseded, żeby Wznów nie przywrócił ich podwójnie obok nowych
  update stock_reservations sr
  set cancel_reason = 'superseded', updated_at = now()
  where sr.order_id = p_order_id and sr.status = 'cancelled' and sr.cancel_reason = 'stage_na';

  for v_match in
    select m.recipe_id, m.part from match_recipes_for_order(p_order_id) m
  loop
    v_any_recipe := true;
    v_matched_parts := array_append(v_matched_parts, v_match.part);

    v_wh_id := resolve_warehouse_for_part(v_order.category, v_order.system, v_match.part);
    if v_wh_id is null then
      v_issues := v_issues || jsonb_build_object(
        'type', 'missing_warehouse', 'part', v_match.part,
        'message', 'Brak przypisania magazynu dla części: ' || v_match.part
          || ' (kategoria ' || v_order.category || ', system ' || coalesce(v_order.system, '—') || ')');
      continue;
    end if;
    select w.code into v_wh_code from warehouses w where w.id = v_wh_id;

    for v_rec_comp in
      select rc.component_id as comp_id, rc.quantity as per_unit, rc.stage_key,
             c.name, c.code as comp_code, c.is_active
      from warehouse_recipe_components rc
      join warehouse_components c on c.id = rc.component_id
      where rc.recipe_id = v_match.recipe_id
    loop
      -- komponent usunięty z kartoteki (is_active=false) — nie rezerwujemy, zgłaszamy
      if not v_rec_comp.is_active then
        v_issues := v_issues || jsonb_build_object(
          'type', 'inactive_component', 'part', v_match.part,
          'component_code', v_rec_comp.comp_code, 'component_name', v_rec_comp.name,
          'message', 'Receptura (' || v_match.part || ') używa komponentu usuniętego z kartoteki: ' || v_rec_comp.name);
        continue;
      end if;

      v_total := v_rec_comp.per_unit * coalesce(v_order.quantity, 1);
      if v_total <= 0 then
        continue;
      end if;

      -- etap „nie dotyczy": wiersz rezerwacji od razu zwolniony (żeby Wznów miał co przywrócić),
      -- stan reserved_quantity nietknięty
      v_stage_na := v_rec_comp.stage_key is not null
        and upper(coalesce(v_order.production_stages->>v_rec_comp.stage_key, '')) = '#ND';
      if v_stage_na then
        insert into stock_reservations (order_id, warehouse_id, component_id, stage_key, quantity_reserved, status, cancel_reason)
        values (p_order_id, v_wh_id, v_rec_comp.comp_id, v_rec_comp.stage_key, v_total, 'cancelled', 'stage_na');
        continue;
      end if;

      insert into warehouse_stock as ws (warehouse_id, component_id, quantity, reserved_quantity)
      values (v_wh_id, v_rec_comp.comp_id, 0, v_total)
      on conflict (warehouse_id, component_id)
      do update set reserved_quantity = ws.reserved_quantity + v_total, updated_at = now();

      insert into stock_reservations (order_id, warehouse_id, component_id, stage_key, quantity_reserved)
      values (p_order_id, v_wh_id, v_rec_comp.comp_id, v_rec_comp.stage_key, v_total);

      select ws.quantity, ws.reserved_quantity into v_stock
      from warehouse_stock ws where ws.warehouse_id = v_wh_id and ws.component_id = v_rec_comp.comp_id;
      v_available_after := coalesce(v_stock.quantity, 0) - coalesce(v_stock.reserved_quantity, 0);

      select i.r_incoming_qty, i.r_earliest_eta into v_incoming
      from get_incoming_stock_per_component() i where i.r_component_id = v_rec_comp.comp_id;

      if v_available_after < 0 then
        v_issues := v_issues || jsonb_build_object(
          'type', 'shortage', 'component_code', v_rec_comp.comp_code, 'component_name', v_rec_comp.name,
          'shortage', -v_available_after, 'warehouse', v_wh_code, 'part', v_match.part,
          'incoming_qty', coalesce(v_incoming.r_incoming_qty, 0), 'earliest_eta', v_incoming.r_earliest_eta);
      end if;

      r_component_id := v_rec_comp.comp_id; r_component_name := v_rec_comp.name; r_component_code := v_rec_comp.comp_code;
      r_quantity_reserved := v_total; r_warehouse_code := v_wh_code; r_part := v_match.part; r_stage_key := v_rec_comp.stage_key;
      r_available_after := v_available_after; r_incoming_qty := coalesce(v_incoming.r_incoming_qty, 0);
      r_earliest_eta := v_incoming.r_earliest_eta; r_insufficient := v_available_after < 0;
      r_status := case when v_available_after < 0 then 'insufficient' else 'ok' end;
      return next;
    end loop;
  end loop;

  foreach v_missing_part in array v_expected_parts loop
    if not (v_missing_part = any(v_matched_parts)) then
      v_issues := v_issues || jsonb_build_object('type', 'missing_recipe', 'part', v_missing_part,
                                                 'message', 'Brak receptury dla części: ' || v_missing_part);
    end if;
  end loop;

  if not v_any_recipe then
    v_final_status := 'no_recipe';
    update orders set stock_status = v_final_status, stock_issues = v_issues where id = p_order_id;
    r_component_id := null; r_component_name := 'Brak pasujących receptur'; r_component_code := ''; r_quantity_reserved := 0;
    r_warehouse_code := ''; r_part := ''; r_stage_key := null; r_available_after := 0; r_incoming_qty := 0;
    r_earliest_eta := null; r_insufficient := false; r_status := 'no_recipe';
    return next;
  elsif jsonb_array_length(v_issues) > 0 then
    if exists (select 1 from jsonb_array_elements(v_issues) el where el->>'type' in ('missing_recipe', 'missing_warehouse', 'inactive_component')) then
      v_final_status := 'partial_recipe';
    else
      v_final_status := 'insufficient';
    end if;
    update orders set stock_status = v_final_status, stock_issues = v_issues where id = p_order_id;
  else
    update orders set stock_status = 'ok', stock_issues = null where id = p_order_id;
  end if;
  return;
end;
$function$;
