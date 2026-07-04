-- =====================================================================
-- MIGRACJA RÓL — WERSJA DO ODPALENIA (2026-07-04)
-- Zastępuje sekcję UPDATE z roles.sql (tamten plik NIE uwzględniał
-- backfillu kategorii — pracownicy zostaliby bez zakładek!).
--
-- WYMAGANIA przed startem (wszystkie już spełnione):
--   ✔ ekipa na beta.27 (UpdateBlocker i tak wymusi przy logowaniu)
--   ✔ kolumna profiles.categories istnieje
--   ✔ profiles_role_check dopuszcza nowe role
--   ✔ RLS profili z current_user_is_admin()
--   ✔ manage-users wdrożone z obsługą roli 'admin'
-- =====================================================================

begin;

-- 1) KATEGORIE dla pracowników wg starego działu (PRZED zmianą roli!)
--    pracownik_produkcji jest zawężony do kategorii — bez tego nie widzi nic.
update public.profiles set categories = '{Bastion}'
  where role = 'worker' and department = 'bastion';

update public.profiles set categories = '{STA,Disting,ST,Techniczne}'
  where role = 'worker' and department = 'stalowe';

update public.profiles set categories = '{STA,Disting,ST,Techniczne,Bastion,DrzwiWewnetrzne}'
  where role = 'worker' and (department = 'all' or department is null or department = '');

-- 2) Pracownicy działu MAGAZYN → rola magazynier
--    (podgląd wszystkich kategorii + Wysyłka + ruchy PZ/MM — jak dotąd w praktyce)
update public.profiles set role = 'magazynier', categories = '{}'
  where role = 'worker' and department = 'magazyn';

-- 3) Pozostali pracownicy → pracownik produkcji
update public.profiles set role = 'pracownik_produkcji'
  where role = 'worker';

-- 4) Sprzedawcy → obsługa klienta (podgląd wszystkiego + komentarze + etykiety)
update public.profiles set role = 'obsluga_klienta'
  where role = 'sprzedawca';

-- 5) Managerowie → admin (pełnia władzy jak dotąd).
--    Po migracji możesz wybranych ZDEGRADOWAĆ w panelu Użytkownicy na
--    kierownik_produkcji / kierownik_magazynu / kierownik_dzialu (+kategorie).
update public.profiles set role = 'admin'
  where role = 'manager';

commit;

-- ── WERYFIKACJA (ma nie być żadnych worker/manager/sprzedawca) ─────────
select role, department, categories, count(*)
from public.profiles
group by 1, 2, 3
order by 1, 2;
