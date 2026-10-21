-- 2026-10-21 (zwiad #5): kto może ruszyć etap zlecenia + cofnięcie etapu ze zwrotem towaru.
--
-- 1) can_write_order_stage(order): kierownik / service_role / postgres ZAWSZE;
--    pracownik produkcji tylko z przypisaniem w worker_stages w kategorii tego zlecenia
--    albo jego partnera (Disting Plus: linked_order_id w obie strony, Titan: titan_group),
--    bo lustra etapów (dist_*, sta_*) zapisują się u partnera. Wcześniej update_order_stage
--    (SECURITY DEFINER od hotfixu f263df5) wpuszczał KAŻDEGO zalogowanego do dowolnego zlecenia.
-- 2) update_order_stage i return_stock_for_stage używają tego guardu (zwrot był tylko
--    dla kierownika — pracownik cofał etap, a towar zostawał zdjęty ze stanu).
-- 3) revert_order_stage(order, stage): ZWR wydanych pozycji etapu + wyczyszczenie etapu
--    w JEDNEJ transakcji (wcześniej klient czyścił etap, a potem osobno wołał zwrot).

CREATE OR REPLACE FUNCTION public.can_write_order_stage(p_order_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    coalesce(auth.role(), '') = 'service_role'
    or session_user = 'postgres'
    or public.current_user_is_manager()
    or exists (
      select 1
      from public.orders o
      join public.worker_stages ws on ws.worker_id = auth.uid()
      where o.id = p_order_id
        and ws.category in (
          select o.category
          union all select p.category from public.orders p where p.id = o.linked_order_id
          union all select p.category from public.orders p where p.linked_order_id = o.id
          union all select p.category from public.orders p
            where o.extra_fields ? 'titan_group'
              and p.extra_fields->>'titan_group' = o.extra_fields->>'titan_group'
        )
    );
$function$;

REVOKE ALL ON FUNCTION public.can_write_order_stage(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_write_order_stage(bigint) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.update_order_stage(p_order_id bigint, p_stage_key text, p_stage_value text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.can_write_order_stage(p_order_id) then
    raise exception 'Brak uprawnień do oznaczania etapów tego zlecenia (etap nie jest przypisany do Twojego stanowiska)';
  end if;
  update orders
  set production_stages = coalesce(production_stages, '{}'::jsonb)
    || jsonb_build_object(p_stage_key, p_stage_value)
  where id = p_order_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.return_stock_for_stage(p_order_id bigint, p_stage_key text)
 RETURNS TABLE(r_component_id bigint, r_component_name text, r_component_code text, r_quantity numeric, r_warehouse_code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.can_write_order_stage(p_order_id) then
    raise exception 'Brak uprawnień do cofania etapów tego zlecenia';
  end if;
  return query select * from public.return_stock_for_stage__impl(p_order_id, p_stage_key);
end; $function$;

CREATE OR REPLACE FUNCTION public.revert_order_stage(p_order_id bigint, p_stage_key text)
 RETURNS TABLE(r_component_id bigint, r_component_name text, r_component_code text, r_quantity numeric, r_warehouse_code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.can_write_order_stage(p_order_id) then
    raise exception 'Brak uprawnień do cofania etapów tego zlecenia';
  end if;
  -- najpierw zwrot (ZWR) wydanych pozycji tego etapu, potem czyszczenie etapu — razem albo wcale
  return query select * from public.return_stock_for_stage__impl(p_order_id, p_stage_key);
  update orders
  set production_stages = coalesce(production_stages, '{}'::jsonb) || jsonb_build_object(p_stage_key, '')
  where id = p_order_id;
end; $function$;

REVOKE ALL ON FUNCTION public.revert_order_stage(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revert_order_stage(bigint, text) TO authenticated, service_role;
