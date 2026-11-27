-- 27.11.2026 (testy 27.11, runda 3; WYSOKI): cofnięcie zniszczenia przypiętego do zlecenia drzwi wewnętrznych dawało
-- drugie wydanie. undo_damage_report zapisuje ZWR „ZWR-ZN-<id>” z order_id zlecenia, a issue_internal_door_stock
-- liczyło „już wydane” jako WSZYSTKIE WZ − ZWR zlecenia na Magazynie 1/2 — zwrot zniszczenia wyglądał jak zwrot
-- wydanych drzwi, więc ponowne rozliczenie wydawało je drugi raz (zlecenie id 29364: stan 0 → wydanie −1 →
-- zniszczenie −2 → cofnięcie −1 → ponowne rozliczenie −2).
-- Teraz issue_internal_door_stock liczy tylko ruchy własnego rozliczenia: WZ-INTDOOR-<id> / ZWR-INTDOOR-<id>
-- (_internal_door_move) oraz ZWR-ORDER-<id> (return_stock_for_order — „Zwróć towar” / „Anuluj” w oknie zlecenia,
-- to też zwrot wydanych drzwi). Ruchy zniszczeń (ZN-…, ZWR-ZN-…) i inne nie wpływają na rozliczenie.
-- Spójnie: return_stock_for_order__impl nie odejmuje od wydanego zwrotów zniszczeń (ZWR-ZN-…) — inaczej anulowanie
-- po cofniętym zniszczeniu oddawało o tyle mniej, ile cofnięto.
-- DO WDROŻENIA (nie wgrane w sesji).
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
  -- testy 27.11 (runda 3): tylko ruchy rozliczenia zlecenia (bez zniszczeń i ich cofnięć)
  v_refs text[] := array['WZ-INTDOOR-' || p_order_id, 'ZWR-INTDOOR-' || p_order_id, 'ZWR-ORDER-' || p_order_id];
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
        and wm.reference_doc = any (v_refs)
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
        where wm.order_id = p_order_id and wm.component_id = v_rec.component_id and wm.movement_type in ('WZ', 'ZWR')
          and wm.reference_doc = any (v_refs);
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

-- return_stock_for_order__impl: zwrot zniszczenia (ZWR-ZN-…) to nie zwrot wydanego towaru
do $$
declare
  d text;
  stare text := 'AND wr.warehouse_to_id = wm.warehouse_from_id';
  nowe text := 'AND wr.warehouse_to_id = wm.warehouse_from_id
            AND coalesce(wr.reference_doc, '''') NOT LIKE ''ZWR-ZN-%'' -- testy 27.11 (runda 3)';
begin
  d := pg_get_functiondef('public.return_stock_for_order__impl(bigint)'::regprocedure);
  if position('testy 27.11 (runda 3)' in d) > 0 then
    raise notice 'return_stock_for_order__impl: już poprawione — bez zmian';
    return;
  end if;
  if position(stare in d) = 0 then
    raise exception 'return_stock_for_order__impl: nie znaleziono miejsca łatki — sprawdź definicję';
  end if;
  execute replace(d, stare, nowe);
end $$;
