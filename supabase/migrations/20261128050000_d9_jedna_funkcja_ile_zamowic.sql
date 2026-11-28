-- 28.11.2026, decyzje D9 + D65 — jedna reguła „ile zamówić” (Stany / Alerty / Zamawianie) i szkice ZD.
-- Problem (D9): trzy ekrany liczyły trzy różne „ile zamówić”:
--  - Stany (v_stock_levels): minimum całej firmy (smart ROP / minimum komponentu) przykładane OSOBNO do każdej
--    półki, „Wszystkie” = suma braków z półek (to samo minimum liczone 2–5 razy), do minimum (nie do celu);
--  - Alerty (get_stock_alerts): na SKU, do celu (smart target albo 2× miesięczne zużycie), bez partii logistycznej;
--  - Zamawianie (src/lib/reorder.ts): na SKU, rezerwacji NIE odejmowało, cel bez targetu = 4× minimum.
-- Decyzja właściciela 28.11 (TAK): jedna funkcja bazy na poziomie KOMPONENTU (suma magazynów); rezerwacje
-- ODEJMOWAĆ od stanu; cel dla komponentu bez smart ROP = 2× średnie miesięczne zużycie.
-- D65 (TAK, opcja a): szkice ZD (status draft) NIE liczą się jako „w drodze” — osobna kolumna „w szkicu”
-- (tu: r_draft_qty) i ostrzeżenie w aplikacji przy dodawaniu do listy zakupowej.
--
-- Reguła (get_reorder_proposals, wiersz = aktywny komponent):
--   pozycja  = stan (suma półek) − zarezerwowane + w drodze (wysłane / częściowe ZD); szkice osobno (r_draft_qty)
--   minimum  = suma minimów półek (gdy którakolwiek półka ma ręczne minimum) → smart ROP → minimum komponentu
--   cel      = smart target → cel komponentu → 2× miesięczne zużycie → 4× minimum (ostatnia deska, gdy brak zużycia);
--              nigdy poniżej minimum
--   status   = critical: pozycja < 0 albo pozycja ≤ minimum (minimum > 0); observe: pozycja ≤ 1,5× minimum;
--              ok; no_threshold (bez minimum i pozycja ≥ 0)
--   propozycja (critical / observe) = max(cel − pozycja, 1); (ok / no_threshold) = max(cel − pozycja, 0)
--              „z wyprzedzeniem”; zaokrąglona w górę do partii (stock_order_lot: minimum logistyczne / paleta)
--   miesięczne zużycie = smart: μ dzienne × sezon × 30; inaczej ostatnia prognoza (forecast_runs) × sezon miesiąca
--   r_level = stock_level(…) na sumach (te same poziomy co Stany: critical / covered / low / ok / inactive)
--
-- get_stock_alerts: „Sugerowane zam.” = r_proposal z get_reorder_proposals (na pierwszej półce SKU, jak dotąd),
-- nowa kolumna r_draft_qty (szkice ZD na tej półce/magazynie). Poziom alertu (dni do wyczerpania) bez zmian.
-- Zmiana typu wyniku get_stock_alerts → drop + create (get_stock_alerts_summary woła ją dynamicznie — bez zmian).
-- Aplikacja działa i bez tego pliku (PGRST202 / brak kolumny → stara logika).
-- Można uruchamiać wielokrotnie.
-- DO WDROŻENIA (nie wgrane).

create or replace function public.get_reorder_proposals()
returns table(
  r_component_id bigint,
  r_stock numeric,
  r_reserved numeric,
  r_available numeric,
  r_incoming numeric,
  r_earliest_eta date,
  r_open_pos integer,
  r_draft_qty numeric,
  r_position numeric,
  r_min numeric,
  r_min_source text,
  r_target numeric,
  r_target_source text,
  r_monthly_consumption numeric,
  r_smart boolean,
  r_level text,
  r_status text,
  r_proposal_raw numeric,
  r_proposal numeric,
  r_order_lot integer
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with comp as (
    select c.id, c.min_stock_level::numeric as comp_min, c.target_stock_level::numeric as comp_target,
           c.order_multiple, c.units_per_pallet
    from warehouse_components c
    where c.is_active
  ),
  st as (
    select ws.component_id,
           sum(ws.quantity) as qty,
           sum(coalesce(ws.reserved_quantity, 0)) as res,
           sum(ws.min_quantity) as shelf_min,
           count(ws.min_quantity) as shelf_min_n
    from warehouse_stock ws
    group by ws.component_id
  ),
  inc as (
    select * from get_incoming_stock_per_component()
  ),
  -- smart ROP tylko dla komponentów ze stanem (WZ zakłada półkę — bez półki smart i tak = manual)
  rop as (
    select c.id as component_id, r.rop::numeric as rop, r.target_stock::numeric as target_stock,
           r.daily_avg, r.seasonal_factor
    from comp c
    join st on st.component_id = c.id
    cross join lateral calculate_dynamic_rop(c.id) r
    where r.smart_status = 'smart' and r.rop is not null
  ),
  season as (
    select coalesce((select sf.factor from seasonal_factors sf
                     where sf.month = extract(month from now())::integer), 1.0)::numeric as f
  ),
  base as (
    select
      c.id,
      coalesce(st.qty, 0) as stock,
      coalesce(st.res, 0) as reserved,
      coalesce(i.r_incoming_qty, 0) as incoming,
      i.r_earliest_eta as earliest_eta,
      coalesce(i.r_open_pos, 0) as open_pos,
      coalesce(i.r_draft_qty, 0) as draft_qty,
      case
        when coalesce(st.shelf_min_n, 0) > 0 then st.shelf_min
        when rop.rop is not null then rop.rop
        else c.comp_min
      end as min_q,
      case
        when coalesce(st.shelf_min_n, 0) > 0 then 'shelf'
        when rop.rop is not null then 'smart'
        when c.comp_min is not null then 'component'
      end as min_src,
      rop.target_stock as smart_target,
      c.comp_target,
      (rop.rop is not null) as smart,
      case
        when rop.rop is not null then round(rop.daily_avg * rop.seasonal_factor * 30, 1)
        else round(coalesce(fc.baseline_qty, 0) * (select f from season), 1)
      end as monthly,
      c.order_multiple,
      c.units_per_pallet
    from comp c
    left join st on st.component_id = c.id
    left join inc i on i.r_component_id = c.id
    left join rop on rop.component_id = c.id
    left join lateral (
      select fr.baseline_qty
      from forecast_runs fr
      where st.component_id is not null and fr.component_id = c.id
      order by fr.run_at desc
      limit 1
    ) fc on true
  ),
  tgt as (
    select b.*,
      b.stock - b.reserved + b.incoming as pos,
      case
        when b.smart_target is not null then 'smart'
        when b.comp_target is not null then 'component'
        when b.monthly > 0 then 'consumption'
        when b.min_q is not null and b.min_q > 0 then 'min_x4'
      end as t_src,
      case
        when b.smart_target is not null then b.smart_target
        when b.comp_target is not null then b.comp_target
        when b.monthly > 0 then 2 * b.monthly
        when b.min_q is not null and b.min_q > 0 then 4 * b.min_q
      end as t0
    from base b
  ),
  stat as (
    select t.*,
      case when t.t0 is not null and t.min_q is not null then greatest(t.t0, t.min_q) else t.t0 end as target_q,
      case
        when t.pos < 0 then 'critical'
        when t.min_q is null then 'no_threshold'
        when t.min_q > 0 and t.pos <= t.min_q then 'critical'
        when t.min_q > 0 and t.pos <= t.min_q * 1.5 then 'observe'
        else 'ok'
      end as status
    from tgt t
  ),
  prop as (
    select s.*,
      case
        when s.status in ('critical', 'observe') then greatest(coalesce(s.target_q, 0) - s.pos, 1)
        else greatest(coalesce(s.target_q, 0) - s.pos, 0)
      end as raw
    from stat s
  )
  select
    p.id,
    p.stock,
    p.reserved,
    p.stock - p.reserved,
    p.incoming,
    p.earliest_eta,
    p.open_pos,
    p.draft_qty,
    p.pos,
    p.min_q,
    p.min_src,
    p.target_q,
    p.t_src,
    p.monthly,
    p.smart,
    public.stock_level(p.stock, p.reserved, p.incoming, p.min_q),
    p.status,
    p.raw,
    public.stock_order_lot(p.raw, p.order_multiple, p.units_per_pallet),
    coalesce(nullif(p.order_multiple, 0), nullif(p.units_per_pallet, 0))
  from prop p;
$$;

comment on function public.get_reorder_proposals() is
  'D9/D65: jedna reguła „ile zamówić” na komponent (suma magazynów): pozycja = stan − rezerwacje + w drodze (szkice ZD osobno), minimum (półki / smart / komponent), cel (smart / komponent / 2× miesięczne zużycie / 4× minimum), status, propozycja zaokrąglona do partii. Czytają: Zamawianie, Stany („Wszystkie”), Alerty.';

revoke all on function public.get_reorder_proposals() from public, anon;
grant execute on function public.get_reorder_proposals() to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Alerty: propozycja z get_reorder_proposals + szkice ZD na półce (D65)
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.get_stock_alerts();

create function public.get_stock_alerts()
 returns table(r_component_id bigint, r_component_name text, r_component_code text, r_product_category text,
               r_warehouse_id bigint, r_warehouse_code text, r_warehouse_name text, r_current_stock numeric,
               r_baseline_monthly numeric, r_seasonal_factor numeric, r_daily_consumption numeric,
               r_days_until_empty numeric, r_alert_level text, r_suggested_order_qty numeric,
               r_reserved_quantity numeric, r_available numeric, r_incoming_qty numeric, r_earliest_eta date,
               r_forecast_indicative boolean, r_draft_qty numeric)
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
    -- D65: szkice ZD (niewysłane) — osobno, NIE wchodzą do „w drodze” ani do dni do wyczerpania
    drafts as (
      select i.component_id, po.warehouse_id, sum(i.quantity_ordered)::numeric as draft_qty
      from purchase_order_items i
      join purchase_orders po on po.id = i.purchase_order_id
      where po.status = 'draft'
        and coalesce(i.status_per_item, 'pending') <> 'cancelled'
        and i.quantity_ordered > 0
      group by i.component_id, po.warehouse_id
    ),
    -- D9: „ile zamówić” — jedna reguła dla Stanów / Alertów / Zamawiania
    prop as (
      select gp.r_component_id as component_id, gp.r_proposal as proposal
      from get_reorder_proposals() gp
    ),
    -- smart ROP raz na komponent (ten sam silnik co Zamawianie)
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
        coalesce(dr.draft_qty, 0)::numeric as draft_qty,
        (rop.smart_status = 'smart') as is_smart,
        (rop.daily_avg * rop.seasonal_factor)::numeric as smart_daily,
        rop.seasonal_factor as smart_seasonal
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
      left join drafts dr
        on dr.component_id = ws.component_id
       and dr.warehouse_id = ws.warehouse_id
      left join rop on rop.component_id = ws.component_id
    ),
    computed as (
      select
        spw.*,
        -- propozycja raz na SKU — na półce z największym stanem, pozostałe wiersze = 0
        row_number() over (partition by spw.component_id order by spw.current_stock desc, spw.warehouse_id) as comp_rn,
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
        when c.comp_rn <> 1 then 0::numeric
        else coalesce(p.proposal, 0)::numeric
      end as r_suggested_order_qty,
      c.reserved_qty as r_reserved_quantity,
      c.available as r_available,
      c.incoming_qty as r_incoming_qty,
      c.earliest_eta as r_earliest_eta,
      (not coalesce(c.is_smart, false) and c.forecast_insufficient and c.baseline_monthly > 0) as r_forecast_indicative,
      c.draft_qty as r_draft_qty
    from computed c
    left join prop p on p.component_id = c.component_id
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
