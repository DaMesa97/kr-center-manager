-- =====================================================================
-- DIAGNOZA + NAPRAWA powiązań Disting Plus (STA ↔ Disting)
-- =====================================================================
-- Hipoteza: po czyszczeniu/migracji orders zerwały się powiązania
-- linked_order_id. Partnerzy STA istnieją, ale link zniknął, więc:
--  - nie zachowują się jak Disting Plus,
--  - mirror etapów ościeżnicy (z Disting) jest pusty.
--
-- KROK 1 — DIAGNOZA. Uruchom sam ten SELECT i sprawdź liczby:
-- =====================================================================
select
  (select count(*) from orders where category = 'STA'
     and nullif(trim(disting_sheet), '') is not null) as sta_z_ref_do_disting,
  (select count(*) from orders where category = 'STA'
     and nullif(trim(disting_sheet), '') is not null
     and linked_order_id is null) as sta_z_ref_ale_bez_linku,
  (select count(*) from orders where category = 'STA'
     and linked_order_id is not null) as sta_z_linkiem;

-- Jeśli "sta_z_ref_ale_bez_linku" > 0 → powiązania są zerwane.
-- Wtedy uruchom KROK 2 (odkomentuj i wykonaj):
-- =====================================================================

-- begin;
--
-- -- STA -> Disting (po numerze arkusza Disting zapisanym w STA.disting_sheet)
-- update orders sta
--   set linked_order_id = dist.id
-- from orders dist
-- where sta.category = 'STA'
--   and dist.category = 'Disting'
--   and sta.linked_order_id is null
--   and nullif(trim(sta.disting_sheet), '') is not null
--   and trim(dist.order_number) = trim(sta.disting_sheet);
--
-- -- Disting -> STA (odwrotny link + uzupełnienie sta_sheet)
-- update orders dist
--   set linked_order_id = sta.id,
--       sta_sheet = sta.order_number
-- from orders sta
-- where dist.category = 'Disting'
--   and sta.category = 'STA'
--   and dist.linked_order_id is null
--   and nullif(trim(sta.disting_sheet), '') is not null
--   and trim(dist.order_number) = trim(sta.disting_sheet);
--
-- commit;

-- KROK 3 — weryfikacja po naprawie (powtórz SELECT z KROKU 1;
-- "sta_z_ref_ale_bez_linku" powinno być 0).
