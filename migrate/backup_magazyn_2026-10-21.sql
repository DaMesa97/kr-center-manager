-- BACKUP definicji funkcji magazynu/inwentaryzacji PRZED migracja magazyn_inwentaryzacja_naprawy.sql (2026-10-21).
-- Przywrocenie: psql -f tego pliku (CREATE OR REPLACE). Kolumny purchase_order_items.quantity_ordered/quantity_received byly typu integer.

CREATE OR REPLACE FUNCTION public.assert_manager_or_service()
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (current_user_is_manager() or auth.role() = 'service_role') then
    raise exception 'Tylko kierownik — brak uprawnień do tej operacji';
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.close_inventory_session(p_session_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform assert_manager_or_service();
  perform public.close_inventory_session__impl(p_session_id);
end; $function$
;

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
begin
  select warehouse_id into v_warehouse_id
  from inventory_sessions
  where id = p_session_id and status = 'open';

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
  loop
    v_diff := v_line.counted_qty - v_line.system_qty;
    if v_diff = 0 then continue; end if;

    -- BEZ greatest(0, ...): spis może celowo sprowadzić ujemny stan do prawdy
    update warehouse_stock
    set quantity = quantity + v_diff,
        updated_at = now()
    where component_id = v_line.component_id
      and warehouse_id = v_warehouse_id;

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
                         'warehouse_id', v_warehouse_id, 'corrections', v_audit_items)
    );
  exception when others then
    null;
  end;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_mm_document(p_warehouse_from_id bigint, p_warehouse_to_id bigint, p_items jsonb, p_reference_doc text, p_notes text)
 RETURNS TABLE(r_component_id bigint, r_component_name text, r_quantity numeric, r_from_warehouse_code text, r_to_warehouse_code text, r_revalidated_orders integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform assert_manager_or_service();
  return query select * from public.create_mm_document__impl(p_warehouse_from_id, p_warehouse_to_id, p_items, p_reference_doc, p_notes);
end; $function$
;

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

    v_reval_count := revalidate_orders_for_component(v_component_id, p_warehouse_to_id);

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
$function$
;

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

  -- Wstaw pozycje
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO purchase_order_items (
      purchase_order_id, component_id, quantity_ordered, notes
    ) VALUES (
      v_po_id,
      (v_item->>'component_id')::bigint,
      (v_item->>'quantity_ordered')::integer,
      NULLIF(v_item->>'notes', '')
    );
  END LOOP;

  RETURN v_po_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.create_pz_document(p_warehouse_id bigint, p_items jsonb, p_reference_doc text, p_notes text)
 RETURNS TABLE(r_component_id bigint, r_component_name text, r_quantity numeric, r_revalidated_orders integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform assert_manager_or_service();
  return query select * from public.create_pz_document__impl(p_warehouse_id, p_items, p_reference_doc, p_notes);
end; $function$
;

CREATE OR REPLACE FUNCTION public.create_pz_document__impl(p_warehouse_id bigint, p_items jsonb, p_reference_doc text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS TABLE(r_component_id bigint, r_component_name text, r_quantity numeric, r_revalidated_orders integer)
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
  v_reval_count integer;
  v_batch_ref text;
  v_warehouse_code text;
BEGIN
  IF p_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Brak magazynu';
  END IF;

  SELECT code INTO v_warehouse_code FROM warehouses WHERE id = p_warehouse_id;
  v_batch_ref := COALESCE(p_reference_doc, 'PZ-' || to_char(now(), 'YYYYMMDD-HH24MISS'));

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_component_id := (v_item->>'component_id')::bigint;
    v_quantity := (v_item->>'quantity')::numeric;
    v_item_notes := v_item->>'notes';

    IF v_component_id IS NULL OR v_quantity IS NULL OR v_quantity <= 0 THEN
      CONTINUE;
    END IF;

    -- Logika notes: priorytet item.notes > p_notes > auto
    v_final_notes := COALESCE(
      NULLIF(TRIM(v_item_notes), ''),
      NULLIF(TRIM(p_notes), ''),
      'Przyjęcie do magazynu ' || COALESCE(v_warehouse_code, '')
        || ' — dokument ' || v_batch_ref
    );

    INSERT INTO warehouse_stock AS ws (warehouse_id, component_id, quantity)
    VALUES (p_warehouse_id, v_component_id, v_quantity)
    ON CONFLICT (warehouse_id, component_id)
    DO UPDATE SET
      quantity = ws.quantity + v_quantity,
      updated_at = now();

    INSERT INTO warehouse_movements(
      movement_type, warehouse_to_id, component_id, quantity,
      reference_doc, notes, created_by
    )
    VALUES (
      'PZ', p_warehouse_id, v_component_id, v_quantity,
      v_batch_ref, v_final_notes, auth.uid()
    );

    SELECT name INTO v_component_name
    FROM warehouse_components
    WHERE id = v_component_id;

    v_reval_count := revalidate_orders_for_component(v_component_id, p_warehouse_id);

    r_component_id := v_component_id;
    r_component_name := v_component_name;
    r_quantity := v_quantity;
    r_revalidated_orders := v_reval_count;
    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$function$
;

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
        when c.hist_months = 0 or c.baseline_monthly = 0 then 'no_data'
        when c.days_empty_sim is null then 'no_data'
        when c.days_empty_sim <= v_critical then 'critical'
        when c.days_empty_sim <= v_warning then 'warning'
        when c.days_empty_sim <= v_observation then 'observation'
        else 'ok'
      end as r_alert_level,
      case
        when c.hist_months = 0 or c.baseline_monthly = 0 then 0::numeric
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
    inner_q.r_days_until_empty nulls last,
    inner_q.r_component_name;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.open_inventory_session(p_notes text DEFAULT NULL::text, p_counted_date date DEFAULT CURRENT_DATE, p_warehouse_id integer DEFAULT NULL::integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform assert_manager_or_service();
  return public.open_inventory_session__impl(p_notes, p_counted_date, p_warehouse_id);
end; $function$
;

CREATE OR REPLACE FUNCTION public.open_inventory_session__impl(p_notes text DEFAULT NULL::text, p_counted_date date DEFAULT CURRENT_DATE, p_warehouse_id integer DEFAULT NULL::integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_session_id int;
begin
  if p_warehouse_id is null then
    raise exception 'Inwentaryzację otwiera się dla konkretnego magazynu';
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

  -- snapshot stanów magazynu (tylko aktywne komponenty)
  insert into inventory_lines (session_id, component_id, system_qty)
  select v_session_id, ws.component_id, coalesce(ws.quantity, 0)
  from warehouse_stock ws
  join warehouse_components wc on wc.id = ws.component_id
  where wc.is_active = true
    and ws.warehouse_id = p_warehouse_id
  order by wc.name;

  return v_session_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.receive_purchase_order(p_po_id bigint, p_warehouse_id bigint, p_received_items jsonb, p_reference_doc text, p_notes text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform assert_manager_or_service();
  perform public.receive_purchase_order__impl(p_po_id, p_warehouse_id, p_received_items, p_reference_doc, p_notes);
end; $function$
;

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
  v_qty_received integer;
  v_po_item record;
  v_pz_items jsonb := '[]'::jsonb;
  v_zd_number text;
  v_all_completed boolean := true;
  v_any_received boolean := false;
BEGIN
  -- Walidacja
  SELECT status, zd_number INTO v_po_status, v_zd_number 
  FROM purchase_orders WHERE id = p_po_id;
  
  IF v_po_status IS NULL THEN
    RAISE EXCEPTION 'Zamówienie % nie istnieje', p_po_id;
  END IF;
  
  IF v_po_status NOT IN ('sent', 'partial') THEN
    RAISE EXCEPTION 'Nie można przyjąć dostawy dla zamówienia w statusie %', v_po_status;
  END IF;
  
  IF p_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Wybierz magazyn docelowy';
  END IF;
  
  -- Iteruj po received_items, aktualizuj quantity_received per item
  FOR v_received_item IN SELECT * FROM jsonb_array_elements(p_received_items)
  LOOP
    v_po_item_id := (v_received_item->>'po_item_id')::bigint;
    v_qty_received := (v_received_item->>'quantity_received')::integer;
    
    IF v_qty_received IS NULL OR v_qty_received < 0 THEN
      CONTINUE;
    END IF;
    
    -- Pobierz pozycję
    SELECT * INTO v_po_item 
    FROM purchase_order_items 
    WHERE id = v_po_item_id AND purchase_order_id = p_po_id;
    
    IF NOT FOUND THEN
      CONTINUE;
    END IF;
    
    -- Akumuluj quantity_received (dodaj do dotychczasowego)
    UPDATE purchase_order_items
    SET quantity_received = quantity_received + v_qty_received,
        status_per_item = CASE 
          WHEN (quantity_received + v_qty_received) >= quantity_ordered THEN 'completed'
          WHEN (quantity_received + v_qty_received) > 0 THEN 'partial'
          ELSE 'pending'
        END
    WHERE id = v_po_item_id;
    
    -- Dodaj do listy dla PZ (tylko niezerowe)
    IF v_qty_received > 0 THEN
      v_any_received := true;
      v_pz_items := v_pz_items || jsonb_build_object(
        'component_id', v_po_item.component_id,
        'quantity', v_qty_received,
        'notes', 'Przyjęcie z ' || v_zd_number
      );
    END IF;
  END LOOP;
  
  -- Wywołaj create_pz_document jeśli były jakieś przyjęcia
  IF v_any_received THEN
    PERFORM create_pz_document(
      p_warehouse_id,
      v_pz_items,
      COALESCE(p_reference_doc, v_zd_number || '-PZ'),
      COALESCE(p_notes, 'Przyjęcie dostawy z ' || v_zd_number)
    );
  END IF;
  
  -- Aktualizuj status PO
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
$function$
;

CREATE OR REPLACE FUNCTION public.record_inventory_count(p_session_id integer, p_component_id bigint, p_counted numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform assert_manager_or_service();
  perform public.record_inventory_count__impl(p_session_id, p_component_id, p_counted);
end; $function$
;

CREATE OR REPLACE FUNCTION public.record_inventory_count__impl(p_session_id integer, p_component_id bigint, p_counted numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_warehouse_id int;
begin
  select warehouse_id into v_warehouse_id
  from inventory_sessions
  where id = p_session_id and status = 'open';
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
$function$
;

CREATE OR REPLACE FUNCTION public.record_inventory_count_line(p_line_id bigint, p_counted numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform assert_manager_or_service();
  perform public.record_inventory_count_line__impl(p_line_id, p_counted);
end; $function$
;

CREATE OR REPLACE FUNCTION public.record_inventory_count_line__impl(p_line_id bigint, p_counted numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_line record;
begin
  select il.id, il.component_id, s.warehouse_id, s.status
  into v_line
  from inventory_lines il
  join inventory_sessions s on s.id = il.session_id
  where il.id = p_line_id;

  if not found then
    raise exception 'Pozycja spisu % nie istnieje', p_line_id;
  end if;
  if v_line.status <> 'open' then
    raise exception 'Sesja inwentaryzacyjna jest zamknięta';
  end if;

  update inventory_lines il
  set counted_qty = p_counted,
      system_qty = coalesce((
        select ws.quantity from warehouse_stock ws
        where ws.warehouse_id = v_line.warehouse_id and ws.component_id = v_line.component_id
      ), 0)
  where il.id = p_line_id;
end;
$function$
;

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
  v_current_stock numeric;
  v_component_id bigint;
  v_original_shortage numeric;
  v_total_wz numeric;
  v_final_status text;
  v_had_missing_recipe boolean := false;
BEGIN
  SELECT id, category, system, quantity, stock_status, stock_issues
  INTO v_order
  FROM orders
  WHERE id = p_order_id;

  IF NOT FOUND THEN
    RETURN 'order_not_found';
  END IF;

  -- Tylko zamówienia z problemami
  IF v_order.stock_status IS NULL OR v_order.stock_status = 'ok' THEN
    RETURN v_order.stock_status;
  END IF;

  -- Dla każdego issue sprawdź czy nadal istnieje
  FOR v_issue IN SELECT * FROM jsonb_array_elements(COALESCE(v_order.stock_issues, '[]'::jsonb))
  LOOP
    IF v_issue->>'type' = 'missing_recipe' THEN
      -- Missing recipe zostaje bez zmian (PZ nie tworzy receptur)
      v_new_issues := v_new_issues || v_issue;
      v_had_missing_recipe := true;
      CONTINUE;
    END IF;

    -- Shortage — sprawdź aktualny stan
    SELECT id INTO v_component_id
    FROM warehouse_components
    WHERE code = v_issue->>'component_code'
    LIMIT 1;

    IF v_component_id IS NULL THEN
      v_new_issues := v_new_issues || v_issue;
      CONTINUE;
    END IF;

    SELECT id INTO v_wh_id
    FROM warehouses
    WHERE code = v_issue->>'warehouse'
    LIMIT 1;

    IF v_wh_id IS NULL THEN
      v_new_issues := v_new_issues || v_issue;
      CONTINUE;
    END IF;

    -- Aktualny stan + ile tego zamówienia już jest w WZ-ach (czyli ile "zabraliśmy")
    SELECT COALESCE(ws.quantity, 0) INTO v_current_stock
    FROM warehouse_stock ws
    WHERE ws.warehouse_id = v_wh_id AND ws.component_id = v_component_id;
    v_current_stock := COALESCE(v_current_stock, 0);

    -- Jeśli stan jest >= 0 to znaczy że komponent jest już wystarczająco dostępny
    -- (bo WZ już odjęło tyle ile zamówienie potrzebowało)
    -- Jeśli stan < 0 to ciągle niedobór, ale shortage maleje z każdym PZ
    
    IF v_current_stock >= 0 THEN
      -- Brak już nie ma — pomijamy issue (stan się "wyprostował")
      CONTINUE;
    ELSE
      -- Jeszcze minus — zaktualizuj shortage
      v_new_issues := v_new_issues || jsonb_set(
        v_issue,
        '{shortage}',
        to_jsonb(ABS(v_current_stock))
      );
    END IF;
  END LOOP;

  -- Ustaw nowy status
  IF jsonb_array_length(v_new_issues) = 0 THEN
    v_final_status := 'ok';
    UPDATE orders SET stock_status = v_final_status, stock_issues = NULL
    WHERE id = p_order_id;
  ELSIF v_had_missing_recipe AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_new_issues) el
    WHERE el->>'type' != 'missing_recipe'
  ) THEN
    v_final_status := 'partial_recipe';
    UPDATE orders SET stock_status = v_final_status, stock_issues = v_new_issues
    WHERE id = p_order_id;
  ELSIF v_had_missing_recipe THEN
    v_final_status := 'partial_recipe';
    UPDATE orders SET stock_status = v_final_status, stock_issues = v_new_issues
    WHERE id = p_order_id;
  ELSE
    v_final_status := 'insufficient';
    UPDATE orders SET stock_status = v_final_status, stock_issues = v_new_issues
    WHERE id = p_order_id;
  END IF;

  RETURN v_final_status;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.revalidate_orders_for_component(p_component_id bigint, p_warehouse_id bigint)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_comp_code text;
  v_wh_code text;
  v_order_id bigint;
  v_count integer := 0;
BEGIN
  SELECT code INTO v_comp_code FROM warehouse_components WHERE id = p_component_id;
  SELECT code INTO v_wh_code FROM warehouses WHERE id = p_warehouse_id;

  FOR v_order_id IN
    SELECT id FROM orders
    WHERE stock_status IN ('insufficient', 'partial_recipe')
      AND stock_issues IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(stock_issues) el
        WHERE el->>'component_code' = v_comp_code
          AND el->>'warehouse' = v_wh_code
      )
  LOOP
    PERFORM revalidate_order_stock_status(v_order_id);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$
;

