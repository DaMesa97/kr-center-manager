-- 28.11.2026 (runda 10 (28.11); ŚREDNI, bezpieczeństwo — uzupełnienie 20261127234000_pilne_anon_bez_funkcji.sql):
-- rola anon (publiczny klucz, bez logowania) miała PEŁNE uprawnienia (SELECT/INSERT/UPDATE/DELETE/TRUNCATE…) do
-- 89 tabel i widoków w public (m.in. orders, worker_stages, complaints, order_photos, profiles) i USAGE/SELECT/
-- UPDATE na 65 sekwencjach. RLS zwracało anonowi puste wyniki bez błędu — przy nieudanym odświeżeniu tokenu
-- aplikacja pokazywała puste listy zamiast błędu. Do tego 3 tabele BEZ RLS (migracja_arkusz_sta,
-- migracja_sta_akcje, migracja_sta_backup) były dla anona w pełni do odczytu i zapisu.
-- Sprawdzone, że NIC legalnie nie używa anon na tabelach public (stan 28.11):
--  - polityki: żadna nie jest „to anon”; polityki „to public” wymagają auth.role() = 'authenticated' / auth.uid();
--    jedyny wyjątek login_attempts_insert_all ma with check (false);
--  - ekran logowania: check_login_rate_limit i log_login_attempt to funkcje SECURITY DEFINER (działają jako
--    właściciel) — EXECUTE dla anon zostaje (jak w 20261127234000), tabele nie są im potrzebne;
--  - sprawdzanie wersji (App.tsx, app_config) — polityka tylko dla authenticated, więc anon i tak nic nie czytał;
--  - funkcje Edge: w repo klucz anon służy tylko do createClient z nagłówkiem Authorization użytkownika (rola
--    authenticated); spoza repo erp-status i dynamic-handler używają service_role;
--  - widoki public (bastion_batches_overview, v_stock_levels) — anon i tak nie miał SELECT.
-- Zmiana: odbieramy anon wszystko na tabelach/widokach/sekwencjach public i domyślne uprawnienia (nowe tabele i
-- sekwencje tworzone przez postgres / supabase_admin nie dostaną anon). authenticated i service_role bez zmian.
-- NIE ruszamy: USAGE na schemacie public (potrzebne do RPC logowania), funkcji (20261127234000), storage
-- (20261128010400), realtime, graphql. Schemat crm: anon nie ma USAGE ani domyślnych uprawnień — bez zmian.
-- Można uruchamiać wielokrotnie.
-- DO WDROŻENIA (nie wgrane w sesji).
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;

-- domyślne uprawnienia roli supabase_admin — jeśli wgrywający nie jest jej członkiem, tylko komunikat
do $$
begin
  execute 'alter default privileges for role supabase_admin in schema public revoke all on tables from anon';
  execute 'alter default privileges for role supabase_admin in schema public revoke all on sequences from anon';
exception when insufficient_privilege then
  raise notice 'anon_bez_tabel: bez uprawnień do domyślnych uprawnień supabase_admin — pominięte (tabele tworzy postgres)';
end $$;
