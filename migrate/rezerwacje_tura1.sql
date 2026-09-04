-- =====================================================================
-- REZERWACJE MAGAZYNOWE — TURA 1: fundament SQL
-- Dwustopniowy stan: rezerwacja przy utworzeniu zamówienia (stan fizyczny
-- bez zmian) → wydanie fizyczne (WZ) przy oznaczeniu etapu jako zrobiony.
--
-- NIE rusza: consume_stock_for_order, return_stock_for_order,
-- match_recipes_for_order, resolve_warehouse_for_part, modułu PO dostawców.
--
-- ODSTĘPSTWA OD BRIEFU (wyjaśnione, zgodne z istniejącą strukturą):
-- 1. match_recipes_for_order zwraca u nas (recipe_id, part) — komponenty
--    z ilościami i stage_key dociągane są joinem z warehouse_recipe_components
--    (dokładnie tak, jak robi to consume_stock_for_order). Nie zmieniam
--    kształtu tej funkcji.
-- 2. ETA "w drodze" bierzemy z purchase_orders.expected_delivery_date —
--    w naszym module PO ETA jest na poziomie zamówienia, nie pozycji.
-- 3. Fallback stage_key IS NULL: wydaje się przy PIERWSZYM UKOŃCZONYM
--    etapie zamówienia (a nie "pierwszym etapie z definicji kategorii") —
--    produkcja jest nieliniowa (e3 bywa przed e1), więc "pierwszy etap
--    z definicji" mógłby nigdy nie być tym klikniętym jako pierwszy.
-- 4. orders.stock_status zostaje przy ISTNIEJĄCYCH wartościach
--    (ok / insufficient / partial_recipe / no_recipe) — badge w UI działa
--    bez zmian. 'insufficient' przy rezerwacji = "dostępne po rezerwacji
--    < 0" (fizycznie towar może jeszcze leżeć — to ostrzeżenie, nie brak).
-- 5. available_quantity = kolumna GENERATED STORED (nie widok) — czyta się
--    wszędzie tak samo jak zwykła kolumna, zero zmian w istniejących SELECT.
-- =====================================================================

-- ── 1. KOLUMNY ────────────────────────────────────────────────────────

alter table public.warehouse_recipe_components
  add column if not exists stage_key text;

alter table public.warehouse_stock
  add column if not exists reserved_quantity numeric not null default 0;

alter table public.warehouse_stock
  add column if not exists available_quantity numeric
  generated always as (quantity - reserved_quantity) stored;

-- ── 2. TABELA REZERWACJI ─────────────────────────────────────────────

create table if not exists public.stock_reservations (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  warehouse_id bigint not null references public.warehouses(id),
  component_id bigint not null references public.warehouse_components(id),
  stage_key text,
  quantity_reserved numeric not null check (quantity_reserved > 0),
  quantity_released numeric not null default 0,
  status text not null default 'reserved'
    check (status in ('reserved', 'partially_released', 'released', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_reservations_order on public.stock_reservations(order_id);
create index if not exists idx_reservations_component on public.stock_reservations(component_id, status);
create index if not exists idx_reservations_stage on public.stock_reservations(order_id, stage_key, status);

alter table public.stock_reservations enable row level security;

drop policy if exists stock_reservations_read on public.stock_reservations;
create policy stock_reservations_read on public.stock_reservations
  for select to authenticated using (true);
-- zapisy idą przez RPC (SECURITY DEFINER); ręcznie może tylko kierownik/admin
drop policy if exists stock_reservations_insert on public.stock_reservations;
create policy stock_reservations_insert on public.stock_reservations
  for insert to authenticated with check (public.current_user_is_manager());
drop policy if exists stock_reservations_update on public.stock_reservations;
create policy stock_reservations_update on public.stock_reservations
  for update to authenticated using (public.current_user_is_manager());
drop policy if exists stock_reservations_delete on public.stock_reservations;
create policy stock_reservations_delete on public.stock_reservations
  for delete to authenticated using (public.current_user_is_manager());

-- ── 3. "W DRODZE" — agregat z istniejącego modułu PO ─────────────────
-- Niedostarczone ilości z PO o statusie sent/partial, pozycje pending/partial.

create or replace function public.get_incoming_stock_per_component()
returns table(
  r_component_id bigint,
  r_incoming_qty numeric,
  r_earliest_eta date,
  r_latest_eta date,
  r_open_pos integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    i.component_id,
    sum(i.quantity_ordered - i.quantity_received) as incoming_qty,
    min(po.expected_delivery_date)::date as earliest_eta,
    max(po.expected_delivery_date)::date as latest_eta,
    count(distinct po.id)::integer as open_pos
  from purchase_order_items i
  join purchase_orders po on po.id = i.purchase_order_id
  where po.status in ('sent', 'partial')
    and i.status_per_item in ('pending', 'partial')
    and (i.quantity_ordered - i.quantity_received) > 0
  group by i.component_id
$$;

-- ── 4. REZERWACJA przy tworzeniu zamówienia ──────────────────────────
-- Zastąpi consume_stock_for_order w flow tworzenia (Tura 2).
-- Stan fizyczny (quantity) BEZ zmian; rośnie tylko reserved_quantity.

create or replace function public.reserve_stock_for_order(p_order_id bigint)
returns table(
  r_component_id bigint,
  r_component_name text,
  r_component_code text,
  r_quantity_reserved numeric,
  r_warehouse_code text,
  r_part text,
  r_stage_key text,
  r_available_after numeric,
  r_incoming_qty numeric,
  r_earliest_eta date,
  r_insufficient boolean,
  r_status text
)
language plpgsql
security definer
set search_path = public
as $$
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
  select o.id, o.category, o.system, o.quantity, o.order_number
  into v_order
  from orders o
  where o.id = p_order_id;

  if not found then
    raise exception 'Zamówienie % nie istnieje', p_order_id;
  end if;

  -- guard: zamówienie już ma aktywne rezerwacje → nie dubluj (retry-safe)
  if exists (
    select 1 from stock_reservations sr
    where sr.order_id = p_order_id and sr.status <> 'cancelled'
  ) then
    r_component_id := null;
    r_component_name := 'Zamówienie ma już rezerwacje — pominięto';
    r_component_code := '';
    r_quantity_reserved := 0;
    r_warehouse_code := '';
    r_part := '';
    r_stage_key := null;
    r_available_after := 0;
    r_incoming_qty := 0;
    r_earliest_eta := null;
    r_insufficient := false;
    r_status := 'already_reserved';
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
      raise exception 'Brak przypisania magazynu dla kategorii % systemu % i part %',
        v_order.category, v_order.system, v_match.part;
    end if;
    select w.code into v_wh_code from warehouses w where w.id = v_wh_id;

    for v_rec_comp in
      select rc.component_id as comp_id, rc.quantity as per_unit, rc.stage_key,
             c.name, c.code as comp_code
      from warehouse_recipe_components rc
      join warehouse_components c on c.id = rc.component_id
      where rc.recipe_id = v_match.recipe_id
    loop
      v_total := v_rec_comp.per_unit * coalesce(v_order.quantity, 1);

      -- upewnij się, że wiersz stanu istnieje i podbij rezerwację
      insert into warehouse_stock as ws (warehouse_id, component_id, quantity, reserved_quantity)
      values (v_wh_id, v_rec_comp.comp_id, 0, v_total)
      on conflict (warehouse_id, component_id)
      do update set
        reserved_quantity = ws.reserved_quantity + v_total,
        updated_at = now();

      insert into stock_reservations (order_id, warehouse_id, component_id, stage_key, quantity_reserved)
      values (p_order_id, v_wh_id, v_rec_comp.comp_id, v_rec_comp.stage_key, v_total);

      select ws.quantity, ws.reserved_quantity into v_stock
      from warehouse_stock ws
      where ws.warehouse_id = v_wh_id and ws.component_id = v_rec_comp.comp_id;

      v_available_after := coalesce(v_stock.quantity, 0) - coalesce(v_stock.reserved_quantity, 0);

      select i.r_incoming_qty, i.r_earliest_eta into v_incoming
      from get_incoming_stock_per_component() i
      where i.r_component_id = v_rec_comp.comp_id;

      if v_available_after < 0 then
        v_issues := v_issues || jsonb_build_object(
          'type', 'shortage',
          'component_code', v_rec_comp.comp_code,
          'component_name', v_rec_comp.name,
          -- brak TEGO zamówienia (nie skumulowany deficyt: przy dostępnych -2
          -- i potrzebie 1 brakuje 1, a nie 3)
          'shortage', least(v_total, -v_available_after),
          'warehouse', v_wh_code,
          'part', v_match.part,
          'incoming_qty', coalesce(v_incoming.r_incoming_qty, 0),
          'earliest_eta', v_incoming.r_earliest_eta
        );
      end if;

      r_component_id := v_rec_comp.comp_id;
      r_component_name := v_rec_comp.name;
      r_component_code := v_rec_comp.comp_code;
      r_quantity_reserved := v_total;
      r_warehouse_code := v_wh_code;
      r_part := v_match.part;
      r_stage_key := v_rec_comp.stage_key;
      r_available_after := v_available_after;
      r_incoming_qty := coalesce(v_incoming.r_incoming_qty, 0);
      r_earliest_eta := v_incoming.r_earliest_eta;
      r_insufficient := v_available_after < 0;
      r_status := case when v_available_after < 0 then 'insufficient' else 'ok' end;
      return next;
    end loop;
  end loop;

  -- brakujące części receptur — jak w consume_stock_for_order
  foreach v_missing_part in array v_expected_parts loop
    if not (v_missing_part = any(v_matched_parts)) then
      v_issues := v_issues || jsonb_build_object(
        'type', 'missing_recipe',
        'part', v_missing_part,
        'message', 'Brak receptury dla części: ' || v_missing_part
      );
    end if;
  end loop;

  if not v_any_recipe then
    v_final_status := 'no_recipe';
    update orders set stock_status = v_final_status, stock_issues = v_issues where id = p_order_id;
    r_component_id := null;
    r_component_name := 'Brak pasujących receptur';
    r_component_code := '';
    r_quantity_reserved := 0;
    r_warehouse_code := '';
    r_part := '';
    r_stage_key := null;
    r_available_after := 0;
    r_incoming_qty := 0;
    r_earliest_eta := null;
    r_insufficient := false;
    r_status := 'no_recipe';
    return next;
  elsif jsonb_array_length(v_issues) > 0 then
    if exists (select 1 from jsonb_array_elements(v_issues) el where el->>'type' = 'missing_recipe') then
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
$$;

-- ── 5. WYDANIE FIZYCZNE przy "Zrobione" na etapie ────────────────────
-- Najpierw sprawdza WSZYSTKIE pozycje; jakikolwiek brak fizyczny =
-- ZERO zmian i zwrot listy braków (r_status='insufficient').
-- Fallback: rezerwacje stage_key IS NULL wydają się przy pierwszym
-- ukończonym etapie tego zamówienia (patrz odstępstwo #3 w nagłówku).

create or replace function public.release_stock_for_stage(p_order_id bigint, p_stage_key text)
returns table(
  r_component_id bigint,
  r_component_name text,
  r_component_code text,
  r_quantity numeric,
  r_warehouse_code text,
  r_status text,
  r_shortage numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_res record;
  v_remaining numeric;
  v_phys numeric;
  v_any_shortage boolean := false;
  v_include_fallback boolean;
  v_audit_items jsonb := '[]'::jsonb;
begin
  select o.id, o.category, o.order_number into v_order
  from orders o where o.id = p_order_id;
  if not found then
    raise exception 'Zamówienie % nie istnieje', p_order_id;
  end if;

  -- fallback NULL → dołącz przy pierwszym ukończonym etapie zamówienia
  v_include_fallback := not exists (
    select 1 from stock_reservations sr
    where sr.order_id = p_order_id
      and sr.status in ('released', 'partially_released')
  );

  -- PRZEBIEG 1: sprawdź fizyczną dostępność wszystkich pozycji
  for v_res in
    select sr.id, sr.warehouse_id, sr.component_id,
           sr.quantity_reserved, sr.quantity_released,
           c.name, c.code as comp_code, w.code as wh_code
    from stock_reservations sr
    join warehouse_components c on c.id = sr.component_id
    join warehouses w on w.id = sr.warehouse_id
    where sr.order_id = p_order_id
      and sr.status in ('reserved', 'partially_released')
      and (sr.stage_key = p_stage_key or (v_include_fallback and sr.stage_key is null))
    for update of sr
  loop
    v_remaining := v_res.quantity_reserved - v_res.quantity_released;
    if v_remaining <= 0 then continue; end if;

    select ws.quantity into v_phys
    from warehouse_stock ws
    where ws.warehouse_id = v_res.warehouse_id and ws.component_id = v_res.component_id;

    if coalesce(v_phys, 0) < v_remaining then
      v_any_shortage := true;
      r_component_id := v_res.component_id;
      r_component_name := v_res.name;
      r_component_code := v_res.comp_code;
      r_quantity := v_remaining;
      r_warehouse_code := v_res.wh_code;
      r_status := 'insufficient';
      r_shortage := v_remaining - coalesce(v_phys, 0);
      return next;
    end if;
  end loop;

  -- jakikolwiek brak → nic nie wydajemy (zwrócone tylko wiersze braków)
  if v_any_shortage then
    return;
  end if;

  -- PRZEBIEG 2: wydaj wszystko
  for v_res in
    select sr.id, sr.warehouse_id, sr.component_id, sr.stage_key,
           sr.quantity_reserved, sr.quantity_released,
           c.name, c.code as comp_code, w.code as wh_code
    from stock_reservations sr
    join warehouse_components c on c.id = sr.component_id
    join warehouses w on w.id = sr.warehouse_id
    where sr.order_id = p_order_id
      and sr.status in ('reserved', 'partially_released')
      and (sr.stage_key = p_stage_key or (v_include_fallback and sr.stage_key is null))
    for update of sr
  loop
    v_remaining := v_res.quantity_reserved - v_res.quantity_released;
    if v_remaining <= 0 then continue; end if;

    -- ZBIORCZE WZ: wszystkie pozycje jednego wydania (zamówienie × etap)
    -- dzielą reference_doc — UI (DocumentDetailsModal) pokaże je jako
    -- jeden dokument z listą pozycji. Ślad rezerwacji w notes (RES-id).
    insert into warehouse_movements(
      movement_type, warehouse_from_id, component_id, quantity,
      order_id, reference_doc, notes, created_by
    ) values (
      'WZ', v_res.warehouse_id, v_res.component_id, v_remaining,
      p_order_id,
      -- format nadpisany w tura4: 'WZ-{kategoria}-{nr zlecenia}-{etap}'
      'WZ-' || v_order.category || '-' || coalesce(nullif(trim(v_order.order_number), ''), p_order_id::text) || '-' || p_stage_key,
      'Wydanie na etap ' || p_stage_key || ' — zamówienie ' || v_order.category
        || ' #' || coalesce(v_order.order_number, p_order_id::text)
        || ' [RES-' || v_res.id || ']',
      auth.uid()
    );

    update warehouse_stock ws
    set quantity = ws.quantity - v_remaining,
        reserved_quantity = ws.reserved_quantity - v_remaining,
        updated_at = now()
    where ws.warehouse_id = v_res.warehouse_id and ws.component_id = v_res.component_id;

    update stock_reservations sr
    set quantity_released = sr.quantity_reserved,
        status = 'released',
        updated_at = now()
    where sr.id = v_res.id;

    v_audit_items := v_audit_items || jsonb_build_object(
      'reservation_id', v_res.id, 'component_code', v_res.comp_code, 'qty', v_remaining
    );

    r_component_id := v_res.component_id;
    r_component_name := v_res.name;
    r_component_code := v_res.comp_code;
    r_quantity := v_remaining;
    r_warehouse_code := v_res.wh_code;
    r_status := 'released';
    r_shortage := 0;
    return next;
  end loop;

  if jsonb_array_length(v_audit_items) > 0 then
    begin
      insert into audit_log (table_name, record_id, operation, user_id, new_data)
      values (
        'stock_reservations', p_order_id::text, 'UPDATE', auth.uid(),
        jsonb_build_object('action', 'release_stage', 'order_id', p_order_id,
                           'stage_key', p_stage_key, 'items', v_audit_items)
      );
    exception when others then
      null; -- audyt nie może zablokować wydania
    end;
  end if;

  return;
end;
$$;

-- ── 6. ANULOWANIE zamówienia — zwolnij niewydane rezerwacje ──────────
-- Wołana z istniejącego flow anulowania (Tura 7). Released nie ruszamy.

create or replace function public.cancel_order_reservations(p_order_id bigint)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res record;
  v_rest numeric;
  v_count integer := 0;
begin
  for v_res in
    select sr.id, sr.warehouse_id, sr.component_id,
           sr.quantity_reserved, sr.quantity_released
    from stock_reservations sr
    where sr.order_id = p_order_id
      and sr.status in ('reserved', 'partially_released')
    for update of sr
  loop
    v_rest := v_res.quantity_reserved - v_res.quantity_released;
    if v_rest > 0 then
      update warehouse_stock ws
      set reserved_quantity = ws.reserved_quantity - v_rest,
          updated_at = now()
      where ws.warehouse_id = v_res.warehouse_id and ws.component_id = v_res.component_id;
    end if;

    update stock_reservations sr
    set status = 'cancelled', updated_at = now()
    where sr.id = v_res.id;

    v_count := v_count + 1;
  end loop;

  if v_count > 0 then
    begin
      insert into audit_log (table_name, record_id, operation, user_id, new_data)
      values (
        'stock_reservations', p_order_id::text, 'UPDATE', auth.uid(),
        jsonb_build_object('action', 'cancel_reservations', 'order_id', p_order_id,
                           'cancelled_count', v_count)
      );
    exception when others then
      null;
    end;
  end if;

  return v_count;
end;
$$;

-- ── 7. PRZEGLĄD STANÓW (do widoku Stany — Tura 5) ────────────────────

create or replace function public.get_stock_overview()
returns table(
  r_warehouse_id bigint,
  r_warehouse_code text,
  r_component_id bigint,
  r_component_code text,
  r_component_name text,
  r_quantity numeric,
  r_reserved numeric,
  r_available numeric,
  r_incoming_qty numeric,
  r_earliest_eta date,
  r_projected numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    ws.warehouse_id,
    w.code,
    ws.component_id,
    c.code,
    c.name,
    ws.quantity,
    ws.reserved_quantity,
    ws.quantity - ws.reserved_quantity,
    coalesce(inc.r_incoming_qty, 0),
    inc.r_earliest_eta,
    (ws.quantity - ws.reserved_quantity) + coalesce(inc.r_incoming_qty, 0)
  from warehouse_stock ws
  join warehouses w on w.id = ws.warehouse_id
  join warehouse_components c on c.id = ws.component_id
  left join get_incoming_stock_per_component() inc on inc.r_component_id = ws.component_id
$$;
