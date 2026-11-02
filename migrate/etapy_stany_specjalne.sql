-- =====================================================================
-- Stany specjalne etapów (decyzja Tymka 2.11.2026, zgłoszenie #73).
--
-- Wartość etapu w orders.production_stages:
--   '#ND'            nie dotyczy  — liczy się jako zrobione, bez magazynu, bez osoby
--   '#WS' / '#WS:x'  wstrzymane   — liczy się jako NIEzrobione, x = powód
-- Ustawia i zdejmuje kierownik (P0404). Stan specjalny nie koliduje z nikim
-- (P0402 tylko między dwiema osobami); na cudze inicjały nie da się go nałożyć
-- bez cofnięcia etapu — tego pilnuje klient (menu), tu zostaje P0402.
-- Skręcanie w partiach Bastion: '#WS' nie liczy się jako skręcone.
-- Idempotentne.
-- =====================================================================

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
  v_special boolean;
begin
  if not public.can_write_order_stage(p_order_id) then
    raise exception 'Brak uprawnień do oznaczania etapów tego zlecenia (etap nie jest przypisany do Twojego stanowiska)';
  end if;
  select coalesce(trim(production_stages->>p_stage_key), '') into v_cur
  from orders where id = p_order_id for update;
  if not found then
    raise exception 'Zlecenie % nie istnieje', p_order_id;
  end if;
  v_special := v_new like '#%' or v_cur like '#%';
  -- stany specjalne (nie dotyczy / wstrzymane) ustawia i zdejmuje kierownik
  if v_special
     and not (coalesce(auth.role(), '') = 'service_role' or session_user = 'postgres' or public.current_user_is_manager()) then
    raise exception 'Stan „nie dotyczy" / „wstrzymane" ustawia i zdejmuje kierownik.' using errcode = 'P0404';
  end if;
  -- konflikt dwóch osób: tylko między inicjałami (stan specjalny kierownik nadpisuje swobodnie)
  if v_new <> '' and v_cur <> '' and upper(v_cur) <> upper(v_new) and not v_mirror
     and v_cur not like '#%' and v_new not like '#%' then
    raise exception 'Ten etap jest już oznaczony (%). Lista się odświeży.', v_cur using errcode = 'P0402';
  end if;
  if v_new = '' and v_cur <> '' and v_cur not like '#%' and not public.stage_value_owned_by_caller(v_cur) then
    raise exception 'To wpis innej osoby (%). Cofnąć może % albo kierownik.', v_cur, v_cur using errcode = 'P0403';
  end if;
  update orders
  set production_stages = coalesce(production_stages, '{}'::jsonb)
    || jsonb_build_object(p_stage_key, p_stage_value)
  where id = p_order_id;
end;
$function$;

-- partie Bastion: skręcone = niepuste i NIE wstrzymane ('#ND' = skręcanie niepotrzebne → liczy się)
create or replace function public.bastion_batch_recalc(p_batch_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_total integer;
  v_screwed integer;
  v_status text;
begin
  -- zlecenia skręcone bez stempla (np. skręcone zanim trafiły do partii) → stempel teraz;
  -- cofnięte / wstrzymane skręcanie → stempel znika
  update bastion_batch_items bi
  set screwed_at = case
    when coalesce(o.production_stages->>'oscieznica_skrecanie', '') <> ''
         and upper(coalesce(o.production_stages->>'oscieznica_skrecanie', '')) not like '#WS%'
      then coalesce(bi.screwed_at, now())
    else null end
  from orders o
  where o.id = bi.order_id and bi.batch_id = p_batch_id
    and (case when coalesce(o.production_stages->>'oscieznica_skrecanie', '') <> ''
                   and upper(coalesce(o.production_stages->>'oscieznica_skrecanie', '')) not like '#WS%'
              then coalesce(bi.screwed_at, now()) else null end)
        is distinct from bi.screwed_at;

  select count(*), count(*) filter (where screwed_at is not null)
  into v_total, v_screwed
  from bastion_batch_items where batch_id = p_batch_id;

  select status into v_status from bastion_batches where id = p_batch_id;
  if v_total > 0 and v_screwed = v_total then
    if v_status <> 'closed' then
      update bastion_batches set status = 'closed', closed_at = now(), updated_at = now() where id = p_batch_id;
    end if;
  else
    if v_status <> 'open' then
      update bastion_batches set status = 'open', closed_at = null, updated_at = now() where id = p_batch_id;
    end if;
  end if;
end;
$function$;
