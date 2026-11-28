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
--
-- 28.11.2026 — decyzja D7, wariant (b) (właściciel: TAK): przy „za mało danych” prognoza NIE spada do zera
-- (wtedy 32 pozycje Alertów, w tym 19 krytycznych, przeszłyby w „brak danych” do stycznia), tylko liczy średnią
-- ORIENTACYJNĄ i oznacza ją flagą r_insufficient_data = true (ekrany pokazują „orientacyjnie”):
--   średnia orientacyjna = zużycie netto (bez wydań odstających, miesiąc ze zwrotami > zużycie = 0) od miesiąca
--   pierwszego ruchu komponentu do dziś (z bieżącym miesiącem) ÷ liczba dni od pierwszego ruchu (min. 30) × 30,
--   czyli rzeczywiste tempo zużycia z całej znanej historii, a nie średnia z samych miesięcy > 0.
--   r_historical_months_used = liczba pełnych miesięcy (0–2) zamiast 0.
-- get_stock_alerts: „są dane” = średnia > 0 (wcześniej też historical_months_used > 0, co przy orientacyjnej
--   średniej z 0 pełnych miesięcy gasiło alert); nowa kolumna r_forecast_indicative (true = prognoza orientacyjna,
--   < 3 pełnych miesięcy; tylko dla pozycji bez smart ROP). Zmiana typu wyniku → drop + create + uprawnienia
--   jak dotąd (authenticated, service_role). get_stock_alerts_summary czyta kolumny po nazwie — bez zmian.
-- Po wgraniu: select public.run_all_forecasts(); (przelicza zapisane prognozy; inaczej ekrany pokażą stare do
-- najbliższego nocnego przeliczenia).
-- Aplikacja (od 1.1.8) czyta r_forecast_indicative, a bez tej migracji działa jak dotąd (kolumny brak = false).
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

  -- D7 (b): za mało pełnych miesięcy → średnia ORIENTACYJNA (tempo z całej historii), nie zero;
  -- flaga r_insufficient_data zostaje true, v_hist_count = liczba pełnych miesięcy (0–2)
  if v_insufficient then
    if v_first_ts is null then
      v_baseline := 0;
    else
      select coalesce(sum(greatest(h.r_net_consumption, 0)), 0)
      into v_sum
      from get_component_consumption_history(p_component_id, 13) h
      where make_date(h.r_year, h.r_month, 1) >= date_trunc('month', v_first_ts)::date;
      v_baseline := v_sum / greatest(extract(epoch from (now() - v_first_ts)) / 86400.0, 30) * 30;
    end if;
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

-- D7 (b): alerty liczą także z prognozy orientacyjnej + kolumna r_forecast_indicative
drop function if exists public.get_stock_alerts();

create function public.get_stock_alerts()
 returns table(r_component_id bigint, r_component_name text, r_component_code text, r_product_category text, r_warehouse_id bigint, r_warehouse_code text, r_warehouse_name text, r_current_stock numeric, r_baseline_monthly numeric, r_seasonal_factor numeric, r_daily_consumption numeric, r_days_until_empty numeric, r_alert_level text, r_suggested_order_qty numeric, r_reserved_quantity numeric, r_available numeric, r_incoming_qty numeric, r_earliest_eta date, r_forecast_indicative boolean)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_critical integer;
  v_warning integer;
  v_observation integer;
  v_current_month integer;
  v_seasonal numeric;
begin
  select critical_days, warning_days, observation_days
  into v_critical, v_warning, v_observation
  from alert_thresholds where id = 1;

  v_current_month := extract(month from now())::integer;
  select factor into v_seasonal
  from seasonal_factors
  where month = v_current_month;
  v_seasonal := coalesce(v_seasonal, 1.0);

  return query
  select * from (
    with incoming as (
      select
        i.component_id,
        po.warehouse_id,
        sum(i.quantity_ordered - i.quantity_received)::numeric as incoming_qty,
        min(po.expected_delivery_date)::date as earliest_eta,
        coalesce(
          jsonb_agg(
            jsonb_build_object(
              't', greatest(0, (po.expected_delivery_date::date - current_date)),
              'qty', i.quantity_ordered - i.quantity_received
            )
            order by po.expected_delivery_date
          ) filter (where po.expected_delivery_date is not null),
          '[]'::jsonb
        ) as deliveries
      from purchase_order_items i
      join purchase_orders po on po.id = i.purchase_order_id
      where po.status in ('sent', 'partial')
        and i.status_per_item in ('pending', 'partial')
        and (i.quantity_ordered - i.quantity_received) > 0
      group by i.component_id, po.warehouse_id
    ),
    -- smart ROP raz na komponent (ten sam silnik co Zamawianie)
    -- 26.11: tylko komponenty, które mają stan — rop łączy się wyłącznie ze stock_per_warehouse,
    -- a 2,5 tys. kartotek Optimy bez stanu kosztowało 3 zapytania plpgsql każda, przy każdym odczycie
    rop as (
      select c.id as component_id, r.smart_status, r.daily_avg, r.seasonal_factor, r.target_stock
      from warehouse_components c
      cross join lateral calculate_dynamic_rop(c.id) r
      where c.is_active = true
        and exists (select 1 from warehouse_stock ws where ws.component_id = c.id)
    ),
    stock_per_warehouse as (
      select
        ws.component_id,
        ws.warehouse_id,
        ws.quantity as current_stock,
        coalesce(ws.reserved_quantity, 0) as reserved_qty,
        ws.quantity - coalesce(ws.reserved_quantity, 0) as available,
        wc.name as component_name,
        wc.code as component_code,
        wc.product_category as product_category,
        w.code as warehouse_code,
        w.name as warehouse_name,
        coalesce(lf.baseline_qty, 0) as baseline_monthly,
        coalesce(lf.historical_months_used, 0) as hist_months,
        coalesce(lf.insufficient, false) as forecast_insufficient,
        coalesce(inc.incoming_qty, 0)::numeric as incoming_qty,
        inc.earliest_eta,
        coalesce(inc.deliveries, '[]'::jsonb) as deliveries,
        (rop.smart_status = 'smart') as is_smart,
        (rop.daily_avg * rop.seasonal_factor)::numeric as smart_daily,
        rop.seasonal_factor as smart_seasonal,
        rop.target_stock as smart_target
      from warehouse_stock ws
      join warehouse_components wc on wc.id = ws.component_id and wc.is_active = true
      join warehouses w on w.id = ws.warehouse_id
      left join lateral (
        select fr.baseline_qty, fr.historical_months_used,
               coalesce((fr.forecast_json -> 0 ->> 'insufficient_data')::boolean, false) as insufficient
        from forecast_runs fr
        where fr.component_id = ws.component_id
        order by fr.run_at desc
        limit 1
      ) lf on true
      left join incoming inc
        on inc.component_id = ws.component_id
       and inc.warehouse_id = ws.warehouse_id
      left join rop on rop.component_id = ws.component_id
    ),
    computed as (
      select
        spw.*,
        -- zwiad #6: propozycja zamówienia raz na SKU (nie per półka) — sumy po wszystkich
        -- magazynach, przypisane do półki z największym stanem, pozostałe wiersze = 0
        sum(spw.available) over (partition by spw.component_id) as comp_available,
        sum(spw.incoming_qty) over (partition by spw.component_id) as comp_incoming,
        row_number() over (partition by spw.component_id order by spw.current_stock desc, spw.warehouse_id) as comp_rn,
        -- dzienne zużycie: smart (μ × sezon dostawy) albo prognoza miesięczna / 30
        -- D7 (b): prognoza orientacyjna (< 3 pełnych miesięcy, historical_months_used 0–2) też się liczy
        case
          when spw.is_smart then round(spw.smart_daily, 3)
          when spw.baseline_monthly <= 0 then 0::numeric
          else round((spw.baseline_monthly * v_seasonal / 30.0)::numeric, 3)
        end as daily_consumption,
        (spw.is_smart or spw.baseline_monthly > 0) as has_data,
        case
          when spw.is_smart then days_until_empty_sim(spw.available, spw.smart_daily, spw.deliveries)
          when spw.baseline_monthly <= 0 then null
          else days_until_empty_sim(spw.available, spw.baseline_monthly * v_seasonal / 30.0, spw.deliveries)
        end as days_empty_sim
      from stock_per_warehouse spw
    )
    select
      c.component_id as r_component_id,
      c.component_name as r_component_name,
      c.component_code as r_component_code,
      c.product_category as r_product_category,
      c.warehouse_id as r_warehouse_id,
      c.warehouse_code as r_warehouse_code,
      c.warehouse_name as r_warehouse_name,
      c.current_stock as r_current_stock,
      case when c.is_smart then round(c.smart_daily * 30, 1) else c.baseline_monthly end as r_baseline_monthly,
      case when c.is_smart then c.smart_seasonal else v_seasonal end as r_seasonal_factor,
      c.daily_consumption as r_daily_consumption,
      c.days_empty_sim as r_days_until_empty,
      case
        when c.available < 0 then 'critical'
        when not c.has_data then 'no_data'
        when c.days_empty_sim is null then 'no_data'
        when c.days_empty_sim <= v_critical then 'critical'
        when c.days_empty_sim <= v_warning then 'warning'
        when c.days_empty_sim <= v_observation then 'observation'
        else 'ok'
      end as r_alert_level,
      case
        -- propozycja tylko na pierwszej półce SKU (reszta 0 — suma po alertach = jedno zamówienie)
        when c.comp_rn <> 1 then 0::numeric
        -- smart: do targetu (jak Zamawianie), minus dostępne i w drodze (wszystkie magazyny)
        when c.is_smart then greatest(ceil(c.smart_target - c.comp_available - c.comp_incoming)::numeric, 0)
        when not c.has_data then greatest(ceil(-c.comp_available - c.comp_incoming)::numeric, 0)
        else greatest(ceil((c.baseline_monthly * v_seasonal * 2.0) - c.comp_available - c.comp_incoming)::numeric, 0)
      end as r_suggested_order_qty,
      c.reserved_qty as r_reserved_quantity,
      c.available as r_available,
      c.incoming_qty as r_incoming_qty,
      c.earliest_eta as r_earliest_eta,
      (not coalesce(c.is_smart, false) and c.forecast_insufficient and c.baseline_monthly > 0) as r_forecast_indicative
    from computed c
  ) inner_q
  order by
    case inner_q.r_alert_level
      when 'critical' then 1
      when 'warning' then 2
      when 'observation' then 3
      when 'ok' then 4
      when 'no_data' then 5
    end,
    case when inner_q.r_available < 0 then 0 else 1 end,
    inner_q.r_days_until_empty nulls last,
    inner_q.r_component_name;
end;
$function$;

revoke all on function public.get_stock_alerts() from public, anon;
grant execute on function public.get_stock_alerts() to authenticated, service_role;
