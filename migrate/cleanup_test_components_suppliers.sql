-- =====================================================================
-- CZYSZCZENIE TESTOWYCH KOMPONENTÓW I DOSTAWCÓW
-- =====================================================================
-- UWAGA: operacja NIEODWRACALNA. Usuwa WSZYSTKIE komponenty magazynowe,
-- stany, receptury, ruchy, PZ/MM, BOM drzwi wewnętrznych ORAZ dostawców
-- i powiązane zamówienia zakupu. NIE rusza zamówień produkcyjnych (orders)
-- ani konfiguracji/użytkowników/firm.
--
-- Zrób to RAZ, przed wgraniem właściwych komponentów. Wklej całość do
-- Supabase SQL editor i Run.
-- =====================================================================

begin;

-- 1. Dane magazynowe zależne od komponentów
truncate table
  warehouse_stock,
  warehouse_movements,
  warehouse_recipe_components,
  warehouse_recipes,
  order_internal_door_items
restart identity cascade;

-- 2. Zamówienia zakupu (zależne od dostawców/komponentów)
truncate table
  purchase_order_items,
  purchase_orders
restart identity cascade;

-- 3. Same komponenty
truncate table warehouse_components restart identity cascade;

-- 4. Dostawcy
truncate table suppliers restart identity cascade;

commit;

-- Weryfikacja (powinno być 0 wszędzie):
-- select 'components' t, count(*) from warehouse_components
-- union all select 'stock', count(*) from warehouse_stock
-- union all select 'suppliers', count(*) from suppliers
-- union all select 'recipes', count(*) from warehouse_recipes;
--
-- Magazyny (warehouses) ZOSTAJĄ. Jeśli któraś z tabel wyżej nie istnieje
-- w Twoim schemacie, usuń ją z listy truncate i uruchom ponownie.
