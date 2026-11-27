-- 27.11.2026 (testy 27.11, runda 3; KRYTYCZNY): rezerwacje etapów „nie dotyczy” (#ND) schodziły przy wydaniu końcowym.
-- excel-sync woła najpierw sync_releases_from_excel → release_remaining_for_order(force), które wydawało WSZYSTKIE
-- rezerwacje (WZ „Wydanie końcowe”, część na minus), a dopiero chwilę później sync_stages_from_excel wpisywało #ND —
-- cancel_stage_reservations__impl nie miało już czego anulować (rezerwacja była 'released'). Zlecenia id 17431, 17437,
-- 17588, 17589, 17625: 7 ram „RAMA KR 68 …” zeszło niepotrzebnie (korekta przeszłości: osobny plik 20261127233100).
-- Teraz:
--  1) cancel_stage_reservations__impl (woła je update_order_stage i sync_stages_from_excel przy wpisaniu #ND)
--     dodatkowo ZWRACA na stan to, co z rezerwacji tego etapu zeszło „Wydaniem końcowym” (WZ …-wydanie minus
--     ZWR …-wydanie z tym samym [RES-id]): ruch ZWR na ten sam magazyn, a rezerwacja → 'cancelled' / 'stage_na'
--     z quantity_released pomniejszonym o zwrot. ZWR ma też końcówkę „-wydanie” i [RES-id], więc drugi raz nie odda
--     (bilans = 0), a return_remaining_for_order nie rusza anulowanych. Rezerwacje wydane przez WYKONANY etap
--     (WZ …-<etap>) zostają jak były — materiał faktycznie zużyto.
--  2) release_remaining_for_order: przed wydaniem anuluje (przez cancel_stage_reservations__impl) aktywne rezerwacje
--     etapów, które w orders.production_stages mają #ND — nie wydaje ich.
--  3) return_remaining_for_order__impl (cofnięcie wydania): spójnie — etap #ND: zwrot tego, co zeszło wydaniem
--     końcowym, i anulowanie rezerwacji (nie przywraca do 'reserved'); wartości „#…” (#ND, #W) nie liczą się już jako
--     wykonany etap przy rezerwacjach bez etapu (te schodzą przy pierwszym WYKONANYM etapie).
-- DO WDROŻENIA (nie wgrane w sesji).

create or replace function public.cancel_stage_reservations__impl(p_order_id bigint, p_stage_key text)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_res record;
  v_rest numeric;
  v_back numeric;
  v_count integer := 0;
  v_returned integer := 0;
  v_order record;
begin
  select o.category, o.order_number into v_order from orders o where o.id = p_order_id;
  for v_res in
    select sr.id, sr.warehouse_id, sr.component_id, sr.quantity_reserved, sr.quantity_released, sr.status
    from stock_reservations sr
    where sr.order_id = p_order_id and sr.stage_key = p_stage_key
      and sr.status in ('reserved', 'partially_released', 'released')
    for update of sr
  loop
    v_rest := v_res.quantity_reserved - v_res.quantity_released;
    -- testy 27.11 (runda 3): ile z tej rezerwacji zeszło „Wydaniem końcowym” (WZ …-wydanie minus ZWR …-wydanie)
    v_back := 0;
    if v_res.quantity_released > 0 then
      select coalesce(sum(case when m.movement_type = 'WZ' then m.quantity else -m.quantity end), 0) into v_back
      from warehouse_movements m
      where m.order_id = p_order_id
        and m.movement_type in ('WZ', 'ZWR')
        and m.reference_doc like '%-wydanie'
        and m.notes like '%[RES-' || v_res.id || ']%';
      v_back := least(greatest(v_back, 0), v_res.quantity_released);
    end if;
    -- wydane przez wykonany etap — zostaje (materiał zużyty)
    if v_res.status = 'released' and v_back <= 0 then
      continue;
    end if;
    if v_rest > 0 then
      update warehouse_stock ws
      set reserved_quantity = ws.reserved_quantity - v_rest, updated_at = now()
      where ws.warehouse_id = v_res.warehouse_id and ws.component_id = v_res.component_id;
    end if;
    if v_back > 0 then
      insert into warehouse_movements(
        movement_type, warehouse_to_id, component_id, quantity,
        order_id, reference_doc, notes, created_by
      ) values (
        'ZWR', v_res.warehouse_id, v_res.component_id, v_back,
        p_order_id,
        'ZWR-' || v_order.category || '-' || coalesce(nullif(trim(v_order.order_number), ''), p_order_id::text) || '-wydanie',
        'Zwrot — etap nie dotyczy (#ND) — zamówienie ' || v_order.category
          || ' #' || coalesce(v_order.order_number, p_order_id::text) || ' [RES-' || v_res.id || ']',
        auth.uid()
      );
      insert into warehouse_stock as ws (warehouse_id, component_id, quantity, reserved_quantity)
      values (v_res.warehouse_id, v_res.component_id, v_back, 0)
      on conflict (warehouse_id, component_id)
      do update set quantity = ws.quantity + v_back, updated_at = now();
      v_returned := v_returned + 1;
    end if;
    update stock_reservations sr
    set status = 'cancelled', cancel_reason = 'stage_na',
        quantity_released = sr.quantity_released - v_back,
        updated_at = now()
    where sr.id = v_res.id;
    v_count := v_count + 1;
  end loop;
  if v_count > 0 then
    perform public.recompute_order_stock_status(p_order_id);
    begin
      insert into audit_log (table_name, record_id, operation, user_id, new_data)
      values ('stock_reservations', p_order_id::text, 'UPDATE', auth.uid(),
              jsonb_build_object('action', 'stage_not_applicable', 'order_id', p_order_id,
                                 'stage_key', p_stage_key, 'cancelled_count', v_count,
                                 'returned_count', v_returned));
    exception when others then null;
    end;
  end if;
  return v_count;
end;
$function$;

revoke all on function public.cancel_stage_reservations__impl(bigint, text) from public, anon, authenticated;

-- 2) release_remaining_for_order: etapy #ND anulowane przed wydaniem
do $$
declare
  d text;
  stare text := '-- PRZEBIEG 1 (pomijany przy p_force)';
  nowe text := '-- etapy „nie dotyczy” (#ND): rezerwacje anulujemy, nie wydajemy (testy 27.11, runda 3)
  perform public.cancel_stage_reservations__impl(p_order_id, x.stage_key)
  from (
    select distinct sr.stage_key
    from stock_reservations sr
    join orders o on o.id = sr.order_id
    where sr.order_id = p_order_id
      and sr.stage_key is not null
      and sr.status in (''reserved'', ''partially_released'')
      and upper(trim(coalesce(o.production_stages ->> sr.stage_key, ''''))) = ''#ND''
  ) x;

  -- PRZEBIEG 1 (pomijany przy p_force)';
begin
  d := pg_get_functiondef('public.release_remaining_for_order(bigint,boolean)'::regprocedure);
  if position('testy 27.11, runda 3' in d) > 0 then
    raise notice 'release_remaining_for_order: już poprawione — bez zmian';
    return;
  end if;
  if position(stare in d) = 0 then
    raise exception 'release_remaining_for_order: nie znaleziono miejsca łatki — sprawdź definicję';
  end if;
  execute replace(d, stare, nowe);
end $$;

-- 3) cofnięcie wydania: spójnie z #ND
create or replace function public.return_remaining_for_order__impl(p_order_id bigint)
 returns table(r_component_id bigint, r_component_name text, r_component_code text, r_quantity numeric, r_warehouse_code text)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_order record;
  v_stages jsonb;
  v_any_own_stage boolean;
  v_res record;
  v_out numeric;
begin
  select o.id, o.category, o.order_number, o.production_stages into v_order
  from orders o where o.id = p_order_id;
  if not found then
    raise exception 'Zamówienie % nie istnieje', p_order_id;
  end if;
  v_stages := coalesce(v_order.production_stages, '{}'::jsonb);
  -- testy 27.11 (runda 3): „#…” (#ND, #W) to nie wykonany etap
  v_any_own_stage := exists (
    select 1 from jsonb_each_text(v_stages) kv
    where coalesce(trim(kv.value), '') <> ''
      and trim(kv.value) not like '#%'
      and kv.key not like 'dist\_%'
      and kv.key not like 'sta\_%'
  );

  -- testy 27.11 (runda 3): etap „nie dotyczy” — to, co zeszło wydaniem końcowym, wraca na stan,
  -- a rezerwacja zostaje anulowana (nie wraca do 'reserved')
  perform public.cancel_stage_reservations__impl(p_order_id, x.stage_key)
  from (
    select distinct sr.stage_key
    from stock_reservations sr
    where sr.order_id = p_order_id
      and sr.stage_key is not null
      and sr.status in ('released', 'partially_released')
      and upper(trim(coalesce(v_stages ->> sr.stage_key, ''))) = '#ND'
  ) x;

  for v_res in
    select sr.id, sr.warehouse_id, sr.component_id, sr.stage_key, sr.quantity_released,
           c.name, c.code as comp_code, w.code as wh_code
    from stock_reservations sr
    join warehouse_components c on c.id = sr.component_id
    join warehouses w on w.id = sr.warehouse_id
    where sr.order_id = p_order_id
      and sr.status in ('released', 'partially_released')
      and sr.quantity_released > 0
      and (
        (sr.stage_key is not null and coalesce(trim(v_stages ->> sr.stage_key), '') = '')
        or (sr.stage_key is null and not v_any_own_stage)
      )
    for update of sr
  loop
    v_out := v_res.quantity_released;

    insert into warehouse_movements(
      movement_type, warehouse_to_id, component_id, quantity,
      order_id, reference_doc, notes, created_by
    ) values (
      'ZWR', v_res.warehouse_id, v_res.component_id, v_out,
      p_order_id,
      'ZWR-' || v_order.category || '-' || coalesce(nullif(trim(v_order.order_number), ''), p_order_id::text) || '-wydanie',
      'Zwrot po cofnięciu wydania — zamówienie ' || v_order.category
        || ' #' || coalesce(v_order.order_number, p_order_id::text) || ' [RES-' || v_res.id || ']',
      auth.uid()
    );

    insert into warehouse_stock as ws (warehouse_id, component_id, quantity, reserved_quantity)
    values (v_res.warehouse_id, v_res.component_id, v_out, v_out)
    on conflict (warehouse_id, component_id)
    do update set quantity = ws.quantity + v_out,
                  reserved_quantity = ws.reserved_quantity + v_out,
                  updated_at = now();

    update stock_reservations sr
    set quantity_released = 0, status = 'reserved', updated_at = now()
    where sr.id = v_res.id;

    r_component_id := v_res.component_id;
    r_component_name := v_res.name;
    r_component_code := v_res.comp_code;
    r_quantity := v_out;
    r_warehouse_code := v_res.wh_code;
    return next;
  end loop;
  return;
end;
$function$;

revoke all on function public.return_remaining_for_order__impl(bigint) from public, anon, authenticated;
