-- 2026-10-21 (zwiad #4, Paczka 1): Weryfikacja i dzwonek obejmują też zamówienia z EXCELA.
-- Paczka I flaguje konflikty numerów z arkusza (needs_review), ale lista Weryfikacji
-- i powiadomienia miały WHERE source='bot' — 175 z 179 flag było niewidocznych.
-- get_orders_needing_review zwraca dodatkowo source; data przyjęcia z created_at,
-- gdy brak bot_received_at (Excel). Zmiana typu wyniku wymaga DROP + CREATE.

DROP FUNCTION IF EXISTS public.get_orders_needing_review();

CREATE FUNCTION public.get_orders_needing_review()
 RETURNS TABLE(id bigint, order_number text, category text, client_order_number text, company text, model text,
               bot_received_at timestamp with time zone, warnings jsonb, api_key_id integer, raw_payload jsonb, source text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    o.id,
    o.order_number,
    o.category,
    o.client_order_number,
    o.company,
    o.model,
    COALESCE((o.extra_fields->>'bot_received_at')::timestamptz, o.created_at),
    o.extra_fields->'warnings',
    (o.extra_fields->>'api_key_id')::integer,
    o.extra_fields->'raw_payload',
    o.source
  FROM orders o
  WHERE (o.extra_fields->>'needs_review')::boolean = true
  ORDER BY COALESCE((o.extra_fields->>'bot_received_at')::timestamptz, o.created_at) ASC NULLS LAST;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_orders_needing_review() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_orders_needing_review() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.notify_managers_new_review()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_needs_review BOOLEAN;
BEGIN
  v_needs_review :=
    (NEW.extra_fields->>'needs_review')::boolean IS TRUE
    OR (
      jsonb_typeof(NEW.extra_fields->'warnings') = 'array'
      AND jsonb_array_length(NEW.extra_fields->'warnings') > 0
    );

  -- bot ORAZ excel (konflikt numeru z arkusza itp.); ręczne zamówienia nie mają flag
  IF NEW.source IN ('bot', 'excel') AND v_needs_review THEN
    INSERT INTO notifications (user_id, type, title, body, link_tab, link_order_id)
    SELECT
      p.id,
      'review',
      'Zamówienie do weryfikacji',
      'Zlecenie ' || COALESCE(NEW.order_number, '?') || ' (' || COALESCE(NEW.category, '?') || ') — ' ||
        COALESCE(NEW.company, '') || ' wymaga weryfikacji',
      'Weryfikacja',
      NEW.id
    FROM profiles p
    WHERE p.role in ('admin', 'manager', 'kierownik_dzialu', 'kierownik_magazynu',
                     'kierownik_produkcji', 'kierownik_firmowy');
  END IF;
  RETURN NEW;
END;
$function$;
