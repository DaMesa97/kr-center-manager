-- 28.11.2026 — decyzja D55 (właściciel: TAK — opcja a, a dla zwolnionych kart b). DO WDROŻENIA (nie wgrane).
-- Wgrywać PO 20261128054100 (D52) — niezależne, ale w tej kolejności testowane.
-- Problem: „Nadpisz” (import_alu_order, tryb overwrite) usuwał pozycje o zmienionym numerze razem z etapami,
-- anulował konstrukcje o najwyższym numerze (także zwolnione, z wydaną deklaracją), a przycisk obiecywał
-- „oznaczone etapy zostają”.
-- Teraz:
--  1) alu_overwrite_impact(zlecenie, pozycje nowej LP) — PODGLĄD (nic nie zmienia): pozycje, które znikną
--     (z oznaczonymi etapami), pozycje z przyciętymi etapami (mniejsza ilość), konstrukcje do anulowania
--     (karta / protokoły / deklaracja), zmiana systemu z / na AS 75EI, oraz BLOKADY (r_blocking):
--       * konstrukcja ze ZWOLNIONĄ kartą wyrobu w zleceniu — nadpisanie zabronione w ogóle (D55 b),
--       * konstrukcja do anulowania z WYDANĄ deklaracją — zabronione bez wycofania deklaracji (D55 a).
--     Aplikacja pokazuje listę przed „Nadpisz” i prosi o potwierdzenie.
--  2) import_alu_order (overwrite): przed usunięciem pozycji sprawdza blokady z alu_overwrite_impact i odmawia
--     (łatka w miejscu, znacznik „D55 (28.11)”; definicja w bazie ma CRLF — normalizujemy).
--  3) alu_positions_sync_constructions (trigger pozycji): konstrukcji z wydaną deklaracją nie anuluje
--     (usunięcie pozycji / zmniejszenie ilości także wprost) — helper alu_assert_no_declaration.

create or replace function public.alu_assert_no_declaration(p_construction_ids bigint[])
 returns void
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_list text;
begin
  if coalesce(cardinality(p_construction_ids), 0) = 0 then
    return;
  end if;
  select string_agg(distinct k.construction_no || ' → ' || d.number, ', ')
  into v_list
  from public.zkp_declarations d
  join public.alu_constructions k on k.id = any (d.construction_ids)
  where d.status = 'wydana' and k.id = any (p_construction_ids);
  if v_list is not null then
    raise exception 'Konstrukcji z wydaną deklaracją nie można anulować — najpierw wycofaj deklarację (D55): %', v_list;
  end if;
end;
$function$;

revoke all on function public.alu_assert_no_declaration(bigint[]) from public, anon;
grant execute on function public.alu_assert_no_declaration(bigint[]) to authenticated, service_role;

create or replace function public.alu_overwrite_impact(p_order_id bigint, p_positions jsonb)
 returns table(r_kind text, r_pos_no integer, r_construction_no text, r_detail text, r_blocking boolean)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  perform public.assert_manager_or_service();
  if p_positions is null or jsonb_typeof(p_positions) <> 'array' then
    raise exception 'Brak pozycji nowej listy produkcyjnej';
  end if;

  return query
  with n as (
    select * from public.import_alu_order__positions(p_positions)
  ),
  cur as (
    select p.* from public.order_alu_positions p where p.order_id = p_order_id
  ),
  gone as (
    select c.* from cur c where c.pos_no not in (select n.pos_no from n)
  ),
  kept as (
    select c.id, c.pos_no, c.quantity, c.system, c.production_stages, n.quantity as new_qty, n.system as new_system
    from cur c join n on n.pos_no = c.pos_no
  ),
  act as (
    select k.*,
           row_number() over (partition by k.position_id order by k.piece_index desc) as rn,
           count(*) over (partition by k.position_id) as cnt
    from public.alu_constructions k
    where k.order_id = p_order_id and k.status = 'aktywna'
  ),
  -- jak alu_positions_sync_constructions: pozycja usunięta = wszystkie aktywne; mniejsza ilość = najwyższe numery
  to_cancel as (
    select a.* from act a join gone g on g.id = a.position_id
    union all
    select a.* from act a join kept p on p.id = a.position_id where a.rn <= a.cnt - p.new_qty
  ),
  info as (
    select a.id,
           a.construction_no,
           a.pos_no,
           c.decision as card_decision,
           c.released_on,
           (c.id is not null) as has_card,
           (select count(*) from public.zkp_test_protocols t where t.construction_id = a.id) as protocols,
           (select string_agg(d.number, ', ') from public.zkp_declarations d
             where d.status = 'wydana' and a.id = any (d.construction_ids)) as declarations
    from act a
    left join public.zkp_product_cards c on c.construction_id = a.id
  ),
  stage_txt as (
    select s.position_id, string_agg(s.label || ' ' || s.txt, ', ' order by s.ord) as txt
    from (
      select g.id as position_id,
             case e.key when 'ciecie' then 'Cięcie' when 'skladanie' then 'Składanie' when 'okuwanie' then 'Okucia'
                        when 'szklenie' then 'Szklenie' when 'pakowanie' then 'Pakowanie' else e.key end as label,
             coalesce(array_position(array['ciecie','skladanie','okuwanie','szklenie','pakowanie'], e.key), 99) as ord,
             case when g.new_qty is null then (e.value->>'done')
                  else (e.value->>'done') || '→' || least(coalesce(nullif(e.value->>'done', '')::int, 0), g.new_qty) end as txt,
             coalesce(nullif(e.value->>'done', '')::int, 0) as done,
             g.new_qty
      from (select id, production_stages, null::int as new_qty from gone
            union all
            select id, production_stages, new_qty from kept where new_qty < quantity) g
      cross join lateral jsonb_each(case when jsonb_typeof(g.production_stages) = 'object' then g.production_stages else '{}'::jsonb end) e
    ) s
    where s.done > 0 and (s.new_qty is null or s.done > s.new_qty)
    group by s.position_id
  ),
  wyn as (
    -- konstrukcje do anulowania
    select 'konstrukcja_anulowana'::text as kind, i.pos_no, i.construction_no,
           concat_ws('; ',
             case when not i.has_card then 'bez karty wyrobu'
                  when i.card_decision = 'zwolniony' then 'karta ZWOLNIONA' || coalesce(' ' || to_char(i.released_on, 'DD.MM.YYYY'), '')
                  when i.card_decision = 'niezgodny' then 'karta: NIEZGODNY'
                  else 'karta wyrobu w toku' end,
             case when i.protocols > 0 then 'protokoły: ' || i.protocols end,
             case when i.declarations is not null then 'deklaracja ' || i.declarations end) as detail,
           (coalesce(i.card_decision, '') = 'zwolniony' or i.declarations is not null) as blocking,
           3 as ord
    from info i join to_cancel t on t.id = i.id
    union all
    -- D55 b: zwolniona karta w zleceniu (konstrukcja zostaje) — nadpisanie zabronione
    select 'karta_zwolniona', i.pos_no, i.construction_no,
           'karta ZWOLNIONA' || coalesce(' ' || to_char(i.released_on, 'DD.MM.YYYY'), '')
             || coalesce('; deklaracja ' || i.declarations, ''),
           true, 1
    from info i
    where i.card_decision = 'zwolniony' and i.id not in (select t.id from to_cancel t)
    union all
    select 'pozycja_usunieta', g.pos_no, null,
           'ilość ' || g.quantity || '; ' || coalesce('oznaczone etapy: ' || st.txt, 'bez oznaczonych etapów'),
           false, 2
    from gone g left join stage_txt st on st.position_id = g.id
    union all
    select 'etapy_przyciete', p.pos_no, null,
           'ilość ' || p.quantity || ' → ' || p.new_qty || '; etapy: ' || st.txt,
           false, 4
    from kept p join stage_txt st on st.position_id = p.id
    union all
    select 'zmiana_systemu', p.pos_no, null,
           coalesce(nullif(p.system, ''), '—') || ' → ' || coalesce(nullif(p.new_system, ''), '—')
             || case when coalesce(p.new_system ~* '75\s*-?\s*EI', false) then ' (pozycja zacznie podlegać ZKP)'
                     else ' (pozycja przestanie podlegać ZKP)' end,
           false, 5
    from kept p
    where coalesce(p.system ~* '75\s*-?\s*EI', false) <> coalesce(p.new_system ~* '75\s*-?\s*EI', false)
  )
  select r.kind, r.pos_no, r.construction_no, r.detail, r.blocking
  from wyn r
  order by r.blocking desc, r.ord, r.pos_no, r.construction_no;
end;
$function$;

revoke all on function public.alu_overwrite_impact(bigint, jsonb) from public, anon;
grant execute on function public.alu_overwrite_impact(bigint, jsonb) to authenticated, service_role;

do $$
declare
  d text;
  stare text;
  nowe text;
begin
  -- 2) import_alu_order: blokady przed nadpisaniem
  d := replace(pg_get_functiondef('public.import_alu_order(jsonb,jsonb,text)'::regprocedure), E'\r', '');
  stare := '    -- pozycje spoza nowego zestawu znikają (razem z etapami)';
  nowe := '    -- D55 (28.11): zwolnione karty wyrobu / wydane deklaracje blokują nadpisanie
    if exists (select 1 from public.alu_overwrite_impact(v_existing_id, p_positions) i where i.r_blocking) then
      raise exception ''Nowej wersji LP nie można nadpisać (D55): %. Zlecenia ze zwolnionymi kartami wyrobu ZKP nie nadpisuje się — zaimportuj LP jako osobne zlecenie albo najpierw wycofaj deklarację / anuluj konstrukcję (Pełnomocnik).'',
        (select string_agg(i.r_construction_no || '' ('' || i.r_detail || '')'', ''; '')
         from public.alu_overwrite_impact(v_existing_id, p_positions) i where i.r_blocking);
    end if;

    -- pozycje spoza nowego zestawu znikają (razem z etapami)';
  if position('D55 (28.11)' in d) > 0 then
    raise notice 'import_alu_order: już poprawione — bez zmian';
  elsif position(stare in d) = 0 then
    raise exception 'import_alu_order: nie znaleziono miejsca łatki — sprawdź definicję';
  else
    execute replace(d, stare, nowe);
  end if;

  -- 3) alu_positions_sync_constructions: nie anuluj konstrukcji z wydaną deklaracją
  d := replace(pg_get_functiondef('public.alu_positions_sync_constructions()'::regprocedure), E'\r', '');
  if position('D55 (28.11)' in d) > 0 then
    raise notice 'alu_positions_sync_constructions: już poprawione — bez zmian';
  else
    stare := '  if tg_op = ''DELETE'' then
    update public.alu_constructions';
    nowe := '  if tg_op = ''DELETE'' then
    -- D55 (28.11): konstrukcji z wydaną deklaracją nie anulujemy
    perform public.alu_assert_no_declaration(array(
      select id from public.alu_constructions where position_id = old.id and status = ''aktywna''));
    update public.alu_constructions';
    if position(stare in d) = 0 then
      raise exception 'alu_positions_sync_constructions (DELETE): nie znaleziono miejsca łatki — sprawdź definicję';
    end if;
    d := replace(d, stare, nowe);
    stare := '  elsif new.quantity < v_active then
    update public.alu_constructions';
    nowe := '  elsif new.quantity < v_active then
    perform public.alu_assert_no_declaration(array(
      select id from public.alu_constructions where position_id = new.id and status = ''aktywna''
      order by piece_index desc limit v_active - new.quantity));
    update public.alu_constructions';
    if position(stare in d) = 0 then
      raise exception 'alu_positions_sync_constructions (ilość): nie znaleziono miejsca łatki — sprawdź definicję';
    end if;
    execute replace(d, stare, nowe);
  end if;
end $$;
