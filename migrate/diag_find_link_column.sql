-- =====================================================================
-- Szukamy KOLUMNY w STA, która trzyma referencję do Disting ("PD xxxx")
-- =====================================================================
-- Disting trzyma swój numer arkusza w disting_sheet (np. 'PD 3081').
-- Sprawdzamy, w której kolumnie STA pojawia się ten sam numer.

-- A) Ile wartości "PD ..." występuje w różnych kolumnach STA
select
  count(*) filter (where disting_sheet ilike 'PD %')        as w_disting_sheet,
  count(*) filter (where sta_sheet     ilike 'PD %')        as w_sta_sheet,
  count(*) filter (where sta_ref       ilike 'PD %')        as w_sta_ref,
  count(*) filter (where client_order_number ilike '%PD %') as w_client_order_number,
  count(*) filter (where notes ilike '%PD %')               as w_notes,
  count(*) filter (where info  ilike '%PD %')               as w_info,
  count(*) filter (where label ilike '%PD %')               as w_label
from orders
where category = 'STA';

-- B) Ile STA matchuje Disting po KAŻDEJ kolumnie kandydującej
--    (dokładne dopasowanie do Disting.disting_sheet)
with d as (select distinct trim(disting_sheet) ds from orders where category='Disting' and nullif(trim(disting_sheet),'') is not null)
select
  (select count(*) from orders s join d on trim(s.sta_sheet)=d.ds            where s.category='STA') as match_sta_sheet,
  (select count(*) from orders s join d on trim(s.sta_ref)=d.ds              where s.category='STA') as match_sta_ref,
  (select count(*) from orders s join d on trim(s.client_order_number)=d.ds  where s.category='STA') as match_client,
  (select count(*) from orders s join d on trim(s.label)=d.ds                where s.category='STA') as match_label,
  (select count(*) from orders s join d on trim(s.info)=d.ds                 where s.category='STA') as match_info;

-- C) Próbka pełnych wierszy Disting "DISTING PLUS" — zobaczmy wszystkie pola
select order_number, system, disting_sheet, sta_sheet, sta_ref, client_order_number, label, company
from orders
where category = 'Disting'
limit 10;
