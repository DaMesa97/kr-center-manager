-- =====================================================================
-- ZWIAD #6 (2026-10-30) — MAGAZYN, paczka P1 (psuło dane albo blokowało pracę)
--
-- 1) Przyjęcie dostawy (receive_purchase_order): dwa komputery przyjmowały tę
--    samą pozycję (stan 20 przy zamówionych 10). Teraz: pozycja zamknięta /
--    w całości przyjęta = błąd „odśwież"; klient może przysłać expected_received
--    (ile widział) — niezgodność = błąd; nadwyżka ponad zamówienie tylko z
--    p_allow_over (kod błędu P0401 → UI pyta); nic nie przyjęto = błąd zamiast
--    „sukcesu" i zmiany statusu ZD; pozycja spoza ZD = błąd; magazyn musi być aktywny.
-- 2) Przywrócenie anulowanego zamówienia podwajało rezerwacje: restore brał
--    WSZYSTKIE wiersze cancelled (także unieważnione edycją / przeliczeniem).
--    Teraz: stock_reservations.cancel_reason (order_cancelled / superseded /
--    manual); restore przywraca tylko order_cancelled (stare wiersze bez powodu:
--    tylko ostatnia paczka anulowania) i przelicza stock_status zlecenia.
-- 3) Pusta receptura (kryteria, 0 pozycji) wygrywała dopasowanie i część
--    zostawała bez rezerwacji — receptura bez pozycji nie kandyduje; CHECK ilość > 0.
-- 4) Nieaktywny komponent w recepturze był rezerwowany — pomijany z issue
--    'inactive_component' (status partial_recipe), widać w brakach zlecenia.
--    + blokada zlecenia FOR UPDATE (podwójna rezerwacja z dwóch wywołań), qty ≤ 0 pomijane.
-- 5) Zamknięcie inwentaryzacji: przeliczanie braków per korekta × zlecenie
--    (6360 przeliczeń, 25 s > limit 8 s) → zbiór zleceń liczony raz po pętli.
-- 6) release_stock_for_stage / release_remaining_for_order bez kontroli
--    uprawnień — guardy jak przy oznaczaniu etapu / ruchach magazynowych.
-- + P2 tanie: unikalny indeks inventory_lines(session_id, component_id)
--   (duplikat księgował korektę 2×); trigger na DELETE stock_reservations
--   koryguje reserved_quantity (kaskada z usunięcia zlecenia zostawiała fantomy).
--
-- Bezpieczne do ponownego uruchomienia.
-- =====================================================================

-- ── 1) Przyjęcie dostawy ─────────────────────────────────────────────────
drop function if exists public.receive_purchase_order(bigint, bigint, jsonb, text, text);
drop function if exists public.receive_purchase_order__impl(bigint, bigint, jsonb, text, text);

create or replace function public.receive_purchase_order__impl(
  p_po_id bigint, p_warehouse_id bigint, p_received_items jsonb,
  p_reference_doc text default null, p_notes text default null, p_allow_over boolean default false
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_po_status text;
  v_received_item jsonb;
  v_po_item_id bigint;
  v_qty_received numeric;
  v_expected numeric;
  v_po_item record;
  v_comp_name text;
  v_new numeric;
  v_pz_items jsonb := '[]'::jsonb;
  v_zd_number text;
  v_all_completed boolean := true;
  v_any_received boolean := false;
  v_ref_base text;
  v_ref text;
  v_ref_no integer := 1;
begin
  -- FOR UPDATE: dwa równoległe przyjęcia tej samej ZD idą po kolei
  select status, zd_number into v_po_status, v_zd_number
  from purchase_orders where id = p_po_id
  for update;

  if v_po_status is null then
    raise exception 'Zamówienie % nie istnieje', p_po_id;
  end if;
  if v_po_status not in ('sent', 'partial') then
    raise exception 'Nie można przyjąć dostawy dla zamówienia w statusie %', v_po_status;
  end if;
  if p_warehouse_id is null then
    raise exception 'Wybierz magazyn docelowy';
  end if;
  if not exists (select 1 from warehouses w where w.id = p_warehouse_id and w.is_active) then
    raise exception 'Magazyn docelowy nie istnieje albo jest nieaktywny';
  end if;
  if p_received_items is null or jsonb_typeof(p_received_items) <> 'array' or jsonb_array_length(p_received_items) = 0 then
    raise exception 'Nic nie przyjęto — wpisz ilości większe od 0';
  end if;

  for v_received_item in select * from jsonb_array_elements(p_received_items)
  loop
    v_po_item_id := (v_received_item->>'po_item_id')::bigint;
    v_qty_received := (v_received_item->>'quantity_received')::numeric;
    v_expected := nullif(v_received_item->>'expected_received', '')::numeric;

    if v_qty_received is null or v_qty_received <= 0 then
      continue;
    end if;

    select i.*, c.name as component_name into v_po_item
    from purchase_order_items i
    left join warehouse_components c on c.id = i.component_id
    where i.id = v_po_item_id
    for update of i;

    if not found or v_po_item.purchase_order_id <> p_po_id then
      raise exception 'Pozycja % nie należy do zamówienia % — odśwież ekran', v_po_item_id, v_zd_number;
    end if;
    v_comp_name := coalesce(v_po_item.component_name, '#' || v_po_item.component_id);

    -- drugi komputer: pozycja zmieniła się od czasu wyświetlenia ekranu
    if v_po_item.status_per_item = 'cancelled' then
      raise exception 'Pozycja „%" została w międzyczasie zamknięta — odśwież ekran', v_comp_name;
    end if;
    if v_po_item.status_per_item = 'completed' then
      raise exception 'Pozycja „%" została już przyjęta w całości (% z %) — odśwież ekran; nadwyżkę przyjmij ręcznym PZ',
        v_comp_name, v_po_item.quantity_received, v_po_item.quantity_ordered;
    end if;
    if v_expected is not null and v_expected <> v_po_item.quantity_received then
      raise exception 'Pozycja „%" została w międzyczasie przyjęta na innym stanowisku (przyjęto już %, Ty widziałeś %) — odśwież ekran',
        v_comp_name, v_po_item.quantity_received, v_expected;
    end if;

    v_new := v_po_item.quantity_received + v_qty_received;
    if v_new > v_po_item.quantity_ordered and not p_allow_over then
      raise exception using
        errcode = 'P0401',
        message = format('Nadwyżka: „%s" zamówiono %s, po przyjęciu byłoby %s — potwierdź nadwyżkę albo popraw ilość',
                         v_comp_name, v_po_item.quantity_ordered, v_new);
    end if;

    update purchase_order_items
    set quantity_received = v_new,
        status_per_item = case when v_new >= quantity_ordered then 'completed' else 'partial' end
    where id = v_po_item_id;

    v_any_received := true;
    v_pz_items := v_pz_items || jsonb_build_object(
      'component_id', v_po_item.component_id,
      'quantity', v_qty_received,
      'notes', 'Przyjęcie z ' || v_zd_number
    );
  end loop;

  if not v_any_received then
    raise exception 'Nic nie przyjęto — wpisz ilości większe od 0';
  end if;

  -- Unikalna referencja PZ per dostawa: częściowe dostawy nie sklejają się w jeden dokument
  v_ref_base := coalesce(nullif(trim(p_reference_doc), ''), v_zd_number || '-PZ');
  v_ref := v_ref_base;
  while exists (select 1 from warehouse_movements m where m.reference_doc = v_ref) loop
    v_ref_no := v_ref_no + 1;
    v_ref := v_ref_base || '-' || v_ref_no;
  end loop;

  perform public.create_pz_document__impl(
    p_warehouse_id, v_pz_items, v_ref,
    coalesce(nullif(trim(p_notes), ''), 'Przyjęcie dostawy z ' || v_zd_number)
  );

  select not exists (
    select 1 from purchase_order_items
    where purchase_order_id = p_po_id and status_per_item in ('pending', 'partial')
  ) into v_all_completed;

  update purchase_orders
  set status = case when v_all_completed then 'completed' else 'partial' end,
      received_at = case when v_all_completed then now() else received_at end
  where id = p_po_id;
end;
$function$;

create or replace function public.receive_purchase_order(
  p_po_id bigint, p_warehouse_id bigint, p_received_items jsonb,
  p_reference_doc text default null, p_notes text default null, p_allow_over boolean default false
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.assert_warehouse_perm('movements');
  perform public.receive_purchase_order__impl(p_po_id, p_warehouse_id, p_received_items, p_reference_doc, p_notes, p_allow_over);
end;
$function$;

revoke all on function public.receive_purchase_order__impl(bigint, bigint, jsonb, text, text, boolean) from public, anon, authenticated;
revoke all on function public.receive_purchase_order(bigint, bigint, jsonb, text, text, boolean) from public, anon;
grant execute on function public.receive_purchase_order(bigint, bigint, jsonb, text, text, boolean) to authenticated, service_role;

-- ── 2) Rezerwacje: powód anulowania + przywracanie tylko po anulowaniu zlecenia ─
alter table public.stock_reservations add column if not exists cancel_reason text;
alter table public.stock_reservations drop constraint if exists stock_reservations_cancel_reason_check;
alter table public.stock_reservations add constraint stock_reservations_cancel_reason_check
  check (cancel_reason is null or cancel_reason in ('order_cancelled', 'superseded', 'manual'));

drop function if exists public.cancel_order_reservations__impl(bigint);
create or replace function public.cancel_order_reservations__impl(p_order_id bigint, p_reason text default 'order_cancelled')
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
  if p_reason not in ('order_cancelled', 'superseded', 'manual') then
    raise exception 'Nieznany powód anulowania rezerwacji: %', p_reason;
  end if;
  for v_res in
    select sr.id, sr.warehouse_id, sr.component_id, sr.quantity_reserved, sr.quantity_released
    from stock_reservations sr
    where sr.order_id = p_order_id and sr.status in ('reserved', 'partially_released')
    for update of sr
  loop
    v_rest := v_res.quantity_reserved - v_res.quantity_released;
    if v_rest > 0 then
      update warehouse_stock ws
      set reserved_quantity = ws.reserved_quantity - v_rest, updated_at = now()
      where ws.warehouse_id = v_res.warehouse_id and ws.component_id = v_res.component_id;
    end if;
    update stock_reservations sr
    set status = 'cancelled', cancel_reason = p_reason, updated_at = now()
    where sr.id = v_res.id;
    v_count := v_count + 1;
  end loop;

  if v_count > 0 then
    begin
      insert into audit_log (table_name, record_id, operation, user_id, new_data)
      values ('stock_reservations', p_order_id::text, 'UPDATE', auth.uid(),
              jsonb_build_object('action', 'cancel_reservations', 'order_id', p_order_id,
                                 'cancelled_count', v_count, 'reason', p_reason));
    exception when others then null;
    end;
  end if;
  return v_count;
end;
$function$;

-- wrapper 1-arg zostaje (anulowanie zlecenia); 2-arg dla edycji („superseded")
create or replace function public.cancel_order_reservations(p_order_id bigint, p_reason text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform assert_manager_or_service();
  return public.cancel_order_reservations__impl(p_order_id, p_reason);
end;
$function$;
revoke all on function public.cancel_order_reservations__impl(bigint, text) from public, anon, authenticated;
revoke all on function public.cancel_order_reservations(bigint, text) from public, anon;
grant execute on function public.cancel_order_reservations(bigint, text) to authenticated, service_role;

-- ręczne zwolnienie w Rezerwacjach = 'manual' (nie wraca przy przywróceniu zlecenia)
create or replace function public.cancel_reservation(p_reservation_id bigint)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_res record;
  v_rest numeric;
begin
  if not current_user_is_manager() then
    raise exception 'Tylko kierownik może ręcznie zwalniać rezerwacje';
  end if;
  select sr.* into v_res from stock_reservations sr where sr.id = p_reservation_id for update;
  if not found then
    raise exception 'Rezerwacja % nie istnieje', p_reservation_id;
  end if;
  if v_res.status not in ('reserved', 'partially_released') then
    return 0;
  end if;
  v_rest := v_res.quantity_reserved - v_res.quantity_released;
  if v_rest > 0 then
    update warehouse_stock ws
    set reserved_quantity = ws.reserved_quantity - v_rest, updated_at = now()
    where ws.warehouse_id = v_res.warehouse_id and ws.component_id = v_res.component_id;
  end if;
  update stock_reservations sr
  set status = 'cancelled', cancel_reason = 'manual', updated_at = now()
  where sr.id = p_reservation_id;
  begin
    insert into audit_log (table_name, record_id, operation, user_id, new_data)
    values ('stock_reservations', p_reservation_id::text, 'UPDATE', auth.uid(),
            jsonb_build_object('action', 'manual_release', 'reservation_id', p_reservation_id,
                               'order_id', v_res.order_id, 'component_id', v_res.component_id,
                               'freed_qty', greatest(v_rest, 0)));
  exception when others then null;
  end;
  return greatest(v_rest, 0);
end;
$function$;

-- przeliczenie receptur = unieważnienie starych wierszy, nie anulowanie zlecenia
create or replace function public.rebuild_reservations_for_category(p_category text, p_after_id bigint default 0, p_limit integer default 150)
returns table(r_rebuilt integer, r_skipped_released integer, r_failed integer, r_failed_orders text[], r_last_id bigint, r_done boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order record;
  v_rebuilt integer := 0;
  v_skipped integer := 0;
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
    if exists (select 1 from stock_reservations sr where sr.order_id = v_order.id and sr.status in ('released', 'partially_released')) then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    begin
      perform public.cancel_order_reservations__impl(v_order.id, 'superseded');
      perform 1 from public.reserve_stock_for_order(v_order.id);
      v_rebuilt := v_rebuilt + 1;
    exception when others then
      v_failed := v_failed + 1;
      if coalesce(array_length(v_failed_orders, 1), 0) < 20 then
        v_failed_orders := array_append(v_failed_orders, v_order.order_number || ': ' || sqlerrm);
      end if;
    end;
  end loop;
  r_rebuilt := v_rebuilt; r_skipped_released := v_skipped; r_failed := v_failed;
  r_failed_orders := v_failed_orders; r_last_id := v_last_id; r_done := v_seen < v_limit;
  return next;
end;
$function$;

create or replace function public.restore_order_reservations__impl(p_order_id bigint)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_res record;
  v_rest numeric;
  v_count integer := 0;
  v_last_batch timestamptz;
  v_issues jsonb;
  v_n int;
begin
  -- stare wiersze bez powodu: tylko ostatnia paczka anulowania (jedno wywołanie = jedno now())
  select max(updated_at) into v_last_batch
  from stock_reservations where order_id = p_order_id and status = 'cancelled' and cancel_reason is null;

  for v_res in
    select sr.id, sr.warehouse_id, sr.component_id, sr.quantity_reserved, sr.quantity_released
    from stock_reservations sr
    where sr.order_id = p_order_id
      and sr.status = 'cancelled'
      and sr.quantity_reserved - sr.quantity_released > 0
      and (sr.cancel_reason = 'order_cancelled'
           or (sr.cancel_reason is null and v_last_batch is not null and sr.updated_at >= v_last_batch - interval '2 seconds'))
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
    -- status braków z przywróconych rezerwacji (UI zerował go przy anulowaniu)
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

    begin
      insert into audit_log (table_name, record_id, operation, user_id, new_data)
      values ('stock_reservations', p_order_id::text, 'UPDATE', auth.uid(),
              jsonb_build_object('action', 'restore_reservations', 'order_id', p_order_id, 'restored_count', v_count));
    exception when others then null;
    end;
  end if;
  return v_count;
end;
$function$;

-- trigger: twarde usunięcie rezerwacji (kaskada z DELETE zlecenia) koryguje licznik
create or replace function public.stock_reservations_before_delete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if old.status in ('reserved', 'partially_released') and old.quantity_reserved - old.quantity_released > 0 then
    update warehouse_stock ws
    set reserved_quantity = ws.reserved_quantity - (old.quantity_reserved - old.quantity_released), updated_at = now()
    where ws.warehouse_id = old.warehouse_id and ws.component_id = old.component_id;
  end if;
  return old;
end;
$function$;
drop trigger if exists stock_reservations_before_delete on public.stock_reservations;
create trigger stock_reservations_before_delete
  before delete on public.stock_reservations
  for each row execute function public.stock_reservations_before_delete();

-- ── 3) Pusta receptura nie kandyduje; ilość w recepturze > 0 ─────────────
create or replace function public.match_recipes_for_order(p_order_id bigint)
returns table(recipe_id bigint, part text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with o as materialized (
    select (to_jsonb(orders.*) || jsonb_build_object(
      'side_panel_a_w', substring(coalesce(nullif(orders.side_panel_a, ''), orders.side_panel) from '^[0-9]+'),
      'side_panel_a_h', substring(coalesce(nullif(orders.side_panel_a, ''), orders.side_panel) from '[×xX]([0-9]+)'),
      'side_panel_b_w', substring(orders.side_panel_b from '^[0-9]+'),
      'side_panel_b_h', substring(orders.side_panel_b from '[×xX]([0-9]+)'),
      'top_light_w', substring(orders.top_light from '^[0-9]+'),
      'top_light_h', substring(orders.top_light from '[×xX]([0-9]+)')
    )) as j, orders.category
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
      -- receptura bez pozycji (np. przerwany zapis) nie może „wygrać" części
      and exists (select 1 from warehouse_recipe_components rc where rc.recipe_id = r.id)
      and not exists (
        select 1
        from warehouse_recipe_criteria c
        where c.recipe_id = r.id
          and not exists (
            select 1 from unnest(c.allowed_values) v
            where upper(trim(coalesce(o.j ->> c.field, ''))) = upper(trim(v))
               or (
                 trim(v) ~ '^[0-9]+\s*-\s*[0-9]+$'
                 and coalesce(o.j ->> c.field, '') ~ '^[0-9]+$'
                 and (o.j ->> c.field)::numeric
                     between split_part(replace(trim(v), ' ', ''), '-', 1)::numeric
                         and split_part(replace(trim(v), ' ', ''), '-', 2)::numeric
               )
          )
      )
  )
  select distinct on (cand.part) cand.id, cand.part
  from cand
  order by cand.part, cand.crit_count desc, cand.id desc
$function$;

alter table public.warehouse_recipe_components drop constraint if exists warehouse_recipe_components_quantity_check;
alter table public.warehouse_recipe_components add constraint warehouse_recipe_components_quantity_check check (quantity > 0);

-- ── 4) Rezerwacja: nieaktywny komponent pomijany z issue, blokada zlecenia ─
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
  v_expected_parts text[] := array['wing','frame','hardware'];
  v_missing_part text;
  v_issues jsonb := '[]'::jsonb;
  v_final_status text;
  v_incoming record;
begin
  -- blokada zlecenia: dwa równoległe wywołania (podwójny zapis / retry) idą po kolei
  select o.id, o.category, o.system, o.quantity, o.order_number
  into v_order
  from orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'Zamówienie % nie istnieje', p_order_id;
  end if;

  if exists (select 1 from stock_reservations sr where sr.order_id = p_order_id and sr.status <> 'cancelled') then
    r_component_id := null; r_component_name := 'Zamówienie ma już rezerwacje — pominięto'; r_component_code := '';
    r_quantity_reserved := 0; r_warehouse_code := ''; r_part := ''; r_stage_key := null; r_available_after := 0;
    r_incoming_qty := 0; r_earliest_eta := null; r_insufficient := false; r_status := 'already_reserved';
    return next;
    return;
  end if;

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

-- ── 5) Zamknięcie inwentaryzacji: braki zleceń raz po pętli ──────────────
-- Dla korekt zbieramy komponenty, potem JEDEN przebieg: (a) zlecenia, które mają
-- już brak któregoś z nich w tym magazynie → revalidate_order_stock_status raz;
-- (b) zlecenia z aktywną rezerwacją komponentów, których stan < rezerwacje, bez
-- tego braku → nowy issue (jak revalidate_orders_for_component, ale per zlecenie,
-- wszystkie komponenty naraz).
create or replace function public.close_inventory_session__impl(p_session_id integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_line record;
  v_diff numeric;
  v_warehouse_id int;
  v_wh_code text;
  v_audit_items jsonb := '[]'::jsonb;
  v_revalidated integer := 0;
  v_comp_ids bigint[] := array[]::bigint[];
  v_order_id bigint;
  v_r record;
  v_issues jsonb;
  v_added boolean;
begin
  select warehouse_id into v_warehouse_id
  from inventory_sessions where id = p_session_id and status = 'open'
  for update;
  if not found then
    raise exception 'Sesja nie istnieje lub jest już zamknięta';
  end if;
  if v_warehouse_id is null then
    raise exception 'Sesja bez magazynu — zamknij ją ręcznie (legacy)';
  end if;
  select code into v_wh_code from warehouses where id = v_warehouse_id;

  for v_line in
    select il.component_id, il.system_qty, il.counted_qty
    from inventory_lines il
    where il.session_id = p_session_id and il.counted_qty is not null
    order by il.id
  loop
    v_diff := v_line.counted_qty - v_line.system_qty;
    if v_diff = 0 then continue; end if;

    insert into warehouse_stock as ws (warehouse_id, component_id, quantity)
    values (v_warehouse_id, v_line.component_id, v_diff)
    on conflict (warehouse_id, component_id)
    do update set quantity = ws.quantity + v_diff, updated_at = now();

    insert into warehouse_movements (component_id, movement_type, quantity, warehouse_from_id, warehouse_to_id,
                                     reference_doc, notes, created_by, created_at)
    values (v_line.component_id, 'INW', abs(v_diff),
            case when v_diff < 0 then v_warehouse_id end, case when v_diff > 0 then v_warehouse_id end,
            'INW-' || p_session_id,
            'Korekta inwentaryzacyjna (' || case when v_diff > 0 then 'nadwyżka +' else 'niedobór -' end || abs(v_diff) || ')',
            auth.uid(), now());

    v_comp_ids := array_append(v_comp_ids, v_line.component_id);
    v_audit_items := v_audit_items || jsonb_build_object('component_id', v_line.component_id,
      'system_qty', v_line.system_qty, 'counted_qty', v_line.counted_qty, 'diff', v_diff);
  end loop;

  if coalesce(array_length(v_comp_ids, 1), 0) > 0 then
    -- (a) zlecenia z istniejącym brakiem któregoś ze skorygowanych komponentów w tym magazynie — raz na zlecenie
    for v_order_id in
      select distinct o.id
      from orders o
      where o.stock_status in ('insufficient', 'partial_recipe')
        and o.stock_issues is not null and jsonb_typeof(o.stock_issues) = 'array'
        and exists (
          select 1 from jsonb_array_elements(o.stock_issues) el
          join warehouse_components c on c.code = el->>'component_code'
          where coalesce(el->>'type', 'shortage') = 'shortage'
            and el->>'warehouse' = v_wh_code
            and c.id = any(v_comp_ids))
    loop
      perform revalidate_order_stock_status(v_order_id);
      v_revalidated := v_revalidated + 1;
    end loop;

    -- (b) stan spadł poniżej rezerwacji — zlecenia bez tego braku dostają issue (per zlecenie, wszystkie komponenty)
    for v_order_id in
      select distinct sr.order_id
      from stock_reservations sr
      join warehouse_stock ws on ws.warehouse_id = sr.warehouse_id and ws.component_id = sr.component_id
      where sr.warehouse_id = v_warehouse_id
        and sr.component_id = any(v_comp_ids)
        and sr.status in ('reserved', 'partially_released')
        and ws.reserved_quantity - ws.quantity > 0
    loop
      select stock_issues into v_issues from orders where id = v_order_id for update;
      if v_issues is null or jsonb_typeof(v_issues) <> 'array' then v_issues := '[]'::jsonb; end if;
      v_added := false;
      for v_r in
        select c.code, c.name, sum(sr.quantity_reserved - sr.quantity_released) as own,
               ws.reserved_quantity - ws.quantity as deficit
        from stock_reservations sr
        join warehouse_stock ws on ws.warehouse_id = sr.warehouse_id and ws.component_id = sr.component_id
        join warehouse_components c on c.id = sr.component_id
        where sr.order_id = v_order_id and sr.warehouse_id = v_warehouse_id
          and sr.component_id = any(v_comp_ids) and sr.status in ('reserved', 'partially_released')
          and ws.reserved_quantity - ws.quantity > 0
        group by c.code, c.name, ws.reserved_quantity, ws.quantity
        having sum(sr.quantity_reserved - sr.quantity_released) > 0
      loop
        if exists (select 1 from jsonb_array_elements(v_issues) el
                   where coalesce(el->>'type', 'shortage') = 'shortage'
                     and el->>'component_code' = v_r.code and el->>'warehouse' = v_wh_code) then
          continue;
        end if;
        v_issues := v_issues || jsonb_build_object('type', 'shortage', 'component_code', v_r.code,
          'component_name', v_r.name, 'shortage', least(v_r.own, v_r.deficit), 'warehouse', v_wh_code, 'part', 'other');
        v_added := true;
      end loop;
      if v_added then
        update orders
        set stock_issues = v_issues,
            stock_status = case when exists (select 1 from jsonb_array_elements(v_issues) el
                                              where el->>'type' in ('missing_recipe', 'missing_warehouse', 'inactive_component'))
                                then 'partial_recipe' else 'insufficient' end
        where id = v_order_id;
        v_revalidated := v_revalidated + 1;
      end if;
    end loop;
  end if;

  update inventory_sessions set status = 'closed', closed_by = auth.uid(), closed_at = now() where id = p_session_id;

  begin
    insert into audit_log (table_name, record_id, operation, user_id, new_data)
    values ('inventory_sessions', p_session_id::text, 'UPDATE', auth.uid(),
            jsonb_build_object('action', 'inventory_close', 'session_id', p_session_id, 'warehouse_id', v_warehouse_id,
                               'corrections', v_audit_items, 'revalidated_orders', v_revalidated));
  exception when others then null;
  end;
end;
$function$;

-- duplikat pozycji spisu (dwa komputery) księgował korektę dwa razy
create unique index if not exists inventory_lines_session_component_uq on public.inventory_lines (session_id, component_id);

-- ── 6) Wydania z magazynu tylko z uprawnieniem ────────────────────────────
-- (treść funkcji bez zmian — dokładamy guard na początku przez wrapper warunku)
do $$
declare
  v_src text;
begin
  select pg_get_functiondef('public.release_stock_for_stage(bigint, text, boolean)'::regprocedure) into v_src;
  if position('can_write_order_stage(p_order_id)' in v_src) = 0 then
    v_src := regexp_replace(v_src,
      '(\mbegin\M\s*\n\s*select o\.id, o\.category, o\.order_number into v_order)',
      E'begin\n  -- zwiad #6: zdjęcie towaru tylko przez osobę, która może oznaczyć etap tego zlecenia\n  if not public.can_write_order_stage(p_order_id) then\n    raise exception ''Brak uprawnień do wydania komponentów tego zlecenia (etap %)'', p_stage_key;\n  end if;\n  select o.id, o.category, o.order_number into v_order',
      '');
    execute v_src;
  end if;

  select pg_get_functiondef('public.release_remaining_for_order(bigint, boolean)'::regprocedure) into v_src;
  if position('assert_warehouse_perm(''movements'')' in v_src) = 0 then
    v_src := regexp_replace(v_src,
      '(\mbegin\M\s*\n\s*select o\.id, o\.category, o\.order_number into v_order)',
      E'begin\n  -- zwiad #6: wydanie końcowe = ruch magazynowy (kierownik / magazynier), nie każdy zalogowany\n  perform public.assert_warehouse_perm(''movements'');\n  select o.id, o.category, o.order_number into v_order',
      '');
    execute v_src;
  end if;
end $$;

-- kontrola: guardy weszły?
select proname,
       position('can_write_order_stage' in pg_get_functiondef(oid)) > 0 as guard_stage,
       position('assert_warehouse_perm' in pg_get_functiondef(oid)) > 0 as guard_movements
from pg_proc where proname in ('release_stock_for_stage', 'release_remaining_for_order') and pronamespace = 'public'::regnamespace;
