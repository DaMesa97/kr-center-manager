-- 28.11.2026, decyzja D46 (TAK, opcja a) — przeliczenie rezerwacji po zapisie receptury: zbiorczo i tylko różnice.
-- Problem: rebuild_reservations_for_category (zapis receptury) dla KAŻDEGO zlecenia kategorii anulował wszystkie
-- otwarte rezerwacje i zakładał je od nowa (cancel_order_reservations__impl + reserve_stock_for_order, albo
-- przelicz_niezrobione_etapy__impl z D15): ~26 zmian warehouse_stock na zlecenie (każda = zdarzenie realtime do
-- każdego otwartego komputera), 13 nowych + 13 anulowanych wierszy stock_reservations — także gdy receptura
-- zmieniła jeden składnik albo nic dla danego zlecenia. stock_reservations: 94% wierszy to anulowane.
-- Zmiana (opcja a z DECISIONS):
--  - nowa _przelicz_rezerwacje_zlecenia(zlecenie, zamroz_zrobione): liczy DOCELOWE rezerwacje (te same reguły co
--    dotąd: match_recipes_for_order, resolve_warehouse_for_part, #ND → wiersz anulowany 'stage_na'), porównuje
--    z otwartymi i:
--      * rezerwacja bez zmian (magazyn, komponent, etap, ilość) — ZOSTAJE (bez anulowania i nowego wiersza),
--      * zbędna — anulowana 'superseded' (jak dotąd), brakująca — dopisana,
--      * stan (reserved_quantity) zmieniany JEDNYM insert … on conflict na parę magazyn × komponent (suma różnic,
--        zero = bez zapisu),
--      * status magazynowy zlecenia zapisywany tylko, gdy się zmienił;
--    zamroz_zrobione = true: reguły D15 (etapy zrobione / z wydanym towarem nietknięte) — przelicz_niezrobione_etapy__impl;
--    zamroz_zrobione = false: reguły reserve_stock_for_order (nic nie wydano — całe zlecenie, status z brakami);
--  - przelicz_niezrobione_etapy__impl → woła nową funkcję (true), te same klucze wyniku + 'bez_zmian';
--  - rebuild_reservations_for_category: zlecenie bez wydanego towaru → nowa funkcja (false) zamiast
--    anuluj wszystko + zarezerwuj od nowa.
-- Historia anulowanych rezerwacji ZOSTAJE (nic nie kasujemy) — mniej nowych anulowanych wierszy dzięki różnicom;
-- sprzątanie / archiwizacja starych anulowanych — pytanie do właściciela (patrz raport).
-- Można uruchamiać wielokrotnie.
-- DO WDROŻENIA (nie wgrane).

create or replace function public._przelicz_rezerwacje_zlecenia(p_order_id bigint, p_zamroz_zrobione boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order record;
  v_frozen text[] := array[]::text[];
  v_frozen_null boolean := false;
  v_match record;
  v_rec_comp record;
  v_wh_id bigint;
  v_total numeric;
  v_any_recipe boolean := false;
  v_matched_parts text[] := array[]::text[];
  v_expected_parts text[];
  v_missing_part text;
  v_issues jsonb := '[]'::jsonb;
  v_want jsonb := '[]'::jsonb;
  v_keep bigint[];
  v_cancel bigint[];
  v_ins jsonb;
  v_na_keep bigint[];
  v_na_ins jsonb;
  v_cancelled integer := 0;
  v_reserved integer := 0;
  v_kept integer := 0;
  v_status text;
  v_new_issues jsonb;
  v_n integer;
begin
  select o.id, o.category, o.system, o.quantity, o.order_number, o.production_stages, o.release_date, o.extra_fields,
         o.stock_status, o.stock_issues
  into v_order
  from orders o where o.id = p_order_id
  for update;
  if not found then raise exception 'Zamówienie % nie istnieje', p_order_id; end if;
  if v_order.release_date is not null or v_order.extra_fields->>'cancelled' = 'true' then
    return jsonb_build_object('status', 'pominiete');
  end if;

  if p_zamroz_zrobione then
    -- D15: etapy zamrożone — zrobione albo z czymkolwiek wydanym z magazynu
    select coalesce(array_agg(distinct s.k), array[]::text[]) into v_frozen
    from (
      select e.key as k
      from jsonb_each_text(case when jsonb_typeof(v_order.production_stages) = 'object'
                                then v_order.production_stages else '{}'::jsonb end) e
      where nullif(trim(e.value), '') is not null and left(trim(e.value), 1) <> '#'
      union
      select sr.stage_key from stock_reservations sr
      where sr.order_id = p_order_id and sr.stage_key is not null and sr.status in ('released', 'partially_released')
    ) s;
    v_frozen_null := exists (
      select 1 from stock_reservations sr
      where sr.order_id = p_order_id and sr.stage_key is null and sr.status in ('released', 'partially_released'));
  end if;

  -- 1) docelowe rezerwacje z aktualnej receptury (te same reguły co reserve_stock_for_order / D15)
  v_expected_parts := public.expected_parts_for_category(v_order.category);
  for v_match in select m.recipe_id, m.part from match_recipes_for_order(p_order_id) m loop
    v_any_recipe := true;
    v_matched_parts := array_append(v_matched_parts, v_match.part);
    v_wh_id := resolve_warehouse_for_part(v_order.category, v_order.system, v_match.part);
    if v_wh_id is null then
      v_issues := v_issues || jsonb_build_object(
        'type', 'missing_warehouse', 'part', v_match.part,
        'message', 'Brak przypisania magazynu dla części: ' || v_match.part
          || ' (kategoria ' || v_order.category || ', system ' || coalesce(v_order.system, '—') || ')');
      continue;
    end if;

    for v_rec_comp in
      select rc.component_id as comp_id, rc.quantity as per_unit, rc.stage_key, c.name, c.code as comp_code, c.is_active
      from warehouse_recipe_components rc
      join warehouse_components c on c.id = rc.component_id
      where rc.recipe_id = v_match.recipe_id
    loop
      if not v_rec_comp.is_active then
        v_issues := v_issues || jsonb_build_object(
          'type', 'inactive_component', 'part', v_match.part,
          'component_code', v_rec_comp.comp_code, 'component_name', v_rec_comp.name,
          'message', 'Receptura (' || v_match.part || ') używa komponentu usuniętego z kartoteki: ' || v_rec_comp.name);
        continue;
      end if;
      -- (w nawiasie: IF w plpgsql kończy warunek na pierwszym THEN)
      if (case when v_rec_comp.stage_key is null then v_frozen_null else v_rec_comp.stage_key = any(v_frozen) end) then
        continue;
      end if;
      v_total := v_rec_comp.per_unit * coalesce(v_order.quantity, 1);
      if v_total <= 0 then continue; end if;

      v_want := v_want || jsonb_build_object(
        'w', v_wh_id, 'c', v_rec_comp.comp_id, 's', v_rec_comp.stage_key, 'q', v_total, 'p', v_match.part,
        'na', v_rec_comp.stage_key is not null
              and upper(coalesce(v_order.production_stages->>v_rec_comp.stage_key, '')) = '#ND');
    end loop;
  end loop;

  foreach v_missing_part in array coalesce(v_expected_parts, array[]::text[]) loop
    if not (v_missing_part = any(v_matched_parts)) then
      v_issues := v_issues || jsonb_build_object('type', 'missing_recipe', 'part', v_missing_part,
                                                 'message', 'Brak receptury dla części: ' || v_missing_part);
    end if;
  end loop;

  -- 2) porównanie z otwartymi rezerwacjami niezamrożonych etapów (pary dobierane po magazyn/komponent/etap/ilość)
  with want as (
    select x.w, x.c, x.s, x.q, x.p, x.na, row_number() over () as rn
    from jsonb_to_recordset(v_want) as x(w bigint, c bigint, s text, q numeric, p text, na boolean)
  ),
  want_k as (
    select want.*, row_number() over (partition by w, c, coalesce(s, ''), q order by rn) as k
    from want where not na
  ),
  have as (
    select sr.id, sr.warehouse_id as w, sr.component_id as c, sr.stage_key as s, sr.quantity_reserved as q,
           coalesce(sr.quantity_released, 0) as rel,
           row_number() over (partition by sr.warehouse_id, sr.component_id, coalesce(sr.stage_key, ''),
                                           sr.quantity_reserved, coalesce(sr.quantity_released, 0) = 0
                              order by sr.id) as k
    from stock_reservations sr
    where sr.order_id = p_order_id
      and (sr.status = 'reserved' or (not p_zamroz_zrobione and sr.status = 'partially_released'))
      and case when sr.stage_key is null then not v_frozen_null else not (sr.stage_key = any(v_frozen)) end
  ),
  pairs as (
    select h.id as have_id, wk.rn
    from have h
    join want_k wk on wk.w = h.w and wk.c = h.c and coalesce(wk.s, '') = coalesce(h.s, '') and wk.q = h.q
                  and wk.k = h.k and h.rel = 0
  )
  select
    coalesce((select array_agg(have_id) from pairs), array[]::bigint[]),
    coalesce((select array_agg(h.id) from have h where h.id not in (select have_id from pairs)), array[]::bigint[]),
    coalesce((select jsonb_agg(jsonb_build_object('w', wk.w, 'c', wk.c, 's', wk.s, 'q', wk.q) order by wk.rn)
              from want_k wk where wk.rn not in (select rn from pairs)), '[]'::jsonb)
  into v_keep, v_cancel, v_ins;

  -- #ND: anulowane 'stage_na' bez zmian zostają, brakujące dopisane
  with want_na as (
    select x.w, x.c, x.s, x.q, row_number() over (partition by x.w, x.c, coalesce(x.s, ''), x.q) as k
    from jsonb_to_recordset(v_want) as x(w bigint, c bigint, s text, q numeric, na boolean)
    where x.na
  ),
  have_na as (
    select sr.id, sr.warehouse_id as w, sr.component_id as c, sr.stage_key as s, sr.quantity_reserved as q,
           row_number() over (partition by sr.warehouse_id, sr.component_id, coalesce(sr.stage_key, ''), sr.quantity_reserved
                              order by sr.id desc) as k
    from stock_reservations sr
    where sr.order_id = p_order_id and sr.status = 'cancelled' and sr.cancel_reason = 'stage_na'
      and case when sr.stage_key is null then not v_frozen_null else not (sr.stage_key = any(v_frozen)) end
  ),
  pairs_na as (
    select h.id as have_id, wn.w, wn.c, wn.s, wn.q, wn.k
    from have_na h
    join want_na wn on wn.w = h.w and wn.c = h.c and coalesce(wn.s, '') = coalesce(h.s, '') and wn.q = h.q and wn.k = h.k
  )
  select
    coalesce((select array_agg(have_id) from pairs_na), array[]::bigint[]),
    coalesce((select jsonb_agg(jsonb_build_object('w', wn.w, 'c', wn.c, 's', wn.s, 'q', wn.q))
              from want_na wn
              where not exists (select 1 from pairs_na pn where pn.w = wn.w and pn.c = wn.c
                                  and coalesce(pn.s, '') = coalesce(wn.s, '') and pn.q = wn.q and pn.k = wn.k)), '[]'::jsonb)
  into v_na_keep, v_na_ins;

  -- 3) stan: jedna zmiana reserved_quantity na parę magazyn × komponent (suma różnic; zero = bez zapisu)
  insert into warehouse_stock as ws (warehouse_id, component_id, quantity, reserved_quantity)
  select d.w, d.c, 0, d.delta
  from (
    select x.w, x.c, sum(x.delta) as delta
    from (
      select sr.warehouse_id as w, sr.component_id as c, -(sr.quantity_reserved - coalesce(sr.quantity_released, 0)) as delta
      from stock_reservations sr where sr.id = any (v_cancel)
      union all
      select i.w, i.c, i.q from jsonb_to_recordset(v_ins) as i(w bigint, c bigint, q numeric)
    ) x
    group by x.w, x.c
  ) d
  where d.delta <> 0
  on conflict (warehouse_id, component_id)
  do update set reserved_quantity = ws.reserved_quantity + excluded.reserved_quantity, updated_at = now();

  -- 4) rezerwacje: anulowane zbędne, dopisane brakujące
  update stock_reservations sr
     set status = 'cancelled', cancel_reason = 'superseded', updated_at = now()
   where sr.id = any (v_cancel);
  get diagnostics v_cancelled = row_count;

  -- stare anulowania (stage_na niedopasowane, order_cancelled, bez powodu) niezamrożonych etapów → superseded (jak dotąd)
  update stock_reservations sr
     set cancel_reason = 'superseded', updated_at = now()
   where sr.order_id = p_order_id and sr.status = 'cancelled'
     and (sr.cancel_reason in ('stage_na', 'order_cancelled') or sr.cancel_reason is null)
     and not (sr.id = any (v_na_keep))
     and case when sr.stage_key is null then not v_frozen_null else not (sr.stage_key = any(v_frozen)) end;

  insert into stock_reservations (order_id, warehouse_id, component_id, stage_key, quantity_reserved)
  select p_order_id, i.w, i.c, i.s, i.q
  from jsonb_to_recordset(v_ins) as i(w bigint, c bigint, s text, q numeric);
  get diagnostics v_reserved = row_count;

  insert into stock_reservations (order_id, warehouse_id, component_id, stage_key, quantity_reserved, status, cancel_reason)
  select p_order_id, i.w, i.c, i.s, i.q, 'cancelled', 'stage_na'
  from jsonb_to_recordset(v_na_ins) as i(w bigint, c bigint, s text, q numeric);

  v_kept := coalesce(array_length(v_keep, 1), 0);

  -- 5) status magazynowy zlecenia — zapis tylko przy zmianie
  if not v_any_recipe then
    v_status := 'no_recipe';
    v_new_issues := v_issues;
  elsif p_zamroz_zrobione then
    -- jak przelicz_niezrobione_etapy__impl (D15) + recompute_order_stock_status
    if jsonb_array_length(v_issues) > 0 then
      v_status := 'partial_recipe';
      v_new_issues := v_issues;
    else
      select coalesce(jsonb_agg(jsonb_build_object(
               'type', 'shortage', 'component_code', c.code, 'component_name', c.name,
               'shortage', least(x.own, ws.reserved_quantity - ws.quantity), 'warehouse', w.code, 'part', 'other')), '[]'::jsonb),
             count(*)
      into v_new_issues, v_n
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
      v_status := case when v_n > 0 then 'insufficient' else 'ok' end;
      if v_n = 0 then v_new_issues := null; end if;
    end if;
  else
    -- jak reserve_stock_for_order: braki na półkach docelowych rezerwacji
    select v_issues || coalesce(jsonb_agg(jsonb_build_object(
             'type', 'shortage', 'component_code', c.code, 'component_name', c.name,
             'shortage', -(ws.quantity - ws.reserved_quantity), 'warehouse', w.code, 'part', x.p,
             'incoming_qty', coalesce(inc.r_incoming_qty, 0), 'earliest_eta', inc.r_earliest_eta) order by x.rn), '[]'::jsonb)
    into v_new_issues
    from (
      select y.w, y.c, y.p, row_number() over () as rn
      from jsonb_to_recordset(v_want) as y(w bigint, c bigint, p text, na boolean)
      where not y.na
    ) x
    join warehouse_stock ws on ws.warehouse_id = x.w and ws.component_id = x.c
    join warehouse_components c on c.id = x.c
    join warehouses w on w.id = x.w
    left join get_incoming_stock_per_component() inc on inc.r_component_id = x.c
    where ws.quantity - ws.reserved_quantity < 0;
    if jsonb_array_length(v_new_issues) = 0 then
      v_status := 'ok';
      v_new_issues := null;
    elsif exists (select 1 from jsonb_array_elements(v_new_issues) el
                  where el->>'type' in ('missing_recipe', 'missing_warehouse', 'inactive_component')) then
      v_status := 'partial_recipe';
    else
      v_status := 'insufficient';
    end if;
  end if;

  update orders
     set stock_status = v_status, stock_issues = v_new_issues
   where id = p_order_id
     and (stock_status is distinct from v_status or stock_issues is distinct from v_new_issues);

  return jsonb_build_object('status', 'przeliczone', 'anulowano', v_cancelled, 'zarezerwowano', v_reserved,
                            'bez_zmian', v_kept,
                            'etapy_zamrozone', to_jsonb(v_frozen), 'bez_etapu_zamrozone', v_frozen_null);
end;
$function$;

comment on function public._przelicz_rezerwacje_zlecenia(bigint, boolean) is
  'D46: przeliczenie rezerwacji zlecenia z aktualnej receptury — tylko różnice (rezerwacje bez zmian zostają), jedna zmiana stanu na parę magazyn × komponent. p_zamroz_zrobione = reguły D15.';
revoke all on function public._przelicz_rezerwacje_zlecenia(bigint, boolean) from public, anon, authenticated;

-- D15 (wgrane 030400) → różnicowo; ta sama sygnatura i klucze wyniku
create or replace function public.przelicz_niezrobione_etapy__impl(p_order_id bigint)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- D46 (28.11): różnicowo — rezerwacje bez zmian zostają, stan zmieniany zbiorczo
  return public._przelicz_rezerwacje_zlecenia(p_order_id, true);
end;
$function$;
revoke all on function public.przelicz_niezrobione_etapy__impl(bigint) from public, anon, authenticated;

-- rebuild_reservations_for_category: zlecenie bez wydanego towaru — różnicowo zamiast anuluj + zarezerwuj od nowa
do $$
declare
  d text;
  stare text := E'        perform public.cancel_order_reservations__impl(v_order.id, ''superseded'');\n        perform 1 from public.reserve_stock_for_order(v_order.id);\n';
  nowe  text := E'        -- D46 (28.11): różnicowo — rezerwacje bez zmian zostają, stan zmieniany zbiorczo\n        perform public._przelicz_rezerwacje_zlecenia(v_order.id, false);\n';
begin
  d := replace(pg_get_functiondef('public.rebuild_reservations_for_category(text,bigint,integer)'::regprocedure), E'\r', '');
  if position('D46 (28.11)' in d) > 0 then
    raise notice 'rebuild_reservations_for_category: już poprawione (D46) — bez zmian';
    return;
  end if;
  if (length(d) - length(replace(d, stare, ''))) / length(stare) <> 1 then
    raise exception 'rebuild_reservations_for_category: łatka D46 — fragment nie występuje dokładnie raz, sprawdź definicję';
  end if;
  execute replace(d, stare, nowe);
end $$;
