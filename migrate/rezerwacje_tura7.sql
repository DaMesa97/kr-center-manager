-- =====================================================================
-- REZERWACJE — TURA 7: WYDANIE KOŃCOWE przy oznaczeniu wydania zamówienia
--
-- Decyzja Tymka 2026-09-04: kategorie bez etapów produkcji (Techniczne,
-- Drzwi wewnętrzne) rezerwują przy utworzeniu, a WZ robią przy oznaczeniu
-- WYDANIA zamówienia. Funkcja działa jako CATCH-ALL: wydaje WSZYSTKIE
-- pozostałe aktywne rezerwacje zamówienia (dowolny etap) — więc przy
-- wydaniu domykają się też ogony po nieodhaczonych etapach (rozszerzenie
-- ponad brief — dzięki temu po wydaniu zamówienie nigdy nie trzyma
-- rezerwacji, co jest warunkiem sensownej inwentaryzacji).
--
-- Mechanika jak release_stock_for_stage: bez p_force braki blokują
-- (zero zmian, lista braków); p_force wydaje na minus z [WYMUSZONE].
-- Zbiorcze WZ: reference 'WZ-{kategoria}-{nr zlecenia}-wydanie'.
-- =====================================================================

create or replace function public.release_remaining_for_order(
  p_order_id bigint,
  p_force boolean default false
)
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
  v_audit_items jsonb := '[]'::jsonb;
  v_forced_any boolean := false;
  v_line_shortage numeric;
begin
  select o.id, o.category, o.order_number into v_order
  from orders o where o.id = p_order_id;
  if not found then
    raise exception 'Zamówienie % nie istnieje', p_order_id;
  end if;

  -- PRZEBIEG 1 (pomijany przy p_force): sprawdź fizyczną dostępność
  if not p_force then
    for v_res in
      select sr.id, sr.warehouse_id, sr.component_id,
             sr.quantity_reserved, sr.quantity_released,
             c.name, c.code as comp_code, w.code as wh_code
      from stock_reservations sr
      join warehouse_components c on c.id = sr.component_id
      join warehouses w on w.id = sr.warehouse_id
      where sr.order_id = p_order_id
        and sr.status in ('reserved', 'partially_released')
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
        r_shortage := v_remaining - greatest(coalesce(v_phys, 0), 0); -- ujemny stan fizyczny liczymy jak 0
        return next;
      end if;
    end loop;

    if v_any_shortage then
      return;
    end if;
  end if;

  -- PRZEBIEG 2: wydaj wszystko co zostało
  for v_res in
    select sr.id, sr.warehouse_id, sr.component_id, sr.stage_key,
           sr.quantity_reserved, sr.quantity_released,
           c.name, c.code as comp_code, w.code as wh_code
    from stock_reservations sr
    join warehouse_components c on c.id = sr.component_id
    join warehouses w on w.id = sr.warehouse_id
    where sr.order_id = p_order_id
      and sr.status in ('reserved', 'partially_released')
    for update of sr
  loop
    v_remaining := v_res.quantity_reserved - v_res.quantity_released;
    if v_remaining <= 0 then continue; end if;

    select ws.quantity into v_phys
    from warehouse_stock ws
    where ws.warehouse_id = v_res.warehouse_id and ws.component_id = v_res.component_id;
    v_line_shortage := greatest(0, v_remaining - greatest(coalesce(v_phys, 0), 0));
    if v_line_shortage > 0 then v_forced_any := true; end if;

    insert into warehouse_movements(
      movement_type, warehouse_from_id, component_id, quantity,
      order_id, reference_doc, notes, created_by
    ) values (
      'WZ', v_res.warehouse_id, v_res.component_id, v_remaining,
      p_order_id,
      'WZ-' || v_order.category || '-' || coalesce(nullif(trim(v_order.order_number), ''), p_order_id::text) || '-wydanie',
      'Wydanie końcowe (oznaczenie wydania) — zamówienie ' || v_order.category
        || ' #' || coalesce(v_order.order_number, p_order_id::text)
        || ' [RES-' || v_res.id || ']'
        || case when v_line_shortage > 0 then ' [WYMUSZONE brak ' || v_line_shortage || ']' else '' end,
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
      'reservation_id', v_res.id, 'component_code', v_res.comp_code,
      'qty', v_remaining, 'forced_shortage', v_line_shortage
    );

    r_component_id := v_res.component_id;
    r_component_name := v_res.name;
    r_component_code := v_res.comp_code;
    r_quantity := v_remaining;
    r_warehouse_code := v_res.wh_code;
    r_status := 'released';
    r_shortage := v_line_shortage;
    return next;
  end loop;

  if jsonb_array_length(v_audit_items) > 0 then
    begin
      insert into audit_log (table_name, record_id, operation, user_id, new_data)
      values (
        'stock_reservations', p_order_id::text, 'UPDATE', auth.uid(),
        jsonb_build_object('action', 'release_final', 'order_id', p_order_id,
                           'forced', v_forced_any, 'items', v_audit_items)
      );
    exception when others then
      null;
    end;
  end if;

  return;
end;
$$;

grant execute on function public.release_remaining_for_order(bigint, boolean) to authenticated;

-- ── WERYFIKACJA ───────────────────────────────────────────────────────
-- select * from release_remaining_for_order(<ID>);        -- braki → insufficient, zero zmian
-- select * from release_remaining_for_order(<ID>, true);  -- wymuszenie
