-- 2026-10-21: kto może ruszyć etap REKLAMACJI — ta sama reguła co dla zleceń
-- (migrate/etapy_guard_i_cofniecie_ze_zwrotem.sql). update_complaint_stage był
-- SECURITY DEFINER bez żadnego warunku: każdy zalogowany mógł oznaczyć/cofnąć
-- dowolny etap dowolnej reklamacji.
-- Kierownik / service_role / postgres zawsze; pracownik produkcji tylko z
-- przypisaniem w worker_stages w kategorii reklamacji albo jej partnera
-- (para Disting Plus: linked_complaint_id w obie strony — lustra dist_*/sta_*).

CREATE OR REPLACE FUNCTION public.can_write_complaint_stage(p_complaint_id bigint)
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
      from public.complaints c
      join public.worker_stages ws on ws.worker_id = auth.uid()
      where c.id = p_complaint_id
        and ws.category in (
          select c.category
          union all select p.category from public.complaints p where p.id = c.linked_complaint_id
          union all select p.category from public.complaints p where p.linked_complaint_id = c.id
        )
    );
$function$;

REVOKE ALL ON FUNCTION public.can_write_complaint_stage(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_write_complaint_stage(bigint) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.update_complaint_stage(p_complaint_id bigint, p_stage_key text, p_stage_value text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.can_write_complaint_stage(p_complaint_id) then
    raise exception 'Brak uprawnień do oznaczania etapów tej reklamacji (etap nie jest przypisany do Twojego stanowiska)';
  end if;
  update complaints
  set production_stages = coalesce(production_stages, '{}'::jsonb) || jsonb_build_object(p_stage_key, p_stage_value)
  where id = p_complaint_id;
end;
$function$;

REVOKE ALL ON FUNCTION public.update_complaint_stage(bigint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_complaint_stage(bigint, text, text) TO authenticated, service_role;
