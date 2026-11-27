-- =====================================================================
-- 27.11.2026: drzwi wewnętrzne w dwóch magazynach + WZ reklamacyjny
--
--  * WEWNETRZNE (id 3, bez stanów i ruchów) → WEW1 „Magazyn 1”; nowy WEW2 „Magazyn 2”.
--    Te same kartoteki leżą na obu, liczymy osobno (spis per magazyn, PZ / MM / zamówienia jak dla innych magazynów).
--  * Wydanie zlecenia drzwi wewnętrznych (issue_internal_door_stock) — automatycznie: najpierw Magazyn 1
--    do jego stanu, brakujące z Magazynu 2, a czego nie ma nigdzie — z Magazynu 1 na minus (jak wymuszenia).
--    Korekta po edycji (ZWR) wraca tam, skąd wydano: najpierw Magazyn 2, potem 1.
--  * stat_wew_braki: stan = suma magazynów WEW*.
--  * WZ reklamacyjny: dokument wydania z wybranego magazynu (nagłówek wz_reklamacyjne + pozycje),
--    ruchy WZ z reference_doc = numer (WZR/RRRR/NNN); anulowanie = ZWR na ten sam magazyn.
-- =====================================================================

-- ---------------------------------------------------------------- magazyny
update public.warehouses set code = 'WEW1', name = 'Magazyn 1'
where id = 3 and code = 'WEWNETRZNE';

insert into public.warehouses (code, name, is_active)
select 'WEW2', 'Magazyn 2', true
where not exists (select 1 from public.warehouses where code = 'WEW2');

-- ---------------------------------------------------------------- ruch drzwi wewnętrznych (WZ / ZWR) dla zlecenia
create or replace function public._internal_door_move(p_type text, p_wh bigint, p_component_id bigint, p_qty numeric, p_order_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if p_qty is null or p_qty <= 0 then return; end if;
  insert into warehouse_movements (
    movement_type, warehouse_from_id, warehouse_to_id, component_id, quantity,
    order_id, reference_doc, notes, created_by
  ) values (
    p_type,
    case when p_type = 'WZ' then p_wh end,
    case when p_type = 'ZWR' then p_wh end,
    p_component_id,
    p_qty,
    p_order_id,
    case when p_type = 'WZ' then 'WZ-INTDOOR-' else 'ZWR-INTDOOR-' end || p_order_id,
    'Zamówienie Drzwi wewnętrzne #' || p_order_id ||
      case when p_type = 'WZ' then ' — wydanie pozycji' else ' — korekta po edycji' end,
    auth.uid()
  );
  insert into warehouse_stock as ws (warehouse_id, component_id, quantity)
  values (p_wh, p_component_id, case when p_type = 'WZ' then -p_qty else p_qty end)
  on conflict (warehouse_id, component_id)
  do update set quantity = ws.quantity + case when p_type = 'WZ' then -p_qty else p_qty end, updated_at = now();
end;
$function$;

revoke all on function public._internal_door_move(text, bigint, bigint, numeric, bigint) from public, anon, authenticated;

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

  for v_rec in
    select x.component_id, x.net_to_issue from (
      select i.component_id,
             -- komponenty spoza magazynu (is_stocked = false) nie zdejmują stanu;
             -- wcześniejsze wydania takich komponentów są korygowane do zera
             (case when c.is_stocked then sum(i.quantity)::numeric else 0 end)
               - coalesce((
                   select sum(case when wm.movement_type = 'WZ' then wm.quantity
                                   when wm.movement_type = 'ZWR' then -wm.quantity
                                   else 0 end)
                   from warehouse_movements wm
                   where wm.order_id = p_order_id
                     and wm.component_id = i.component_id
                     and wm.movement_type in ('WZ', 'ZWR')
                 ), 0) as net_to_issue
      from order_internal_door_items i
      join warehouse_components c on c.id = i.component_id
      where i.order_id = p_order_id
      group by i.component_id, c.is_stocked
    ) x
    where x.net_to_issue <> 0
  loop
    if v_rec.net_to_issue > 0 then
      -- wydanie: Magazyn 1 do jego stanu, potem Magazyn 2, reszta z Magazynu 1 na minus
      v_left := v_rec.net_to_issue;
      foreach v_wh in array array_remove(array[v_w1, v_w2], null) loop
        select greatest(coalesce(ws.quantity, 0), 0) into v_have
        from warehouse_stock ws where ws.warehouse_id = v_wh and ws.component_id = v_rec.component_id;
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
      -- korekta: zwrot tam, skąd wydano (najpierw Magazyn 2, potem 1); nadwyżka na Magazyn 1
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

-- ---------------------------------------------------------------- statystyka braków: stan z obu magazynów
CREATE OR REPLACE FUNCTION public.stat_wew_braki(p_days integer DEFAULT 180, p_prog integer DEFAULT 7)
 RETURNS TABLE(optima_code text, optima_name text, item_type text, grupa text, model text, kolor text, rozmiar text, wykonanie text, component_id bigint, is_stocked boolean, stan numeric, otwarte_zlecenia bigint, otwarte_szt bigint, otwarte_sr_dni numeric, otwarte_max_dni integer, otwarte_najstarsze date, hist_zlecenia bigint, hist_czekaly bigint, hist_sr_dni numeric, hist_max_dni integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- magazyny drzwi wewnętrznych (WEW1, WEW2…) — stan = suma
  v_wh bigint[] := (select array_agg(w.id) from public.warehouses w where upper(w.code) like 'WEW%');
begin
  if not public.current_user_is_manager() then return; end if;
  perform public.interior_item_dict_refresh();
  return query
    with otw as (
      select i.optima_code,
             count(distinct i.order_id) as zlecenia,
             sum(i.quantity) as szt,
             round(avg(current_date - o.order_date), 1) as sr_dni,
             max(current_date - o.order_date) as max_dni,
             min(o.order_date) as najstarsze
      from public.orders o
      join public.order_internal_door_items i on i.order_id = o.id
      where o.category = 'DrzwiWewnetrzne' and public.wew_zlecenie_otwarte(o) and i.optima_code is not null
      group by 1
    ), hist as (
      select i.optima_code,
             count(distinct i.order_id) as zlecenia,
             count(distinct i.order_id) filter (where o.release_date - o.order_date > p_prog) as czekaly,
             round(avg(o.release_date - o.order_date) filter (where o.release_date - o.order_date > p_prog), 1) as sr_dni,
             max(o.release_date - o.order_date) as max_dni
      from public.orders o
      join public.order_internal_door_items i on i.order_id = o.id
      where o.category = 'DrzwiWewnetrzne' and o.release_date is not null
        and o.order_date >= current_date - greatest(coalesce(p_days, 180), 1)
        and coalesce(o.extra_fields->>'cancelled', '') <> 'true' and i.optima_code is not null
      group by 1
    ), kody as (
      select coalesce(a.optima_code, h.optima_code) as optima_code from otw a full join hist h on h.optima_code = a.optima_code
    )
    select k.optima_code, d.optima_name, d.item_type, d.grupa, d.model, d.kolor, d.rozmiar, d.wykonanie,
           c.id as component_id, c.is_stocked,
           (select sum(s.quantity) from public.warehouse_stock s where s.component_id = c.id and (v_wh is null or s.warehouse_id = any(v_wh))) as stan,
           coalesce(a.zlecenia, 0)::bigint, coalesce(a.szt, 0)::bigint, a.sr_dni, a.max_dni, a.najstarsze,
           coalesce(h.zlecenia, 0)::bigint, coalesce(h.czekaly, 0)::bigint, h.sr_dni, h.max_dni
    from kody k
    left join public.interior_item_dict d on d.optima_code = k.optima_code
    left join otw a on a.optima_code = k.optima_code
    left join hist h on h.optima_code = k.optima_code
    left join lateral (
      select wc.id, wc.is_stocked from public.warehouse_components wc
      where wc.id = (select m.component_id from public.optima_component_map m where m.optima_code = k.optima_code)
         or wc.code = k.optima_code
      order by (wc.code = k.optima_code) limit 1
    ) c on true
    where (coalesce(a.zlecenia, 0) > 0 or coalesce(h.czekaly, 0) > 0)
      and coalesce(d.pomijane, false) = false;
end;
$function$;

-- ---------------------------------------------------------------- WZ reklamacyjny
create table if not exists public.wz_reklamacyjne (
  id bigserial primary key,
  numer text not null unique,
  warehouse_id bigint not null references public.warehouses(id),
  complaint_id bigint references public.complaints(id) on delete set null,
  firma text,
  nr_zlecenia text,
  powod text,
  uwagi text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  anulowany_at timestamptz,
  anulowany_by uuid,
  anulowany_powod text
);

create table if not exists public.wz_reklamacyjne_pozycje (
  id bigserial primary key,
  wz_id bigint not null references public.wz_reklamacyjne(id) on delete cascade,
  component_id bigint not null references public.warehouse_components(id),
  quantity numeric not null check (quantity > 0),
  uwagi text
);
create index if not exists wz_reklamacyjne_pozycje_wz_idx on public.wz_reklamacyjne_pozycje(wz_id);
create index if not exists wz_reklamacyjne_complaint_idx on public.wz_reklamacyjne(complaint_id);

alter table public.wz_reklamacyjne enable row level security;
alter table public.wz_reklamacyjne_pozycje enable row level security;
drop policy if exists wz_reklamacyjne_read on public.wz_reklamacyjne;
create policy wz_reklamacyjne_read on public.wz_reklamacyjne for select to authenticated using (true);
drop policy if exists wz_reklamacyjne_pozycje_read on public.wz_reklamacyjne_pozycje;
create policy wz_reklamacyjne_pozycje_read on public.wz_reklamacyjne_pozycje for select to authenticated using (true);
-- zapis tylko przez funkcje (security definer) — bez polityk insert/update/delete

create or replace function public.create_wz_reklamacyjny(
  p_warehouse_id bigint,
  p_items jsonb,
  p_firma text default null,
  p_nr_zlecenia text default null,
  p_complaint_id bigint default null,
  p_powod text default null,
  p_uwagi text default null
)
returns table(r_id bigint, r_numer text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id bigint;
  v_numer text;
  v_rok text := to_char(now() at time zone 'Europe/Warsaw', 'YYYY');
  v_nr int;
  v_item jsonb;
  v_comp bigint;
  v_qty numeric;
  v_wh_code text;
  v_count int := 0;
begin
  perform public.assert_warehouse_perm('movements');
  select code into v_wh_code from warehouses where id = p_warehouse_id and is_active;
  if v_wh_code is null then
    raise exception 'Wybierz aktywny magazyn';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'WZ reklamacyjny bez pozycji';
  end if;
  if p_complaint_id is not null and not exists (select 1 from complaints where id = p_complaint_id) then
    raise exception 'Reklamacja % nie istnieje', p_complaint_id;
  end if;

  -- numer WZR/RRRR/NNN — kolejny w roku (blokada, żeby dwa zapisy naraz nie wzięły tego samego)
  perform pg_advisory_xact_lock(hashtext('wz_reklamacyjne_numer'));
  select coalesce(max(split_part(numer, '/', 3)::int), 0) + 1 into v_nr
  from wz_reklamacyjne where numer like 'WZR/' || v_rok || '/%';
  v_numer := 'WZR/' || v_rok || '/' || lpad(v_nr::text, 3, '0');

  insert into wz_reklamacyjne (numer, warehouse_id, complaint_id, firma, nr_zlecenia, powod, uwagi)
  values (v_numer, p_warehouse_id, p_complaint_id, nullif(trim(p_firma), ''), nullif(trim(p_nr_zlecenia), ''),
          nullif(trim(p_powod), ''), nullif(trim(p_uwagi), ''))
  returning id into v_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_comp := (v_item->>'component_id')::bigint;
    v_qty := (v_item->>'quantity')::numeric;
    if v_comp is null or v_qty is null or v_qty <= 0 then continue; end if;
    insert into wz_reklamacyjne_pozycje (wz_id, component_id, quantity, uwagi)
    values (v_id, v_comp, v_qty, nullif(trim(v_item->>'uwagi'), ''));
    insert into warehouse_movements (movement_type, warehouse_from_id, component_id, quantity, reference_doc, notes, created_by)
    values ('WZ', p_warehouse_id, v_comp, v_qty, v_numer,
            'WZ reklamacyjny ' || v_numer
              || coalesce(' — ' || nullif(trim(p_firma), ''), '')
              || coalesce(' — zlec. ' || nullif(trim(p_nr_zlecenia), ''), '')
              || coalesce(' — ' || nullif(trim(p_powod), ''), ''),
            auth.uid());
    insert into warehouse_stock as ws (warehouse_id, component_id, quantity)
    values (p_warehouse_id, v_comp, -v_qty)
    on conflict (warehouse_id, component_id)
    do update set quantity = ws.quantity - v_qty, updated_at = now();
    perform revalidate_orders_for_component(v_comp, p_warehouse_id);
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    raise exception 'WZ reklamacyjny bez poprawnych pozycji (komponent i ilość > 0)';
  end if;

  r_id := v_id;
  r_numer := v_numer;
  return next;
end;
$function$;

create or replace function public.cancel_wz_reklamacyjny(p_id bigint, p_powod text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_wz record;
  v_p record;
begin
  perform public.assert_warehouse_perm('movements');
  select * into v_wz from wz_reklamacyjne where id = p_id for update;
  if not found then raise exception 'WZ reklamacyjny % nie istnieje', p_id; end if;
  if v_wz.anulowany_at is not null then raise exception 'WZ % jest już anulowany', v_wz.numer; end if;

  for v_p in select * from wz_reklamacyjne_pozycje where wz_id = p_id loop
    insert into warehouse_movements (movement_type, warehouse_to_id, component_id, quantity, reference_doc, notes, created_by)
    values ('ZWR', v_wz.warehouse_id, v_p.component_id, v_p.quantity, v_wz.numer,
            'Anulowanie WZ reklamacyjnego ' || v_wz.numer || coalesce(' — ' || nullif(trim(p_powod), ''), ''),
            auth.uid());
    insert into warehouse_stock as ws (warehouse_id, component_id, quantity)
    values (v_wz.warehouse_id, v_p.component_id, v_p.quantity)
    on conflict (warehouse_id, component_id)
    do update set quantity = ws.quantity + v_p.quantity, updated_at = now();
    perform revalidate_orders_for_component(v_p.component_id, v_wz.warehouse_id);
  end loop;

  update wz_reklamacyjne
  set anulowany_at = now(), anulowany_by = auth.uid(), anulowany_powod = nullif(trim(p_powod), '')
  where id = p_id;
end;
$function$;

revoke all on function public.create_wz_reklamacyjny(bigint, jsonb, text, text, bigint, text, text) from public, anon;
revoke all on function public.cancel_wz_reklamacyjny(bigint, text) from public, anon;
grant execute on function public.create_wz_reklamacyjny(bigint, jsonb, text, text, bigint, text, text) to authenticated;
grant execute on function public.cancel_wz_reklamacyjny(bigint, text) to authenticated;
