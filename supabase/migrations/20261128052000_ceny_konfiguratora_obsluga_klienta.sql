-- 28.11.2026 — decyzja D12, odpowiedź właściciela: obsługa klienta (rola obsluga_klienta) MA widzieć ceny z konfiguratora.
-- Plik 20261128031400 (WGRANY) przeniósł ceny do public.ceny_konfiguratora z polityką odczytu „tylko kierownicy”
-- (current_user_is_manager: admin, superadmin, manager, kierownik_*). Teraz polityka czyta nowy helper
-- public.current_user_can_see_prices() = kierownicy + obsluga_klienta (lustro uprawnienia 'prices.view'
-- z src/lib/permissions.ts). Hala (pracownik_produkcji) i magazynier dalej nie widzą cen.
-- Aplikacja: rola obsluga_klienta dostaje 'prices.view' (permissions.ts) — dziś cenę pokazuje tylko Archiwum
-- (zakładka i tabela orders_archive dla kierowników), więc obsługa klienta zobaczy cenę wszędzie tam, gdzie
-- aplikacja ją pokaże w przyszłości; dane w bazie są już dla niej dostępne po tej migracji.
-- Można uruchamiać wielokrotnie. Zależy od 20261128031400 (wgrany).
-- DO WDROŻENIA (nie wgrane).

create or replace function public.current_user_can_see_prices()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  -- D12 (28.11): lustro 'prices.view' — kierownicy (current_user_is_manager) + obsługa klienta
  select public.current_user_is_manager()
      or exists (select 1 from public.profiles where id = auth.uid() and role = 'obsluga_klienta');
$function$;

revoke all on function public.current_user_can_see_prices() from public, anon;
grant execute on function public.current_user_can_see_prices() to authenticated, service_role;

drop policy if exists ceny_konfiguratora_select on public.ceny_konfiguratora;
create policy ceny_konfiguratora_select on public.ceny_konfiguratora
  for select to authenticated
  using ((select public.current_user_can_see_prices()));

comment on table public.ceny_konfiguratora is
  'D12: ceny z konfiguratora (orders / complaints) — tylko kierownicy i obsługa klienta; w orders.configurator_value zawsze null';
