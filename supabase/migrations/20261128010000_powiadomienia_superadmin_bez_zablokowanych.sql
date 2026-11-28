-- 28.11.2026 (testy 27.11 (runda 3) — noc 28.11; WYSOKI): powiadomienia trafiają do złych osób.
-- 1) Listy ról w funkcjach powiadomień mają 'admin', ale nie 'superadmin' — właściciel (rola superadmin od 13.11)
--    nie dostaje nic: „do weryfikacji”, reklamacje, błędy Optimy, braki krytyczne, plan wydań.
-- 2) Powiadomienia szły też do kont zablokowanych (auth.users.banned_until > now()) — tester: zablokowany
--    kierownik STA dostał powiadomienie „do weryfikacji”, a superadmin nic.
-- Teraz: każda z funkcji dokłada 'superadmin' i pomija konta zablokowane / usunięte (pomocnik notify_user_active).
-- Pomocnik jest SECURITY DEFINER (właściciel postgres ma SELECT na auth.users); funkcje powiadomień też są
-- SECURITY DEFINER z właścicielem postgres, więc wołają go jako postgres. Zwykli użytkownicy go nie wykonają.
-- send_route_plan_summary (pg_cron) — tylko łatka listy ról; NIE uruchamiana w teście (woła net.http_post).
-- Plik można uruchamiać wielokrotnie (kontrola „już poprawione”). DO WDROŻENIA (nie wgrane w sesji).

create or replace function public.notify_user_active(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  -- konto aktywne = istnieje w auth.users, nie jest zablokowane ani usunięte (testy 27.11 (runda 3), noc 28.11)
  select exists (
    select 1 from auth.users u
    where u.id = p_user_id
      and (u.banned_until is null or u.banned_until <= now())
      and u.deleted_at is null
  );
$$;

comment on function public.notify_user_active(uuid) is
  'Czy konto może dostawać powiadomienia (nie zablokowane, nie usunięte). Tylko dla funkcji SECURITY DEFINER.';

revoke all on function public.notify_user_active(uuid) from public, anon, authenticated;
grant execute on function public.notify_user_active(uuid) to service_role;

do $$
declare
  f text;
  d text;
  n text;
  v_mark text := 'public.notify_user_active(p.id)';
begin
  foreach f in array array[
    'public.notify_managers_new_review()',
    'public.notify_managers_new_complaint()',
    'public.notify_erp_error()',
    'public.stock_critical_notify()',
    'public.send_route_plan_summary()'
  ] loop
    d := pg_get_functiondef(f::regprocedure);
    if position(v_mark in d) > 0 then
      raise notice '%: już poprawione — bez zmian', f;
      continue;
    end if;
    n := d;
    -- a) superadmin obok admin
    n := replace(n, 'p.role in (''admin'',', 'p.role in (''superadmin'', ''admin'',');
    n := replace(n, '''kierownik_firmowy'', ''admin'');', '''kierownik_firmowy'', ''admin'', ''superadmin'');');
    -- b) bez kont zablokowanych / usuniętych (testy 27.11 (runda 3), noc 28.11)
    n := replace(n, 'where p.role in (', 'where ' || v_mark || ' and p.role in (');
    n := replace(n, 'WHERE p.role in (', 'WHERE ' || v_mark || ' and p.role in (');
    if position('''superadmin''' in n) = 0 or position(v_mark in n) = 0 then
      raise exception '%: nie znaleziono listy ról — sprawdź definicję', f;
    end if;
    execute n;
  end loop;
end $$;
