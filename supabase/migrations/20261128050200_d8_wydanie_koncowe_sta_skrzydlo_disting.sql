-- 28.11.2026, decyzja D8 (TAK) — Disting Plus: wydanie końcowe STA zdejmuje też części skrzydła nogi Disting.
-- Kontekst: 20261128036200 (WGRANY) — odhaczenie etapu e3/e4 na STA wydaje (WZ z MARKLOWICKA) także rezerwacje
-- części skrzydła nogi Disting tej pary (_d8_rezerwacje_skrzydla_partnera), cofnięcie etapu je oddaje.
-- Brakowało tego przy WYDANIU KOŃCOWYM STA (release_remaining_for_order — „Oznacz jako wydane”, bez odhaczania
-- etapów): rezerwacje e3/e4 nogi Disting zostawały wiszące (zaległość 595 rezerwacji przy STA wydanych bez e3/e4).
-- Zmiana (wzór: 036200, łatki tekstowe z kontrolą „już poprawione”):
--  - release_remaining_for_order na STA: oba przebiegi (sprawdzenie braków i wydanie) obejmują też rezerwacje
--    e3/e4 nogi Disting tej pary z MARKLOWICKA — tylko dla etapów, które na STA NIE są „#ND”; ruch WZ ma order_id
--    nogi Disting (rezerwacja jest jej), reference_doc jak dla STA („WZ-STA-<nr>-wydanie”) i dopisek
--    „[Disting Plus: część skrzydła z nogi Disting #<id>]”; braki nogi Disting w tym samym oknie „Wydaj mimo braku”;
--  - nowy pomocnik _d8_rezerwacje_skrzydla_partnera_wydanie(STA): rezerwacje nogi Disting wydane właśnie wydaniem
--    końcowym STA (ruch WZ „WZ-STA-%-wydanie” z ich [RES-id]);
--  - return_remaining_for_order__impl (cofnięcie wydania) na STA: oddaje też te rezerwacje (ZWR na nogę Disting,
--    rezerwacja wraca do 'reserved'), na tych samych zasadach co własne (etap STA nieodhaczony).
-- NIE zmienia: Disting bez pary, par Titan, rezerwacji wydanych odhaczeniem etapu (036200), zaległości sprzed
-- wgrania (rezerwacje przy STA już wydanych — osobna decyzja, patrz raport).
-- Wymaga: 20261128036200 (funkcja _d8_rezerwacje_skrzydla_partnera).
-- Można uruchamiać wielokrotnie.
-- DO WDROŻENIA (nie wgrane).

create or replace function public._d8_rezerwacje_skrzydla_partnera_wydanie(p_order_id bigint)
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
    and sr.stage_key in ('e3', 'e4')
    and coalesce(d.extra_fields->>'cancelled', '') <> 'true'
    and sr.status in ('released', 'partially_released')
    and sr.quantity_released > 0
    and exists (
      select 1 from warehouse_movements wm
      where wm.order_id = d.id and wm.movement_type = 'WZ'
        and wm.reference_doc like 'WZ-STA-%-wydanie'
        and wm.notes like '%[RES-' || sr.id || ']%');
$$;
comment on function public._d8_rezerwacje_skrzydla_partnera_wydanie(bigint) is
  'D8: rezerwacje części skrzydła (e3/e4, MARKLOWICKA) nogi Disting pary Disting Plus wydane wydaniem końcowym STA.';
revoke all on function public._d8_rezerwacje_skrzydla_partnera_wydanie(bigint) from public, anon, authenticated;

-- 1) release_remaining_for_order (wydanie końcowe)
do $$
declare
  d text;
  p record;
begin
  d := replace(pg_get_functiondef('public.release_remaining_for_order(bigint,boolean)'::regprocedure), E'\r', '');
  if position('D8 (28.11), wydanie końcowe STA' in d) > 0 then
    raise notice 'release_remaining_for_order: już poprawione (D8) — bez zmian';
    return;
  end if;
  for p in
    select * from (values
      (1, E'  v_line_shortage numeric;\nbegin\n',
          E'  v_line_shortage numeric;\n  -- D8 (28.11), wydanie końcowe STA: części skrzydła nogi Disting (MARKLOWICKA) schodzą razem z STA\n  v_partner_res bigint[];\nbegin\n'),
      (2, E'  -- PRZEBIEG 1 (pomijany przy p_force): sprawdź fizyczną dostępność\n',
          E'  -- etapy e3/e4, które na STA nie są „#ND” (dla innych kategorii pomocnik zwraca pusto)\n  v_partner_res := array(\n    select r.id\n    from orders o\n    cross join unnest(array[''e3'', ''e4'']) k(st)\n    cross join lateral public._d8_rezerwacje_skrzydla_partnera(p_order_id, k.st) as r(id)\n    where o.id = p_order_id\n      and upper(trim(coalesce(o.production_stages ->> k.st, ''''))) <> ''#ND''\n  );\n\n  -- PRZEBIEG 1 (pomijany przy p_force): sprawdź fizyczną dostępność\n'),
      (3, E'      where sr.order_id = p_order_id\n        and sr.status in (''reserved'', ''partially_released'')\n      for update of sr\n',
          E'      where (sr.order_id = p_order_id or sr.id = any (v_partner_res))\n        and sr.status in (''reserved'', ''partially_released'')\n      for update of sr\n'),
      (4, E'    where sr.order_id = p_order_id\n      and sr.status in (''reserved'', ''partially_released'')\n    for update of sr\n',
          E'    where (sr.order_id = p_order_id or sr.id = any (v_partner_res))\n      and sr.status in (''reserved'', ''partially_released'')\n    for update of sr\n'),
      (5, E'    select sr.id, sr.warehouse_id, sr.component_id, sr.stage_key,\n',
          E'    select sr.id, sr.order_id as res_order_id, sr.warehouse_id, sr.component_id, sr.stage_key,\n'),
      (6, E'      ''WZ'', v_res.warehouse_id, v_res.component_id, v_remaining,\n      p_order_id,\n',
          E'      ''WZ'', v_res.warehouse_id, v_res.component_id, v_remaining,\n      v_res.res_order_id,\n'),
      (7, E'        || '' [RES-'' || v_res.id || '']''\n        || case when v_line_shortage > 0',
          E'        || '' [RES-'' || v_res.id || '']''\n        || case when v_res.res_order_id <> p_order_id then '' [Disting Plus: część skrzydła z nogi Disting #'' || v_res.res_order_id || '']'' else '''' end\n        || case when v_line_shortage > 0')
    ) as t(n, stare, nowe) order by n
  loop
    if (length(d) - length(replace(d, p.stare, ''))) / length(p.stare) <> 1 then
      raise exception 'release_remaining_for_order: łatka D8 nr % — fragment nie występuje dokładnie raz, sprawdź definicję', p.n;
    end if;
    d := replace(d, p.stare, p.nowe);
  end loop;
  execute d;
end $$;

-- 2) return_remaining_for_order__impl (cofnięcie wydania)
do $$
declare
  d text;
  p record;
begin
  d := replace(pg_get_functiondef('public.return_remaining_for_order__impl(bigint)'::regprocedure), E'\r', '');
  if position('D8 (28.11), wydanie końcowe STA' in d) > 0 then
    raise notice 'return_remaining_for_order__impl: już poprawione (D8) — bez zmian';
    return;
  end if;
  for p in
    select * from (values
      (1, E'  v_out numeric;\nbegin\n',
          E'  v_out numeric;\n  -- D8 (28.11), wydanie końcowe STA: wracają też części skrzydła nogi Disting wydane z STA\n  v_partner_res bigint[];\nbegin\n'),
      (2, E'  for v_res in\n    select sr.id, sr.warehouse_id, sr.component_id, sr.stage_key, sr.quantity_released,\n',
          E'  v_partner_res := array(select public._d8_rezerwacje_skrzydla_partnera_wydanie(p_order_id));\n\n  for v_res in\n    select sr.id, sr.order_id as res_order_id, sr.warehouse_id, sr.component_id, sr.stage_key, sr.quantity_released,\n'),
      (3, E'    where sr.order_id = p_order_id\n      and sr.status in (''released'', ''partially_released'')\n      and sr.quantity_released > 0\n',
          E'    where (sr.order_id = p_order_id or sr.id = any (v_partner_res))\n      and sr.status in (''released'', ''partially_released'')\n      and sr.quantity_released > 0\n'),
      (4, E'      ''ZWR'', v_res.warehouse_id, v_res.component_id, v_out,\n      p_order_id,\n',
          E'      ''ZWR'', v_res.warehouse_id, v_res.component_id, v_out,\n      v_res.res_order_id,\n'),
      (5, E'|| '' [RES-'' || v_res.id || '']'',\n      auth.uid()',
          E'|| '' [RES-'' || v_res.id || '']''\n        || case when v_res.res_order_id <> p_order_id then '' [Disting Plus: część skrzydła z nogi Disting #'' || v_res.res_order_id || '']'' else '''' end,\n      auth.uid()')
    ) as t(n, stare, nowe) order by n
  loop
    if (length(d) - length(replace(d, p.stare, ''))) / length(p.stare) <> 1 then
      raise exception 'return_remaining_for_order__impl: łatka D8 nr % — fragment nie występuje dokładnie raz, sprawdź definicję', p.n;
    end if;
    d := replace(d, p.stare, p.nowe);
  end loop;
  execute d;
end $$;
