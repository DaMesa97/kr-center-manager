-- 27.11.2026 (sesja testów, runda 2; tester zaopatrzenia, DROBNY/ŚREDNI): anulowanie ZD po częściowym przyjęciu dawało
-- status „Anulowane”, choć towar przyszedł (np. 3 PZ, 115 szt.) — historia i raporty pokazywały, że nic nie dotarło.
-- Teraz: pozycje z przyjętą ilością zamykają się jako 'completed' (zamknięte częściowo), reszta 'cancelled'; całe ZD
-- dostaje 'completed', gdy coś przyjęto, inaczej 'cancelled' (tak jak już robi cancel_purchase_order_item).
-- Poprawka (testy 27.11, runda 3; NISKI): przy 'completed' ustawiamy też received_at (jeśli puste), jak przy przyjęciu.
-- DO WDROŻENIA (nie wgrane w sesji).
create or replace function public.cancel_purchase_order__impl(p_po_id bigint)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_status text;
  v_przyjete boolean;
begin
  select status into v_status from purchase_orders where id = p_po_id for update;
  if v_status is null then
    raise exception 'Zamówienie % nie istnieje', p_po_id;
  end if;
  if v_status in ('completed') then
    raise exception 'Nie można anulować zamówienia ze statusem completed';
  end if;

  update purchase_order_items
  set status_per_item = case when coalesce(quantity_received, 0) > 0 then 'completed' else 'cancelled' end
  where purchase_order_id = p_po_id
    and status_per_item in ('pending', 'partial');

  select exists (select 1 from purchase_order_items where purchase_order_id = p_po_id and coalesce(quantity_received, 0) > 0)
    into v_przyjete;
  -- testy 27.11 (runda 3): zamknięte jako przyjęte → data przyjęcia jak przy receive_purchase_order
  update purchase_orders
  set status = case when v_przyjete then 'completed' else 'cancelled' end,
      received_at = case when v_przyjete then coalesce(received_at, now()) else received_at end
  where id = p_po_id;
end;
$function$;
