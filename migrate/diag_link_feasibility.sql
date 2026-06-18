-- =====================================================================
-- DIAGNOZA: czy da się auto-połączyć migrowane STA ↔ Disting
-- =====================================================================
-- Uruchom KAŻDE zapytanie osobno i podaj wyniki.

-- 1) Ile czego mamy
select
  (select count(*) from orders where category = 'STA') as sta_total,
  (select count(*) from orders where category = 'Disting') as disting_total,
  (select count(*) from orders where category = 'STA'
     and nullif(trim(disting_sheet), '') is not null) as sta_z_disting_sheet,
  (select count(*) from orders where linked_order_id is not null) as juz_polaczone;

-- 2) Próbka wartości STA.disting_sheet (do czego się odnoszą)
select order_number, disting_sheet, company
from orders
where category = 'STA' and nullif(trim(disting_sheet), '') is not null
limit 15;

-- 3) Próbka numerów zleceń Disting (format order_number) + ich disting_sheet
select order_number, disting_sheet, company
from orders
where category = 'Disting'
limit 15;

-- 4) Ile par dopasowałoby się po STA.disting_sheet = Disting.order_number
select count(*) as match_po_order_number
from orders sta
join orders dist
  on dist.category = 'Disting'
 and trim(dist.order_number) = trim(sta.disting_sheet)
where sta.category = 'STA'
  and nullif(trim(sta.disting_sheet), '') is not null;

-- 5) Ile par dopasowałoby się po STA.disting_sheet = Disting.disting_sheet
--    (gdyby obie strony miały ten sam numer arkusza Disting)
select count(*) as match_po_disting_sheet
from orders sta
join orders dist
  on dist.category = 'Disting'
 and trim(dist.disting_sheet) = trim(sta.disting_sheet)
where sta.category = 'STA'
  and nullif(trim(sta.disting_sheet), '') is not null;
