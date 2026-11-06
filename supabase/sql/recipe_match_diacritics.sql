-- =====================================================================
-- Dopasowanie receptur niewrażliwe na polskie znaki i podwójne spacje
-- Wdrożone 7.11.2026 (migracja recipe_match_diacritics_insensitive przez MCP).
--
-- Powód: wiersze z Excela przychodzą jako „DAB ZLOTY" / „DAB TURNER", a słownik
-- i receptury mają „DĄB ZŁOTY" / „DĄB TURNER". Porównanie upper(trim()) było
-- dosłowne, więc ~70 otwartych zleceń STA/Disting/ST nie łapało receptury
-- skrzydła i wisiało jako „częściowa receptura" (zgłoszenia #65/#66/#67).
-- Po wdrożeniu i przeliczeniu (rebuild_reservations_for_category):
--   Disting partial 45 -> 3, STA 18 -> 2, ST 1 -> 1.
--
-- Pełne definicje match_recipes_for_order / preview_order_stock są w bazie;
-- tu tylko helper i JEDYNA zmieniona linia w obu funkcjach:
--   było:  where upper(trim(coalesce(o.j ->> c.field, ''))) = upper(trim(v))
--   jest:  where public._recipe_norm(o.j ->> c.field) = public._recipe_norm(v)
-- (w preview_order_stock analogicznie z v_p zamiast o.j).
--
-- Przy okazji (ten sam dzień): kryteria szerokości 56 receptur STA TITAN
-- (id 170–225) miały wartość „80N TITAN" / „90E TITAN" ze słownika „rozmiar"
-- (config_options 734/735), której żadne zlecenie nigdy nie miało — zlecenia
-- niosą „80N" / „90E". allowed_values rozszerzone do {80N, 80N TITAN} itd.
-- =====================================================================

create or replace function public._recipe_norm(t text)
returns text
language sql
immutable
as $$
  select regexp_replace(
           translate(upper(trim(coalesce(t, ''))), 'ĄĆĘŁŃÓŚŹŻąćęłńóśźż', 'ACELNOSZZACELNOSZZ'),
           '\s+', ' ', 'g')
$$;

-- update warehouse_recipe_criteria c
-- set allowed_values = array[upper(left(c.allowed_values[1], 3)), c.allowed_values[1]]
-- from warehouse_recipes r
-- where r.id = c.recipe_id and r.id between 170 and 225 and r.category = 'STA'
--   and c.field = 'width' and array_length(c.allowed_values, 1) = 1
--   and upper(c.allowed_values[1]) in ('80N TITAN', '90E TITAN');
