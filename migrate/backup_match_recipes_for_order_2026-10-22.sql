-- BACKUP 2026-10-22: definicja match_recipes_for_order przed WITH ... AS MATERIALIZED
CREATE OR REPLACE FUNCTION public.match_recipes_for_order(p_order_id bigint)
 RETURNS TABLE(recipe_id bigint, part text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with o as (
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
  ),
  cand as (
    select
      r.id,
      r.part,
      (select count(*) from warehouse_recipe_criteria c where c.recipe_id = r.id) as crit_count
    from warehouse_recipes r, o
    where r.is_active
      and r.category = o.category
      and not exists (
        select 1
        from warehouse_recipe_criteria c
        where c.recipe_id = r.id
          and not exists (
            select 1 from unnest(c.allowed_values) v
            where upper(trim(coalesce(o.j ->> c.field, ''))) = upper(trim(v))
               or (
                 trim(v) ~ '^[0-9]+\s*-\s*[0-9]+$'
                 and coalesce(o.j ->> c.field, '') ~ '^[0-9]+$'
                 and (o.j ->> c.field)::numeric
                     between split_part(replace(trim(v), ' ', ''), '-', 1)::numeric
                         and split_part(replace(trim(v), ' ', ''), '-', 2)::numeric
               )
          )
      )
  )
  select distinct on (cand.part) cand.id, cand.part
  from cand
  order by cand.part, cand.crit_count desc, cand.id desc
$function$

;
