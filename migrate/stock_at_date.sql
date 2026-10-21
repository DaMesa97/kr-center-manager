-- 2026-10-20: stan magazynowy na wybrany dzień (zgłoszenie #59, eksport bez otwierania inwentaryzacji).
--
-- Stan na koniec dnia p_date (czas polski) = dzisiejszy stan fizyczny MINUS wszystkie
-- ruchy (warehouse_movements) od początku następnego dnia. Każda zmiana stanu
-- fizycznego (WZ, PZ, MM, inwentaryzacja, zwroty) loguje ruch, więc bilans otwarcia
-- nie jest potrzebny. Wiarygodne od 2026-09-30 (stany wyzerowano ok. 29.09 bez ruchu korygującego;
-- testowe WZ z września). Rezerwacji nie da się odtworzyć wstecz — tylko stan fizyczny.
-- SECURITY INVOKER: RLS tabel magazynowych obowiązuje jak przy zwykłym odczycie.

CREATE OR REPLACE FUNCTION public.get_stock_at_date(p_date date, p_warehouse_id bigint DEFAULT NULL)
RETURNS TABLE (
  component_id bigint,
  warehouse_id bigint,
  warehouse_code text,
  component_code text,
  component_name text,
  category text,
  unit text,
  quantity numeric
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  WITH cutoff AS (
    SELECT ((p_date + 1)::timestamp AT TIME ZONE 'Europe/Warsaw') AS t
  ),
  after_date AS (
    SELECT m.warehouse_to_id AS wh, m.component_id AS c, m.quantity AS q
    FROM warehouse_movements m, cutoff
    WHERE m.warehouse_to_id IS NOT NULL AND m.created_at >= cutoff.t
    UNION ALL
    SELECT m.warehouse_from_id, m.component_id, -m.quantity
    FROM warehouse_movements m, cutoff
    WHERE m.warehouse_from_id IS NOT NULL AND m.created_at >= cutoff.t
  ),
  net AS (
    SELECT wh, c, SUM(q) AS q FROM after_date GROUP BY wh, c
  ),
  base AS (
    SELECT COALESCE(s.warehouse_id, n.wh) AS wh,
           COALESCE(s.component_id, n.c) AS c,
           COALESCE(s.quantity, 0) - COALESCE(n.q, 0) AS qty
    FROM warehouse_stock s
    FULL JOIN net n ON n.wh = s.warehouse_id AND n.c = s.component_id
  )
  SELECT b.c, b.wh, w.code, wc.code, wc.name, wc.category, wc.unit, b.qty
  FROM base b
  JOIN warehouses w ON w.id = b.wh
  JOIN warehouse_components wc ON wc.id = b.c
  WHERE p_warehouse_id IS NULL OR b.wh = p_warehouse_id
  ORDER BY w.code, wc.code;
$$;

GRANT EXECUTE ON FUNCTION public.get_stock_at_date(date, bigint) TO authenticated;
