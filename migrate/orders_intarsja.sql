-- =====================================================================
-- RODZAJ INTARSJI (2026-09-09) — pole dedykowane systemom Titan (CORE/GUARD).
-- Wartości: JEDNOSTRONNA / DWUSTRONNA; dla SN/SN+/SN+RC2 puste ''.
--
-- Formularz STA pokazuje przełącznik tylko dla systemów Titan; nogi trójki
-- (ST/Bastion) dziedziczą wartość z bazowego STA. Import z Excela mapuje
-- kolumnę "Rodzaj intarsji" (lub "Intarsja").
--
-- Receptury: pole od razu dostępne jako kryterium doboru ("Intarsja (Titan)"
-- w edytorze). ISTNIEJĄCE receptury nie są dotknięte — dobór sprawdza tylko
-- kryteria, które receptura ma; nowego pola żadna z nich nie używa.
-- =====================================================================

alter table public.orders
  add column if not exists intarsja text not null default '';

alter table public.orders_archive
  add column if not exists intarsja text not null default '';

-- ⚠️ UWAGA — archiwizacja: archive_old_orders kopiuje JAWNĄ listą kolumn
-- (po awarii z SELECT *). Nowa kolumna NIE przenosi się do archiwum, dopóki
-- nie dopiszesz jej do tej listy. Zrzuć definicję:
--   select pg_get_functiondef(oid) from pg_proc where proname = 'archive_old_orders';
-- i dodaj "intarsja" w obu listach kolumn (INSERT ... oraz SELECT ...),
-- po czym wykonaj CREATE OR REPLACE z poprawioną wersją.

-- Kontrola:
select column_name from information_schema.columns
where table_name in ('orders', 'orders_archive') and column_name = 'intarsja';
-- oczekiwane: 2 wiersze
