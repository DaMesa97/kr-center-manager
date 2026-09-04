-- =====================================================================
-- REZERWACJE — TURA 3: MAPOWANIE komponentów receptur na etapy produkcji
-- Zaakceptowane przez Tymka 2026-09-04.
--
-- Zasada: stage_key siedzi na POZYCJI komponentu (warehouse_recipe_
-- components), więc jedna receptura może wydawać na różnych etapach.
-- Komponent bez etapu (NULL) = fallback: wydanie przy pierwszym
-- ukończonym etapie zamówienia.
--
-- Etapy STA/Disting: e1 cięcie profilu ościeżnicy → e2_1 składanie
-- i okuwanie ościeżnicy → e2_2 dostawka/naświetle → e3 frez skrzydła
-- → e4 okuwanie/szklenie skrzydła → e5 pakowanie.
--
-- Idempotentne: krok 1 ustawia tylko NULL-e, krok 2 nadpisuje wyjątki
-- po nazwie komponentu (można odpalać wielokrotnie).
-- =====================================================================

-- ── 1. Domyślny etap wg CZĘŚCI receptury (tylko pozycje bez etapu) ───
update warehouse_recipe_components rc
set stage_key = m.stage
from warehouse_recipes r,
     (values
        ('frame',            'e1'),   -- profile/gotowe ościeżnice (wyjątki niżej)
        ('wing',             'e3'),   -- skrzydło brane przy frezowaniu
        ('glazing',          'e4'),
        ('decorative_panel', 'e4'),
        ('peephole',         'e4'),
        ('hardware',         'e4'),   -- zamki/zawiasy/bolce (wyjątki niżej)
        ('fittings',         'e2_1'), -- blacha zaczepowa
        ('handle',           'e5')    -- pochwyty przy pakowaniu
     ) as m(part, stage)
where rc.recipe_id = r.id
  and r.category in ('STA', 'Disting')
  and r.part = m.part
  and rc.stage_key is null;

-- ── 2. Wyjątki po nazwie komponentu (nadpisują domyślne) ─────────────
-- e2_1: składanie i okuwanie ościeżnicy — próg, uszczelki, korner,
--       blachy montażowe/zaczepowe
update warehouse_recipe_components rc
set stage_key = 'e2_1'
from warehouse_recipes r
join warehouse_components c on true
where rc.recipe_id = r.id
  and c.id = rc.component_id
  and r.category in ('STA', 'Disting')
  and (
    c.name ilike 'PRÓG%'
    or c.name ilike 'USZCZELKA 3223A%'
    or c.name ilike 'USZCZELKA S 7779%'
    or c.name ilike 'USZCZELKA S 7453%'
    or c.name ilike 'ŁĄCZNIK ALUMIN.NAROŻNY%KORNER%'
    or c.name ilike 'BLACHA MONTAŻOWA%'
    or c.name ilike 'BLACHA ZACZEPOWA%'
  );

-- e2_2: dostawka/naświetle
update warehouse_recipe_components rc
set stage_key = 'e2_2'
from warehouse_recipes r
join warehouse_components c on true
where rc.recipe_id = r.id
  and c.id = rc.component_id
  and r.category in ('STA', 'Disting')
  and c.name ilike 'ŁĄCZNIK NAROŻNY NIERDZEWNY NAŚWIETLA%';

-- e5: zabezpieczenia do pakowania
update warehouse_recipe_components rc
set stage_key = 'e5'
from warehouse_recipes r
join warehouse_components c on true
where rc.recipe_id = r.id
  and c.id = rc.component_id
  and r.category in ('STA', 'Disting')
  and c.name ilike 'NAROŻNIK OCHRONNY%';

-- ── WERYFIKACJA ───────────────────────────────────────────────────────
-- rozkład: ile pozycji na którym etapie, per część
select r.part, rc.stage_key, count(*) as pozycji
from warehouse_recipe_components rc
join warehouse_recipes r on r.id = rc.recipe_id
where r.category in ('STA', 'Disting') and r.is_active
group by r.part, rc.stage_key
order by r.part, rc.stage_key;

-- pozycje, które zostały bez etapu (powinno być 0 albo świadome wyjątki):
select r.part, c.name
from warehouse_recipe_components rc
join warehouse_recipes r on r.id = rc.recipe_id
join warehouse_components c on c.id = rc.component_id
where r.category in ('STA', 'Disting') and r.is_active and rc.stage_key is null
order by r.part, c.name;
