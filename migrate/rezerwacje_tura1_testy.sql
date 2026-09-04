-- =====================================================================
-- REZERWACJE — TURA 1: TESTY (odpalaj sekcjami, czytaj wyniki)
-- Wymaga: rezerwacje_tura1.sql wykonane.
-- Podstaw :ORDER_ID = id zamówienia, które PASUJE do jakiejś receptury
-- (np. dodaj testowe zlecenie STA pod recepturę #55 i weź jego id).
-- =====================================================================

-- ── TEST 0: sanity po migracji ───────────────────────────────────────
select column_name from information_schema.columns
where table_name = 'warehouse_stock' and column_name in ('reserved_quantity','available_quantity');
select column_name from information_schema.columns
where table_name = 'warehouse_recipe_components' and column_name = 'stage_key';
-- oba zapytania mają zwrócić wiersze

-- ── TEST 1: rezerwacja ───────────────────────────────────────────────
-- zapamiętaj stan PRZED:
select ws.warehouse_id, ws.component_id, ws.quantity, ws.reserved_quantity, ws.available_quantity
from warehouse_stock ws
join warehouse_recipe_components rc on rc.component_id = ws.component_id
where rc.recipe_id = 55;  -- albo inna receptura pod którą robisz test

select * from reserve_stock_for_order(:ORDER_ID);
-- oczekiwane: wiersze per komponent, r_status ok/insufficient,
-- r_available_after, r_incoming_qty, r_earliest_eta

-- stan PO: quantity BEZ ZMIAN, reserved_quantity urosło o zapotrzebowanie
select ws.warehouse_id, ws.component_id, ws.quantity, ws.reserved_quantity, ws.available_quantity
from warehouse_stock ws
join stock_reservations sr on sr.component_id = ws.component_id and sr.warehouse_id = ws.warehouse_id
where sr.order_id = :ORDER_ID;

select id, component_id, stage_key, quantity_reserved, quantity_released, status
from stock_reservations where order_id = :ORDER_ID;

-- ── TEST 2: guard podwójnej rezerwacji ───────────────────────────────
select * from reserve_stock_for_order(:ORDER_ID);
-- oczekiwane: JEDEN wiersz r_status = 'already_reserved', zero nowych rezerwacji

-- ── TEST 3: wydanie na etap ──────────────────────────────────────────
-- (stage_key w recepturach jeszcze NULL → fallback: wyda się przy
--  PIERWSZYM ukończonym etapie, niezależnie od klucza)
select * from release_stock_for_stage(:ORDER_ID, 'e3');
-- oczekiwane: wiersze r_status='released' z ilościami

-- weryfikacja: quantity SPADŁO, reserved SPADŁO, rezerwacje released
select ws.component_id, ws.quantity, ws.reserved_quantity from warehouse_stock ws
join stock_reservations sr on sr.component_id = ws.component_id and sr.warehouse_id = ws.warehouse_id
where sr.order_id = :ORDER_ID;
select id, stage_key, quantity_reserved, quantity_released, status
from stock_reservations where order_id = :ORDER_ID;
select movement_type, component_id, quantity, reference_doc, notes
from warehouse_movements where order_id = :ORDER_ID and reference_doc like 'RES-%';

-- ponowne wydanie tego samego etapu = nic (już released):
select * from release_stock_for_stage(:ORDER_ID, 'e3');
-- oczekiwane: 0 wierszy

-- ── TEST 4: braki fizyczne blokują wydanie (na DRUGIM zamówieniu) ────
-- 1) utwórz drugie testowe zlecenie pod tę samą recepturę → :ORDER_ID2
-- 2) select * from reserve_stock_for_order(:ORDER_ID2);
-- 3) sztucznie zbij stan fizyczny jednego komponentu poniżej potrzeby:
--    update warehouse_stock set quantity = 0
--    where component_id = :COMPONENT_ID and warehouse_id = :WH_ID;
-- 4) select * from release_stock_for_stage(:ORDER_ID2, 'e3');
--    oczekiwane: wiersze r_status='insufficient' z r_shortage,
--    ZERO ruchów WZ, rezerwacje dalej 'reserved', stany bez zmian
-- 5) przywróć stan: update warehouse_stock set quantity = <stara wartość> ...

-- ── TEST 5: anulowanie zwalnia niewydane ─────────────────────────────
select cancel_order_reservations(:ORDER_ID2);
-- oczekiwane: liczba zwolnionych; reserved_quantity wraca, statusy 'cancelled'
select id, status, quantity_reserved, quantity_released
from stock_reservations where order_id = :ORDER_ID2;

-- ── TEST 6: "w drodze" i przegląd stanów ─────────────────────────────
select * from get_incoming_stock_per_component();
-- oczekiwane: wiersze per komponent z otwartych PO (sent/partial);
-- pusto jeśli nie ma otwartych PO — wtedy stwórz testowe PO w apce
select * from get_stock_overview() limit 15;
