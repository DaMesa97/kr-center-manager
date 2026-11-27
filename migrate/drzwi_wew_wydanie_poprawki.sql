-- =====================================================================
-- 27.11.2026 wieczorem: issue_internal_door_stock po testach agentów (TESTY_AGENTOW_27-11.md)
--  * zwrot (ZWR) także za komponenty, których NIE MA już w pozycjach zlecenia (np. komplet przesuwny zamieniony
--    w Optimie na zwykłe drzwi, wiersz usunięty w ręcznym zleceniu) — liczone na pełnym złączeniu pozycje ↔ ruchy;
--  * komponent „na zamówienie” (is_stocked = false) nie dostaje korekty — zmiana TAK→NIE po wydaniu nie oddaje
--    na stan towaru, który wyjechał;
--  * blokada zlecenia (FOR UPDATE) i stanów — dwa „Wydane” w tej samej chwili nie zdejmują podwójnie.
-- Uprawnienia i kolejność magazynów bez zmian (najpierw WEW1, brak z WEW2, reszta na minus WEW1; korekta oddaje
-- najpierw na WEW2, potem WEW1). Uruchamiane konektorem (apply_migration drzwi_wew_wydanie_poprawki).
-- =====================================================================
create or replace function public.issue_internal_door_stock(p_order_id bigint)
 returns table(r_component_id bigint, r_quantity numeric)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_rec record;
  v_w1 bigint := (select id from warehouses where code = 'WEW1');
  v_w2 bigint := (select id from warehouses where code = 'WEW2');
  v_wh bigint;
  v_left numeric;
  v_have numeric;
  v_take numeric;
begin
  if not (
    current_user_is_manager()
    or auth.role() = 'service_role'
    or exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role in ('magazynier', 'obsluga_klienta'))
  ) then
    raise exception 'Brak uprawnień do wydania z magazynu wewnętrznego';
  end if;
  if v_w1 is null then
    raise exception 'Brak magazynu WEW1 (Magazyn 1)';
  end if;
  -- jedno rozliczenie zlecenia naraz (drugie czeka i widzi już ruchy pierwszego)
  perform 1 from orders where id = p_order_id for update;

  for v_rec in
    with poz as (
      select i.component_id, sum(i.quantity)::numeric as q
      from order_internal_door_items i
      where i.order_id = p_order_id and i.component_id is not null
      group by i.component_id
    ), ruch as (
      select wm.component_id,
             sum(case when wm.movement_type = 'WZ' then wm.quantity
                      when wm.movement_type = 'ZWR' then -wm.quantity
                      else 0 end) as wyd
      from warehouse_movements wm
      where wm.order_id = p_order_id
        and wm.movement_type in ('WZ', 'ZWR')
        and (wm.warehouse_from_id in (v_w1, v_w2) or wm.warehouse_to_id in (v_w1, v_w2))
      group by wm.component_id
    )
    select x.component_id, x.net_to_issue from (
      select coalesce(p.component_id, r.component_id) as component_id,
             coalesce(p.q, 0) - coalesce(r.wyd, 0) as net_to_issue
      from poz p
      full join ruch r on r.component_id = p.component_id
    ) x
    join warehouse_components c on c.id = x.component_id
    where c.is_stocked and x.net_to_issue <> 0
    order by x.component_id
  loop
    if v_rec.net_to_issue > 0 then
      v_left := v_rec.net_to_issue;
      foreach v_wh in array array_remove(array[v_w1, v_w2], null) loop
        select greatest(coalesce(ws.quantity, 0), 0) into v_have
        from warehouse_stock ws where ws.warehouse_id = v_wh and ws.component_id = v_rec.component_id
        for update;
        v_take := least(v_left, coalesce(v_have, 0));
        if v_take > 0 then
          perform _internal_door_move('WZ', v_wh, v_rec.component_id, v_take, p_order_id);
          v_left := v_left - v_take;
        end if;
      end loop;
      if v_left > 0 then
        perform _internal_door_move('WZ', v_w1, v_rec.component_id, v_left, p_order_id);
      end if;
    else
      v_left := -v_rec.net_to_issue;
      foreach v_wh in array array_remove(array[v_w2, v_w1], null) loop
        select coalesce(sum(case when wm.movement_type = 'WZ' and wm.warehouse_from_id = v_wh then wm.quantity
                                 when wm.movement_type = 'ZWR' and wm.warehouse_to_id = v_wh then -wm.quantity
                                 else 0 end), 0)
          into v_have
        from warehouse_movements wm
        where wm.order_id = p_order_id and wm.component_id = v_rec.component_id and wm.movement_type in ('WZ', 'ZWR');
        v_take := least(v_left, greatest(v_have, 0));
        if v_take > 0 then
          perform _internal_door_move('ZWR', v_wh, v_rec.component_id, v_take, p_order_id);
          v_left := v_left - v_take;
        end if;
      end loop;
      if v_left > 0 then
        perform _internal_door_move('ZWR', v_w1, v_rec.component_id, v_left, p_order_id);
      end if;
    end if;

    r_component_id := v_rec.component_id;
    r_quantity := v_rec.net_to_issue;
    return next;
  end loop;
  return;
end;
$function$;
