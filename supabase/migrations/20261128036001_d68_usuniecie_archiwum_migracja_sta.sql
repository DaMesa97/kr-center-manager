-- 28.11.2026, decyzja D68 — krok 2 z 2: USUNIĘCIE tabel archiwum.migracja_* (pozostałość po migracji STA).
-- !!! WGRYWAĆ DOPIERO PO POTWIERDZENIU KOPII !!!
-- Warunki przed wgraniem:
--  1) wgrany krok 1: 20261128036000_d68_tabele_migracja_sta_do_archiwum.sql (tabele są w schemacie archiwum);
--  2) jest świeża zewnętrzna kopia (npm run backup:db — pg_dump całej bazy) zrobiona PO kroku 1 i sprawdzona
--     (np. pg_restore --list <plik> | findstr migracja_ pokazuje 3 tabele z danymi);
--  3) nikt nie zgłosił potrzeby tych danych od wgrania kroku 1.
-- Plik odmawia działania, gdy tabele wciąż leżą w public (krok 1 niewgrany) — nic nie usuwa „po drodze”.
-- Schemat archiwum zostaje (pusty) na przyszłe archiwa. Nieodwracalne poza odtworzeniem z kopii.
-- DO WDROŻENIA (nie wgrane) — PO POTWIERDZENIU KOPII.

do $$
begin
  if to_regclass('public.migracja_arkusz_sta') is not null
     or to_regclass('public.migracja_sta_akcje') is not null
     or to_regclass('public.migracja_sta_backup') is not null then
    raise exception 'D68: tabele migracja_* są jeszcze w public — najpierw krok 1 (20261128036000) i kopia';
  end if;
end $$;

drop table if exists archiwum.migracja_arkusz_sta;
drop table if exists archiwum.migracja_sta_akcje;
drop table if exists archiwum.migracja_sta_backup;
