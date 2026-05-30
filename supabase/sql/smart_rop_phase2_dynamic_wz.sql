-- ============================================================
-- Tura 9.6 — Smart logic (Faza 2): dynamiczny ROP z historii WZ
-- ============================================================

-- 1) Helper: status SKU (smart vs manual vs no_data)
-- Zwraca dla SKU jego "tryb pracy" w dashboardzie zamawiania
CREATE OR REPLACE FUNCTION get_sku_smart_status(p_component_id bigint)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_distinct_days integer;
BEGIN
  -- Liczymy ile RÓŻNYCH dni było WZ dla tego SKU w ostatnich 12 tygodniach
  SELECT COUNT(DISTINCT DATE(created_at))
  INTO v_distinct_days
  FROM warehouse_movements
  WHERE component_id = p_component_id
    AND movement_type = 'WZ'
    AND created_at >= now() - INTERVAL '12 weeks';

  IF v_distinct_days >= 4 THEN
    RETURN 'smart';
  ELSE
    RETURN 'manual';  -- może być też 'no_data' jeśli brak min_stock_level — sprawdza UI
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_sku_smart_status(bigint) TO authenticated;

-- 2) Główna funkcja: dynamic ROP dla SKU
-- Zwraca rekomendowane wartości min_stock_level i target_stock_level
-- bazując na historii WZ + sezonowości
CREATE OR REPLACE FUNCTION calculate_dynamic_rop(p_component_id bigint)
RETURNS TABLE (
  smart_status text,           -- 'smart' albo 'manual'
  rop integer,                 -- rekomendowany min_stock_level
  target_stock integer,        -- rekomendowany target_stock_level
  daily_avg numeric,           -- μ dzienne
  daily_stddev numeric,        -- σ dzienne (z weekly sums / 7)
  safety_stock integer,        -- bufor bezpieczeństwa
  seasonal_factor numeric,     -- uśredniony factor dla okresu lead-time
  lead_time_days integer,      -- z dostawcy
  weeks_of_history integer,    -- ile tygodni historii faktycznie było
  distinct_wz_days integer     -- ile różnych dni miało WZ (dla weryfikacji)
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead_time integer;
  v_supplier_id bigint;
  v_distinct_days integer;
  v_window_start timestamptz := now() - INTERVAL '12 weeks';
  v_total_qty numeric;
  v_total_days numeric := 84;  -- 12 tygodni
  v_daily_avg numeric;
  v_weekly_stddev numeric;
  v_daily_stddev numeric;
  v_safety_stock numeric;
  v_seasonal_factor numeric;
  v_rop numeric;
  v_target numeric;
  v_first_wz_date date;
  v_weeks_history integer;
BEGIN
  -- Pobierz lead_time_days z dostawcy
  SELECT s.lead_time_days, c.supplier_id
  INTO v_lead_time, v_supplier_id
  FROM warehouse_components c
  LEFT JOIN suppliers s ON s.id = c.supplier_id
  WHERE c.id = p_component_id;

  -- Default lead_time jeśli brak dostawcy / lead_time
  v_lead_time := COALESCE(v_lead_time, 42);

  -- Liczba różnych dni z WZ — sprawdź czy smart aktywny
  SELECT
    COUNT(DISTINCT DATE(wm.created_at)),
    MIN(DATE(wm.created_at))
  INTO v_distinct_days, v_first_wz_date
  FROM warehouse_movements wm
  WHERE wm.component_id = p_component_id
    AND wm.movement_type = 'WZ'
    AND wm.created_at >= v_window_start;

  -- Faktyczna liczba tygodni historii (max 12)
  v_weeks_history := LEAST(
    CEIL(EXTRACT(EPOCH FROM (now() - COALESCE(v_first_wz_date::timestamptz, now()))) / 604800)::integer,
    12
  );

  -- Jeśli za mało dni → smart_status = 'manual', wracamy z NULL-ami
  IF v_distinct_days < 4 THEN
    RETURN QUERY SELECT
      'manual'::text,
      NULL::integer,
      NULL::integer,
      NULL::numeric,
      NULL::numeric,
      NULL::integer,
      NULL::numeric,
      v_lead_time,
      v_weeks_history,
      v_distinct_days;
    RETURN;
  END IF;

  -- ============================================================
  -- SMART CALCULATION
  -- ============================================================

  -- 1) Średnie dzienne zużycie μ (suma WZ / 84 dni)
  SELECT COALESCE(SUM(quantity), 0)
  INTO v_total_qty
  FROM warehouse_movements
  WHERE component_id = p_component_id
    AND movement_type = 'WZ'
    AND created_at >= v_window_start;

  v_daily_avg := v_total_qty / v_total_days;

  -- 2) Odchylenie standardowe na TYGODNIOWYCH SUMACH (mniej szumu niż dzienne)
  -- Buduj tygodniowe sumy
  WITH weekly_sums AS (
    SELECT
      DATE_TRUNC('week', wm.created_at) as week_start,
      SUM(wm.quantity) as week_qty
    FROM warehouse_movements wm
    WHERE wm.component_id = p_component_id
      AND wm.movement_type = 'WZ'
      AND wm.created_at >= v_window_start
    GROUP BY DATE_TRUNC('week', wm.created_at)
  )
  SELECT COALESCE(STDDEV_SAMP(week_qty), 0)
  INTO v_weekly_stddev
  FROM weekly_sums;

  -- Konwersja σ tygodniowego na dzienne
  v_daily_stddev := v_weekly_stddev / 7.0;

  -- 3) Safety stock = 1.65 × σ_daily × √lead_time (95% confidence)
  v_safety_stock := 1.65 * v_daily_stddev * SQRT(v_lead_time);

  -- 4) Sezonowy factor — uśredniony dla okresu od dziś do końca lead-time
  -- Liczymy które miesiące pokrywa lead-time
  WITH lead_period AS (
    SELECT generate_series(
      0,
      CEIL(v_lead_time::numeric / 30)::integer
    ) AS months_offset
  ),
  months_in_period AS (
    SELECT DISTINCT EXTRACT(MONTH FROM (now() + (months_offset || ' months')::interval))::integer AS m
    FROM lead_period
  )
  SELECT COALESCE(AVG(sf.factor), 1.0)
  INTO v_seasonal_factor
  FROM months_in_period mip
  LEFT JOIN seasonal_factors sf ON sf.month = mip.m;

  -- 5) ROP = μ × lead_time × seasonal_factor + safety_stock
  v_rop := (v_daily_avg * v_lead_time * v_seasonal_factor) + v_safety_stock;

  -- 6) Target = ROP + (μ × 7) — bardziej lean, zapas operacyjny na 1 tydzień ponad ROP
  v_target := v_rop + (v_daily_avg * 7);

  -- Zwróć wynik
  RETURN QUERY SELECT
    'smart'::text,
    GREATEST(CEIL(v_rop)::integer, 1),     -- min 1 (bo ROP=0 nie ma sensu)
    GREATEST(CEIL(v_target)::integer, 1),
    ROUND(v_daily_avg, 2),
    ROUND(v_daily_stddev, 2),
    GREATEST(CEIL(v_safety_stock)::integer, 0),
    ROUND(v_seasonal_factor, 2),
    v_lead_time,
    v_weeks_history,
    v_distinct_days;
END;
$$;

GRANT EXECUTE ON FUNCTION calculate_dynamic_rop(bigint) TO authenticated;

-- 3) Funkcja batch dla wszystkich SKU (do dashboardu Zamawianie)
-- Zwraca rekomendacje dla każdego aktywnego SKU
CREATE OR REPLACE FUNCTION get_all_smart_rop()
RETURNS TABLE (
  component_id bigint,
  component_name text,
  smart_status text,
  recommended_min_stock integer,
  recommended_target_stock integer,
  manual_min_stock integer,        -- co user wpisał ręcznie
  manual_target_stock integer,
  effective_min_stock integer,     -- użyte w dashboardzie (smart || manual)
  effective_target_stock integer,
  daily_avg numeric,
  seasonal_factor numeric,
  weeks_of_history integer,
  distinct_wz_days integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.name,
    rop.smart_status,
    rop.rop,
    rop.target_stock,
    c.min_stock_level,
    c.target_stock_level,
    -- effective: smart > manual (ale jeśli smart NULL to manual)
    COALESCE(rop.rop, c.min_stock_level) AS effective_min_stock,
    COALESCE(rop.target_stock, c.target_stock_level) AS effective_target_stock,
    rop.daily_avg,
    rop.seasonal_factor,
    rop.weeks_of_history,
    rop.distinct_wz_days
  FROM warehouse_components c
  LEFT JOIN LATERAL calculate_dynamic_rop(c.id) rop ON true
  WHERE c.is_active = true
  ORDER BY c.name;
END;
$$;

GRANT EXECUTE ON FUNCTION get_all_smart_rop() TO authenticated;

-- 4) Weryfikacja
SELECT 'RPC calculate_dynamic_rop' AS test,
  CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname='calculate_dynamic_rop')
    THEN 'OK' ELSE 'BRAK' END AS info
UNION ALL
SELECT 'RPC get_sku_smart_status',
  CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname='get_sku_smart_status')
    THEN 'OK' ELSE 'BRAK' END
UNION ALL
SELECT 'RPC get_all_smart_rop',
  CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname='get_all_smart_rop')
    THEN 'OK' ELSE 'BRAK' END;

-- 5) Test smart logic dla istniejącego SKU
-- (opcjonalnie — zwróci 'manual' jeśli brak historii, 'smart' jeśli >= 4 dni WZ)
-- Zamień 1 na ID istniejącego komponentu:
-- SELECT * FROM calculate_dynamic_rop(1);

-- 6) Pełen przegląd wszystkich SKU
-- SELECT * FROM get_all_smart_rop() LIMIT 20;
