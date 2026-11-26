-- Wydajność (26.11.2026) — po dojściu 11,6 tys. RO drzwi wewnętrznych i 2,5 tys. kartotek Optimy
-- aplikacja „ładowała się niemiłosiernie długo”. Pomiar pg_stat_statements (15:26–21:53):
--   get_stock_alerts_summary()  3 536 wywołań, średnio 492 ms, max 4,3 s  = 29 min czasu bazy (nr 1)
--   orders po kategorii (select *) 201 stron po ~200 ms (24 strony na jedno wejście w Drzwi wewnętrzne)
-- Ta migracja zajmuje się stroną bazy; reszta (tylko otwarte zlecenia, licznik alertów z pamięcią
-- 15 s, pozycje tylko zmienionych zleceń) jest w aplikacji.
--
-- 1) get_stock_alerts(): smart ROP (calculate_dynamic_rop — 3 zapytania plpgsql na komponent) liczony
--    był dla WSZYSTKICH aktywnych komponentów (3 051, w tym 2 568 kartotek Optimy bez żadnego stanu),
--    a wynik i tak łączony jest tylko ze stanami (warehouse_stock: 483 komponenty / 856 półek).
--    Zmiana: liczymy tylko dla komponentów ze stanem. Wiersze wynikowe identyczne.
-- 2) Indeksy pod zapytania, które po wzroście tabeli przestały mieścić się w pamięci podręcznej:
--    - get_orders_needing_review() (co minutę z każdego komputera kierownika) — warunek
--      (extra_fields->>'needs_review')::boolean bez indeksu = seq scan 23,6 tys. wierszy
--    - Wysyłka: wydane z ostatnich 14 dni (release_date >= X order by release_date desc)
-- Nic nie kasujemy, nic w danych nie zmieniamy.

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

-- Weryfikacja (get_orders_needing_review, co 60 s z każdego komputera kierownika)
CREATE INDEX IF NOT EXISTS idx_orders_needs_review
  ON public.orders (id)
  WHERE ((extra_fields->>'needs_review')::boolean);

-- Wysyłka: wydane z ostatnich 14 dni
CREATE INDEX IF NOT EXISTS idx_orders_release_date
  ON public.orders (release_date DESC, id DESC)
  WHERE (release_date IS NOT NULL);

-- ─────────────────────────────────────────────────────────────────────────────
-- Część 2 (wgrana konektorem jako wydajnosc_2026_11_26_b)
-- 3) Licznik alertów (badge w menu) liczony najwyżej raz na 60 s dla całej firmy:
--    get_stock_alerts_summary() zapisuje wynik w stock_alerts_summary_cache i oddaje go kolejnym
--    wywołaniom; p_fresh = true (aplikacja po własnym PZ / MM) liczy od nowa.
--    Stara bezargumentowa wersja usunięta (dwie naraz = PostgREST nie umie wybrać).
-- 4) v_stock_levels: smart ROP raz na komponent ze stanem (483) zamiast raz na półkę (856,
--    stock_min_effective per wiersz). Wiersze identyczne — sprawdzone md5 starego i nowego widoku
--    w jednym zapytaniu (3866a940…). security_invoker i granty jak dotąd.

create table if not exists public.stock_alerts_summary_cache (
  id smallint primary key default 1 check (id = 1),
  computed_at timestamptz not null,
  r_critical integer not null,
  r_warning integer not null,
  r_observation integer not null,
  r_total_needs_attention integer not null
);
alter table public.stock_alerts_summary_cache enable row level security;
revoke all on public.stock_alerts_summary_cache from anon, authenticated;

drop function if exists public.get_stock_alerts_summary();
create or replace function public.get_stock_alerts_summary(p_fresh boolean default false)
 returns table(r_critical integer, r_warning integer, r_observation integer, r_total_needs_attention integer)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_row public.stock_alerts_summary_cache%rowtype;
begin
  -- 26.11: 3,5 tys. wywołań po ~0,5 s w 6,5 h (co 5 min + po każdej serii realtime, z każdego komputera).
  -- Wynik z pamięci, jeśli młodszy niż 60 s; p_fresh = true (po własnym PZ / MM) liczy od nowa.
  if not p_fresh then
    select * into v_row
    from public.stock_alerts_summary_cache
    where id = 1 and computed_at > now() - interval '60 seconds';
    if found then
      return query select v_row.r_critical, v_row.r_warning, v_row.r_observation, v_row.r_total_needs_attention;
      return;
    end if;
  end if;
  select
    count(*) filter (where a.r_alert_level = 'critical')::integer,
    count(*) filter (where a.r_alert_level = 'warning')::integer,
    count(*) filter (where a.r_alert_level = 'observation')::integer,
    count(*) filter (where a.r_alert_level in ('critical', 'warning'))::integer
  into v_row.r_critical, v_row.r_warning, v_row.r_observation, v_row.r_total_needs_attention
  from public.get_stock_alerts() a;
  insert into public.stock_alerts_summary_cache (id, computed_at, r_critical, r_warning, r_observation, r_total_needs_attention)
  values (1, now(), v_row.r_critical, v_row.r_warning, v_row.r_observation, v_row.r_total_needs_attention)
  on conflict (id) do update
    set computed_at = excluded.computed_at,
        r_critical = excluded.r_critical,
        r_warning = excluded.r_warning,
        r_observation = excluded.r_observation,
        r_total_needs_attention = excluded.r_total_needs_attention;
  return query select v_row.r_critical, v_row.r_warning, v_row.r_observation, v_row.r_total_needs_attention;
end;
$function$;
revoke execute on function public.get_stock_alerts_summary(boolean) from public, anon;
grant execute on function public.get_stock_alerts_summary(boolean) to authenticated, service_role;

create or replace view public.v_stock_levels with (security_invoker = true) as
with rop as (
  -- smart ROP raz na komponent ze stanem (dotąd stock_min_effective liczyło to osobno dla każdej półki)
  select c.id as component_id, r.rop::numeric as smart_min
  from warehouse_components c
  cross join lateral calculate_dynamic_rop(c.id) r
  where c.is_active and r.smart_status = 'smart' and r.rop is not null
    and exists (select 1 from warehouse_stock ws where ws.component_id = c.id)
)
SELECT s.id AS stock_id,
    s.warehouse_id,
    w.code AS warehouse_code,
    s.component_id,
    c.code AS component_code,
    c.name AS component_name,
    c.unit AS component_unit,
    c.category AS component_category,
    c.supplier_id,
    c.is_active,
    s.quantity,
    s.reserved_quantity,
    s.available_quantity,
    COALESCE(inc.r_incoming_qty, 0::numeric) AS incoming_qty,
    inc.r_earliest_eta AS earliest_eta,
    COALESCE(inc.r_open_pos, 0) AS open_pos,
    s.min_quantity,
    case
      when s.min_quantity is not null then 'shelf'
      when rop.smart_min is not null then 'smart'
      when c.min_stock_level is not null then 'component'
      else null
    end AS min_source,
    coalesce(s.min_quantity, rop.smart_min, c.min_stock_level) AS min_effective,
    stock_level(s.quantity, s.reserved_quantity, COALESCE(inc.r_incoming_qty, 0::numeric), coalesce(s.min_quantity, rop.smart_min, c.min_stock_level)) AS level,
    stock_order_lot(stock_shortage(s.quantity, s.reserved_quantity, COALESCE(inc.r_incoming_qty, 0::numeric), coalesce(s.min_quantity, rop.smart_min, c.min_stock_level)), c.order_multiple, c.units_per_pallet) AS shortage,
    s.updated_at,
    stock_shortage(s.quantity, s.reserved_quantity, COALESCE(inc.r_incoming_qty, 0::numeric), coalesce(s.min_quantity, rop.smart_min, c.min_stock_level)) AS shortage_raw,
    c.order_multiple,
    c.units_per_pallet
   FROM warehouse_stock s
     JOIN warehouses w ON w.id = s.warehouse_id
     JOIN warehouse_components c ON c.id = s.component_id
     LEFT JOIN get_incoming_stock_per_warehouse() inc(r_component_id, r_warehouse_id, r_incoming_qty, r_earliest_eta, r_latest_eta, r_open_pos) ON inc.r_warehouse_id = s.warehouse_id AND inc.r_component_id = s.component_id
     LEFT JOIN rop ON rop.component_id = c.id;
grant select on public.v_stock_levels to authenticated, service_role;
