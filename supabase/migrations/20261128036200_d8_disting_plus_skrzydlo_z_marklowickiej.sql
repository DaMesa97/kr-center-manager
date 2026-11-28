-- 28.11.2026, decyzja D8 — Disting Plus: rezerwacje części skrzydła (e3/e4) zakłada noga Disting, a etap odhacza STA.
-- !!! INTERPRETACJA DO POTWIERDZENIA Z WŁAŚCICIELEM PRZED WGRANIEM (pytanie kontrolne w raporcie D8) !!!
-- Właściciel: „tylko rezerwacja na Disting Plus skrzydła musi je ściągać z magazynu Marklowicka”.
-- Stan 28.11 (produkcja): rezerwacje e3/e4 nóg Disting z parą STA leżą WYŁĄCZNIE na MARKLOWICKA
-- (127 e3 + 572 e4 aktywnych = 699 rezerwacji / 825 szt). Etap e3/e4 odhacza STA (release_stock_for_stage na
-- zleceniu STA), na Disting idzie tylko lustro sta_e3/sta_e4 (update_order_stage, bez wydania) — więc te rezerwacje
-- nigdy nie schodzą (do wydania końcowego nogi Disting, które w programie prawie się nie zdarza).
-- Zmiana (opcja a z DECISIONS):
--  - _d8_rezerwacje_skrzydla_partnera(order STA, etap e3/e4, wydane?): rezerwacje nogi Disting tej pary dla tego
--    samego etapu, tylko z magazynu MARKLOWICKA, noga Disting nieanulowana;
--  - release_stock_for_stage na STA, etap e3/e4: wydaje (WZ z MARKLOWICKA) także te rezerwacje — w tym samym
--    przebiegu: braki nogi Disting pokazują się w tym samym oknie „Wydaj mimo braku”; ruch WZ ma order_id nogi Disting
--    (rezerwacja jest jej), reference_doc jak dla STA („WZ-STA-<nr>-e3”) i dopisek „[Disting Plus: … #<id Disting>]”;
--  - return_stock_for_stage__impl (cofnięcie etapu e3/e4 na STA): oddaje też to, co tak zeszło z nogi Disting
--    (tylko rezerwacje wydane ruchem WZ-STA-…-<etap> z ich [RES-id] — nie rusza wydanych inną drogą).
-- NIE zmienia: Disting bez pary (własne e3/e4, BUKOWA), par Titan (STA+ST), wydania końcowego
-- (release_remaining_for_order), #ND (cancel_stage_reservations__impl), zaległości (595 rezerwacji przy STA już
-- wydanych bez odhaczania e3/e4 — osobna decyzja, patrz raport).
-- Forma: łatki tekstowe na aktualnej definicji (jak 20261128021000), z kontrolą „już poprawione” — zgodne z każdą
-- wersją funkcji, która ma te same fragmenty. Definicje z bazy normalizowane do LF.
-- Można uruchamiać wielokrotnie.
-- DO WDROŻENIA (nie wgrane) — PO POTWIERDZENIU INTERPRETACJI.

create or replace function public._d8_rezerwacje_skrzydla_partnera(p_order_id bigint, p_stage_key text, p_wydane boolean default false)
returns setof bigint
language sql
stable
security definer
set search_path to 'public'
as $$
  select sr.id
  from orders s
  join orders d on d.category = 'Disting' and d.linked_order_id = s.id
  join stock_reservations sr on sr.order_id = d.id
  join warehouses w on w.id = sr.warehouse_id and w.code = 'MARKLOWICKA'
  where s.id = p_order_id
    and s.category = 'STA'
    and p_stage_key in ('e3', 'e4')
    and sr.stage_key = p_stage_key
    and coalesce(d.extra_fields->>'cancelled', '') <> 'true'
    and case
      when p_wydane then
        sr.status in ('released', 'partially_released') and sr.quantity_released > 0
        and exists (
          select 1 from warehouse_movements wm
          where wm.order_id = d.id and wm.movement_type = 'WZ'
            and wm.reference_doc like 'WZ-STA-%-' || p_stage_key
            and wm.notes like '%[RES-' || sr.id || ']%')
      else sr.status in ('reserved', 'partially_released')
    end;
$$;
comment on function public._d8_rezerwacje_skrzydla_partnera(bigint, text, boolean) is
  'D8: rezerwacje części skrzydła (e3/e4, MARKLOWICKA) nogi Disting pary Disting Plus — schodzą z etapem STA.';
revoke all on function public._d8_rezerwacje_skrzydla_partnera(bigint, text, boolean) from public, anon, authenticated;

-- 1) release_stock_for_stage
do $$
declare
  d text;
  p record;
begin
  d := replace(pg_get_functiondef('public.release_stock_for_stage(bigint,text,boolean)'::regprocedure), E'\r', '');
  if position('D8 (28.11), Disting Plus' in d) > 0 then
    raise notice 'release_stock_for_stage: już poprawione (D8) — bez zmian';
    return;
  end if;
  for p in
    select * from (values
      (1, E'  v_line_shortage numeric;\nbegin\n',
          E'  v_line_shortage numeric;\n  -- D8 (28.11), Disting Plus: rezerwacje części skrzydła nogi Disting (MARKLOWICKA) schodzą z etapem STA\n  v_partner_res bigint[];\nbegin\n'),
      (2, E'  -- fallback NULL → dołącz przy pierwszym ukończonym etapie zamówienia\n',
          E'  v_partner_res := array(select public._d8_rezerwacje_skrzydla_partnera(p_order_id, p_stage_key));\n\n  -- fallback NULL → dołącz przy pierwszym ukończonym etapie zamówienia\n'),
      (3, E'      where sr.order_id = p_order_id\n        and sr.status in (''reserved'', ''partially_released'')\n        and (sr.stage_key = p_stage_key or (v_include_fallback and sr.stage_key is null))\n',
          E'      where ((sr.order_id = p_order_id\n              and (sr.stage_key = p_stage_key or (v_include_fallback and sr.stage_key is null)))\n             or sr.id = any (v_partner_res))\n        and sr.status in (''reserved'', ''partially_released'')\n'),
      (4, E'    where sr.order_id = p_order_id\n      and sr.status in (''reserved'', ''partially_released'')\n      and (sr.stage_key = p_stage_key or (v_include_fallback and sr.stage_key is null))\n',
          E'    where ((sr.order_id = p_order_id\n            and (sr.stage_key = p_stage_key or (v_include_fallback and sr.stage_key is null)))\n           or sr.id = any (v_partner_res))\n      and sr.status in (''reserved'', ''partially_released'')\n'),
      (5, E'    select sr.id, sr.warehouse_id, sr.component_id, sr.stage_key,\n',
          E'    select sr.id, sr.order_id as res_order_id, sr.warehouse_id, sr.component_id, sr.stage_key,\n'),
      (6, E'      ''WZ'', v_res.warehouse_id, v_res.component_id, v_remaining,\n      p_order_id,\n',
          E'      ''WZ'', v_res.warehouse_id, v_res.component_id, v_remaining,\n      v_res.res_order_id,\n'),
      (7, E'        || '' [RES-'' || v_res.id || '']''\n        || case when v_line_shortage > 0',
          E'        || '' [RES-'' || v_res.id || '']''\n        || case when v_res.res_order_id <> p_order_id then '' [Disting Plus: część skrzydła z nogi Disting #'' || v_res.res_order_id || '']'' else '''' end\n        || case when v_line_shortage > 0')
    ) as t(n, stare, nowe) order by n
  loop
    if (length(d) - length(replace(d, p.stare, ''))) / length(p.stare) <> 1 then
      raise exception 'release_stock_for_stage: łatka D8 nr % — fragment nie występuje dokładnie raz, sprawdź definicję', p.n;
    end if;
    d := replace(d, p.stare, p.nowe);
  end loop;
  execute d;
end $$;

-- 2) return_stock_for_stage__impl (cofnięcie etapu)
do $$
declare
  d text;
  p record;
begin
  d := replace(pg_get_functiondef('public.return_stock_for_stage__impl(bigint,text)'::regprocedure), E'\r', '');
  if position('D8 (28.11), Disting Plus' in d) > 0 then
    raise notice 'return_stock_for_stage__impl: już poprawione (D8) — bez zmian';
    return;
  end if;
  for p in
    select * from (values
      (1, E'    select sr.id, sr.warehouse_id, sr.component_id, sr.quantity_released,\n',
          E'    select sr.id, sr.order_id as res_order_id, sr.warehouse_id, sr.component_id, sr.quantity_released,\n'),
      (2, E'    where sr.order_id = p_order_id\n      and sr.stage_key = p_stage_key\n',
          E'    -- D8 (28.11), Disting Plus: także części skrzydła nogi Disting, które zeszły z tym etapem STA\n    where (sr.order_id = p_order_id\n           or sr.id in (select public._d8_rezerwacje_skrzydla_partnera(p_order_id, p_stage_key, true)))\n      and sr.stage_key = p_stage_key\n'),
      (3, E'      ''ZWR'', v_res.warehouse_id, v_res.component_id, v_out,\n      p_order_id,\n',
          E'      ''ZWR'', v_res.warehouse_id, v_res.component_id, v_out,\n      v_res.res_order_id,\n')
    ) as t(n, stare, nowe) order by n
  loop
    if (length(d) - length(replace(d, p.stare, ''))) / length(p.stare) <> 1 then
      raise exception 'return_stock_for_stage__impl: łatka D8 nr % — fragment nie występuje dokładnie raz, sprawdź definicję', p.n;
    end if;
    d := replace(d, p.stare, p.nowe);
  end loop;
  execute d;
end $$;
