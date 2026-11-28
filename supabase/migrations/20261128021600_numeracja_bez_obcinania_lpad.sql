-- 28.11.2026 (runda 10 (28.11); WYSOKI, umowy): lpad w Postgresie OBCINA tekst dłuższy niż zadana długość.
--  - crm.nastepny_numer_umowy: lpad(n, 2) → setna umowa w roku dostałaby „10/MM/RRRR” (jak dziesiąta; crm.dokumenty.numer
--    nie ma unikalności, więc duplikat przeszedłby po cichu). Licznik umowa:2026 = 71 (28.11) — zostało 29 umów;
--  - crm.nastepny_numer_oferty: lpad(n, 3) → 1000. oferta w roku = „RRRR/MM/100”;
--  - public.get_next_complaint_number: lpad(max+1, 3) → po RK/RRRR/999 wychodziło „RK/RRRR/100” (duplikat). Maksimum
--    liczone jest LICZBOWO (split_part(...)::int), więc po zmianie „1000” > „999” — następny 1001;
--  - public.generate_zd_number: LPAD(n, 3) → 1000. ZD u dostawcy w roku = „…-100/RRRR”.
-- Teraz zera tylko dopełniają: lpad(x, greatest(N, length(x)), '0') (wzór: migrate/wzr_numer_ponad_999.sql).
-- Format numerów do 99 / 999 bez zmian. Uprawnienia funkcji zachowane (create or replace ich nie rusza; dla
-- crm.nastepny_numer_oferty obowiązuje revoke z 20261127233400 — ta łatka go nie zmienia, kolejność dowolna).
-- Kontrola „już poprawione” po znaczniku „runda 10 (28.11), numer ponad”.
-- DO WDROŻENIA (nie wgrane w sesji).

create or replace function crm.nastepny_numer_umowy()
 returns text
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  r text := to_char(now() at time zone 'Europe/Warsaw', 'YYYY');
  m text := to_char(now() at time zone 'Europe/Warsaw', 'MM');
  n int;
begin
  insert into crm.liczniki (klucz, wartosc) values ('umowa:' || r, 1)
  on conflict (klucz) do update set wartosc = crm.liczniki.wartosc + 1, updated_at = now()
  returning wartosc into n;
  -- zera tylko dopełniają: setna umowa = „100/MM/RRRR”, nie „10/…” (runda 10 (28.11), numer ponad 99)
  return lpad(n::text, greatest(2, length(n::text)), '0') || '/' || m || '/' || r;
end $function$;

create or replace function crm.nastepny_numer_oferty(p_data date default ((now() at time zone 'Europe/Warsaw'::text))::date)
 returns text
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  n integer;
  rok text := to_char(p_data, 'YYYY');
begin
  insert into crm.liczniki (klucz, wartosc) values ('oferta:' || rok, 1)
  on conflict (klucz) do update set wartosc = crm.liczniki.wartosc + 1, updated_at = now()
  returning wartosc into n;
  -- zera tylko dopełniają: 1000. oferta = „RRRR/MM/1000” (runda 10 (28.11), numer ponad 999)
  return rok || '/' || to_char(p_data, 'MM') || '/' || lpad(n::text, greatest(3, length(n::text)), '0');
end;
$function$;

create or replace function public.get_next_complaint_number()
 returns text
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  -- maksimum liczbowo (::int), zera tylko dopełniają: po RK/RRRR/999 → 1000 (runda 10 (28.11), numer ponad 999)
  select 'RK/' || extract(year from now())::int || '/' ||
         lpad(x.n::text, greatest(3, length(x.n::text)), '0')
  from (
    select coalesce(max(split_part(complaint_number, '/', 3)::int), 0) + 1 as n
    from complaints
    where complaint_number like 'RK/' || extract(year from now())::int || '/%'
      and split_part(complaint_number, '/', 3) ~ '^[0-9]+$'
  ) x;
$function$;

do $$
declare
  d text;
  stare text := 'LPAD(v_next_number::text, 3, ''0'')';
  nowe text := 'LPAD(v_next_number::text, GREATEST(3, length(v_next_number::text)), ''0'') /* runda 10 (28.11), numer ponad 999 */';
begin
  d := replace(pg_get_functiondef('public.generate_zd_number(bigint)'::regprocedure), E'\r', '');
  if position('runda 10 (28.11), numer ponad' in d) > 0 then
    raise notice 'generate_zd_number: już poprawione — bez zmian';
  elsif position(stare in d) = 0 then
    raise exception 'generate_zd_number: nie znaleziono miejsca łatki — sprawdź definicję';
  else
    execute replace(d, stare, nowe);
  end if;
end $$;
