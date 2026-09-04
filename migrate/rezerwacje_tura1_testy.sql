-- =====================================================================
-- REZERWACJE — TURA 1: TESTY (wykonane 2026-09-04 na zleceniu 12939 ✓)
-- Supabase SQL Editor: każde uruchomienie to osobna sesja (temp table
-- nie przeżyje), zmiennych :var nie ma → podmień 12939 na swoje ID
-- (Ctrl+H w edytorze). ID zleceń z recepturami znajdziesz zapytaniem:
--
--   select o.id, o.order_number, o.category,
--          (select count(*) from match_recipes_for_order(o.id)) as pasujace_receptury
--   from orders o
--   where o.category in ('STA','Disting')
--   order by o.id desc limit 20;
-- =====================================================================

-- ── TEST 0: sanity po migracji ───────────────────────────────────────
select column_name from information_schema.columns
where table_name = 'warehouse_stock' and column_name in ('reserved_quantity','available_quantity');
select column_name from information_schema.columns
where table_name = 'warehouse_recipe_components' and column_name = 'stage_key';
-- oba mają zwrócić wiersze

-- ── TEST 1: rezerwacja ───────────────────────────────────────────────
select * from reserve_stock_for_order(12939);
-- oczekiwane: wiersze per komponent, r_status ok/insufficient
-- (insufficient NIE blokuje — rezerwacja i tak wchodzi, decyzja z briefu)

-- stan PO: quantity BEZ ZMIAN, reserved_quantity urosło:
select ws.warehouse_id, ws.component_id, ws.quantity, ws.reserved_quantity, ws.available_quantity
from warehouse_stock ws
where (ws.warehouse_id, ws.component_id) in (
  select sr.warehouse_id, sr.component_id from stock_reservations sr
  where sr.order_id = 12939 and sr.status <> 'cancelled'
);

select sr.id, sr.component_id, sr.stage_key, sr.quantity_reserved, sr.quantity_released, sr.status
from stock_reservations sr where sr.order_id = 12939;

-- ── TEST 2: guard podwójnej rezerwacji ───────────────────────────────
select * from reserve_stock_for_order(12939);
-- oczekiwane: JEDEN wiersz r_status = 'already_reserved'

-- ── TEST 3: wydanie na etap ──────────────────────────────────────────
-- (stage_key w recepturach jeszcze NULL → fallback: wyda się przy
--  pierwszym ukończonym etapie, niezależnie od klucza)
select * from release_stock_for_stage(12939, 'e3');
-- oczekiwane: wiersze r_status='released'
-- Jeśli magazyn fizycznie pusty → WSZYSTKO r_status='insufficient'
-- z r_shortage i ZERO zmian (tak ma być). Na potrzeby testu można
-- podnieść stan pod rezerwacje:
--   update warehouse_stock ws set quantity = ws.reserved_quantity
--   where (ws.warehouse_id, ws.component_id) in (
--     select sr.warehouse_id, sr.component_id from stock_reservations sr
--     where sr.order_id = 12939 and sr.status = 'reserved');

-- weryfikacja: quantity SPADŁO, reserved SPADŁO, rezerwacje released:
select ws.component_id, ws.quantity, ws.reserved_quantity
from warehouse_stock ws
where (ws.warehouse_id, ws.component_id) in (
  select sr.warehouse_id, sr.component_id from stock_reservations sr where sr.order_id = 12939
);
select sr.id, sr.stage_key, sr.quantity_reserved, sr.quantity_released, sr.status
from stock_reservations sr where sr.order_id = 12939;

-- WZ: jedno ZBIORCZE wydanie na zamówienie×etap (wspólny reference_doc,
-- RES-<id> w notatkach dla śladu):
select m.movement_type, m.component_id, m.quantity, m.reference_doc, m.notes
from warehouse_movements m
where m.order_id = 12939 and m.reference_doc like 'WZ-ORDER-%';

-- ponowne wydanie tego samego etapu = 0 wierszy:
select * from release_stock_for_stage(12939, 'e3');

-- ── TEST 4: braki fizyczne blokują wydanie ───────────────────────────
-- Na DRUGIM zleceniu: zarezerwuj (TEST 1), potem wyzeruj jeden stan:
--   update warehouse_stock set quantity = 0
--   where component_id = <ID_KOMPONENTU> and warehouse_id = <ID_MAGAZYNU>;
--   select * from release_stock_for_stage(<ID2>, 'e3');
-- oczekiwane: r_status='insufficient' z r_shortage, ZERO ruchów WZ,
-- rezerwacje dalej 'reserved', stany bez zmian. Potem przywróć quantity.

-- ── TEST 5: anulowanie zwalnia niewydane ─────────────────────────────
select cancel_order_reservations(12939);
-- oczekiwane: liczba zwolnionych; reserved wraca, statusy 'cancelled';
-- rezerwacje już 'released' NIE są ruszane (wydane nie wraca)
select sr.id, sr.status, sr.quantity_reserved, sr.quantity_released
from stock_reservations sr where sr.order_id = 12939;

-- ── TEST 6: "w drodze" i przegląd stanów ─────────────────────────────
select * from get_incoming_stock_per_component();
-- pusto jeśli brak otwartych PO (sent/partial) — wtedy utwórz testowe PO w apce
select * from get_stock_overview() limit 15;

-- ── TEST 7 (Tura 2): podgląd przed zapisem ───────────────────────────
-- Wymaga rezerwacje_tura2.sql. Payload z realnego zlecenia:
select p.* from orders o, lateral preview_order_stock(to_jsonb(o.*)) p
where o.id = 12939;
-- wynik ma się zgadzać komponent-w-komponent z reserve (bez zapisu)
