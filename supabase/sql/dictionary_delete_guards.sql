-- beta.97 (#105, Łukasz 12.11.2026): pozycje słowników (config_options) i kontrahenci
-- (companies) użyte w zamówieniach nie znikają fizycznie. Aplikacja najpierw liczy
-- użycia (RPC) i pokazuje komunikat; trigger BEFORE DELETE jest twardym bezpiecznikiem
-- także dla zapisów spoza aplikacji. Zastosowane 13.11.2026 jako migracja
-- `dictionary_delete_guards`.

-- Ile zamówień (aktywnych + archiwum) używa wartości słownika. Mapowanie
-- typ → kolumna jak w mapConfigTypeToFormField (src/utils.ts); dodatkowo zawsze
-- extra_fields->>typ (Wewnetrzne, Bastion „reszta”). Porównanie bez wielkości
-- liter i spacji na brzegach.
create or replace function public.config_option_usage(p_category text, p_type text, p_value text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_cols    text[];
  v_where   text;
  v_orders  integer := 0;
  v_archive integer := 0;
  v_val     text := lower(trim(coalesce(p_value, '')));
  v_cat     text := case when p_category = 'Wewnetrzne' then 'DrzwiWewnetrzne' else p_category end;
begin
  if v_val = '' then
    return jsonb_build_object('orders', 0, 'archive', 0, 'total', 0);
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
    when 'zaczep'            then array['zaczep']
    when 'panel'             then array['decorative_panel']
    when 'oscieznica'        then array['bastion_frame_type']
    when 'zakres'            then array['bastion_frame_range']
    when 'kolekcja'          then array['bastion_collection']
    when 'wentylacja'        then array['wentylacja']
    else array[]::text[]
  end;

  -- Bastion „Reszta — pozycje” to podpowiedzi opisu w bastion_extras, nie kolumna zamówienia
  if p_category = 'Bastion' and p_type = 'reszta' then
    select count(*) into v_orders from public.bastion_extras where lower(trim(description)) = v_val;
    return jsonb_build_object('orders', v_orders, 'archive', 0, 'total', v_orders);
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

  return jsonb_build_object('orders', v_orders, 'archive', v_archive, 'total', v_orders + v_archive);
end;
$$;

grant execute on function public.config_option_usage(text, text, text) to authenticated;

create or replace function public.config_options_guard_delete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  u jsonb;
begin
  u := public.config_option_usage(old.category, old.type, old.value);
  if (u->>'total')::integer > 0 then
    raise exception 'Wartość „%” (% / %) jest użyta w % zamówieniach (% aktywnych, % w archiwum) — nie można jej usunąć. Zmień nazwę albo zostaw ją w słowniku.',
      old.value, old.category, old.type, u->>'total', u->>'orders', u->>'archive'
      using errcode = 'P0405';
  end if;
  return old;
end;
$$;

drop trigger if exists config_options_guard_delete on public.config_options;
create trigger config_options_guard_delete
  before delete on public.config_options
  for each row execute function public.config_options_guard_delete();

-- Kontrahent: zamówienia trzymają nazwę firmy jako tekst (snapshot), więc liczymy po nazwie.
create or replace function public.company_usage(p_name text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_orders  integer := 0;
  v_archive integer := 0;
  v_name    text := lower(trim(coalesce(p_name, '')));
begin
  if v_name = '' then
    return jsonb_build_object('orders', 0, 'archive', 0, 'total', 0);
  end if;
  select count(*) into v_orders  from public.orders         where lower(trim(company)) = v_name;
  select count(*) into v_archive from public.orders_archive where lower(trim(company)) = v_name;
  return jsonb_build_object('orders', v_orders, 'archive', v_archive, 'total', v_orders + v_archive);
end;
$$;

grant execute on function public.company_usage(text) to authenticated;

create or replace function public.companies_guard_delete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  u jsonb;
begin
  u := public.company_usage(old.name);
  if (u->>'total')::integer > 0 then
    raise exception 'Kontrahent „%” ma % zamówień (% aktywnych, % w archiwum) — nie można go usunąć. Popraw dane zamiast usuwać.',
      old.name, u->>'total', u->>'orders', u->>'archive'
      using errcode = 'P0406';
  end if;
  return old;
end;
$$;

drop trigger if exists companies_guard_delete on public.companies;
create trigger companies_guard_delete
  before delete on public.companies
  for each row execute function public.companies_guard_delete();
