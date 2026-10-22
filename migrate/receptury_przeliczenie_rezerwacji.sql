-- 2026-10-22: zmiana receptury przelicza rezerwacje otwartych zleceń.
--
-- Rezerwacje powstają raz (przy utworzeniu / edycji zlecenia) i nie pamiętają,
-- z której receptury pochodzą. Zmiana receptury (pozycje, ilości, kryteria,
-- wyłączenie) zostawiała otwarte zlecenia z rezerwacjami wg STAREJ receptury —
-- audyt: 79 zleceń rozjechanych, 17 bez żadnej rezerwacji.
--
-- rebuild_reservations_for_category(kategoria) — dla każdego OTWARTEGO,
-- nieanulowanego zlecenia kategorii:
--  * nic jeszcze nie wydano z magazynu → anuluj rezerwacje i zarezerwuj od nowa
--    wg aktualnych receptur (ten sam przepis co edycja zlecenia: cancel + reserve),
--  * coś już wydano (WZ) → POMIŃ (wydanego towaru automat nie cofa; kierownik
--    koryguje ręcznie) i policz w r_skipped_released,
--  * błąd jednego zlecenia nie wywraca reszty (osobny blok + r_failed).
-- Woła ją aplikacja po zapisie / usunięciu / wyłączeniu receptury.
--
-- PRZY OKAZJI: match_recipes_for_order liczył to_jsonb(zlecenia) + 6 regexów od nowa
-- przy KAŻDYM sprawdzanym kryterium (CTE inlinowane) — ~240 ms na zlecenie, 60 zleceń
-- = 14 s. WITH ... AS MATERIALIZED liczy raz: 60 zleceń = 0,4 s, wyniki identyczne
-- (sprawdzone EXCEPT w obie strony). Przyspiesza też każdy zapis zlecenia.
-- Stara definicja: migrate/backup_match_recipes_for_order_2026-10-22.sql

CREATE OR REPLACE FUNCTION public.match_recipes_for_order(p_order_id bigint)
 RETURNS TABLE(recipe_id bigint, part text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with o as materialized (
    select (to_jsonb(orders.*) || jsonb_build_object(
      'side_panel_a_w', substring(coalesce(nullif(orders.side_panel_a, ''), orders.side_panel) from '^[0-9]+'),
      'side_panel_a_h', substring(coalesce(nullif(orders.side_panel_a, ''), orders.side_panel) from '[×xX]([0-9]+)'),
      'side_panel_b_w', substring(orders.side_panel_b from '^[0-9]+'),
      'side_panel_b_h', substring(orders.side_panel_b from '[×xX]([0-9]+)'),
      'top_light_w', substring(orders.top_light from '^[0-9]+'),
      'top_light_h', substring(orders.top_light from '[×xX]([0-9]+)')
    )) as j, orders.category
    from orders
    where orders.id = p_order_id
  ),
  cand as (
    select
      r.id,
      r.part,
      (select count(*) from warehouse_recipe_criteria c where c.recipe_id = r.id) as crit_count
    from warehouse_recipes r, o
    where r.is_active
      and r.category = o.category
      and not exists (
        select 1
        from warehouse_recipe_criteria c
        where c.recipe_id = r.id
          and not exists (
            select 1 from unnest(c.allowed_values) v
            where upper(trim(coalesce(o.j ->> c.field, ''))) = upper(trim(v))
               or (
                 trim(v) ~ '^[0-9]+\s*-\s*[0-9]+$'
                 and coalesce(o.j ->> c.field, '') ~ '^[0-9]+$'
                 and (o.j ->> c.field)::numeric
                     between split_part(replace(trim(v), ' ', ''), '-', 1)::numeric
                         and split_part(replace(trim(v), ' ', ''), '-', 2)::numeric
               )
          )
      )
  )
  select distinct on (cand.part) cand.id, cand.part
  from cand
  order by cand.part, cand.crit_count desc, cand.id desc
$function$;

-- Porcjami (p_after_id / p_limit): limit zapytania dla zalogowanych to 8 s,
-- a cała kategoria (np. Disting) się w nim nie mieści — klient woła kolejne
-- porcje od r_last_id, aż r_done = true.
CREATE OR REPLACE FUNCTION public.rebuild_reservations_for_category(
  p_category text,
  p_after_id bigint DEFAULT 0,
  p_limit integer DEFAULT 150
)
 RETURNS TABLE(
   r_rebuilt integer, r_skipped_released integer, r_failed integer, r_failed_orders text[],
   r_last_id bigint, r_done boolean
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order record;
  v_rebuilt integer := 0;
  v_skipped integer := 0;
  v_failed integer := 0;
  v_failed_orders text[] := array[]::text[];
  v_last_id bigint := coalesce(p_after_id, 0);
  v_seen integer := 0;
  v_limit integer := least(greatest(coalesce(p_limit, 150), 1), 500);
begin
  perform assert_manager_or_service();

  for v_order in
    select o.id, o.order_number
    from orders o
    where o.category = p_category
      and o.id > v_last_id
      and (o.release_date is null or trim(o.release_date::text) = '')
      and coalesce((o.extra_fields->>'cancelled')::boolean, false) = false
    order by o.id
    limit v_limit
  loop
    v_seen := v_seen + 1;
    v_last_id := v_order.id;
    if exists (
      select 1 from stock_reservations sr
      where sr.order_id = v_order.id and sr.status in ('released', 'partially_released')
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    begin
      perform public.cancel_order_reservations__impl(v_order.id);
      perform 1 from public.reserve_stock_for_order(v_order.id);
      v_rebuilt := v_rebuilt + 1;
    exception when others then
      v_failed := v_failed + 1;
      if coalesce(array_length(v_failed_orders, 1), 0) < 20 then
        v_failed_orders := array_append(v_failed_orders, v_order.order_number || ': ' || sqlerrm);
      end if;
    end;
  end loop;

  r_rebuilt := v_rebuilt;
  r_skipped_released := v_skipped;
  r_failed := v_failed;
  r_failed_orders := v_failed_orders;
  r_last_id := v_last_id;
  r_done := v_seen < v_limit;
  return next;
end;
$function$;

REVOKE ALL ON FUNCTION public.rebuild_reservations_for_category(text, bigint, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rebuild_reservations_for_category(text, bigint, integer) TO authenticated, service_role;
