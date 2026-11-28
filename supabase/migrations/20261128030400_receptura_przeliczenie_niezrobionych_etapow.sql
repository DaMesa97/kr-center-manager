-- 28.11.2026 — decyzja D15 (właściciel: TAK, wariant a): zmiana receptury na zleceniach w produkcji — przeliczać
-- tylko NIEZROBIONE etapy, w jednej funkcji bazy.
-- Było: rebuild_reservations_for_category pomijało całe zlecenie, gdy cokolwiek z niego zeszło z magazynu
-- (STA 47/92, Disting 90/282 zleceń w produkcji nie dostawało nowej receptury).
-- Teraz:
--   * przelicz_niezrobione_etapy__impl(order) — w jednej transakcji, na jednym zleceniu:
--       - etap „zamrożony” = zrobiony (wpis w production_stages, nie '#…') ALBO ma rezerwację wydaną / częściowo
--         wydaną; rezerwacje bez etapu (stage_key null) są zamrożone, gdy coś z nich wydano;
--       - otwarte rezerwacje ('reserved') niezamrożonych etapów → anulowane (cancel_reason 'superseded'),
--         reserved_quantity na półkach w dół; stare anulowania tych etapów ('stage_na' / 'order_cancelled' / null)
--         → 'superseded' (świeże je zastępują, „Przywróć” ich nie podwoi — jak w reserve_stock_for_order);
--       - nowe rezerwacje z AKTUALNEJ receptury tylko dla niezamrożonych etapów (ta sama logika co
--         reserve_stock_for_order: magazyn części, '#ND' = anulowana 'stage_na', nieaktywny komponent = problem);
--       - stock_status / stock_issues: brak receptury / braki części jak w reserve_stock_for_order, inaczej
--         przeliczenie braków (recompute_order_stock_status).
--     Zrobionych etapów NIE rusza: co zeszło, zeszło wg starej receptury (bez dorabiania WZ / zwrotów).
--   * rebuild_reservations_for_category — zlecenie bez wydań: jak dotąd (anuluj wszystko + reserve_stock_for_order);
--     zlecenie z wydaniami: przelicz_niezrobione_etapy__impl zamiast pomijania. Nowa kolumna wyniku
--     r_partial_rebuilt (ile zleceń przeliczono tylko w niezrobionych etapach; wliczone też w r_rebuilt);
--     r_skipped_released zostaje dla zgodności (zawsze 0). Zmiana typu wyniku → drop + create.
--   * przelicz_niezrobione_etapy(order) — to samo dla jednego zlecenia z aplikacji (kierownik).
-- Przykład 28.11 (właściciel): w ST rama (RAMA KR 68) jest w recepturze przy etapie „oścież.”, który w ST jest
-- „nie dotyczy” — po przepięciu ramy na właściwy etap przeliczenie da rezerwację ramy zleceniom, w których ten
-- etap jeszcze NIE jest zrobiony. Zlecenia z tym etapem już zrobionym ramy nie dostaną (to byłoby dorabianie WZ
-- wstecz — osobna decyzja).
-- Zależności: brak (reserve_stock_for_order / cancel_order_reservations__impl / recompute_order_stock_status są na
-- produkcji). Aplikacja 1.1.7 czyta wynik po nazwach kolumn — działa (pokaże 0 pominiętych).
-- DO WDROŻENIA (nie wgrane).

create or replace function public.przelicz_niezrobione_etapy__impl(p_order_id bigint)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_order record;
  v_frozen text[];
  v_frozen_null boolean;
  v_res record;
  v_rest numeric;
  v_cancelled integer := 0;
  v_reserved integer := 0;
  v_match record;
  v_rec_comp record;
  v_wh_id bigint;
  v_total numeric;
  v_any_recipe boolean := false;
  v_matched_parts text[] := array[]::text[];
  v_expected_parts text[];
  v_missing_part text;
  v_issues jsonb := '[]'::jsonb;
  v_skip boolean;
begin
  select o.id, o.category, o.system, o.quantity, o.order_number, o.production_stages, o.release_date, o.extra_fields
  into v_order
  from orders o where o.id = p_order_id
  for update;
  if not found then raise exception 'Zamówienie % nie istnieje', p_order_id; end if;
  if v_order.release_date is not null or v_order.extra_fields->>'cancelled' = 'true' then
    return jsonb_build_object('status', 'pominiete');
  end if;

  -- etapy zamrożone: zrobione albo z czymkolwiek wydanym z magazynu
  select coalesce(array_agg(distinct s.k), array[]::text[]) into v_frozen
  from (
    select e.key as k
    from jsonb_each_text(case when jsonb_typeof(v_order.production_stages) = 'object'
                              then v_order.production_stages else '{}'::jsonb end) e
    where nullif(trim(e.value), '') is not null and left(trim(e.value), 1) <> '#'
    union
    select sr.stage_key from stock_reservations sr
    where sr.order_id = p_order_id and sr.stage_key is not null and sr.status in ('released', 'partially_released')
  ) s;
  v_frozen_null := exists (
    select 1 from stock_reservations sr
    where sr.order_id = p_order_id and sr.stage_key is null and sr.status in ('released', 'partially_released'));

  -- 1) otwarte rezerwacje niezamrożonych etapów → anulowane (superseded)
  for v_res in
    select sr.id, sr.warehouse_id, sr.component_id, sr.quantity_reserved, sr.quantity_released
    from stock_reservations sr
    where sr.order_id = p_order_id and sr.status = 'reserved'
      and case when sr.stage_key is null then not v_frozen_null else not (sr.stage_key = any(v_frozen)) end
    for update of sr
  loop
    v_rest := v_res.quantity_reserved - coalesce(v_res.quantity_released, 0);
    if v_rest > 0 then
      update warehouse_stock ws
         set reserved_quantity = ws.reserved_quantity - v_rest, updated_at = now()
       where ws.warehouse_id = v_res.warehouse_id and ws.component_id = v_res.component_id;
    end if;
    update stock_reservations sr
       set status = 'cancelled', cancel_reason = 'superseded', updated_at = now()
     where sr.id = v_res.id;
    v_cancelled := v_cancelled + 1;
  end loop;

  update stock_reservations sr
     set cancel_reason = 'superseded', updated_at = now()
   where sr.order_id = p_order_id and sr.status = 'cancelled'
     and (sr.cancel_reason in ('stage_na', 'order_cancelled') or sr.cancel_reason is null)
     and case when sr.stage_key is null then not v_frozen_null else not (sr.stage_key = any(v_frozen)) end;

  -- 2) nowe rezerwacje z aktualnej receptury — tylko niezamrożone etapy (logika jak reserve_stock_for_order)
  v_expected_parts := public.expected_parts_for_category(v_order.category);
  for v_match in select m.recipe_id, m.part from match_recipes_for_order(p_order_id) m loop
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

    for v_rec_comp in
      select rc.component_id as comp_id, rc.quantity as per_unit, rc.stage_key, c.name, c.code as comp_code, c.is_active
      from warehouse_recipe_components rc
      join warehouse_components c on c.id = rc.component_id
      where rc.recipe_id = v_match.recipe_id
    loop
      if not v_rec_comp.is_active then
        v_issues := v_issues || jsonb_build_object(
          'type', 'inactive_component', 'part', v_match.part,
          'component_code', v_rec_comp.comp_code, 'component_name', v_rec_comp.name,
          'message', 'Receptura (' || v_match.part || ') używa komponentu usuniętego z kartoteki: ' || v_rec_comp.name);
        continue;
      end if;
      v_skip := case when v_rec_comp.stage_key is null then v_frozen_null else v_rec_comp.stage_key = any(v_frozen) end;
      if v_skip then continue; end if;

      v_total := v_rec_comp.per_unit * coalesce(v_order.quantity, 1);
      if v_total <= 0 then continue; end if;

      if v_rec_comp.stage_key is not null
         and upper(coalesce(v_order.production_stages->>v_rec_comp.stage_key, '')) = '#ND' then
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
      v_reserved := v_reserved + 1;
    end loop;
  end loop;

  foreach v_missing_part in array coalesce(v_expected_parts, array[]::text[]) loop
    if not (v_missing_part = any(v_matched_parts)) then
      v_issues := v_issues || jsonb_build_object('type', 'missing_recipe', 'part', v_missing_part,
                                                 'message', 'Brak receptury dla części: ' || v_missing_part);
    end if;
  end loop;

  -- 3) status magazynowy zlecenia
  if not v_any_recipe then
    update orders set stock_status = 'no_recipe', stock_issues = v_issues where id = p_order_id;
  elsif jsonb_array_length(v_issues) > 0 then
    update orders set stock_status = 'partial_recipe', stock_issues = v_issues where id = p_order_id;
  else
    update orders set stock_status = 'ok', stock_issues = null where id = p_order_id;
    perform public.recompute_order_stock_status(p_order_id);
  end if;

  return jsonb_build_object('status', 'przeliczone', 'anulowano', v_cancelled, 'zarezerwowano', v_reserved,
                            'etapy_zamrozone', to_jsonb(v_frozen), 'bez_etapu_zamrozone', v_frozen_null);
end;
$function$;

revoke all on function public.przelicz_niezrobione_etapy__impl(bigint) from public, anon, authenticated;

create or replace function public.przelicz_niezrobione_etapy(p_order_id bigint)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  perform assert_manager_or_service();
  return public.przelicz_niezrobione_etapy__impl(p_order_id);
end;
$function$;

revoke all on function public.przelicz_niezrobione_etapy(bigint) from public, anon;
grant execute on function public.przelicz_niezrobione_etapy(bigint) to authenticated, service_role;

drop function if exists public.rebuild_reservations_for_category(text, bigint, integer);

create function public.rebuild_reservations_for_category(p_category text, p_after_id bigint default 0, p_limit integer default 150)
 returns table(r_rebuilt integer, r_skipped_released integer, r_failed integer, r_failed_orders text[], r_last_id bigint, r_done boolean, r_partial_rebuilt integer)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_order record;
  v_rebuilt integer := 0;
  v_partial integer := 0;
  v_failed integer := 0;
  v_failed_orders text[] := array[]::text[];
  v_last_id bigint := coalesce(p_after_id, 0);
  v_seen integer := 0;
  v_limit integer := least(greatest(coalesce(p_limit, 150), 1), 500);
begin
  perform assert_manager_or_service();
  for v_order in
    select o.id, o.order_number
    from orders o
    where o.category = p_category
      and o.id > v_last_id
      and (o.release_date is null or trim(o.release_date::text) = '')
      and coalesce((o.extra_fields->>'cancelled')::boolean, false) = false
    order by o.id
    limit v_limit
  loop
    v_seen := v_seen + 1;
    v_last_id := v_order.id;
    begin
      if exists (select 1 from stock_reservations sr where sr.order_id = v_order.id and sr.status in ('released', 'partially_released')) then
        -- D15: coś już zeszło → przeliczamy tylko niezrobione etapy
        perform public.przelicz_niezrobione_etapy__impl(v_order.id);
        v_partial := v_partial + 1;
      else
        perform public.cancel_order_reservations__impl(v_order.id, 'superseded');
        perform 1 from public.reserve_stock_for_order(v_order.id);
      end if;
      v_rebuilt := v_rebuilt + 1;
    exception when others then
      v_failed := v_failed + 1;
      if coalesce(array_length(v_failed_orders, 1), 0) < 20 then
        v_failed_orders := array_append(v_failed_orders, v_order.order_number || ': ' || sqlerrm);
      end if;
    end;
  end loop;
  r_rebuilt := v_rebuilt; r_skipped_released := 0; r_failed := v_failed;
  r_failed_orders := v_failed_orders; r_last_id := v_last_id; r_done := v_seen < v_limit;
  r_partial_rebuilt := v_partial;
  return next;
end;
$function$;

revoke all on function public.rebuild_reservations_for_category(text, bigint, integer) from public, anon;
grant execute on function public.rebuild_reservations_for_category(text, bigint, integer) to authenticated, service_role;
