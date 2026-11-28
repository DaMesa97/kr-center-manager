-- 28.11.2026, decyzja D68 (właściciel: TAK — tabele migracja_* można usunąć po kopii).
-- Tabele robocze z jednorazowej migracji/czyszczenia STA: public.migracja_arkusz_sta (5745 wierszy),
-- public.migracja_sta_akcje (889), public.migracja_sta_backup (866) — bez RLS, w schemacie public.
-- Sprawdzone 28.11 (produkcja, tylko odczyt):
--  - żadna funkcja SQL (prosrc w każdym schemacie), widok, klucz obcy, wyzwalacz, zadanie cron ani publikacja
--    realtime ich nie używa;
--  - kod aplikacji (src/, electron/), funkcje Edge w repo i skrypty — brak odwołań (tylko TODO.MD:83 „DROP po
--    zamknięciu czyszczenia STA”);
--  - na produkcji anon/authenticated już nie mają do nich uprawnień (tylko postgres i service_role), ale tabele
--    leżą w public bez RLS — wystarczy jeden przypadkowy GRANT, żeby były czytelne i zapisywalne dla każdego.
-- Zmiana (krok 1 z 2, bezpieczny i odwracalny): przenosimy je do osobnego schematu `archiwum`, którego PostgREST
-- nie wystawia (nie ma go w „Exposed schemas”), bez USAGE dla public/anon/authenticated, z włączonym RLS (bez
-- polityk = nikt poza właścicielem i service_role). Dane zostają 1:1 — to jest „kopia”.
-- Cofnięcie: alter table archiwum.<nazwa> set schema public;
-- Krok 2 (osobny plik 20261128036001_d68_usuniecie_archiwum_migracja_sta.sql) usuwa je — dopiero po potwierdzeniu,
-- że jest zewnętrzna kopia (npm run backup:db — pg_dump całej bazy, obejmuje schemat archiwum).
-- Można uruchamiać wielokrotnie.
-- DO WDROŻENIA (nie wgrane).

create schema if not exists archiwum;
comment on schema archiwum is
  'Dane archiwalne / pozostałości po migracjach. Niewystawiane przez API, bez dostępu dla anon/authenticated (D68, 28.11.2026).';
revoke all on schema archiwum from public;
revoke all on schema archiwum from anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['migracja_arkusz_sta', 'migracja_sta_akcje', 'migracja_sta_backup'] loop
    if to_regclass('public.' || t) is not null then
      if to_regclass('archiwum.' || t) is not null then
        raise exception 'D68: tabela archiwum.% już istnieje, a public.% też — sprawdź ręcznie', t, t;
      end if;
      execute format('alter table public.%I set schema archiwum', t);
    end if;
    if to_regclass('archiwum.' || t) is not null then
      execute format('alter table archiwum.%I enable row level security', t);
      execute format('revoke all on table archiwum.%I from public, anon, authenticated', t);
      execute format(
        'comment on table archiwum.%I is %L', t,
        'Pozostałość po migracji STA (przeniesiona z public 28.11.2026, D68). Do usunięcia po potwierdzeniu kopii.');
    end if;
  end loop;
end $$;

-- nowe tabele tworzone w archiwum przez postgres też bez dostępu dla zwykłych ról
alter default privileges for role postgres in schema archiwum revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema archiwum revoke all on sequences from public, anon, authenticated;
