-- 27.11.2026 (testy 27.11, runda 3; WYSOKI): polityka warehouse_stock_write (ALL dla ról kierowniczych) pozwalała
-- wpisać dowolny stan / rezerwację prosto w tabelę — bez dokumentu (PZ/WZ/MM) i bez śladu w audycie.
-- Aplikacja pisze bezpośrednio do warehouse_stock tylko:
--   • przy zakładaniu komponentu / dodawaniu magazynu do komponentu — wiersze z quantity 0 (useWarehouse.ts),
--   • przy usuwaniu komponentu / magazynu — tylko wiersze z quantity 0 i reserved_quantity 0 (useWarehouse.ts, App.tsx).
-- Żadna ścieżka aplikacji nie robi .from('warehouse_stock').update/upsert (sprawdzone grep 27.11). Ilości zmieniają
-- funkcje SECURITY DEFINER (PZ, WZ, MM, rezerwacje, inwentaryzacja, set_stock_minimums) — działają jako właściciel,
-- polityk nie dotyczą. Funkcji bez SECURITY DEFINER piszących do warehouse_stock w bazie nie ma (sprawdzone 27.11).
-- Teraz:
--  a) trigger audytu (ten sam audit_trigger_fn co na warehouse_movements i orders) na warehouse_stock
--     i warehouse_recipe_components — każda zmiana stanu i receptury z autorem w audit_log,
--  b) warehouse_stock: kierownik może tylko dodać wiersz zerowy i usunąć wiersz zerowy; UPDATE tylko przez funkcje.
-- DO WDROŻENIA (nie wgrane w sesji).

-- a) audyt (testy 27.11, runda 3)
drop trigger if exists audit_warehouse_stock on public.warehouse_stock;
create trigger audit_warehouse_stock
  after insert or delete or update on public.warehouse_stock
  for each row execute function public.audit_trigger_fn();

drop trigger if exists audit_warehouse_recipe_components on public.warehouse_recipe_components;
create trigger audit_warehouse_recipe_components
  after insert or delete or update on public.warehouse_recipe_components
  for each row execute function public.audit_trigger_fn();

-- b) zapis bezpośredni tylko zerowych wierszy (testy 27.11, runda 3)
drop policy if exists warehouse_stock_write on public.warehouse_stock;
drop policy if exists warehouse_stock_insert_zero on public.warehouse_stock;
drop policy if exists warehouse_stock_delete_zero on public.warehouse_stock;

create policy warehouse_stock_insert_zero on public.warehouse_stock
  for insert to authenticated
  with check (
    (select public.current_user_is_manager())
    and coalesce(quantity, 0) = 0
    and coalesce(reserved_quantity, 0) = 0
  );

create policy warehouse_stock_delete_zero on public.warehouse_stock
  for delete to authenticated
  using (
    (select public.current_user_is_manager())
    and coalesce(quantity, 0) = 0
    and coalesce(reserved_quantity, 0) = 0
  );
