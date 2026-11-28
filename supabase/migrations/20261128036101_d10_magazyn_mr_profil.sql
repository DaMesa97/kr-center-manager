-- 28.11.2026, decyzja D10 (właściciel: TAK) — MR Profil: osobny magazyn drzwi wewnętrznych.
-- Problem: zlecenia drzwi wewnętrznych z RO bazy MR Profil (source_metadata->>'optima_key' = 'MR:<id>') przy
-- wydaniu (issue_internal_door_stock) schodziłyby z magazynów KR — WEW1 „Magazyn 1” i WEW2 „Magazyn 2”.
-- Dziś MR ma 0 zleceń, więc bez korekty danych.
-- Zmiana:
--  - nowy magazyn MR_WEW „Magazyn MR Profil” (kod celowo NIE zaczyna się od WEW — ekrany i statystyki KR liczą
--    magazyny drzwi wewnętrznych po wzorcu 'WEW%', więc stan MR nie miesza się ze stanem KR);
--  - wew_zlecenie_mr(order_id): czy zlecenie pochodzi z RO MR Profil;
--  - issue_internal_door_stock: zlecenie MR wydaje tylko z MR_WEW (brak towaru → stan MR_WEW na minus, jak dotąd
--    WEW1 dla KR); zwroty (korekta po edycji) wracają na magazyn, z którego zeszły (najpierw MR_WEW dla MR, WEW2/WEW1
--    dla KR). Zlecenia KR — bez zmian zachowania. Treść funkcji = wersja z 20261127233200 (ta sama co na produkcji
--    28.11, z blokadą P0410 dla anulowanych) + wybór magazynów.
-- Zależności: po 20261127233200 / 233300 (pełna podmiana funkcji; blokada anulowanych zachowana w treści).
-- Można uruchamiać wielokrotnie.
-- DO WDROŻENIA (nie wgrane).

insert into public.warehouses (code, name, is_active)
values ('MR_WEW', 'Magazyn MR Profil', true)
on conflict (code) do nothing;

create or replace function public.wew_zlecenie_mr(p_order_id bigint)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from orders o
    where o.id = p_order_id and o.source = 'optima_ro' and o.source_metadata->>'optima_key' like 'MR:%'
  );
$$;
revoke all on function public.wew_zlecenie_mr(bigint) from public, anon;
grant execute on function public.wew_zlecenie_mr(bigint) to authenticated, service_role;

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
  -- D10: magazyn MR Profil (zlecenia z RO bazy MR)
  v_wmr bigint := (select id from warehouses where code = 'MR_WEW');
  v_mr boolean := wew_zlecenie_mr(p_order_id);
  v_issue bigint[];   -- kolejność zdejmowania
  v_ret bigint[];     -- kolejność zwrotów
  v_all bigint[];     -- wszystkie magazyny drzwi wewnętrznych (rozliczenie „już wydane”)
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
  if v_mr then
    if v_wmr is null then
      raise exception 'Brak magazynu MR_WEW (Magazyn MR Profil)';
    end if;
    v_issue := array[v_wmr];
    v_ret := array_remove(array[v_wmr, v_w2, v_w1], null);
  else
    if v_w1 is null then
      raise exception 'Brak magazynu WEW1 (Magazyn 1)';
    end if;
    v_issue := array_remove(array[v_w1, v_w2], null);
    v_ret := array_remove(array[v_w2, v_w1, v_wmr], null);
  end if;
  v_all := array_remove(array[v_w1, v_w2, v_wmr], null);
  -- jedno rozliczenie zlecenia naraz (drugie czeka i widzi już ruchy pierwszego)
  perform 1 from orders where id = p_order_id for update;
  -- anulowanego zlecenia nie wydajemy (testy 27.11, runda 3) — ta sama blokada co w 20261127233300 (a)
  if exists (select 1 from orders where id = p_order_id and extra_fields->>'cancelled' = 'true') then
    raise exception 'Zlecenie jest anulowane — nie można wydać towaru z magazynu. Najpierw przywróć zlecenie.'
      using errcode = 'P0410';
  end if;

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
        and (wm.warehouse_from_id = any (v_all) or wm.warehouse_to_id = any (v_all))
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
      foreach v_wh in array v_issue loop
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
        perform _internal_door_move('WZ', v_issue[1], v_rec.component_id, v_left, p_order_id);
      end if;
    else
      v_left := -v_rec.net_to_issue;
      foreach v_wh in array v_ret loop
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
        perform _internal_door_move('ZWR', v_issue[1], v_rec.component_id, v_left, p_order_id);
      end if;
    end if;

    r_component_id := v_rec.component_id;
    r_quantity := v_rec.net_to_issue;
    return next;
  end loop;
  return;
end;
$function$;
