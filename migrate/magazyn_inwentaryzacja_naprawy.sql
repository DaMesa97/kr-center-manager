-- 2026-10-21: magazyn / inwentaryzacja — naprawy po audycie.
-- Backup starych definicji: migrate/backup_magazyn_2026-10-21.sql
--
-- 1) Uprawnienia: current_user_can_warehouse(perm) — lustro src/lib/permissions.ts:
--      'movements' (stany + PZ/MM, przyjęcie dostawy ZD): kierownicy + magazynier,
--      'ordering'  (zamawianie + inwentaryzacja):          kierownicy.
--    create_pz_document / create_mm_document / receive_purchase_order wpuszczają teraz
--    magazyniera (wcześniej assert_manager_or_service = tylko kierownicy, choć UI
--    ZD i permissions.ts dawały mu przyjęcia). Liczenie spisu (record_inventory_count*,
--    open_inventory_session, add_inventory_line) = 'ordering' — magazynier NIE ma
--    w permissions.ts inwentaryzacji (zakładka niewidoczna). Zatwierdzenie
--    (close_inventory_session, korekty stanów) — bez zmian: tylko kierownik.
-- 2) open_inventory_session: snapshot obejmuje WSZYSTKIE aktywne komponenty pasujące
--    do typu magazynu (WEW* = drzwi, reszta = surowce) + wszystko, co ma już półkę
--    w tym magazynie. Wcześniej tylko komponenty z wierszem warehouse_stock — towar
--    bez półki nie dał się policzyć. Półka (wiersz stanu) powstaje przy zatwierdzeniu
--    korekty (INSERT .. ON CONFLICT) — nie zakładamy z góry pustych półek, bo wiersz
--    warehouse_stock = przypisanie komponentu do magazynu (checkboxy w kartotece).
--    Wcześniej UPDATE bez wiersza nic nie robił, a ruch INW i tak się zapisywał.
-- 3) add_inventory_line(session, component): dopisanie pozycji spoza listy do otwartej sesji.
-- 4) close_inventory_session: blokada sesji (FOR UPDATE — podwójne zamknięcie),
--    po korekcie każdego komponentu revalidate_orders_for_component w TEJ SAMEJ transakcji.
--    record_inventory_count*: FOR SHARE na sesji (liczenie nie wchodzi w trakcie zamykania).
-- 5) revalidate_order_stock_status: brak liczony z DOSTĘPNEGO (stan − rezerwacje),
--    a nie "stan >= 0". Własna rezerwacja zlecenia nie jest brakiem:
--      dostępne dla zlecenia = stan − (rezerwacje − własna niewydana rezerwacja),
--      brak = min(własna niewydana rezerwacja, rezerwacje − stan)
--    (to samo co liczy reserve_stock_for_order przy rezerwacji). Zlecenie bez żadnych
--    rezerwacji (stary model): brak = −dostępne. Zachowuje issue innych typów
--    (missing_recipe, missing_warehouse, glass_not_received); status partial_recipe
--    także przy missing_warehouse (wcześniej spadał do insufficient).
--    revalidate_orders_for_component: oprócz zleceń z istniejącym issue — dopisuje
--    NOWY brak zleceniom z aktywną rezerwacją, gdy stan spadł poniżej rezerwacji
--    (korekta INW na minus, MM z magazynu). create_mm_document przelicza też magazyn źródłowy.
-- 6) get_stock_alerts: nadrezerwacja (dostępne < 0) = 'critical' także bez historii
--    zużycia (wcześniej 'no_data'); sugerowana ilość pokrywa co najmniej deficyt.
-- 7) Przyjęcie ZD: purchase_order_items.quantity_* integer -> numeric (2,5 mb),
--    create_purchase_order bez ::integer; receive_purchase_order: FOR UPDATE na ZD
--    i pozycjach (wyścig dwóch przyjęć), pomija pozycje anulowane, unikalna
--    referencja PZ per dostawa (ZD-…-PZ, ZD-…-PZ-2, …; także dla numeru dokumentu
--    dostawcy) — dostawy częściowe nie sklejają się w jeden dokument PZ.

-- ── 1) Helper uprawnień ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.current_user_can_warehouse(p_perm text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Lustro ROLE_PERMISSIONS z src/lib/permissions.ts (warehouse.movements / warehouse.ordering)
  select
    coalesce(auth.role(), '') = 'service_role'
    or public.current_user_is_manager()
    or (
      p_perm = 'movements'
      and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'magazynier')
    );
$function$;

REVOKE ALL ON FUNCTION public.current_user_can_warehouse(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_can_warehouse(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.assert_warehouse_perm(p_perm text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.current_user_can_warehouse(p_perm) then
    raise exception '%', case p_perm
      when 'movements' then 'Brak uprawnień do ruchów magazynowych (przyjęcia / przesunięcia)'
      when 'ordering' then 'Brak uprawnień do inwentaryzacji / zamawiania'
      else 'Brak uprawnień do tej operacji magazynowej'
    end;
  end if;
end;
$function$;

REVOKE ALL ON FUNCTION public.assert_warehouse_perm(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_warehouse_perm(text) TO authenticated, service_role;

-- ── Guardy ruchów (magazynier wpuszczony) ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_pz_document(p_warehouse_id bigint, p_items jsonb, p_reference_doc text, p_notes text)
 RETURNS TABLE(r_component_id bigint, r_component_name text, r_quantity numeric, r_revalidated_orders integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.assert_warehouse_perm('movements');
  return query select * from public.create_pz_document__impl(p_warehouse_id, p_items, p_reference_doc, p_notes);
end; $function$;

CREATE OR REPLACE FUNCTION public.create_mm_document(p_warehouse_from_id bigint, p_warehouse_to_id bigint, p_items jsonb, p_reference_doc text, p_notes text)
 RETURNS TABLE(r_component_id bigint, r_component_name text, r_quantity numeric, r_from_warehouse_code text, r_to_warehouse_code text, r_revalidated_orders integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.assert_warehouse_perm('movements');
  return query select * from public.create_mm_document__impl(p_warehouse_from_id, p_warehouse_to_id, p_items, p_reference_doc, p_notes);
end; $function$;

CREATE OR REPLACE FUNCTION public.receive_purchase_order(p_po_id bigint, p_warehouse_id bigint, p_received_items jsonb, p_reference_doc text, p_notes text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.assert_warehouse_perm('movements');
  perform public.receive_purchase_order__impl(p_po_id, p_warehouse_id, p_received_items, p_reference_doc, p_notes);
end; $function$;

-- ── Inwentaryzacja: guardy liczenia/otwarcia ('ordering'), zamknięcie = kierownik ──
CREATE OR REPLACE FUNCTION public.open_inventory_session(p_notes text DEFAULT NULL::text, p_counted_date date DEFAULT CURRENT_DATE, p_warehouse_id integer DEFAULT NULL::integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.assert_warehouse_perm('ordering');
  return public.open_inventory_session__impl(p_notes, p_counted_date, p_warehouse_id);
end; $function$;

CREATE OR REPLACE FUNCTION public.record_inventory_count(p_session_id integer, p_component_id bigint, p_counted numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.assert_warehouse_perm('ordering');
  perform public.record_inventory_count__impl(p_session_id, p_component_id, p_counted);
end; $function$;

CREATE OR REPLACE FUNCTION public.record_inventory_count_line(p_line_id bigint, p_counted numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.assert_warehouse_perm('ordering');
  perform public.record_inventory_count_line__impl(p_line_id, p_counted);
end; $function$;

-- close_inventory_session: guard bez zmian (assert_manager_or_service) — korekty stanów tylko kierownik.

-- ── 2) Snapshot: wszystkie aktywne komponenty pasujące do magazynu ─────────
CREATE OR REPLACE FUNCTION public.open_inventory_session__impl(p_notes text DEFAULT NULL::text, p_counted_date date DEFAULT CURRENT_DATE, p_warehouse_id integer DEFAULT NULL::integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Snapshot: aktywne komponenty z półką w tym magazynie ORAZ wszystkie aktywne
  -- komponenty pasujące do typu magazynu (WEW* = drzwi wewnętrzne, reszta = surowce;
  -- ta sama reguła co "czyszczenie błędnych półek"). Komponent bez półki ma stan 0.
  insert into inventory_lines (session_id, component_id, system_qty)
  select v_session_id, wc.id, coalesce(ws.quantity, 0)
  from warehouse_components wc
  left join warehouse_stock ws
    on ws.component_id = wc.id and ws.warehouse_id = p_warehouse_id
  where wc.is_active = true
    and (
      ws.id is not null
      or (coalesce(wc.product_category, 'raw') <> 'raw') = v_is_internal
    )
  order by wc.name, wc.id;

  return v_session_id;
end;
$function$;

-- ── 3) Dopisanie pozycji spoza listy ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.add_inventory_line__impl(p_session_id integer, p_component_id bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_warehouse_id int;
  v_line_id bigint;
begin
  select warehouse_id into v_warehouse_id
  from inventory_sessions
  where id = p_session_id and status = 'open'
  for share;
  if not found then
    raise exception 'Sesja nie istnieje lub jest zamknięta';
  end if;

  if not exists (select 1 from warehouse_components where id = p_component_id) then
    raise exception 'Komponent % nie istnieje', p_component_id;
  end if;

  select il.id into v_line_id
  from inventory_lines il
  where il.session_id = p_session_id and il.component_id = p_component_id
  limit 1;
  if v_line_id is not null then
    raise exception 'Ten komponent jest już na liście spisu';
  end if;

  insert into inventory_lines (session_id, component_id, system_qty)
  values (
    p_session_id, p_component_id,
    coalesce((
      select ws.quantity from warehouse_stock ws
      where ws.warehouse_id = v_warehouse_id and ws.component_id = p_component_id
    ), 0)
  )
  returning id into v_line_id;

  return v_line_id;
end;
$function$;

REVOKE ALL ON FUNCTION public.add_inventory_line__impl(integer, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_inventory_line__impl(integer, bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.add_inventory_line(p_session_id integer, p_component_id bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.assert_warehouse_perm('ordering');
  return public.add_inventory_line__impl(p_session_id, p_component_id);
end; $function$;

REVOKE ALL ON FUNCTION public.add_inventory_line(integer, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_inventory_line(integer, bigint) TO authenticated, service_role;

-- ── Liczenie: FOR SHARE na sesji (nie wchodzi w trakcie zamykania) ─────────
CREATE OR REPLACE FUNCTION public.record_inventory_count__impl(p_session_id integer, p_component_id bigint, p_counted numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_warehouse_id int;
begin
  if p_counted is not null and p_counted < 0 then
    raise exception 'Policzona ilość nie może być ujemna';
  end if;

  select warehouse_id into v_warehouse_id
  from inventory_sessions
  where id = p_session_id and status = 'open'
  for share;
  if not found then
    raise exception 'Sesja nie istnieje lub jest zamknięta';
  end if;

  update inventory_lines il
  set counted_qty = p_counted,
      system_qty = coalesce((
        select ws.quantity from warehouse_stock ws
        where ws.warehouse_id = v_warehouse_id and ws.component_id = il.component_id
      ), 0)
  where il.session_id = p_session_id and il.component_id = p_component_id;

  if not found then
    raise exception 'Pozycja spisu nie istnieje w tej sesji';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_inventory_count_line__impl(p_line_id bigint, p_counted numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_line record;
begin
  if p_counted is not null and p_counted < 0 then
    raise exception 'Policzona ilość nie może być ujemna';
  end if;

  select il.id, il.component_id, s.warehouse_id, s.status
  into v_line
  from inventory_lines il
  join inventory_sessions s on s.id = il.session_id
  where il.id = p_line_id
  for share of s;

  if not found then
    raise exception 'Pozycja spisu % nie istnieje', p_line_id;
  end if;
  if v_line.status <> 'open' then
    raise exception 'Sesja inwentaryzacyjna jest zamknięta';
  end if;

  -- system_qty = stan z CHWILI liczenia pozycji (ruchy w trakcie spisu nie liczą się podwójnie)
  update inventory_lines il
  set counted_qty = p_counted,
      system_qty = coalesce((
        select ws.quantity from warehouse_stock ws
        where ws.warehouse_id = v_line.warehouse_id and ws.component_id = v_line.component_id
      ), 0)
  where il.id = p_line_id;
end;
$function$;

-- ── 4) Zamknięcie: blokada, półka tworzona przy korekcie, przeliczenie braków ──
CREATE OR REPLACE FUNCTION public.close_inventory_session__impl(p_session_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_line record;
  v_diff numeric;
  v_warehouse_id int;
  v_audit_items jsonb := '[]'::jsonb;
  v_revalidated integer := 0;
begin
  -- FOR UPDATE: drugie równoległe zamknięcie czeka i dostaje "już zamknięta"
  select warehouse_id into v_warehouse_id
  from inventory_sessions
  where id = p_session_id and status = 'open'
  for update;

  if not found then
    raise exception 'Sesja nie istnieje lub jest już zamknięta';
  end if;
  if v_warehouse_id is null then
    raise exception 'Sesja bez magazynu — zamknij ją ręcznie (legacy)';
  end if;

  for v_line in
    select il.component_id, il.system_qty, il.counted_qty
    from inventory_lines il
    where il.session_id = p_session_id
      and il.counted_qty is not null
    order by il.id
  loop
    v_diff := v_line.counted_qty - v_line.system_qty;
    if v_diff = 0 then continue; end if;

    -- BEZ greatest(0, ...): spis może celowo sprowadzić ujemny stan do prawdy.
    -- Brak półki (komponent spoza przypisania) => zakładamy ją z korektą.
    insert into warehouse_stock as ws (warehouse_id, component_id, quantity)
    values (v_warehouse_id, v_line.component_id, v_diff)
    on conflict (warehouse_id, component_id)
    do update set
      quantity = ws.quantity + v_diff,
      updated_at = now();

    insert into warehouse_movements (
      component_id, movement_type, quantity,
      warehouse_from_id, warehouse_to_id,
      reference_doc, notes, created_by, created_at
    ) values (
      v_line.component_id,
      'INW',
      abs(v_diff),
      case when v_diff < 0 then v_warehouse_id end,
      case when v_diff > 0 then v_warehouse_id end,
      'INW-' || p_session_id,
      'Korekta inwentaryzacyjna (' || case when v_diff > 0 then 'nadwyżka +' else 'niedobór -' end || abs(v_diff) || ')',
      auth.uid(),
      now()
    );

    -- braki zleceń (czerwony badge) dla skorygowanego komponentu — w tej samej transakcji
    v_revalidated := v_revalidated + public.revalidate_orders_for_component(v_line.component_id, v_warehouse_id);

    v_audit_items := v_audit_items || jsonb_build_object(
      'component_id', v_line.component_id,
      'system_qty', v_line.system_qty,
      'counted_qty', v_line.counted_qty,
      'diff', v_diff
    );
  end loop;

  update inventory_sessions
  set status = 'closed', closed_by = auth.uid(), closed_at = now()
  where id = p_session_id;

  begin
    insert into audit_log (table_name, record_id, operation, user_id, new_data)
    values (
      'inventory_sessions', p_session_id::text, 'UPDATE', auth.uid(),
      jsonb_build_object('action', 'inventory_close', 'session_id', p_session_id,
                         'warehouse_id', v_warehouse_id, 'corrections', v_audit_items,
                         'revalidated_orders', v_revalidated)
    );
  exception when others then
    null;
  end;
end;
$function$;

-- ── 5) Braki zleceń liczone z DOSTĘPNEGO ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.revalidate_order_stock_status(p_order_id bigint)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order record;
  v_issue jsonb;
  v_new_issues jsonb := '[]'::jsonb;
  v_wh_id bigint;
  v_component_id bigint;
  v_qty numeric;
  v_reserved numeric;
  v_own_remaining numeric;
  v_has_reservations boolean;
  v_shortage numeric;
  v_final_status text;
BEGIN
  SELECT id, stock_status, stock_issues
  INTO v_order
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'order_not_found';
  END IF;

  -- Tylko zlecenia z brakami (ok / no_recipe / null — nic do przeliczenia)
  IF v_order.stock_status IS NULL OR v_order.stock_status NOT IN ('insufficient', 'partial_recipe') THEN
    RETURN v_order.stock_status;
  END IF;
  IF v_order.stock_issues IS NULL OR jsonb_typeof(v_order.stock_issues) <> 'array' THEN
    RETURN v_order.stock_status;
  END IF;

  SELECT EXISTS (SELECT 1 FROM stock_reservations sr WHERE sr.order_id = p_order_id)
  INTO v_has_reservations;

  FOR v_issue IN SELECT * FROM jsonb_array_elements(v_order.stock_issues)
  LOOP
    -- Inne typy (missing_recipe, missing_warehouse, glass_not_received) — PZ/INW ich nie rozwiązuje
    IF COALESCE(v_issue->>'type', 'shortage') <> 'shortage' THEN
      v_new_issues := v_new_issues || v_issue;
      CONTINUE;
    END IF;

    v_component_id := NULL;
    v_wh_id := NULL;
    SELECT id INTO v_component_id
    FROM warehouse_components
    WHERE code = v_issue->>'component_code'
    ORDER BY is_active DESC, id
    LIMIT 1;
    SELECT id INTO v_wh_id
    FROM warehouses
    WHERE code = v_issue->>'warehouse'
    LIMIT 1;

    IF v_component_id IS NULL OR v_wh_id IS NULL THEN
      v_new_issues := v_new_issues || v_issue;
      CONTINUE;
    END IF;

    v_qty := NULL;
    v_reserved := NULL;
    SELECT ws.quantity, ws.reserved_quantity INTO v_qty, v_reserved
    FROM warehouse_stock ws
    WHERE ws.warehouse_id = v_wh_id AND ws.component_id = v_component_id;
    v_qty := COALESCE(v_qty, 0);
    v_reserved := COALESCE(v_reserved, 0);

    IF v_has_reservations THEN
      -- Niewydana część WŁASNEJ rezerwacji zlecenia na tej półce
      SELECT COALESCE(SUM(sr.quantity_reserved - sr.quantity_released), 0)
      INTO v_own_remaining
      FROM stock_reservations sr
      WHERE sr.order_id = p_order_id
        AND sr.component_id = v_component_id
        AND sr.warehouse_id = v_wh_id
        AND sr.status IN ('reserved', 'partially_released');
      -- dostępne dla zlecenia = stan − rezerwacje INNYCH = stan − (rezerwacje − własna)
      -- brak = własna − dostępne dla zlecenia = rezerwacje − stan (max: własna)
      v_shortage := LEAST(GREATEST(v_own_remaining, 0), v_reserved - v_qty);
    ELSE
      -- Stary model bez rezerwacji: brak = ujemne dostępne
      v_shortage := v_reserved - v_qty;
    END IF;

    IF v_shortage > 0 THEN
      v_new_issues := v_new_issues || jsonb_set(v_issue, '{shortage}', to_jsonb(v_shortage));
    END IF;
  END LOOP;

  IF jsonb_array_length(v_new_issues) = 0 THEN
    v_final_status := 'ok';
    v_new_issues := NULL;
  ELSIF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_new_issues) el
    WHERE el->>'type' IN ('missing_recipe', 'missing_warehouse')
  ) THEN
    v_final_status := 'partial_recipe';
  ELSE
    v_final_status := 'insufficient';
  END IF;

  UPDATE orders
  SET stock_status = v_final_status, stock_issues = v_new_issues
  WHERE id = p_order_id
    AND (stock_status IS DISTINCT FROM v_final_status OR stock_issues IS DISTINCT FROM v_new_issues);

  RETURN v_final_status;
END;
$function$;

CREATE OR REPLACE FUNCTION public.revalidate_orders_for_component(p_component_id bigint, p_warehouse_id bigint)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_comp record;
  v_wh_code text;
  v_order_id bigint;
  v_count integer := 0;
  v_qty numeric;
  v_reserved numeric;
  v_r record;
  v_shortage numeric;
  v_incoming record;
  v_issues jsonb;
  v_part text;
BEGIN
  SELECT code, name INTO v_comp FROM warehouse_components WHERE id = p_component_id;
  SELECT code INTO v_wh_code FROM warehouses WHERE id = p_warehouse_id;
  IF v_comp.code IS NULL OR v_wh_code IS NULL THEN
    RETURN 0;
  END IF;

  -- (a) zlecenia, które JUŻ mają brak tego komponentu w tym magazynie — przelicz
  FOR v_order_id IN
    SELECT id FROM orders
    WHERE stock_status IN ('insufficient', 'partial_recipe')
      AND stock_issues IS NOT NULL
      AND jsonb_typeof(stock_issues) = 'array'
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(stock_issues) el
        WHERE COALESCE(el->>'type', 'shortage') = 'shortage'
          AND el->>'component_code' = v_comp.code
          AND el->>'warehouse' = v_wh_code
      )
  LOOP
    PERFORM revalidate_order_stock_status(v_order_id);
    v_count := v_count + 1;
  END LOOP;

  -- (b) stan spadł poniżej rezerwacji (korekta INW na minus, MM z magazynu) —
  --     zlecenia z aktywną rezerwacją, które jeszcze nie mają tego braku, dostają issue
  SELECT ws.quantity, ws.reserved_quantity INTO v_qty, v_reserved
  FROM warehouse_stock ws
  WHERE ws.warehouse_id = p_warehouse_id AND ws.component_id = p_component_id;
  v_qty := COALESCE(v_qty, 0);
  v_reserved := COALESCE(v_reserved, 0);

  IF v_reserved - v_qty > 0 THEN
    SELECT i.r_incoming_qty, i.r_earliest_eta INTO v_incoming
    FROM get_incoming_stock_per_component() i
    WHERE i.r_component_id = p_component_id;

    FOR v_r IN
      SELECT sr.order_id, SUM(sr.quantity_reserved - sr.quantity_released) AS own_remaining
      FROM stock_reservations sr
      JOIN orders o ON o.id = sr.order_id
      WHERE sr.component_id = p_component_id
        AND sr.warehouse_id = p_warehouse_id
        AND sr.status IN ('reserved', 'partially_released')
        AND NOT (
          o.stock_issues IS NOT NULL
          AND jsonb_typeof(o.stock_issues) = 'array'
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(o.stock_issues) el
            WHERE COALESCE(el->>'type', 'shortage') = 'shortage'
              AND el->>'component_code' = v_comp.code
              AND el->>'warehouse' = v_wh_code
          )
        )
      GROUP BY sr.order_id
      HAVING SUM(sr.quantity_reserved - sr.quantity_released) > 0
      ORDER BY sr.order_id
    LOOP
      v_shortage := LEAST(v_r.own_remaining, v_reserved - v_qty);

      SELECT m.part INTO v_part
      FROM match_recipes_for_order(v_r.order_id) m
      JOIN warehouse_recipe_components rc ON rc.recipe_id = m.recipe_id AND rc.component_id = p_component_id
      LIMIT 1;

      SELECT stock_issues INTO v_issues FROM orders WHERE id = v_r.order_id FOR UPDATE;
      IF v_issues IS NULL OR jsonb_typeof(v_issues) <> 'array' THEN
        v_issues := '[]'::jsonb;
      END IF;
      v_issues := v_issues || jsonb_build_object(
        'type', 'shortage',
        'component_code', v_comp.code,
        'component_name', v_comp.name,
        'shortage', v_shortage,
        'warehouse', v_wh_code,
        'part', COALESCE(v_part, 'other'),
        'incoming_qty', COALESCE(v_incoming.r_incoming_qty, 0),
        'earliest_eta', v_incoming.r_earliest_eta
      );

      UPDATE orders
      SET stock_issues = v_issues,
          stock_status = CASE
            WHEN EXISTS (
              SELECT 1 FROM jsonb_array_elements(v_issues) el
              WHERE el->>'type' IN ('missing_recipe', 'missing_warehouse')
            ) THEN 'partial_recipe'
            ELSE 'insufficient'
          END
      WHERE id = v_r.order_id;

      v_count := v_count + 1;
    END LOOP;
  END IF;

  RETURN v_count;
END;
$function$;

-- MM: przelicz także magazyn ŹRÓDŁOWY (tam stan spada — mogą powstać braki)
CREATE OR REPLACE FUNCTION public.create_mm_document__impl(p_warehouse_from_id bigint, p_warehouse_to_id bigint, p_items jsonb, p_reference_doc text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS TABLE(r_component_id bigint, r_component_name text, r_quantity numeric, r_from_warehouse_code text, r_to_warehouse_code text, r_revalidated_orders integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item jsonb;
  v_component_id bigint;
  v_quantity numeric;
  v_item_notes text;
  v_final_notes text;
  v_component_name text;
  v_from_code text;
  v_to_code text;
  v_reval_count integer;
  v_batch_ref text;
BEGIN
  IF p_warehouse_from_id IS NULL OR p_warehouse_to_id IS NULL THEN
    RAISE EXCEPTION 'Brak magazynu źródłowego lub docelowego';
  END IF;

  IF p_warehouse_from_id = p_warehouse_to_id THEN
    RAISE EXCEPTION 'Magazyn źródłowy i docelowy muszą być różne';
  END IF;

  SELECT code INTO v_from_code FROM warehouses WHERE id = p_warehouse_from_id;
  SELECT code INTO v_to_code FROM warehouses WHERE id = p_warehouse_to_id;

  v_batch_ref := COALESCE(p_reference_doc, 'MM-' || to_char(now(), 'YYYYMMDD-HH24MISS'));

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_component_id := (v_item->>'component_id')::bigint;
    v_quantity := (v_item->>'quantity')::numeric;
    v_item_notes := v_item->>'notes';

    IF v_component_id IS NULL OR v_quantity IS NULL OR v_quantity <= 0 THEN
      CONTINUE;
    END IF;

    v_final_notes := COALESCE(
      NULLIF(TRIM(v_item_notes), ''),
      NULLIF(TRIM(p_notes), ''),
      'Przesunięcie ' || COALESCE(v_from_code, '?') || ' → ' || COALESCE(v_to_code, '?')
        || ' — dokument ' || v_batch_ref
    );

    INSERT INTO warehouse_stock AS ws (warehouse_id, component_id, quantity)
    VALUES (p_warehouse_from_id, v_component_id, -v_quantity)
    ON CONFLICT (warehouse_id, component_id)
    DO UPDATE SET
      quantity = ws.quantity - v_quantity,
      updated_at = now();

    INSERT INTO warehouse_stock AS ws (warehouse_id, component_id, quantity)
    VALUES (p_warehouse_to_id, v_component_id, v_quantity)
    ON CONFLICT (warehouse_id, component_id)
    DO UPDATE SET
      quantity = ws.quantity + v_quantity,
      updated_at = now();

    INSERT INTO warehouse_movements(
      movement_type, warehouse_from_id, warehouse_to_id,
      component_id, quantity, reference_doc, notes, created_by
    )
    VALUES (
      'MM', p_warehouse_from_id, p_warehouse_to_id,
      v_component_id, v_quantity,
      v_batch_ref, v_final_notes, auth.uid()
    );

    SELECT name INTO v_component_name
    FROM warehouse_components
    WHERE id = v_component_id;

    v_reval_count := revalidate_orders_for_component(v_component_id, p_warehouse_to_id)
                   + revalidate_orders_for_component(v_component_id, p_warehouse_from_id);

    r_component_id := v_component_id;
    r_component_name := v_component_name;
    r_quantity := v_quantity;
    r_from_warehouse_code := v_from_code;
    r_to_warehouse_code := v_to_code;
    r_revalidated_orders := v_reval_count;
    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$function$;

-- ── 6) Alerty: nadrezerwacja = krytyczny ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_stock_alerts()
 RETURNS TABLE(r_component_id bigint, r_component_name text, r_component_code text, r_product_category text, r_warehouse_id bigint, r_warehouse_code text, r_warehouse_name text, r_current_stock numeric, r_baseline_monthly numeric, r_seasonal_factor numeric, r_daily_consumption numeric, r_days_until_empty numeric, r_alert_level text, r_suggested_order_qty numeric, r_reserved_quantity numeric, r_available numeric, r_incoming_qty numeric, r_earliest_eta date)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_critical integer;
  v_warning integer;
  v_observation integer;
  v_current_month integer;
  v_seasonal numeric;
begin
  select critical_days, warning_days, observation_days
  into v_critical, v_warning, v_observation
  from alert_thresholds where id = 1;

  v_current_month := extract(month from now())::integer;
  select factor into v_seasonal
  from seasonal_factors
  where month = v_current_month;
  v_seasonal := coalesce(v_seasonal, 1.0);

  return query
  select * from (
    with incoming as (
      select
        i.component_id,
        po.warehouse_id,
        sum(i.quantity_ordered - i.quantity_received)::numeric as incoming_qty,
        min(po.expected_delivery_date)::date as earliest_eta,
        coalesce(
          jsonb_agg(
            jsonb_build_object(
              't', greatest(0, (po.expected_delivery_date::date - current_date)),
              'qty', i.quantity_ordered - i.quantity_received
            )
            order by po.expected_delivery_date
          ) filter (where po.expected_delivery_date is not null),
          '[]'::jsonb
        ) as deliveries
      from purchase_order_items i
      join purchase_orders po on po.id = i.purchase_order_id
      where po.status in ('sent', 'partial')
        and i.status_per_item in ('pending', 'partial')
        and (i.quantity_ordered - i.quantity_received) > 0
      group by i.component_id, po.warehouse_id
    ),
    stock_per_warehouse as (
      select
        ws.component_id,
        ws.warehouse_id,
        ws.quantity as current_stock,
        coalesce(ws.reserved_quantity, 0) as reserved_qty,
        ws.quantity - coalesce(ws.reserved_quantity, 0) as available,
        wc.name as component_name,
        wc.code as component_code,
        wc.product_category as product_category,
        w.code as warehouse_code,
        w.name as warehouse_name,
        coalesce(lf.baseline_qty, 0) as baseline_monthly,
        coalesce(lf.historical_months_used, 0) as hist_months,
        coalesce(inc.incoming_qty, 0)::numeric as incoming_qty,
        inc.earliest_eta,
        coalesce(inc.deliveries, '[]'::jsonb) as deliveries
      from warehouse_stock ws
      join warehouse_components wc on wc.id = ws.component_id and wc.is_active = true
      join warehouses w on w.id = ws.warehouse_id
      -- najnowsza prognoza per komponent: sonda indeksu zamiast DISTINCT ON
      -- po całej (stale rosnącej) tabeli forecast_runs
      left join lateral (
        select fr.baseline_qty, fr.historical_months_used
        from forecast_runs fr
        where fr.component_id = ws.component_id
        order by fr.run_at desc
        limit 1
      ) lf on true
      left join incoming inc
        on inc.component_id = ws.component_id
       and inc.warehouse_id = ws.warehouse_id
    ),
    computed as (
      select
        spw.*,
        case
          when spw.hist_months = 0 or spw.baseline_monthly = 0 then 0::numeric
          else round((spw.baseline_monthly * v_seasonal / 30.0)::numeric, 3)
        end as daily_consumption,
        case
          when spw.hist_months = 0 or spw.baseline_monthly = 0 then null
          else days_until_empty_sim(
            spw.available,
            spw.baseline_monthly * v_seasonal / 30.0,
            spw.deliveries
          )
        end as days_empty_sim
      from stock_per_warehouse spw
    )
    select
      c.component_id as r_component_id,
      c.component_name as r_component_name,
      c.component_code as r_component_code,
      c.product_category as r_product_category,
      c.warehouse_id as r_warehouse_id,
      c.warehouse_code as r_warehouse_code,
      c.warehouse_name as r_warehouse_name,
      c.current_stock as r_current_stock,
      c.baseline_monthly as r_baseline_monthly,
      v_seasonal as r_seasonal_factor,
      c.daily_consumption as r_daily_consumption,
      c.days_empty_sim as r_days_until_empty,
      case
        -- nadrezerwacja (rezerwacje > stan): już teraz brakuje pod zlecenia
        when c.available < 0 then 'critical'
        when c.hist_months = 0 or c.baseline_monthly = 0 then 'no_data'
        when c.days_empty_sim is null then 'no_data'
        when c.days_empty_sim <= v_critical then 'critical'
        when c.days_empty_sim <= v_warning then 'warning'
        when c.days_empty_sim <= v_observation then 'observation'
        else 'ok'
      end as r_alert_level,
      case
        when c.hist_months = 0 or c.baseline_monthly = 0 then
          -- bez historii: co najmniej pokryj deficyt rezerwacji
          greatest(ceil(-c.available - c.incoming_qty)::numeric, 0)
        else greatest(
          ceil((c.baseline_monthly * v_seasonal * 2.0) - c.available - c.incoming_qty)::numeric,
          0
        )
      end as r_suggested_order_qty,
      c.reserved_qty as r_reserved_quantity,
      c.available as r_available,
      c.incoming_qty as r_incoming_qty,
      c.earliest_eta as r_earliest_eta
    from computed c
  ) inner_q
  order by
    case inner_q.r_alert_level
      when 'critical' then 1
      when 'warning' then 2
      when 'observation' then 3
      when 'ok' then 4
      when 'no_data' then 5
    end,
    case when inner_q.r_available < 0 then 0 else 1 end,
    inner_q.r_days_until_empty nulls last,
    inner_q.r_component_name;
end;
$function$;

-- ── 7) ZD: ilości numeric, blokady, unikalna referencja PZ ────────────────
ALTER TABLE public.purchase_order_items
  ALTER COLUMN quantity_ordered TYPE numeric,
  ALTER COLUMN quantity_received TYPE numeric;

CREATE OR REPLACE FUNCTION public.create_purchase_order__impl(p_supplier_id bigint, p_items jsonb, p_notes text DEFAULT NULL::text, p_expected_delivery_date date DEFAULT NULL::date, p_warehouse_id bigint DEFAULT NULL::bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_zd_number text;
  v_po_id bigint;
  v_item jsonb;
  v_lead_time integer;
  v_expected_date date;
BEGIN
  IF p_supplier_id IS NULL THEN
    RAISE EXCEPTION 'Brak dostawcy';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Lista pozycji nie może być pusta';
  END IF;

  IF p_warehouse_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM warehouses w WHERE w.id = p_warehouse_id AND w.is_active
  ) THEN
    RAISE EXCEPTION 'Magazyn docelowy % nie istnieje lub jest nieaktywny', p_warehouse_id;
  END IF;

  -- Wylicz expected_delivery_date z lead-time dostawcy
  IF p_expected_delivery_date IS NULL THEN
    SELECT lead_time_days INTO v_lead_time FROM suppliers WHERE id = p_supplier_id;
    v_expected_date := (now() AT TIME ZONE 'Europe/Warsaw')::date + COALESCE(v_lead_time, 42);
  ELSE
    v_expected_date := p_expected_delivery_date;
  END IF;

  -- Generuj numer ZD
  v_zd_number := generate_zd_number(p_supplier_id);

  -- Wstaw zamówienie ze statusem draft
  INSERT INTO purchase_orders (
    zd_number, supplier_id, status, expected_delivery_date, notes, created_by, warehouse_id
  ) VALUES (
    v_zd_number, p_supplier_id, 'draft', v_expected_date, p_notes, auth.uid(), p_warehouse_id
  ) RETURNING id INTO v_po_id;

  -- Wstaw pozycje (ilości ułamkowe: mb, m2 — bez ::integer)
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO purchase_order_items (
      purchase_order_id, component_id, quantity_ordered, notes
    ) VALUES (
      v_po_id,
      (v_item->>'component_id')::bigint,
      (v_item->>'quantity_ordered')::numeric,
      NULLIF(v_item->>'notes', '')
    );
  END LOOP;

  RETURN v_po_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.receive_purchase_order__impl(p_po_id bigint, p_warehouse_id bigint, p_received_items jsonb, p_reference_doc text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_po_status text;
  v_received_item jsonb;
  v_po_item_id bigint;
  v_qty_received numeric;
  v_po_item record;
  v_pz_items jsonb := '[]'::jsonb;
  v_zd_number text;
  v_all_completed boolean := true;
  v_any_received boolean := false;
  v_ref_base text;
  v_ref text;
  v_ref_no integer := 1;
BEGIN
  -- FOR UPDATE: dwa równoległe przyjęcia tej samej ZD idą po kolei
  -- (bez blokady oba czytały ten sam quantity_received / status)
  SELECT status, zd_number INTO v_po_status, v_zd_number
  FROM purchase_orders WHERE id = p_po_id
  FOR UPDATE;

  IF v_po_status IS NULL THEN
    RAISE EXCEPTION 'Zamówienie % nie istnieje', p_po_id;
  END IF;

  IF v_po_status NOT IN ('sent', 'partial') THEN
    RAISE EXCEPTION 'Nie można przyjąć dostawy dla zamówienia w statusie %', v_po_status;
  END IF;

  IF p_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Wybierz magazyn docelowy';
  END IF;

  FOR v_received_item IN SELECT * FROM jsonb_array_elements(p_received_items)
  LOOP
    v_po_item_id := (v_received_item->>'po_item_id')::bigint;
    v_qty_received := (v_received_item->>'quantity_received')::numeric;

    IF v_qty_received IS NULL OR v_qty_received < 0 THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_po_item
    FROM purchase_order_items
    WHERE id = v_po_item_id AND purchase_order_id = p_po_id
    FOR UPDATE;

    IF NOT FOUND OR v_po_item.status_per_item = 'cancelled' THEN
      CONTINUE;
    END IF;

    UPDATE purchase_order_items
    SET quantity_received = quantity_received + v_qty_received,
        status_per_item = CASE
          WHEN (quantity_received + v_qty_received) >= quantity_ordered THEN 'completed'
          WHEN (quantity_received + v_qty_received) > 0 THEN 'partial'
          ELSE 'pending'
        END
    WHERE id = v_po_item_id;

    IF v_qty_received > 0 THEN
      v_any_received := true;
      v_pz_items := v_pz_items || jsonb_build_object(
        'component_id', v_po_item.component_id,
        'quantity', v_qty_received,
        'notes', 'Przyjęcie z ' || v_zd_number
      );
    END IF;
  END LOOP;

  IF v_any_received THEN
    -- Unikalna referencja PZ per dostawa: częściowe dostawy nie sklejają się
    -- w jeden dokument (podgląd PZ grupuje po reference_doc)
    v_ref_base := COALESCE(NULLIF(TRIM(p_reference_doc), ''), v_zd_number || '-PZ');
    v_ref := v_ref_base;
    WHILE EXISTS (SELECT 1 FROM warehouse_movements m WHERE m.reference_doc = v_ref) LOOP
      v_ref_no := v_ref_no + 1;
      v_ref := v_ref_base || '-' || v_ref_no;
    END LOOP;

    PERFORM public.create_pz_document__impl(
      p_warehouse_id,
      v_pz_items,
      v_ref,
      COALESCE(NULLIF(TRIM(p_notes), ''), 'Przyjęcie dostawy z ' || v_zd_number)
    );
  END IF;

  SELECT NOT EXISTS (
    SELECT 1 FROM purchase_order_items
    WHERE purchase_order_id = p_po_id
      AND status_per_item IN ('pending', 'partial')
  ) INTO v_all_completed;

  UPDATE purchase_orders
  SET status = CASE WHEN v_all_completed THEN 'completed' ELSE 'partial' END,
      received_at = CASE WHEN v_all_completed THEN now() ELSE received_at END
  WHERE id = p_po_id;
END;
$function$;
