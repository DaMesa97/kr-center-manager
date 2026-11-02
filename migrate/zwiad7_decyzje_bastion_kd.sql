-- =====================================================================
-- Zwiad #7 — decyzje Tymka z 2.11.2026 (zgłoszenia #71 i #74)
--
-- #71 Brygadzista Bastionu (w programie: pracownik z etapami Bastion na
--     stanowisku) sam tworzy partie ościeżnic, dokłada/wyjmuje zlecenia,
--     pisze notatkę partii oraz dodaje i edytuje pozycje Reszty.
--     Zostaje przy kierowniku: usuwanie partii, naklejka, zrealizowane,
--     anulowanie / przywracanie pozycji Reszty.
--
-- #74 Kierownik działu sam zakłada konta pracowników produkcji w swoich
--     kategoriach, edytuje je (nazwisko, inicjały, kategorie w obrębie
--     swoich) i resetuje hasła (edge function manage-users). Nie zmienia
--     ról, działów, ZKP; nie usuwa kont (dezaktywacja — tak).
--
-- Idempotentne. Testy: scratchpad zwiad7/test_decyzje.sql (ROLLBACK).
-- =====================================================================

-- ── #71 Bastion: wspólny guard dla „załogi Bastionu" ─────────────────
create or replace function public.assert_bastion_crew()
returns void
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.bastion_batch_can_mark() then
    raise exception 'Brak uprawnień — partie i Resztę prowadzi kierownik albo pracownik z etapami Bastion na stanowisku';
  end if;
end;
$function$;

create or replace function public.bastion_create_batch(p_order_ids bigint[], p_notes text default null)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id bigint;
  v_no integer;
begin
  perform public.assert_bastion_crew();
  perform public.bastion_batch_check_orders(p_order_ids);
  -- numeracja kontynuuje arkusz OŚC.REG. NOWE (ostatnia partia 33)
  select greatest(coalesce(max(batch_no), 0), 33) + 1 into v_no from bastion_batches;
  insert into bastion_batches (batch_no, notes, created_by)
  values (v_no, nullif(trim(coalesce(p_notes, '')), ''), auth.uid())
  returning id into v_id;
  insert into bastion_batch_items (batch_id, order_id, position)
  select v_id, x.id, x.ord
  from unnest(p_order_ids) with ordinality as x(id, ord);
  perform public.bastion_batch_recalc(v_id);
  begin
    insert into audit_log (table_name, record_id, operation, user_id, new_data)
    values ('bastion_batches', v_id::text, 'INSERT', auth.uid(),
            jsonb_build_object('action', 'create_batch', 'batch_no', v_no, 'order_ids', to_jsonb(p_order_ids)));
  exception when others then null;
  end;
  return v_id;
end;
$function$;

create or replace function public.bastion_batch_add_orders(p_batch_id bigint, p_order_ids bigint[])
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pos integer;
begin
  perform public.assert_bastion_crew();
  if not exists (select 1 from bastion_batches where id = p_batch_id) then
    raise exception 'Partia % nie istnieje', p_batch_id;
  end if;
  perform public.bastion_batch_check_orders(p_order_ids);
  select coalesce(max(position), 0) into v_pos from bastion_batch_items where batch_id = p_batch_id;
  insert into bastion_batch_items (batch_id, order_id, position)
  select p_batch_id, x.id, v_pos + x.ord
  from unnest(p_order_ids) with ordinality as x(id, ord);
  update bastion_batches set updated_at = now() where id = p_batch_id;
  perform public.bastion_batch_recalc(p_batch_id);
end;
$function$;

create or replace function public.bastion_batch_remove_order(p_batch_id bigint, p_order_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.assert_bastion_crew();
  delete from bastion_batch_items where batch_id = p_batch_id and order_id = p_order_id;
  if not found then
    raise exception 'Zlecenia nie ma w tej partii';
  end if;
  update bastion_batches set updated_at = now() where id = p_batch_id;
  perform public.bastion_batch_recalc(p_batch_id);
end;
$function$;

create or replace function public.bastion_batch_set_notes(p_batch_id bigint, p_notes text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.assert_bastion_crew();
  update bastion_batches set notes = nullif(trim(coalesce(p_notes, '')), ''), updated_at = now() where id = p_batch_id;
  if not found then
    raise exception 'Partia % nie istnieje', p_batch_id;
  end if;
end;
$function$;

-- bastion_delete_batch: bez zmian (assert_manager_or_service) — usuwa tylko kierownik

create or replace function public.bastion_extra_create(p jsonb)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r public.bastion_extras;
  v_id bigint;
begin
  perform public.assert_bastion_crew();
  r.extra_no := (select greatest(coalesce(max(extra_no), 0), 362) + 1 from bastion_extras);
  r.order_date := current_date; r.company := ''; r.production_day := ''; r.description := ''; r.color := '';
  r.width_side := ''; r.system := ''; r.quantity := 1; r.order_ref := ''; r.client_order_number := '';
  r.rush := ''; r.notes := ''; r.sales_changes := ''; r.stages := '{}'::jsonb; r.label := ''; r.is_cancelled := false;
  r := public.bastion_extra_apply(r, p);
  insert into bastion_extras (extra_no, order_date, company, production_day, description, color, width_side, system, quantity,
                              order_ref, client_order_number, rush, notes, sales_changes, entered_by, created_by)
  values (r.extra_no, r.order_date, r.company, r.production_day, r.description, r.color, r.width_side, r.system, r.quantity,
          r.order_ref, r.client_order_number, r.rush, r.notes, r.sales_changes,
          coalesce((select upper(coalesce(initials, '')) from profiles where id = auth.uid()), ''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$function$;

create or replace function public.bastion_extra_update(p_id bigint, p jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r public.bastion_extras;
begin
  perform public.assert_bastion_crew();
  select * into r from bastion_extras where id = p_id for update;
  if not found then raise exception 'Pozycja % nie istnieje', p_id; end if;
  r := public.bastion_extra_apply(r, p);
  update bastion_extras e
  set order_date = r.order_date, company = r.company, production_day = r.production_day, description = r.description,
      color = r.color, width_side = r.width_side, system = r.system, quantity = r.quantity, order_ref = r.order_ref,
      client_order_number = r.client_order_number, rush = r.rush, notes = r.notes, sales_changes = r.sales_changes,
      updated_at = now()
  where e.id = p_id;
end;
$function$;

-- bastion_extra_set_flags (naklejka / zrealizowane / anulowanie): bez zmian — kierownik

-- ── #74 Kierownik działu zarządza kontami pracowników produkcji ──────
-- Czy zalogowany kierownik działu może założyć / zmienić profil o takiej
-- roli i kategoriach: tylko pracownik produkcji, kategorie niepuste i
-- wszystkie w kategoriach kierownika.
create or replace function public.kd_can_manage_profile(p_role text, p_categories text[])
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from public.profiles me
    where me.id = auth.uid()
      and me.role = 'kierownik_dzialu'
      and p_role = 'pracownik_produkcji'
      and coalesce(array_length(p_categories, 1), 0) > 0
      and p_categories <@ coalesce(me.categories, '{}'::text[])
  );
$function$;
revoke all on function public.kd_can_manage_profile(text, text[]) from public, anon;
grant execute on function public.kd_can_manage_profile(text, text[]) to authenticated, service_role;

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (
    public.current_user_is_admin()
    or (public.kd_can_manage_profile(role, categories)
        and coalesce(array_length(zkp_roles, 1), 0) = 0
        and zkp_position is null)
  );

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (auth.uid() = id or public.current_user_is_admin() or public.kd_can_manage_profile(role, categories))
  with check (auth.uid() = id or public.current_user_is_admin() or public.kd_can_manage_profile(role, categories));

create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    return new;
  end if;
  if (new.role is distinct from old.role
      or new.categories is distinct from old.categories
      or new.department is distinct from old.department
      or new.initials is distinct from old.initials
      or new.full_name is distinct from old.full_name
      or new.zkp_roles is distinct from old.zkp_roles        -- ZKP 5.3.2
      or new.zkp_position is distinct from old.zkp_position)  -- zał. 6.1
     and not public.current_user_is_admin() then
    -- kierownik działu: nazwisko, inicjały i kategorie pracownika produkcji
    -- ze swoich kategorii (przed i po zmianie); rola, dział, ZKP — nie
    if public.kd_can_manage_profile(old.role, old.categories)
       and public.kd_can_manage_profile(new.role, new.categories)
       and new.department is not distinct from old.department
       and new.zkp_roles is not distinct from old.zkp_roles
       and new.zkp_position is not distinct from old.zkp_position then
      return new;
    end if;
    raise exception 'Tylko administrator może zmieniać role (także ZKP), stanowisko, kategorie, działy, inicjały i nazwiska (kierownik działu: tylko pracowników produkcji w swoich kategoriach)';
  end if;
  return new;
end;
$function$;
