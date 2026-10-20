-- ============================================================================
-- HOTFIX oznaczania etapów (zwiad #4, 2026-10-20; migracje przez MCP:
-- update_order_stage_coalesce_i_pracownicy + update_order_stage_guard_postgres)
--
-- Dwa żywe bugi, oba "cichy sukces":
-- 1) update_order_stage robił `production_stages || jsonb(...)` BEZ coalesce,
--    a NULL::jsonb || cokolwiek = NULL. 1268 otwartych zleceń miało NULL —
--    oznaczenie etapu przepadało bez błędu (WZ z magazynu zdążyła zejść).
--    Fix: backfill '{}' + DEFAULT + NOT NULL + coalesce w funkcji.
-- 2) Funkcja była SECURITY INVOKER, a RLS orders_update (paczka S, beta.49)
--    przepuszcza tylko kierowników/magazyniera/obsługę. Pracownik_produkcji
--    od 2026-10-18 "oznaczał" etapy w 0 wierszy — bez błędu, z toastem
--    sukcesu. Fix: SECURITY DEFINER (jak update_complaint_stage) z guardem:
--    authenticated / service_role / sesja administracyjna postgres.
-- ============================================================================

update orders set production_stages = '{}'::jsonb where production_stages is null;
alter table orders alter column production_stages set default '{}'::jsonb;
alter table orders alter column production_stages set not null;

create or replace function public.update_order_stage(
  p_order_id bigint,
  p_stage_key text,
  p_stage_value text
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'service_role')
     and session_user <> 'postgres' then
    raise exception 'update_order_stage: wymagane zalogowanie';
  end if;
  update orders
  set production_stages = coalesce(production_stages, '{}'::jsonb)
    || jsonb_build_object(p_stage_key, p_stage_value)
  where id = p_order_id;
end;
$$;

revoke execute on function public.update_order_stage(bigint, text, text) from public, anon;
grant execute on function public.update_order_stage(bigint, text, text) to authenticated, service_role;
