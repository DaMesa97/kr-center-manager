-- =====================================================================
-- RLS HARDENING (2026-07-04) — dokleja RBAC do bazy.
-- Do tej pory role były egzekwowane tylko w UI; polityki na tabelach
-- pomocniczych były tautologiami USING (true). Ten skrypt:
--   1) helper current_user_is_manager() (SECURITY DEFINER, bez rekurencji)
--   2) trigger: role i kategorie w profiles zmienia TYLKO admin
--      (koniec z samopodbiciem roli przez API)
--   3) zaostrza polityki: label_templates, print_documents, company_aliases,
--      feedback, notifications
-- NIE dotyka tabeli orders (celowo — produkcja musi działać bez ryzyka).
-- Można odpalać przed lub po roles_migrate_now.sql (kolejność obojętna).
-- =====================================================================

-- 1) Helper: czy zalogowany user jest kierownikiem/adminem (spójne z permissions.ts)
create or replace function public.current_user_is_manager()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('admin', 'manager', 'kierownik_dzialu', 'kierownik_magazynu',
                   'kierownik_produkcji', 'kierownik_firmowy')
  );
$$;

-- 2) Ochrona przed samopodbiciem roli/kategorii (privilege escalation).
--    auth.uid() IS NULL = kontekst serwerowy (SQL editor / service_role) — przepuszczamy,
--    bo service key i tak omija RLS, a migracje muszą przechodzić.
create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if (new.role is distinct from old.role or new.categories is distinct from old.categories)
     and not public.current_user_is_admin() then
    raise exception 'Tylko administrator może zmieniać role i kategorie';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_profile_privileges on public.profiles;
create trigger trg_protect_profile_privileges
  before update on public.profiles
  for each row execute function public.protect_profile_privileges();

-- Pomocnik: zdejmij WSZYSTKIE istniejące polityki z tabeli (nazwy bywały różne)
create or replace function public.__drop_all_policies(p_table text)
returns void language plpgsql as $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = p_table loop
    execute format('drop policy %I on public.%I', p.policyname, p_table);
  end loop;
end;
$$;

-- 3a) Szablony etykiet — czyta każdy, pisze kierownik/admin
select public.__drop_all_policies('label_templates');
create policy label_templates_read   on public.label_templates for select to authenticated using (true);
create policy label_templates_insert on public.label_templates for insert to authenticated with check (public.current_user_is_manager());
create policy label_templates_update on public.label_templates for update to authenticated using (public.current_user_is_manager());
create policy label_templates_delete on public.label_templates for delete to authenticated using (public.current_user_is_manager());

-- 3b) Dokumenty DoP/DWU — jak wyżej
select public.__drop_all_policies('print_documents');
create policy print_documents_read   on public.print_documents for select to authenticated using (true);
create policy print_documents_insert on public.print_documents for insert to authenticated with check (public.current_user_is_manager());
create policy print_documents_update on public.print_documents for update to authenticated using (public.current_user_is_manager());
create policy print_documents_delete on public.print_documents for delete to authenticated using (public.current_user_is_manager());

-- 3c) Aliasy kontrahentów — czyta każdy, pisze kierownik/admin (dopasowuje przy edycji)
select public.__drop_all_policies('company_aliases');
create policy company_aliases_read   on public.company_aliases for select to authenticated using (true);
create policy company_aliases_insert on public.company_aliases for insert to authenticated with check (public.current_user_is_manager());
create policy company_aliases_update on public.company_aliases for update to authenticated using (public.current_user_is_manager());
create policy company_aliases_delete on public.company_aliases for delete to authenticated using (public.current_user_is_manager());

-- 3d) Zgłoszenia — dodaje i zmienia status każdy (beta feedback), USUWA tylko kierownik/admin
select public.__drop_all_policies('feedback');
create policy feedback_read   on public.feedback for select to authenticated using (true);
create policy feedback_insert on public.feedback for insert to authenticated with check (true);
create policy feedback_update on public.feedback for update to authenticated using (true);
create policy feedback_delete on public.feedback for delete to authenticated using (public.current_user_is_manager());

-- 3e) Powiadomienia — widzisz/oznaczasz TYLKO swoje; insert dla zalogowanych
--     (wzmianki @ tworzą powiadomienia dla innych — dlatego insert szeroki)
select public.__drop_all_policies('notifications');
create policy notifications_read   on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_insert on public.notifications for insert to authenticated with check (true);
create policy notifications_update on public.notifications for update to authenticated using (user_id = auth.uid());
create policy notifications_delete on public.notifications for delete to authenticated using (user_id = auth.uid());

drop function public.__drop_all_policies(text);

-- ── WERYFIKACJA ────────────────────────────────────────────────────────
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('label_templates','print_documents','company_aliases','feedback','notifications','profiles')
order by tablename, cmd;
