-- =====================================================================
-- 27.11.2026: sekcja INNE (part = 'other') — schodzą WSZYSTKIE pasujące receptury
-- (pytanie Dawida: okapnik + samozamykacz w jednym zleceniu → dotąd szła tylko jedna).
--
-- Reguła:
--   * części inne niż 'other': bez zmian — jedna receptura na część (najwięcej kryteriów, remis → nowsza);
--   * 'other': każda pasująca receptura, CHYBA ŻE dwie opisują to samo — zbiór pól kryteriów jednej
--     zawiera się w drugiej (np. „samozamykacz” vs „samozamykacz + kierunek”); wtedy jak dotąd
--     wygrywa dokładniejsza (więcej kryteriów, remis → nowsza). Receptura bez kryteriów konkuruje ze wszystkimi.
--
-- Jedno miejsce dopasowania: recipes_matching(kategoria, pola) — używa go match_recipes_for_order
-- (rezerwacje, wydania, rewalidacja) i preview_order_stock (podgląd w formularzu). Wcześniej były to
-- dwie kopie tego samego zapytania.
-- =====================================================================

create or replace function public.recipes_matching(p_category text, p_j jsonb)
returns table(recipe_id bigint, part text)
language sql
stable security definer
set search_path to 'public'
as $function$
  with cand as (
    select
      r.id,
      r.part,
      (select count(*) from warehouse_recipe_criteria c where c.recipe_id = r.id) as crit_count,
      coalesce((select array_agg(distinct c.field) from warehouse_recipe_criteria c where c.recipe_id = r.id), '{}'::text[]) as fields
    from warehouse_recipes r
    where r.is_active
      and r.category = p_category
      -- receptura bez pozycji (np. przerwany zapis) nie może „wygrać" części
      and exists (select 1 from warehouse_recipe_components rc where rc.recipe_id = r.id)
      and not exists (
        select 1
        from warehouse_recipe_criteria c
        where c.recipe_id = r.id
          and not exists (
            select 1 from unnest(c.allowed_values) v
            -- porównanie bez polskich znaków i podwójnych spacji (Excel: „DAB ZLOTY" = „DĄB ZŁOTY")
            where public._recipe_norm(p_j ->> c.field) = public._recipe_norm(v)
               or (
                 trim(v) ~ '^[0-9]+\s*-\s*[0-9]+$'
                 and coalesce(p_j ->> c.field, '') ~ '^[0-9]+$'
                 and (p_j ->> c.field)::numeric
                     between split_part(replace(trim(v), ' ', ''), '-', 1)::numeric
                         and split_part(replace(trim(v), ' ', ''), '-', 2)::numeric
               )
          )
      )
  )
  select c.id, c.part
  from cand c
  where not exists (
    select 1
    from cand d
    where d.part = c.part
      and d.id <> c.id
      and (d.crit_count > c.crit_count or (d.crit_count = c.crit_count and d.id > c.id))
      and (c.part <> 'other' or c.fields <@ d.fields or d.fields <@ c.fields)
  )
  order by c.part, c.id
$function$;

create or replace function public.match_recipes_for_order(p_order_id bigint)
returns table(recipe_id bigint, part text)
language sql
stable security definer
set search_path to 'public'
as $function$
  with o as materialized (
    select (to_jsonb(orders.*) || jsonb_build_object(
      'side_panel_a_w', substring(coalesce(nullif(orders.side_panel_a, ''), orders.side_panel) from '^[0-9]+'),
      'side_panel_a_h', substring(coalesce(nullif(orders.side_panel_a, ''), orders.side_panel) from '[×xX]([0-9]+)'),
      'side_panel_b_w', substring(orders.side_panel_b from '^[0-9]+'),
      'side_panel_b_h', substring(orders.side_panel_b from '[×xX]([0-9]+)'),
      'top_light_w', substring(orders.top_light from '^[0-9]+'),
      'top_light_h', substring(orders.top_light from '[×xX]([0-9]+)')
    )) as j, orders.category
    from orders
    where orders.id = p_order_id
  )
  select m.recipe_id, m.part
  from o, lateral public.recipes_matching(o.category, o.j) m
$function$;

-- preview_order_stock(p_payload): pętla dopasowań (dotąd własna kopia zapytania z distinct on (part))
-- zamieniona na:
--   for v_match in select m.recipe_id, m.part from public.recipes_matching(v_category, v_p) m loop
-- reszta funkcji bez zmian (pełna definicja w bazie; migracja konektorem recipes_matching_inne_wiele_krok2).
--
-- Sprawdzone 27.11: 400 otwartych zleceń STA/Disting/ST — stare i nowe dopasowanie identyczne (1692 wiersze);
-- próba na sucho (DO + raise, wycofana): GEZE TS3000 INOX + okapnik → obie receptury; DORMA LEWE + okapnik → obie;
-- sam GEZE → tylko GEZE.
