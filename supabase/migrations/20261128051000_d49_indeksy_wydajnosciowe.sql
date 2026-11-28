-- 28.11.2026 — D49 (decyzja właściciela: TAK). Trzy indeksy wydajnościowe.
-- DO WDROŻENIA (nie wgrane).
--
-- !!! WGRYWANIE INACZEJ NIŻ ZWYKLE !!!
-- `create index concurrently` NIE DZIAŁA w transakcji (błąd „cannot run inside a transaction block”).
-- Ten plik wgrywa się POZA transakcją, każde polecenie osobno:
--   * psql: `psql "$SUPABASE_DB_URL" -f 20261128051000_d49_indeksy_wydajnosciowe.sql` — BEZ opcji -1 / --single-transaction
--     i bez dopisywania begin/commit (psql bez -1 wykonuje każde polecenie osobno, w trybie autocommit);
--   * SQL Editor w Supabase: wklejać i uruchamiać po JEDNYM poleceniu (edytor wysyła całość w jednej transakcji).
-- `concurrently` = budowa indeksu nie blokuje zapisów do tabeli (trwa dłużej, ok. sekund–minuty).
-- `if not exists` = ponowne uruchomienie jest bezpieczne.
-- UWAGA: jeśli budowa `concurrently` się przerwie, zostaje indeks oznaczony jako nieważny (indisvalid = false), a `if not exists`
-- go potem pomija. Po wgraniu sprawdzić zapytaniem z końca pliku; nieważny → `drop index concurrently <nazwa>;` i uruchomić ponownie.
--
-- Co i dlaczego (pomiary 28.11 na produkcji: explain analyze na prawdziwej tabeli vs kopia tymczasowa z indeksem, w transakcji cofanej):
-- 1) idx_orders_category_created — trigger `flag_possible_duplicate_order` (każde nowe zlecenie STA/Disting) szuka duplikatu
--    z ostatnich 14 dni, a dziś czyta CAŁĄ kategorię (STA: 4441 wierszy odrzuconych filtrem, 1905 stron); z indeksem 101 wierszy,
--    ~180 stron. Koszt rośnie z historią — z indeksem zależy tylko od liczby zleceń z 14 dni.
-- 2) idx_orders_search_trgm — Ctrl+K (GlobalSearch: ilike '%fraza%' po numerze, firmie, nr klienta, modelu): dziś seq scan całej
--    tabeli, 107 ms; z indeksem trigramowym 8 ms (rzadka fraza), 26 ms (częsta, 1138 trafień). Frazy krótsze niż 3 znaki
--    indeksu nie użyją (jak dotąd seq scan).
-- 3) idx_audit_log_user_created — Dziennik zmian, pierwsza strona (user_id is not null, order by created_at desc, id desc,
--    500 wierszy): dziś odczyt wszystkich 10 tys. wpisów użytkowników + sortowanie, 1,8 s (zimny start do 3 s);
--    z indeksem częściowym odczyt tylko 500 wierszy w kolejności indeksu, ~1 ms (+ odczyt samych wierszy).
-- Rozszerzenie pg_trgm jest w schemacie `extensions` (sprawdzone), stąd `extensions.gin_trgm_ops`.

create index concurrently if not exists idx_orders_category_created
  on public.orders (category, created_at desc);

create index concurrently if not exists idx_audit_log_user_created
  on public.audit_log (created_at desc, id desc)
  where user_id is not null;

create index concurrently if not exists idx_orders_search_trgm
  on public.orders using gin (
    order_number extensions.gin_trgm_ops,
    company extensions.gin_trgm_ops,
    client_order_number extensions.gin_trgm_ops,
    model extensions.gin_trgm_ops
  );

-- Kontrola po wgraniu (oczekiwane: 3 wiersze, wszystkie indisvalid = true):
-- select c.relname, i.indisvalid
-- from pg_index i join pg_class c on c.oid = i.indexrelid
-- where c.relname in ('idx_orders_category_created', 'idx_audit_log_user_created', 'idx_orders_search_trgm');
