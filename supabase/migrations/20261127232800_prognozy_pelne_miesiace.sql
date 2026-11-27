-- 27.11.2026 (testy 27.11, runda 3; WYSOKI): prognozy magazynowe zawyżone i z fałszywym „wystarczających danych”.
-- forecast_component_demand:
--   a) średnia (baseline) liczyła tylko miesiące ze zużyciem > 0 — miesiąc bez zużycia znikał ze średniej;
--   b) bieżący, niepełny miesiąc wchodził do średniej;
--   → teraz baseline = średnia z PEŁNYCH miesięcy (ostatnie 3, a gdy w nich zero — ostatnie 12), także zerowych
--     (miesiąc ze zwrotami większymi niż zużycie liczy się jako 0), tylko od miesiąca pierwszego ruchu komponentu
--     (wcześniej komponentu nie było w magazynie, więc tamte miesiące nie są „zerowym zużyciem”).
-- get_component_consumption_history (i za nią prognoza):
--   c) „za mało danych” zależało od liczby ruchów WZ (< 3) — 169 wydań w jednym miesiącu dawało „wystarczających danych”;
--   → teraz: mniej niż 3 pełne miesiące historii komponentu = za mało danych. Pełne miesiące liczone od miesiąca
--     PO miesiącu pierwszego ruchu komponentu (dowolnego typu) — chyba że pierwszy ruch był 1. dnia miesiąca, wtedy
--     od tego miesiąca — do poprzedniego miesiąca włącznie (miesiąc pierwszego ruchu jest zwykle niepełny).
--   Odcinanie wydań odstających (> 3 × mediana) zostaje jak było (zależne od liczby WZ). Wiersze historii (wykres)
--   bez zmian — nadal z bieżącym miesiącem.
-- Przykład: komponent 470 (październik 10 szt., listopad 2330) — było baseline 910/mies. i „wystarczających danych”,
-- teraz 0 pełnych miesięcy → „za mało danych”. 27.11 cała historia magazynu zaczyna się 4.09.2026 (36 komponentów
-- ma pierwszy ruch 4–15.09, żaden 1. dnia miesiąca), więc pierwszy pełny miesiąc to październik: do końca grudnia
-- żaden komponent nie ma 3 pełnych miesięcy, od stycznia 2027 te 36 je ma (październik–grudzień).
-- Poprawka (testy 27.11, runda 3; próba generalna): wcześniej niepełny wrzesień liczył się jak pełny.
-- DO WDROŻENIA (nie wgrane w sesji).

create or replace function public.get_component_consumption_history(p_component_id bigint, p_months integer default 12)
 returns table(r_year integer, r_month integer, r_consumed numeric, r_returned numeric, r_received numeric, r_net_consumption numeric, r_outlier_removed boolean, r_insufficient_data boolean)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_wz_count integer;
  v_wz_median numeric;
  v_wz_threshold numeric;
  v_first_ts timestamptz;
  v_first_month date;
  v_full_months integer;
  v_insufficient boolean;
begin
  select count(*), percentile_cont(0.5) within group (order by quantity)
  into v_wz_count, v_wz_median
  from warehouse_movements
  where component_id = p_component_id
    and movement_type = 'WZ';

  -- testy 27.11 (runda 3): „za mało danych” = mniej niż 3 pełne miesiące historii komponentu
  select min(created_at) into v_first_ts
  from warehouse_movements where component_id = p_component_id;
  -- pierwszy PEŁNY miesiąc: miesiąc po pierwszym ruchu, chyba że ruch był 1. dnia (testy 27.11, runda 3)
  v_first_month := case
    when v_first_ts is null then null
    when extract(day from v_first_ts) = 1 then date_trunc('month', v_first_ts)::date
    else (date_trunc('month', v_first_ts) + interval '1 month')::date
  end;
  v_full_months := case when v_first_month is null or v_first_month >= date_trunc('month', now())::date then 0
    else (extract(year from age(date_trunc('month', now())::date, v_first_month)) * 12
          + extract(month from age(date_trunc('month', now())::date, v_first_month)))::integer end;
  v_insufficient := v_full_months < 3;

  -- outliery (> 3 × mediana) odcinamy tylko przy sensownej próbce wydań
  v_wz_threshold := case when coalesce(v_wz_count, 0) < 3 then null else coalesce(v_wz_median, 0) * 3 end;
  if v_wz_threshold = 0 then v_wz_threshold := null; end if;

  return query
  with months as (
    select generate_series(
      date_trunc('month', now() - make_interval(months => p_months - 1))::date,
      date_trunc('month', now())::date,
      '1 month'::interval
    )::date as mstart
  )
  select
    extract(year from m.mstart)::integer,
    extract(month from m.mstart)::integer,
    coalesce(sum(
      case
        when wm.movement_type = 'WZ'
         and (v_wz_threshold is null or wm.quantity <= v_wz_threshold)
        then wm.quantity else 0
      end
    ), 0),
    coalesce(sum(case when wm.movement_type = 'ZWR' then wm.quantity else 0 end), 0),
    coalesce(sum(case when wm.movement_type = 'PZ' then wm.quantity else 0 end), 0),
    coalesce(sum(
      case
        when wm.movement_type = 'WZ'
         and (v_wz_threshold is null or wm.quantity <= v_wz_threshold)
        then wm.quantity else 0
      end
    ), 0)
    - coalesce(sum(case when wm.movement_type = 'ZWR' then wm.quantity else 0 end), 0),
    exists (
      select 1 from warehouse_movements wmx
      where wmx.component_id = p_component_id
        and wmx.movement_type = 'WZ'
        and wmx.created_at >= m.mstart
        and wmx.created_at < (m.mstart + interval '1 month')
        and v_wz_threshold is not null
        and wmx.quantity > v_wz_threshold
    ),
    v_insufficient
  from months m
  left join warehouse_movements wm
    on wm.component_id = p_component_id
   and wm.created_at >= m.mstart
   and wm.created_at < (m.mstart + interval '1 month')
  group by m.mstart
  order by m.mstart;
end;
$function$;

create or replace function public.forecast_component_demand(p_component_id bigint, p_months_ahead integer default 6)
 returns table(r_year integer, r_month integer, r_forecast_qty numeric, r_baseline numeric, r_seasonal_factor numeric, r_historical_months_used integer, r_insufficient_data boolean)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_baseline numeric := 0;
  v_hist_count integer := 0;
  v_insufficient boolean := false;
  v_sum numeric := 0;
  v_cur date := date_trunc('month', now())::date;
  v_first_ts timestamptz;
  v_first_month date;
  v_target_date date;
  v_target_month integer;
  v_target_year integer;
  v_factor numeric;
  v_i integer;
begin
  -- testy 27.11 (runda 3): tylko pełne miesiące (bez bieżącego), także zerowe, od pierwszego pełnego miesiąca
  select min(created_at) into v_first_ts
  from warehouse_movements where component_id = p_component_id;
  -- pierwszy PEŁNY miesiąc: miesiąc po pierwszym ruchu, chyba że ruch był 1. dnia (testy 27.11, runda 3)
  v_first_month := case
    when v_first_ts is null then null
    when extract(day from v_first_ts) = 1 then date_trunc('month', v_first_ts)::date
    else (date_trunc('month', v_first_ts) + interval '1 month')::date
  end;

  select coalesce(avg(greatest(h.r_net_consumption, 0)), 0), count(*)::integer,
         coalesce(sum(greatest(h.r_net_consumption, 0)), 0), coalesce(bool_or(h.r_insufficient_data), true)
  into v_baseline, v_hist_count, v_sum, v_insufficient
  from get_component_consumption_history(p_component_id, 4) h
  where make_date(h.r_year, h.r_month, 1) < v_cur
    and make_date(h.r_year, h.r_month, 1) >= coalesce(v_first_month, v_cur);

  if v_sum = 0 and not v_insufficient then
    select coalesce(avg(greatest(h.r_net_consumption, 0)), 0), count(*)::integer
    into v_baseline, v_hist_count
    from get_component_consumption_history(p_component_id, 13) h
    where make_date(h.r_year, h.r_month, 1) < v_cur
      and make_date(h.r_year, h.r_month, 1) >= coalesce(v_first_month, v_cur);
  end if;

  if v_insufficient then
    v_baseline := 0;
    v_hist_count := 0;
  end if;
  v_baseline := round(v_baseline, 2);

  for v_i in 1..p_months_ahead loop
    v_target_date := (date_trunc('month', now()) + (v_i || ' month')::interval)::date;
    v_target_month := extract(month from v_target_date)::integer;
    v_target_year := extract(year from v_target_date)::integer;

    select factor into v_factor
    from seasonal_factors
    where month = v_target_month;

    if v_factor is null then v_factor := 1.0; end if;

    r_year := v_target_year;
    r_month := v_target_month;
    r_forecast_qty := round(v_baseline * v_factor, 2);
    r_baseline := v_baseline;
    r_seasonal_factor := v_factor;
    r_historical_months_used := v_hist_count;
    r_insufficient_data := v_insufficient;
    return next;
  end loop;

  return;
end;
$function$;
