-- =====================================================================
-- ZWIAD #6 (2026-10-30) — MAGAZYN, paczka P2 (smart / alerty)
--
-- 1) calculate_dynamic_rop: komponent ze zwrotami ≥ wydań (ZWR z anulowanych
--    zleceń) miał zużycie netto 0 → smart dawał min 1 / target 1 i NADPISYWAŁ
--    ręczne progi. Teraz: zużycie netto ≤ 0 = 'manual' (ręczne progi zostają).
-- 2) get_stock_alerts: propozycja zamówienia była liczona per półka (magazyn ×
--    komponent) — SKU w dwóch magazynach dostawał 2× target. Teraz raz na SKU
--    (sumy dostępne / w drodze po wszystkich półkach), na wierszu półki
--    z największym stanem; pozostałe wiersze = 0.
--
-- Reszta funkcji bez zmian (kopia z smart_rop_poprawki.sql). Bezpieczne do ponownego uruchomienia.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.calculate_dynamic_rop(p_component_id bigint)
 RETURNS TABLE(smart_status text, rop integer, target_stock integer, daily_avg numeric, daily_stddev numeric, safety_stock integer, seasonal_factor numeric, lead_time_days integer, weeks_of_history integer, distinct_wz_days integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lead_time       integer;
  v_window_start    timestamptz := now() - INTERVAL '12 weeks';
  v_distinct_days   integer;
  v_first_wz        timestamptz;
  v_days_hist       numeric;
  v_weeks_history   integer;
  v_total_qty       numeric;   -- netto (WZ − ZWR), odsezonowane
  v_daily_avg       numeric;
  v_weekly_stddev   numeric;
  v_daily_stddev    numeric;
  v_safety_stock    numeric;
  v_seasonal_factor numeric;
  v_rop             numeric;
  v_target          numeric;
BEGIN
  SELECT s.lead_time_days INTO v_lead_time
  FROM warehouse_components c
  LEFT JOIN suppliers s ON s.id = c.supplier_id
  WHERE c.id = p_component_id;
  v_lead_time := COALESCE(v_lead_time, 42);

  SELECT COUNT(DISTINCT DATE(wm.created_at)), MIN(wm.created_at)
  INTO v_distinct_days, v_first_wz
  FROM warehouse_movements wm
  WHERE wm.component_id = p_component_id
    AND wm.movement_type = 'WZ'
    AND wm.created_at >= v_window_start;

  -- dni historii: od pierwszego WZ w oknie, w widełkach 28–84
  v_days_hist := GREATEST(LEAST(EXTRACT(EPOCH FROM (now() - COALESCE(v_first_wz, now()))) / 86400.0, 84), 28);
  v_weeks_history := LEAST(CEIL(EXTRACT(EPOCH FROM (now() - COALESCE(v_first_wz, now()))) / 604800)::integer, 12);

  IF v_distinct_days < 4 THEN
    RETURN QUERY SELECT 'manual'::text, NULL::integer, NULL::integer, NULL::numeric, NULL::numeric,
                        NULL::integer, NULL::numeric, v_lead_time, v_weeks_history, v_distinct_days;
    RETURN;
  END IF;

  -- 1) zużycie netto, odsezonowane: WZ dodatnie, ZWR ujemne, każde / mnożnik miesiąca ruchu
  SELECT GREATEST(COALESCE(SUM(mv.q), 0), 0)
  INTO v_total_qty
  FROM (
    SELECT (CASE WHEN wm.movement_type = 'WZ' THEN wm.quantity ELSE -wm.quantity END)
           / COALESCE((SELECT sf.factor FROM seasonal_factors sf WHERE sf.month = EXTRACT(MONTH FROM wm.created_at)::integer), 1.0) AS q
    FROM warehouse_movements wm
    WHERE wm.component_id = p_component_id
      AND wm.movement_type IN ('WZ', 'ZWR')
      AND wm.created_at >= v_window_start
  ) mv;
  v_daily_avg := v_total_qty / v_days_hist;

  -- zwiad #6: zwroty ≥ wydania (ZWR z anulowanych zleceń) → zużycie netto 0;
  -- bez tego smart dawał min 1 / target 1 i nadpisywał ręczne progi
  IF v_total_qty <= 0 THEN
    RETURN QUERY SELECT 'manual'::text, NULL::integer, NULL::integer, NULL::numeric, NULL::numeric,
                        NULL::integer, NULL::numeric, v_lead_time, v_weeks_history, v_distinct_days;
    RETURN;
  END IF;

  -- 2) odchylenie na TYGODNIOWYCH sumach netto (odsezonowanych), tygodnie bez ruchu = 0
  WITH weeks AS (
    SELECT generate_series(date_trunc('week', GREATEST(v_first_wz, v_window_start)), date_trunc('week', now()), '1 week') AS w
  ),
  weekly AS (
    SELECT date_trunc('week', wm.created_at) AS w,
           SUM((CASE WHEN wm.movement_type = 'WZ' THEN wm.quantity ELSE -wm.quantity END)
               / COALESCE((SELECT sf.factor FROM seasonal_factors sf WHERE sf.month = EXTRACT(MONTH FROM wm.created_at)::integer), 1.0)) AS wq
    FROM warehouse_movements wm
    WHERE wm.component_id = p_component_id
      AND wm.movement_type IN ('WZ', 'ZWR')
      AND wm.created_at >= v_window_start
    GROUP BY 1
  )
  SELECT COALESCE(STDDEV_SAMP(GREATEST(COALESCE(weekly.wq, 0), 0)), 0)
  INTO v_weekly_stddev
  FROM weeks LEFT JOIN weekly ON weekly.w = weeks.w;
  v_daily_stddev := v_weekly_stddev / 7.0;

  -- 3) zapas bezpieczeństwa = 1,65 × σ_dzienne × √lead (95%)
  v_safety_stock := 1.65 * v_daily_stddev * SQRT(v_lead_time);

  -- 4) mnożnik sezonu uśredniony dla miesięcy od dziś do końca czasu dostawy
  WITH lead_period AS (
    SELECT generate_series(0, CEIL(v_lead_time::numeric / 30)::integer) AS months_offset
  ),
  months_in_period AS (
    SELECT DISTINCT EXTRACT(MONTH FROM (now() + (months_offset || ' months')::interval))::integer AS m
    FROM lead_period
  )
  SELECT COALESCE(AVG(sf.factor), 1.0)
  INTO v_seasonal_factor
  FROM months_in_period mip
  LEFT JOIN seasonal_factors sf ON sf.month = mip.m;

  -- 5) ROP = μ × lead × sezon + zapas bezpieczeństwa
  v_rop := (v_daily_avg * v_lead_time * v_seasonal_factor) + v_safety_stock;

  -- 6) target = ROP + zużycie przez cykl zamawiania (= czas dostawy, min 7 dni):
  --    po dostawie zapas starcza do następnego progu, a nie na tydzień
  v_target := v_rop + (v_daily_avg * v_seasonal_factor * GREATEST(v_lead_time, 7));

  RETURN QUERY SELECT
    'smart'::text,
    GREATEST(CEIL(v_rop)::integer, 1),
    GREATEST(CEIL(v_target)::integer, 1),
    ROUND(v_daily_avg, 2),
    ROUND(v_daily_stddev, 2),
    GREATEST(CEIL(v_safety_stock)::integer, 0),
    ROUND(v_seasonal_factor, 2),
    v_lead_time,
    v_weeks_history,
    v_distinct_days;
END;
$function$;

-- ── Alerty na tym samym silniku co Zamawianie (dla SKU smart) ─────────────
CREATE OR REPLACE FUNCTION public.get_stock_alerts()
 RETURNS TABLE(r_component_id bigint, r_component_name text, r_component_code text, r_product_category text, r_warehouse_id bigint, r_warehouse_code text, r_warehouse_name text, r_current_stock numeric, r_baseline_monthly numeric, r_seasonal_factor numeric, r_daily_consumption numeric, r_days_until_empty numeric, r_alert_level text, r_suggested_order_qty numeric, r_reserved_quantity numeric, r_available numeric, r_incoming_qty numeric, r_earliest_eta date)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    rop as (
      select c.id as component_id, r.smart_status, r.daily_avg, r.seasonal_factor, r.target_stock
      from warehouse_components c
      cross join lateral calculate_dynamic_rop(c.id) r
      where c.is_active = true
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
        select fr.baseline_qty, fr.historical_months_used
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
        case
          when spw.is_smart then round(spw.smart_daily, 3)
          when spw.hist_months = 0 or spw.baseline_monthly = 0 then 0::numeric
          else round((spw.baseline_monthly * v_seasonal / 30.0)::numeric, 3)
        end as daily_consumption,
        (spw.is_smart or (spw.hist_months > 0 and spw.baseline_monthly > 0)) as has_data,
        case
          when spw.is_smart then days_until_empty_sim(spw.available, spw.smart_daily, spw.deliveries)
          when spw.hist_months = 0 or spw.baseline_monthly = 0 then null
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
      c.earliest_eta as r_earliest_eta
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
