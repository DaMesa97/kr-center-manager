-- 28.11.2026 — decyzja D16 (właściciel: TAK, wariant a): przy MM towaru zarezerwowanego pytanie „przenieść też
-- rezerwacje N zleceń?”. Dotąd przesunięcie całego stanu zostawiało rezerwacje na starym magazynie: hala dostawała
-- „brak”, a „Wydaj mimo braku” zdejmowało źródło na minus.
--   * mm_rezerwacje_do_przeniesienia(from, component, qty) — które rezerwacje trzeba przenieść: tylko tyle, ile
--     po przesunięciu nie zmieści się w stanie źródła (potrzeba = zarezerwowane − (stan − ilość MM)), najstarsze
--     najpierw, całymi wierszami, łącznie nie więcej niż ilość MM. Tylko rezerwacje nietknięte (status 'reserved',
--     nic nie wydano) — częściowo wydane zostają na źródle (historia wydań nie zmienia magazynu).
--   * podglad_rezerwacji_mm(from, items) — dla okna MM: na pozycję ile zleceń / sztuk by się przeniosło.
--   * create_mm_document(..., p_move_reservations boolean default false) — gdy true, przed przesunięciem stanu
--     przenosi wskazane rezerwacje (stock_reservations.warehouse_id + reserved_quantity na obu półkach); przeliczenie
--     braków zleceń robi jak dotąd create_mm_document__impl (oba magazyny). Wynik bez zmian.
--     Stara 5-parametrowa wersja jest usuwana (PostgREST nie może mieć dwóch kandydatów); wywołania z 5 parametrami
--     (aplikacja 1.1.7) działają dalej (p_move_reservations = false = jak dotąd).
-- Zależności: PO 20261128030200 (blokada spisu — ta wersja create_mm_document ją zawiera).
-- DO WDROŻENIA (nie wgrane).

create or replace function public.mm_rezerwacje_do_przeniesienia(p_warehouse_from_id bigint, p_component_id bigint, p_quantity numeric)
 returns table(r_reservation_id bigint, r_order_id bigint, r_remaining numeric)
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  with src as (
    select coalesce(ws.quantity, 0) as qty, coalesce(ws.reserved_quantity, 0) as reserved
    from (select 1) d
    left join warehouse_stock ws on ws.warehouse_id = p_warehouse_from_id and ws.component_id = p_component_id
  ),
  need as (
    select greatest(0, s.reserved - greatest(s.qty - coalesce(p_quantity, 0), 0)) as need from src s
  ),
  cand as (
    select sr.id, sr.order_id, (sr.quantity_reserved - sr.quantity_released) as remaining,
           sum(sr.quantity_reserved - sr.quantity_released) over (order by sr.created_at, sr.id) as cum
    from stock_reservations sr
    where sr.warehouse_id = p_warehouse_from_id
      and sr.component_id = p_component_id
      and sr.status = 'reserved'
      and coalesce(sr.quantity_released, 0) = 0
      and sr.quantity_reserved > 0
  )
  select c.id, c.order_id, c.remaining
  from cand c, need n
  where n.need > 0
    and c.cum <= coalesce(p_quantity, 0)
    and c.cum - c.remaining < n.need
  order by c.cum;
$function$;

revoke all on function public.mm_rezerwacje_do_przeniesienia(bigint, bigint, numeric) from public, anon, authenticated;

create or replace function public.podglad_rezerwacji_mm(p_warehouse_from_id bigint, p_items jsonb)
 returns table(r_component_id bigint, r_orders integer, r_reservations integer, r_quantity numeric)
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $function$
declare
  v_item jsonb;
  v_comp bigint;
  v_qty numeric;
begin
  perform public.assert_warehouse_perm('movements');
  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_comp := nullif(v_item->>'component_id', '')::bigint;
    v_qty := nullif(v_item->>'quantity', '')::numeric;
    if v_comp is null or v_qty is null or v_qty = 'NaN' or v_qty = 'Infinity' or v_qty <= 0 then continue; end if;
    select v_comp, count(distinct m.r_order_id)::integer, count(*)::integer, coalesce(sum(m.r_remaining), 0)
      into r_component_id, r_orders, r_reservations, r_quantity
    from public.mm_rezerwacje_do_przeniesienia(p_warehouse_from_id, v_comp, v_qty) m;
    if r_reservations > 0 then return next; end if;
  end loop;
end;
$function$;

revoke all on function public.podglad_rezerwacji_mm(bigint, jsonb) from public, anon;
grant execute on function public.podglad_rezerwacji_mm(bigint, jsonb) to authenticated, service_role;

drop function if exists public.create_mm_document(bigint, bigint, jsonb, text, text);

create function public.create_mm_document(p_warehouse_from_id bigint, p_warehouse_to_id bigint, p_items jsonb, p_reference_doc text, p_notes text, p_move_reservations boolean default false)
 returns table(r_component_id bigint, r_component_name text, r_quantity numeric, r_from_warehouse_code text, r_to_warehouse_code text, r_revalidated_orders integer)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_item jsonb;
  v_comp bigint;
  v_qty numeric;
  v_moved numeric;
begin
  perform public.assert_warehouse_perm('movements');
  perform public.assert_magazyn_bez_blokady_spisu(p_warehouse_from_id);  -- D14
  perform public.assert_magazyn_bez_blokady_spisu(p_warehouse_to_id);

  -- D16: rezerwacje idą razem z towarem (przed przesunięciem stanu — impl przelicza potem braki obu magazynów)
  if coalesce(p_move_reservations, false) and p_warehouse_from_id is not null and p_warehouse_to_id is not null
     and p_warehouse_from_id <> p_warehouse_to_id then
    for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
      v_comp := nullif(v_item->>'component_id', '')::bigint;
      v_qty := nullif(v_item->>'quantity', '')::numeric;
      if v_comp is null or v_qty is null or v_qty = 'NaN' or v_qty = 'Infinity' or v_qty <= 0 then continue; end if;

      with m as (
        select * from public.mm_rezerwacje_do_przeniesienia(p_warehouse_from_id, v_comp, v_qty)
      ), upd as (
        update stock_reservations sr
           set warehouse_id = p_warehouse_to_id, updated_at = now()
          from m
         where sr.id = m.r_reservation_id
        returning m.r_remaining
      )
      select coalesce(sum(r_remaining), 0) into v_moved from upd;

      if v_moved > 0 then
        update warehouse_stock
           set reserved_quantity = greatest(coalesce(reserved_quantity, 0) - v_moved, 0), updated_at = now()
         where warehouse_id = p_warehouse_from_id and component_id = v_comp;
        insert into warehouse_stock as ws (warehouse_id, component_id, quantity, reserved_quantity)
        values (p_warehouse_to_id, v_comp, 0, v_moved)
        on conflict (warehouse_id, component_id)
        do update set reserved_quantity = coalesce(ws.reserved_quantity, 0) + v_moved, updated_at = now();
      end if;
    end loop;
  end if;

  return query select * from public.create_mm_document__impl(p_warehouse_from_id, p_warehouse_to_id, p_items, p_reference_doc, p_notes);
end; $function$;

revoke all on function public.create_mm_document(bigint, bigint, jsonb, text, text, boolean) from public, anon;
grant execute on function public.create_mm_document(bigint, bigint, jsonb, text, text, boolean) to authenticated, service_role;
