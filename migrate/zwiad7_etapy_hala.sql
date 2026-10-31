-- =====================================================================
-- ZWIAD #7 — HALA (2026-10-31): etapy zleceń na wspólnych komputerach.
-- Decyzje Tymka: pracownik cofa SWOJE inicjały (bez limitu czasu), cudzych nie
-- rusza; dwie osoby na tym samym etapie nie nadpisują się po cichu.
--
-- 1) update_order_stage:
--    * nowa niepusta wartość na już wypełniony etap INNĄ wartością → błąd P0402
--      („już oznaczył XX") — wcześniej ostatni wygrywał i obie osoby miały „sukces";
--      klucze lustrzane (sta_*, dist_*) są wyjęte spod tej kontroli (lustro
--      przepisuje wartość ze źródła, może się różnić po poprawce u źródła);
--    * wyczyszczenie ('' = cofnięcie) przez nie-kierownika tylko własnych
--      inicjałów (profiles.initials) → inaczej błąd P0403.
-- 2) revert_order_stage: ta sama zasada własnych inicjałów dla nie-kierownika.
-- Kierownik / service_role / sesja postgres — bez zmian.
-- Bezpieczne do ponownego uruchomienia.
-- =====================================================================

create or replace function public.stage_value_owned_by_caller(p_value text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  -- kierownik, service_role, postgres: zawsze; pracownik: tylko gdy wpis = jego inicjały
  select coalesce(auth.role(), '') = 'service_role'
      or session_user = 'postgres'
      or public.current_user_is_manager()
      or coalesce(upper(trim(p_value)), '') = ''
      or exists (
        select 1 from public.profiles p
        where p.id = auth.uid()
          and upper(trim(coalesce(p.initials, ''))) <> ''
          and upper(trim(coalesce(p.initials, ''))) = upper(trim(p_value))
      );
$function$;
revoke all on function public.stage_value_owned_by_caller(text) from public, anon;
grant execute on function public.stage_value_owned_by_caller(text) to authenticated, service_role;

create or replace function public.update_order_stage(p_order_id bigint, p_stage_key text, p_stage_value text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cur text;
  v_new text := coalesce(trim(p_stage_value), '');
  v_mirror boolean := p_stage_key like 'sta\_%' or p_stage_key like 'dist\_%';
begin
  if not public.can_write_order_stage(p_order_id) then
    raise exception 'Brak uprawnień do oznaczania etapów tego zlecenia (etap nie jest przypisany do Twojego stanowiska)';
  end if;
  select coalesce(trim(production_stages->>p_stage_key), '') into v_cur
  from orders where id = p_order_id for update;
  if not found then
    raise exception 'Zlecenie % nie istnieje', p_order_id;
  end if;
  -- konflikt dwóch osób: etap już wypełniony inną wartością
  if v_new <> '' and v_cur <> '' and upper(v_cur) <> upper(v_new) and not v_mirror then
    raise exception 'Ten etap jest już oznaczony (%). Lista się odświeży.', v_cur using errcode = 'P0402';
  end if;
  -- cofnięcie: pracownik czyści tylko swoje inicjały
  if v_new = '' and v_cur <> '' and not public.stage_value_owned_by_caller(v_cur) then
    raise exception 'To wpis innej osoby (%). Cofnąć może % albo kierownik.', v_cur, v_cur using errcode = 'P0403';
  end if;
  update orders
  set production_stages = coalesce(production_stages, '{}'::jsonb)
    || jsonb_build_object(p_stage_key, p_stage_value)
  where id = p_order_id;
end;
$function$;

create or replace function public.revert_order_stage(p_order_id bigint, p_stage_key text)
returns table(r_component_id bigint, r_component_name text, r_component_code text, r_quantity numeric, r_warehouse_code text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cur text;
begin
  if not public.can_write_order_stage(p_order_id) then
    raise exception 'Brak uprawnień do cofania etapów tego zlecenia';
  end if;
  select coalesce(trim(production_stages->>p_stage_key), '') into v_cur
  from orders where id = p_order_id for update;
  if not found then
    raise exception 'Zlecenie % nie istnieje', p_order_id;
  end if;
  if v_cur <> '' and not public.stage_value_owned_by_caller(v_cur) then
    raise exception 'To wpis innej osoby (%). Cofnąć może % albo kierownik.', v_cur, v_cur using errcode = 'P0403';
  end if;
  -- najpierw zwrot (ZWR) wydanych pozycji tego etapu, potem czyszczenie etapu — razem albo wcale
  return query select * from public.return_stock_for_stage__impl(p_order_id, p_stage_key);
  update orders
  set production_stages = coalesce(production_stages, '{}'::jsonb) || jsonb_build_object(p_stage_key, '')
  where id = p_order_id;
end;
$function$;

revoke all on function public.update_order_stage(bigint, text, text) from public, anon;
grant execute on function public.update_order_stage(bigint, text, text) to authenticated, service_role;
revoke all on function public.revert_order_stage(bigint, text) from public, anon;
grant execute on function public.revert_order_stage(bigint, text) to authenticated, service_role;
