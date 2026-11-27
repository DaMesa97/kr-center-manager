-- PILNE: zalecane wgranie od razu, niezależnie od reszty.
-- 27.11.2026 (testy 27.11, runda 3; KRYTYCZNY): funkcje SECURITY DEFINER wykonywalne bez logowania.
-- Tester publicznym kluczem (rola anon, bez logowania) anulował 16 i przywrócił 16 rezerwacji zlecenia 17384 (e2_1)
-- przez cancel_stage_reservations__impl / restore_stage_reservations__impl, a restore_stage_reservations__impl(15995,'e1')
-- przywróciło rezerwację. Te funkcje nie sprawdzają roli — są „wnętrzem” update_order_stage / sync_stages_from_excel
-- (obie SECURITY DEFINER, działają jako właściciel, więc odebranie uprawnień ich nie psuje). Aplikacja (src/) ich nie woła.
--
-- Plik jest SAMODZIELNY (nie zależy od 20261127233000) i można go uruchamiać wielokrotnie — warto puścić go jeszcze
-- raz PO wgraniu reszty migracji, bo nowe funkcje w schemacie public dostają domyślnie EXECUTE dla anon.
--
-- 1) cancel/restore_stage_reservations__impl i recompute_order_stock_status: tylko właściciel i service_role
--    (woła je wyłącznie kod SECURITY DEFINER).
-- 2) Wszystkie pozostałe zwykłe funkcje (nie trigger) w schemacie public, które anon mógł wykonać: odebrane anon i PUBLIC,
--    a authenticated / service_role zachowują dokładnie to, co miały. Wyjątki (potrzebne PRZED zalogowaniem —
--    ekran logowania w src/hooks/useAuth.ts i src/MobileApp.tsx): check_login_rate_limit, log_login_attempt.
--    Sprawdzanie wersji (min_app_version) to odczyt tabeli app_config, nie funkcja — bez zmian.
--    Stan z 27.11 (odebrane anon): _recipe_norm, _xs_norm, alu_stage_zkp_operation, assert_bastion_crew,
--    bastion_batch_can_mark, bastion_batch_stage_keys, bastion_collection_for_model, bastion_collection_is_system_name,
--    bastion_extra_stage_keys, bastion_rule_set_active, bastion_rules_eval, bastion_rules_preview, company_key,
--    company_usage, config_option_usage, current_user_can_ship, expected_parts_for_category, feedback_update_own,
--    get_incoming_stock_per_component, get_stock_at_date, interior_item_parse, optima_interior_type, recipes_matching,
--    suggest_pallets, sync_stages_from_excel, wew_zlecenie_otwarte (+ trzy z pkt 1).
--    Funkcji wyzwalaczy (returns trigger) nie ruszamy — nie da się ich wywołać przez API, a uprawnienie EXECUTE
--    sprawdzane jest tylko przy CREATE TRIGGER.
--    Schemat crm: anon nie ma USAGE na schemacie, więc jego funkcje są dla anon nieosiągalne — bez zmian.

-- 1) wnętrza rezerwacji etapów — tylko kod SECURITY DEFINER / service_role
revoke all on function public.cancel_stage_reservations__impl(bigint, text) from public, anon, authenticated;
revoke all on function public.restore_stage_reservations__impl(bigint, text) from public, anon, authenticated;
revoke all on function public.recompute_order_stock_status(bigint) from public, anon, authenticated;
grant execute on function public.cancel_stage_reservations__impl(bigint, text) to service_role;
grant execute on function public.restore_stage_reservations__impl(bigint, text) to service_role;
grant execute on function public.recompute_order_stock_status(bigint) to service_role;

-- 2) reszta funkcji public wykonywalnych przez anon (testy 27.11, runda 3)
do $$
declare
  f record;
  v_auth boolean;
  v_svc boolean;
  v_n integer := 0;
begin
  for f in
    select p.oid, p.oid::regprocedure::text as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.prorettype <> 'trigger'::regtype
      and has_function_privilege('anon', p.oid, 'execute')
      and p.proname not in ('check_login_rate_limit', 'log_login_attempt')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    v_auth := has_function_privilege('authenticated', f.oid, 'execute');
    v_svc := has_function_privilege('service_role', f.oid, 'execute');
    execute format('revoke execute on function %s from public, anon', f.sig);
    if v_auth then execute format('grant execute on function %s to authenticated', f.sig); end if;
    if v_svc then execute format('grant execute on function %s to service_role', f.sig); end if;
    v_n := v_n + 1;
  end loop;
  raise notice 'pilne_anon_bez_funkcji: odebrano anon/PUBLIC w % funkcjach', v_n;
end $$;
