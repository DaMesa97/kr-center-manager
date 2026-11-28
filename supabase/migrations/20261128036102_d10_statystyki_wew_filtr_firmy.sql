-- 28.11.2026, decyzja D10 (właściciel: TAK) — MR Profil: filtr firmy w statystykach drzwi wewnętrznych.
-- Problem: stat_wew_sprzedaz / stat_wew_miesiace / stat_wew_braki liczą wszystkie zlecenia DrzwiWewnetrzne —
-- zlecenia z RO bazy MR Profil (source_metadata->>'optima_key' = 'MR:<id>') liczyłyby się w statystykach KR,
-- a „stan” w brakach to suma magazynów KR (WEW%).
-- Zmiana: nowy ostatni parametr p_firma text default 'KR':
--   'KR'  — tylko KR Center (zlecenia ręczne, z Excela i z RO bazy KR) — DOMYŚLNIE, więc stara aplikacja
--           (wywołanie bez p_firma) dostaje statystyki KR bez MR;
--   'MR'  — tylko zlecenia z RO bazy MR Profil; w brakach stan z magazynu MR_WEW (20261128036101);
--   'all' albo null — obie firmy (stan: magazyny KR + MR).
-- Stare sygnatury usuwamy (inaczej wywołanie bez p_firma byłoby niejednoznaczne). Treść poza filtrem bez zmian
-- (wersje z produkcji 28.11). Uprawnienia jak dotąd: authenticated (w środku current_user_is_manager()), bez anon.
-- Zależności: brak twardych (MR_WEW z 036101 potrzebny tylko dla p_firma = 'MR'; bez niego stan = null).
-- Można uruchamiać wielokrotnie.
-- DO WDROŻENIA (nie wgrane).

create or replace function public.wew_firma_pasuje(p_order public.orders, p_firma text)
returns boolean
language sql
immutable
set search_path to 'public'
as $$
  select case
    when p_firma is null or lower(p_firma) = 'all' then true
    when upper(p_firma) = 'MR' then coalesce(p_order.source = 'optima_ro' and p_order.source_metadata->>'optima_key' like 'MR:%', false)
    else not coalesce(p_order.source = 'optima_ro' and p_order.source_metadata->>'optima_key' like 'MR:%', false)
  end;
$$;
revoke all on function public.wew_firma_pasuje(public.orders, text) from public, anon;
grant execute on function public.wew_firma_pasuje(public.orders, text) to authenticated, service_role;

drop function if exists public.stat_wew_sprzedaz(date, date);
create or replace function public.stat_wew_sprzedaz(p_from date, p_to date default current_date, p_firma text default 'KR')
 returns table(item_type text, grupa text, model text, linia text, wykonanie text, kolor text, rozmiar text, rozpoznane boolean, szt bigint, zlecenia bigint)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not public.current_user_is_manager() then return; end if;
  perform public.interior_item_dict_refresh();
  return query
    select coalesce(d.item_type, i.item_type, 'inne') as item_type,
           d.grupa, d.model, d.linia, d.wykonanie, d.kolor, d.rozmiar,
           coalesce(d.rozpoznane, false) as rozpoznane,
           sum(i.quantity)::bigint as szt,
           count(distinct i.order_id)::bigint as zlecenia
    from public.orders o
    join public.order_internal_door_items i on i.order_id = o.id
    left join public.interior_item_dict d on d.optima_code = i.optima_code
    where o.category = 'DrzwiWewnetrzne'
      and o.order_date >= p_from and o.order_date <= coalesce(p_to, current_date)
      and coalesce(o.extra_fields->>'cancelled', '') <> 'true'
      and coalesce(d.pomijane, false) = false
      and public.wew_firma_pasuje(o, p_firma)
    group by 1, 2, 3, 4, 5, 6, 7, 8;
end;
$function$;

drop function if exists public.stat_wew_miesiace(integer);
create or replace function public.stat_wew_miesiace(p_months integer default 13, p_firma text default 'KR')
 returns table(miesiac date, item_type text, grupa text, wykonanie text, szt bigint, zlecenia bigint)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not public.current_user_is_manager() then return; end if;
  perform public.interior_item_dict_refresh();
  return query
    select date_trunc('month', o.order_date)::date as miesiac,
           coalesce(d.item_type, i.item_type, 'inne') as item_type,
           d.grupa, d.wykonanie,
           sum(i.quantity)::bigint as szt,
           count(distinct i.order_id)::bigint as zlecenia
    from public.orders o
    join public.order_internal_door_items i on i.order_id = o.id
    left join public.interior_item_dict d on d.optima_code = i.optima_code
    where o.category = 'DrzwiWewnetrzne'
      and o.order_date >= (date_trunc('month', now()) - make_interval(months => greatest(coalesce(p_months, 13), 1) - 1))::date
      and coalesce(o.extra_fields->>'cancelled', '') <> 'true'
      and coalesce(d.pomijane, false) = false
      and public.wew_firma_pasuje(o, p_firma)
    group by 1, 2, 3, 4;
end;
$function$;

drop function if exists public.stat_wew_braki(integer, integer);
create or replace function public.stat_wew_braki(p_days integer default 180, p_prog integer default 7, p_firma text default 'KR')
 returns table(optima_code text, optima_name text, item_type text, grupa text, model text, kolor text, rozmiar text, wykonanie text, component_id bigint, is_stocked boolean, stan numeric, otwarte_zlecenia bigint, otwarte_szt bigint, otwarte_sr_dni numeric, otwarte_max_dni integer, otwarte_najstarsze date, hist_zlecenia bigint, hist_czekaly bigint, hist_sr_dni numeric, hist_max_dni integer)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  -- D10: stan z magazynów firmy — KR: WEW%, MR: MR_WEW, obie: wszystkie
  v_wh bigint[] := (
    select array_agg(w.id) from public.warehouses w
    where case
      when p_firma is null or lower(p_firma) = 'all' then upper(w.code) like 'WEW%' or upper(w.code) = 'MR_WEW'
      when upper(p_firma) = 'MR' then upper(w.code) = 'MR_WEW'
      else upper(w.code) like 'WEW%'
    end);
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
        and public.wew_firma_pasuje(o, p_firma)
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
        and public.wew_firma_pasuje(o, p_firma)
      group by 1
    ), kody as (
      select coalesce(a.optima_code, h.optima_code) as optima_code from otw a full join hist h on h.optima_code = a.optima_code
    )
    select k.optima_code, d.optima_name, d.item_type, d.grupa, d.model, d.kolor, d.rozmiar, d.wykonanie,
           c.id as component_id, c.is_stocked,
           (select sum(s.quantity) from public.warehouse_stock s where s.component_id = c.id and s.warehouse_id = any(coalesce(v_wh, '{}'::bigint[]))) as stan,
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

revoke all on function public.stat_wew_sprzedaz(date, date, text) from public, anon;
revoke all on function public.stat_wew_miesiace(integer, text) from public, anon;
revoke all on function public.stat_wew_braki(integer, integer, text) from public, anon;
grant execute on function public.stat_wew_sprzedaz(date, date, text) to authenticated, service_role;
grant execute on function public.stat_wew_miesiace(integer, text) to authenticated, service_role;
grant execute on function public.stat_wew_braki(integer, integer, text) to authenticated, service_role;
