-- 27.11.2026 (testy 27.11, runda 3; KRYTYCZNY): „Anuluj” → „Przywróć” podwajało rezerwacje.
-- Zapasowa reguła dla starych wierszy bez powodu anulowania (cancel_reason is null, sprzed 7.11) brała
-- „ostatnią paczkę bez powodu” ZAWSZE — także gdy zlecenie miało już wiersze 'order_cancelled' (nowe anulowanie)
-- albo aktywne rezerwacje. Przywracało wtedy obie paczki (np. zlecenie id 15402: 23 → 46 wierszy, 62,75 → 125,5).
-- Teraz reguła zapasowa działa tylko, gdy zlecenie NIE ma żadnego wiersza 'order_cancelled' i nie ma aktywnych
-- rezerwacji (reserved / partially_released) — czyli tylko dla zleceń anulowanych starym kodem.
-- Stan 27.11: 901 zleceń ma stare wiersze bez powodu; 16 z nich ma też 'order_cancelled', 218 ma aktywne rezerwacje
-- (te przestają być podwajane); 594 zostaje z regułą zapasową (stare anulowania).
-- DO WDROŻENIA (nie wgrane w sesji).
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
  -- stare wiersze bez powodu: tylko ostatnia paczka anulowania (jedno wywołanie = jedno now()),
  -- i TYLKO gdy zlecenie nie ma nowego anulowania ani aktywnych rezerwacji (testy 27.11, runda 3)
  if not exists (select 1 from stock_reservations
                 where order_id = p_order_id
                   and (cancel_reason = 'order_cancelled' or status in ('reserved', 'partially_released'))) then
    select max(updated_at) into v_last_batch
    from stock_reservations where order_id = p_order_id and status = 'cancelled' and cancel_reason is null;
  end if;

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
