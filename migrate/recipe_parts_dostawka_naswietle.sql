-- =====================================================================
-- CZĘŚCI RECEPTUR „DOSTAWKA BOCZNA" i „NAŚWIETLE GÓRNE" (2026-09-29)
-- [WYKONANE w bazie przez konektor — plik dla historii]
--
-- Osobne części, żeby receptury dostawki/naświetla SUMOWAŁY SIĘ
-- z ościeżnicą i szkleniem, zamiast z nimi konkurować (na jedną część
-- wygrywa tylko jedna receptura — wzorzec jak intarsja/prog).
--
-- Jak pisać recepturę dostawki (przykład STA):
--   Część: „Dostawka boczna"
--   Kryterium: „Szklenie dostawki A" (i/lub B) z wartościami ze słownika
--     → receptura wchodzi TYLKO gdy zamówienie ma dostawkę z tym szkleniem
--   Pozycje: profil dostawki, szyba, łączniki — etap wydania: E2.2
-- Analogicznie naświetle przez kryterium „Szklenie naświetla".
-- =====================================================================

alter table warehouse_assignment drop constraint if exists warehouse_assignment_part_check;
alter table warehouse_assignment add constraint warehouse_assignment_part_check
  check (part in ('wing','frame','hardware','fittings','handle','peephole',
                  'electric_strike','glazing','decorative_panel','intarsja','prog',
                  'dostawka','naswietle','other'));

alter table warehouse_recipes drop constraint if exists warehouse_recipes_part_check;
alter table warehouse_recipes add constraint warehouse_recipes_part_check
  check (part in ('wing','frame','hardware','fittings','handle','peephole',
                  'electric_strike','glazing','decorative_panel','intarsja','prog',
                  'dostawka','naswietle','other'));

-- Przypisania magazynów: STA → Marklowicka (1), Disting → Bukowa (2)
insert into warehouse_assignment (category, system, part, warehouse_id)
select v.category, v.system, v.part, v.warehouse_id
from (values
  ('STA',     null::text,      'dostawka',  1),
  ('STA',     null::text,      'naswietle', 1),
  ('Disting', null::text,      'dostawka',  2),
  ('Disting', null::text,      'naswietle', 2),
  ('Disting', 'DISTING PLUS',  'dostawka',  2),
  ('Disting', 'DISTING PLUS',  'naswietle', 2)
) as v(category, system, part, warehouse_id)
where not exists (
  select 1 from warehouse_assignment wa
  where wa.category = v.category
    and wa.part = v.part
    and (wa.system is not distinct from v.system)
);
