-- 28.11.2026 (testy 27.11 (runda 3) — noc 28.11; WYSOKI): bezpiecznik słownika przepuścił usunięcie STA / kolor / CZARNY,
-- choć 82 zlecenia STA mają ościeżnicę CZARNY, a receptura magazynu ma ten kolor w kryteriach.
-- Przyczyny w config_option_usage:
--  a) typ 'kolor' liczył tylko wing_color — a w kategoriach bez osobnego słownika 'kolor_oscieznicy' (STA, ST, Disting,
--     Techniczne) formularz zlecenia bierze kolor ościeżnicy z tego samego słownika 'kolor'
--     (OrderFormModal: options = kolor_oscieznicy ?? kolor);
--  b) nie patrzył na receptury magazynu (warehouse_recipe_criteria.allowed_values + stare kolumny warehouse_recipes),
--     wykluczenia konfiguratora (config_exclusions) ani reguły Bastion (bastion_rules).
-- Teraz config_option_usage zwraca dodatkowo: recipes, exclusions, rules, recipe_names (do 3) oraz total_all.
-- 'orders' / 'archive' / 'total' bez zmian (aplikacja: useConfig.handleDeleteConfigOption pokazuje je jako „zamówienia”).
-- Trigger config_options_guard_delete blokuje usunięcie, gdy total_all > 0, z komunikatem, gdzie wartość jest użyta.
-- Wartości kryteriów: tablica; dla pewności każdy element dzielimy też po „|”; porównanie jak w recipes_matching
-- (_recipe_norm: wielkość liter, polskie znaki, spacje).
-- DO WDROŻENIA (nie wgrane w sesji).

create or replace function public.config_option_usage(p_category text, p_type text, p_value text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_cols    text[];
  v_where   text;
  v_orders  integer := 0;
  v_archive integer := 0;
  v_recipes integer := 0;
  v_excl    integer := 0;
  v_rules   integer := 0;
  v_names   text[];
  v_val     text := lower(trim(coalesce(p_value, '')));
  v_norm    text := public._recipe_norm(p_value);
  v_cat     text := case when p_category = 'Wewnetrzne' then 'DrzwiWewnetrzne' else p_category end;
begin
  if v_val = '' then
    return jsonb_build_object('orders', 0, 'archive', 0, 'total', 0,
                              'recipes', 0, 'exclusions', 0, 'rules', 0, 'total_all', 0);
  end if;

  v_cols := case p_type
    when 'system'            then array['system']
    when 'model'             then array['model']
    when 'kolor'             then array['wing_color']
    when 'kolor_oscieznicy'  then array['frame_color']
    when 'kolor_progu'       then array['threshold_color']
    when 'prog'              then array['prog', 'threshold_color']
    when 'rozmiar'           then array['width']
    when 'wysokosc'          then array['height']
    when 'szklenie'          then array['glazing']
    when 'szklenie_dostawki' then array['top_light_glazing', 'side_panel_glazing', 'side_panel_a_glazing', 'side_panel_b_glazing']
    when 'wizjer'            then array['peephole']
    when 'okucia'            then array['hardware']
    when 'pochwyt'           then array['handle']
    when 'oslonki'           then array['oslonki']
    when 'samozamykacz'      then array['samozamykacz']
    when 'zaczep'            then array['zaczep']
    when 'panel'             then array['decorative_panel']
    when 'oscieznica'        then array['bastion_frame_type']
    when 'zakres'            then array['bastion_frame_range']
    when 'kolekcja'          then array['bastion_collection']
    when 'wentylacja'        then array['wentylacja']
    else array[]::text[]
  end;

  -- testy 27.11 (runda 3), noc 28.11: kolor ościeżnicy ze słownika 'kolor', gdy kategoria nie ma 'kolor_oscieznicy'
  if p_type = 'kolor' and not exists (
       select 1 from public.config_options o where o.category = p_category and o.type = 'kolor_oscieznicy') then
    v_cols := v_cols || array['frame_color'];
  end if;

  -- Bastion „Reszta — pozycje” to podpowiedzi opisu w bastion_extras, nie kolumna zamówienia
  if p_category = 'Bastion' and p_type = 'reszta' then
    select count(*) into v_orders from public.bastion_extras where lower(trim(description)) = v_val;
    return jsonb_build_object('orders', v_orders, 'archive', 0, 'total', v_orders,
                              'recipes', 0, 'exclusions', 0, 'rules', 0, 'total_all', v_orders);
  end if;

  select string_agg(format('lower(trim(%I::text)) = %L', c, v_val), ' or ')
    into v_where
    from unnest(v_cols) as c;
  v_where := concat_ws(' or ', v_where, format('lower(trim(extra_fields->>%L)) = %L', p_type, v_val));
  -- Bastion ościeżnice: słownik ma rdzeń („REGULOWANA”), zamówienie pełną nazwę
  -- („DREWNIANA REGULOWANA”) — dopasowanie jak bastionFrameOptionForOrder (zawieranie)
  if p_category = 'Bastion' and p_type = 'oscieznica' then
    v_where := concat_ws(' or ', v_where,
      format('lower(bastion_frame_type) like %L', '%' || v_val || '%'),
      format('lower(extra_fields->>''oscieznica_typ'') like %L', '%' || v_val || '%'));
  end if;

  execute format('select count(*) from public.orders where category = %L and (%s)', v_cat, v_where)
    into v_orders;
  execute format('select count(*) from public.orders_archive where category = %L and (%s)', v_cat, v_where)
    into v_archive;

  if coalesce(array_length(v_cols, 1), 0) > 0 then
    -- receptury magazynu: kryteria (tablica, element może mieć „a|b”) i stare kolumny receptury
    with hit as (
      select r.id, r.name
      from public.warehouse_recipes r
      where r.category in (p_category, v_cat)
        and (
          exists (
            select 1 from public.warehouse_recipe_criteria c
            cross join lateral unnest(c.allowed_values) av(v)
            cross join lateral regexp_split_to_table(av.v, '\|') s(v)
            where c.recipe_id = r.id and c.field = any (v_cols)
              and public._recipe_norm(s.v) = v_norm
          )
          or exists (
            select 1
            from jsonb_each_text(to_jsonb(r)) j(k, v)
            cross join lateral regexp_split_to_table(j.v, '\|') s(v)
            where j.k = any (v_cols) and public._recipe_norm(s.v) = v_norm
          )
        )
    )
    select count(*), (array_agg(h.name order by h.id))[1:3] into v_recipes, v_names from hit h;

    -- wykluczenia konfiguratora (pole źródłowe albo docelowe)
    select count(*) into v_excl
    from public.config_exclusions e
    where e.category in (p_category, v_cat)
      and (
        (e.source_field = any (v_cols) and exists (
           select 1 from regexp_split_to_table(e.source_value, '\|') s(v) where public._recipe_norm(s.v) = v_norm))
        or
        (e.target_field = any (v_cols) and exists (
           select 1 from regexp_split_to_table(e.target_value, '\|') s(v) where public._recipe_norm(s.v) = v_norm))
      );
  end if;

  -- reguły Bastion (warunki systemu / ościeżnicy / szerokości i wartość docelowa)
  if v_cat = 'Bastion' then
    select count(*) into v_rules
    from public.bastion_rules b
    where (p_type = 'system' and exists (select 1 from unnest(b.when_system) w(v) where public._recipe_norm(w.v) = v_norm))
       or (p_type = 'oscieznica' and exists (select 1 from unnest(b.when_frame) w(v) where public._recipe_norm(w.v) like '%' || v_norm || '%'))
       or (p_type = 'rozmiar' and exists (select 1 from unnest(b.when_width) w(v) where public._recipe_norm(w.v) = v_norm))
       or (b.target = any (v_cols) and (
             public._recipe_norm(b.value) = v_norm
             or exists (select 1 from unnest(b.when_target_not_in) w(v) where public._recipe_norm(w.v) = v_norm)));
  end if;

  return jsonb_build_object(
    'orders', v_orders, 'archive', v_archive, 'total', v_orders + v_archive,
    'recipes', v_recipes, 'recipe_names', coalesce(to_jsonb(v_names), '[]'::jsonb),
    'exclusions', v_excl, 'rules', v_rules,
    'total_all', v_orders + v_archive + v_recipes + v_excl + v_rules);
end;
$function$;

revoke all on function public.config_option_usage(text, text, text) from public, anon;
grant execute on function public.config_option_usage(text, text, text) to authenticated, service_role;

create or replace function public.config_options_guard_delete()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  u jsonb;
  v_gdzie text;
begin
  u := public.config_option_usage(old.category, old.type, old.value);
  -- testy 27.11 (runda 3), noc 28.11: także receptury, wykluczenia, reguły Bastion
  if coalesce((u->>'total_all')::integer, (u->>'total')::integer, 0) > 0 then
    v_gdzie := concat_ws('; ',
      case when (u->>'total')::integer > 0 then
        format('zamówienia: %s (%s aktywnych, %s w archiwum)', u->>'total', u->>'orders', u->>'archive') end,
      case when (u->>'recipes')::integer > 0 then
        format('receptury magazynu: %s (%s)', u->>'recipes',
               (select string_agg(x, ', ') from jsonb_array_elements_text(u->'recipe_names') x)) end,
      case when (u->>'exclusions')::integer > 0 then
        format('wykluczenia konfiguratora: %s', u->>'exclusions') end,
      case when (u->>'rules')::integer > 0 then
        format('reguły Bastion: %s', u->>'rules') end);
    raise exception 'Wartość „%” (% / %) jest używana — nie można jej usunąć. Gdzie: %. Zmień nazwę albo zostaw ją w słowniku.',
      old.value, old.category, old.type, v_gdzie
      using errcode = 'P0405';
  end if;
  return old;
end;
$function$;
