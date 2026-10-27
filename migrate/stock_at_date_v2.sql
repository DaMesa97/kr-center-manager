-- 2026-10-28: „Stan na dzień” — poprawki po zgłoszeniu Tymka (data z marca pokazała stan
-- komponentów, których wtedy nie było).
--
-- 1) Komponent założony PO wybranym dniu nie może mieć na ten dzień stanu — pomijamy
--    (wc.created_at > koniec dnia). Dotąd wracały wszystkie 835 wierszy stan × magazyn.
-- 2) Daty sprzed 2026-09-30 odrzucane: ok. 29.09 stany wyzerowano bez ruchu korygującego,
--    więc „dziś minus ruchy” daje dla wcześniejszych dni wartości z sufitu (36 wierszy
--    MARKLOWICKA, 418 szt — wrześniowe WZ „cofnięte” zerowaniem). Ta sama data w aplikacji:
--    STOCK_HISTORY_RELIABLE_FROM (src/lib/stockAtDateCsv.ts).
-- Reszta bez zmian: stan na koniec dnia (czas polski) = stan fizyczny − ruchy od następnego dnia.
CREATE OR REPLACE FUNCTION public.get_stock_at_date(p_date date, p_warehouse_id bigint DEFAULT NULL)
RETURNS TABLE(component_id bigint, warehouse_id bigint, warehouse_code text, component_code text, component_name text, category text, unit text, quantity numeric)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
BEGIN
  IF p_date < DATE '2026-09-30' THEN
    RAISE EXCEPTION 'Stan na dzień dostępny od 2026-09-30 — wcześniej historia ruchów jest niekompletna (stany wyzerowano bez dokumentu)';
  END IF;
  RETURN QUERY
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
  CROSS JOIN cutoff
  WHERE (p_warehouse_id IS NULL OR b.wh = p_warehouse_id)
    AND wc.created_at < cutoff.t          -- komponent istniał tego dnia
  ORDER BY w.code, wc.code;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_stock_at_date(date, bigint) TO authenticated;
