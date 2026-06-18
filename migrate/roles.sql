-- =====================================================================
-- ROLE 2.0 — nowe role + przypisane kategorie per użytkownik
-- =====================================================================
-- ⚠️ NIE URUCHAMIAĆ ZANIM KOD (warstwa uprawnień) NIE BĘDZIE WDROŻONY!
-- Inaczej obecni 'manager' zmienią się w 'admin' i — jeśli kod jeszcze
-- sprawdza role === 'manager' — stracą dostęp. Najpierw release Stage 1,
-- potem ten SQL.
-- =====================================================================

-- 1) Kolumna przypisanych kategorii (dla zawężenia: pracownik produkcji, kierownik działu)
alter table public.profiles add column if not exists categories text[] not null default '{}';

-- 1b) CHECK na role — stary dopuszcza tylko worker/manager/sprzedawca i blokuje 'admin'.
--     Podmieniamy na nowy zestaw (8 nowych + 3 legacy na czas przejścia). MUSI być
--     przed UPDATE-ami niżej, inaczej 'admin' łamie stary constraint.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (
  role in (
    'obsluga_klienta', 'pracownik_produkcji', 'magazynier',
    'kierownik_dzialu', 'kierownik_magazynu', 'kierownik_produkcji', 'kierownik_firmowy', 'admin',
    'worker', 'manager', 'sprzedawca'
  )
);

-- 2) Migracja istniejących ról:
--    manager → admin (superrola), worker → pracownik_produkcji, sprzedawca → obsluga_klienta
update public.profiles set role = 'admin'               where role = 'manager';
update public.profiles set role = 'pracownik_produkcji' where role = 'worker';
update public.profiles set role = 'obsluga_klienta'     where role = 'sprzedawca';

-- 3) RLS — stare polityki sprawdzają role='manager'. Po migracji manager→admin
--    przestałyby uznawać admina za uprzywilejowanego (update/insert profili = 0 wierszy
--    bez błędu). Podmieniamy na funkcję SECURITY DEFINER (bez rekurencji RLS).
create or replace function public.current_user_is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'manager')
  );
$$;

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update
  using (auth.uid() = id or public.current_user_is_admin())
  with check (true);

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert
  with check (public.current_user_is_admin());

-- (opcjonalnie) komponenty kategorii dla pracowników produkcji można uzupełnić
-- z worker_stages, jeśli ktoś już ma przypisane etapy:
-- update public.profiles p set categories = sub.cats
-- from (select worker_id, array_agg(distinct category) cats from worker_stages group by worker_id) sub
-- where p.id = sub.worker_id and p.role = 'pracownik_produkcji';

-- Weryfikacja:
-- select role, count(*) from public.profiles group by role;
