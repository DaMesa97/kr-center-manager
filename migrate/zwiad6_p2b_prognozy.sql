-- =====================================================================
-- ZWIAD #6 (2026-10-30) — Prognozy: historia zużycia przy < 3 WZ
--
-- get_component_consumption_history zwracała SAME ZERA dla komponentu z mniej
-- niż 3 wydaniami (wykres „brak historii", choć ruchy były). Flaga
-- r_insufficient_data zostaje (prognoza dalej = 0, forecast_component_demand
-- zeruje baseline), ale historia pokazuje prawdziwe WZ / ZWR / PZ. Przy < 3 WZ
-- nie ma sensu liczyć mediany do odcinania outlierów → próg wyłączony.
--
-- Bezpieczne do ponownego uruchomienia.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.get_component_consumption_history(p_component_id bigint, p_months integer DEFAULT 12)
 RETURNS TABLE(r_year integer, r_month integer, r_consumed numeric, r_returned numeric, r_received numeric, r_net_consumption numeric, r_outlier_removed boolean, r_insufficient_data boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_wz_count integer;
  v_wz_median numeric;
  v_wz_threshold numeric;
  v_insufficient boolean;
BEGIN
  SELECT COUNT(*), percentile_cont(0.5) WITHIN GROUP (ORDER BY quantity)
  INTO v_wz_count, v_wz_median
  FROM warehouse_movements
  WHERE component_id = p_component_id
    AND movement_type = 'WZ';

  v_insufficient := COALESCE(v_wz_count, 0) < 3;

  -- outliery (> 3 × mediana) odcinamy tylko przy sensownej próbce
  v_wz_threshold := CASE WHEN v_insufficient THEN NULL ELSE COALESCE(v_wz_median, 0) * 3 END;
  IF v_wz_threshold = 0 THEN v_wz_threshold := NULL; END IF;

  RETURN QUERY
  WITH months AS (
    SELECT generate_series(
      date_trunc('month', now() - make_interval(months => p_months - 1))::date,
      date_trunc('month', now())::date,
      '1 month'::interval
    )::date AS mstart
  )
  SELECT
    EXTRACT(YEAR FROM m.mstart)::integer,
    EXTRACT(MONTH FROM m.mstart)::integer,
    COALESCE(SUM(
      CASE
        WHEN wm.movement_type = 'WZ'
         AND (v_wz_threshold IS NULL OR wm.quantity <= v_wz_threshold)
        THEN wm.quantity ELSE 0
      END
    ), 0),
    COALESCE(SUM(CASE WHEN wm.movement_type = 'ZWR' THEN wm.quantity ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN wm.movement_type = 'PZ' THEN wm.quantity ELSE 0 END), 0),
    COALESCE(SUM(
      CASE
        WHEN wm.movement_type = 'WZ'
         AND (v_wz_threshold IS NULL OR wm.quantity <= v_wz_threshold)
        THEN wm.quantity ELSE 0
      END
    ), 0)
    - COALESCE(SUM(CASE WHEN wm.movement_type = 'ZWR' THEN wm.quantity ELSE 0 END), 0),
    EXISTS (
      SELECT 1 FROM warehouse_movements wmx
      WHERE wmx.component_id = p_component_id
        AND wmx.movement_type = 'WZ'
        AND wmx.created_at >= m.mstart
        AND wmx.created_at < (m.mstart + interval '1 month')
        AND v_wz_threshold IS NOT NULL
        AND wmx.quantity > v_wz_threshold
    ),
    v_insufficient
  FROM months m
  LEFT JOIN warehouse_movements wm
    ON wm.component_id = p_component_id
   AND wm.created_at >= m.mstart
   AND wm.created_at < (m.mstart + interval '1 month')
  GROUP BY m.mstart
  ORDER BY m.mstart;
END;
$function$;
