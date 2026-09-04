-- =====================================================================
-- REZERWACJE — TURA 6: ALERTY świadome rezerwacji i dostaw w drodze
--
-- Zmiany w get_stock_alerts():
-- 1. Punkt startu = DOSTĘPNE (fizyczne − zarezerwowane), nie fizyczne.
-- 2. "Dni do wyczerpania" = SYMULACJA osi czasu: stan spada o dzienne
--    zużycie, dostawy z otwartych ZD wpadają w swoich terminach
--    (expected_delivery_date). Dzień, w którym stan schodzi ≤ 0,
--    to wynik. Dostawy bez daty NIE wchodzą do symulacji (liczą się
--    tylko do kolumny "w drodze").
-- 3. Nowe kolumny: r_reserved_quantity, r_available, r_incoming_qty,
--    r_earliest_eta (dotychczasowe kolumny bez zmian nazw/kolejności —
--    frontend mapuje po nazwach).
-- 4. Sugerowane zamówienie uwzględnia rezerwacje i w drodze:
--    ceil(2×miesięczne×sezon − dostępne − w drodze).
--
-- Sygnatura się zmienia → DROP + CREATE.
-- =====================================================================

-- ── 1. Symulacja: za ile dni stan zejdzie do zera ────────────────────
-- p_deliveries: jsonb [{"t": dni_od_dziś (>=0), "qty": ilość}, ...]
-- posortowane rosnąco po t. Zwraca NULL gdy brak zużycia (nie da się
-- policzyć), 0 gdy już pusto i nic dziś nie wpada.
create or replace function public.days_until_empty_sim(
  p_start numeric,
  p_daily numeric,
  p_deliveries jsonb default '[]'::jsonb
)
returns numeric
language plpgsql
immutable
as $$
declare
  v_stock numeric := p_start;
  v_t numeric := 0;
  v_run_out numeric;
  v_d record;
begin
  if p_daily is null or p_daily <= 0 then
    return null;
  end if;

  for v_d in
    select (e->>'t')::numeric as t, (e->>'qty')::numeric as qty
    from jsonb_array_elements(coalesce(p_deliveries, '[]'::jsonb)) e
    order by (e->>'t')::numeric
  loop
    if v_stock <= 0 then
      return round(greatest(v_t, 0), 1); -- pusto zanim doszła kolejna dostawa
    end if;
    v_run_out := v_t + v_stock / p_daily;
    if v_run_out < v_d.t then
      return round(v_run_out, 1); -- kończy się przed dostawą
    end if;
    v_stock := v_stock - p_daily * (v_d.t - v_t) + v_d.qty;
    v_t := v_d.t;
  end loop;

  if v_stock <= 0 then
    return round(greatest(v_t, 0), 1);
  end if;
  return least(round(v_t + v_stock / p_daily, 1), 999);
end;
$$;

-- ── 2. Nowe get_stock_alerts ─────────────────────────────────────────
drop function if exists public.get_stock_alerts();

create or replace function public.get_stock_alerts()
returns table(
  r_component_id bigint,
  r_component_name text,
  r_component_code text,
  r_product_category text,
  r_warehouse_id bigint,
  r_warehouse_code text,
  r_warehouse_name text,
  r_current_stock numeric,
  r_baseline_monthly numeric,
  r_seasonal_factor numeric,
  r_daily_consumption numeric,
  r_days_until_empty numeric,
  r_alert_level text,
  r_suggested_order_qty numeric,
  r_reserved_quantity numeric,
  r_available numeric,
  r_incoming_qty numeric,
  r_earliest_eta date
)
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
    with latest_forecast as (
      select distinct on (component_id)
        component_id,
        baseline_qty,
        historical_months_used
      from forecast_runs
      order by component_id, run_at desc
    ),
    -- dostawy w drodze per komponent: suma + najbliższa data + harmonogram do symulacji
    incoming as (
      select
        i.component_id,
        sum(i.quantity_ordered - i.quantity_received) as incoming_qty,
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
        and i.status in ('pending', 'partial')
        and (i.quantity_ordered - i.quantity_received) > 0
      group by i.component_id
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
        coalesce(inc.incoming_qty, 0) as incoming_qty,
        inc.earliest_eta,
        coalesce(inc.deliveries, '[]'::jsonb) as deliveries
      from warehouse_stock ws
      join warehouse_components wc on wc.id = ws.component_id and wc.is_active = true
      join warehouses w on w.id = ws.warehouse_id
      left join latest_forecast lf on lf.component_id = ws.component_id
      left join incoming inc on inc.component_id = ws.component_id
    ),
    computed as (
      select
        spw.*,
        case
          when spw.hist_months = 0 or spw.baseline_monthly = 0 then 0::numeric
          else round((spw.baseline_monthly * v_seasonal / 30.0)::numeric, 3)
        end as daily_consumption,
        case
          when spw.hist_months = 0 or spw.baseline_monthly = 0 then null
          else days_until_empty_sim(
            spw.available,
            spw.baseline_monthly * v_seasonal / 30.0,
            spw.deliveries
          )
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
      c.baseline_monthly as r_baseline_monthly,
      v_seasonal as r_seasonal_factor,
      c.daily_consumption as r_daily_consumption,
      c.days_empty_sim as r_days_until_empty,
      case
        when c.hist_months = 0 or c.baseline_monthly = 0 then 'no_data'
        when c.days_empty_sim is null then 'no_data'
        when c.days_empty_sim <= v_critical then 'critical'
        when c.days_empty_sim <= v_warning then 'warning'
        when c.days_empty_sim <= v_observation then 'observation'
        else 'ok'
      end as r_alert_level,
      case
        when c.hist_months = 0 or c.baseline_monthly = 0 then 0::numeric
        else greatest(
          ceil((c.baseline_monthly * v_seasonal * 2.0) - c.available - c.incoming_qty)::numeric,
          0
        )
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
    inner_q.r_days_until_empty nulls last,
    inner_q.r_component_name;
end;
$function$;

grant execute on function public.get_stock_alerts() to authenticated;

-- ── WERYFIKACJA ───────────────────────────────────────────────────────
-- symulacja "na sucho":
select days_until_empty_sim(10, 1) as bez_dostaw,              -- 10
       days_until_empty_sim(10, 1, '[{"t":5,"qty":20}]') as z_dostawa, -- 30
       days_until_empty_sim(10, 1, '[{"t":15,"qty":20}]') as dostawa_za_pozno, -- 10
       days_until_empty_sim(0, 1, '[{"t":3,"qty":5}]') as juz_pusto;   -- 0
-- select * from get_stock_alerts() limit 20;
