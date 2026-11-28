-- 28.11.2026 (testy 27.11 (runda 3) — noc 28.11; ŚREDNI): przywracanie zlecenia z archiwum.
-- 1) restore_from_archive__impl gubiło zdjęcia: archiwizacja zapisuje je w orders_archive.photos (jsonb), a order_photos
--    kasuje kaskadą — przywrócenie wstawiało tylko wiersz orders, bez zdjęć.
-- 2) Wstawienie przywracanego wiersza do orders odpalało triggery „nowego zlecenia” — 6 fałszywych powiadomień
--    „Zamówienie do weryfikacji” dla wydanego zlecenia 15390 (i potencjalnie „Błąd Optimy”).
-- Teraz:
--  - pomocnik public.notify_muted(): true, gdy w transakcji ustawiono app.restoring = '1';
--  - notify_managers_new_review i notify_erp_error na czas przywracania nic nie wysyłają;
--  - restore_from_archive__impl ustawia app.restoring tylko na czas wstawienia (potem czyści), odtwarza order_photos
--    z photos (bez dubli po storage_path);
--  - archive_old_orders__impl zapisuje w photos także uploaded_by (przy przywróceniu wraca, jeśli konto nadal istnieje;
--    starsze archiwa nie mają tego pola — wtedy uploaded_by = null, inicjały zostają).
-- Wymaga 20261128010000 (te same funkcje powiadomień, łatka na innym miejscu — kolejność bez znaczenia).
-- DO WDROŻENIA (nie wgrane w sesji).

create or replace function public.notify_muted()
returns boolean
language sql
stable
set search_path = public
as $$
  -- przywracanie z archiwum: bez powiadomień „nowego zlecenia” (testy 27.11 (runda 3), noc 28.11)
  select coalesce(current_setting('app.restoring', true), '') = '1';
$$;

comment on function public.notify_muted() is
  'True w trakcie przywracania z archiwum (app.restoring = 1) — funkcje powiadomień wtedy nic nie wysyłają.';

revoke all on function public.notify_muted() from public, anon;
grant execute on function public.notify_muted() to authenticated, service_role;

do $$
declare
  d text;
  v_mark text := 'public.notify_muted()';
  stare text;
begin
  -- a) „do weryfikacji”
  d := pg_get_functiondef('public.notify_managers_new_review()'::regprocedure);
  stare := 'IF NEW.source IN (''bot'', ''excel'') AND v_needs_review THEN';
  if position(v_mark in d) > 0 then
    raise notice 'notify_managers_new_review: już poprawione — bez zmian';
  elsif position(stare in d) = 0 then
    raise exception 'notify_managers_new_review: nie znaleziono miejsca łatki — sprawdź definicję';
  else
    execute replace(d, stare,
      'IF NEW.source IN (''bot'', ''excel'') AND v_needs_review AND NOT ' || v_mark || ' THEN');
  end if;

  -- b) błąd Optimy
  d := pg_get_functiondef('public.notify_erp_error()'::regprocedure);
  stare := 'if coalesce(new.erp_status, '''') <> ''NIEPOMYŚLNY'' then';
  if position(v_mark in d) > 0 then
    raise notice 'notify_erp_error: już poprawione — bez zmian';
  elsif position(stare in d) = 0 then
    raise exception 'notify_erp_error: nie znaleziono miejsca łatki — sprawdź definicję';
  else
    execute replace(d, stare,
      'if coalesce(new.erp_status, '''') <> ''NIEPOMYŚLNY'' or ' || v_mark || ' then');
  end if;

  -- c) archiwizacja zapisuje też uploaded_by zdjęcia
  d := pg_get_functiondef('public.archive_old_orders__impl(integer)'::regprocedure);
  stare := '''uploaded_by_initials'', ph.uploaded_by_initials,';
  if position('''uploaded_by'', ph.uploaded_by,' in d) > 0 then
    raise notice 'archive_old_orders__impl: już poprawione — bez zmian';
  elsif position(stare in d) = 0 then
    raise exception 'archive_old_orders__impl: nie znaleziono miejsca łatki — sprawdź definicję';
  else
    execute replace(d, stare, stare || E'\n                ''uploaded_by'', ph.uploaded_by,');
  end if;
end $$;

create or replace function public.restore_from_archive__impl(p_order_id bigint)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_cols text;
  v_found boolean;
begin
  select exists(select 1 from orders_archive where id = p_order_id) into v_found;
  if not v_found then
    return false;
  end if;

  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position)
  into v_cols
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'orders'
    and exists (
      select 1 from information_schema.columns a
      where a.table_schema = 'public' and a.table_name = 'orders_archive'
        and a.column_name = c.column_name
    );

  -- przywrócenie to nie nowe zlecenie: bez powiadomień „do weryfikacji” / „błąd Optimy”
  -- (testy 27.11 (runda 3), noc 28.11: app.restoring)
  perform set_config('app.restoring', '1', true);
  execute format(
    'insert into orders (%s) select %s from orders_archive where id = %L',
    v_cols, v_cols, p_order_id
  );
  perform set_config('app.restoring', '', true);

  -- zdjęcia z orders_archive.photos z powrotem do order_photos (testy 27.11 (runda 3), noc 28.11)
  insert into order_photos (order_id, storage_path, public_url, uploaded_by, uploaded_by_initials, created_at)
  select p_order_id,
         ph->>'storage_path',
         ph->>'public_url',
         (select u.id from auth.users u where u.id::text = ph->>'uploaded_by'),
         nullif(ph->>'uploaded_by_initials', ''),
         coalesce((ph->>'created_at')::timestamptz, now())
  from orders_archive a
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(a.photos) = 'array' then a.photos else '[]'::jsonb end) ph
  where a.id = p_order_id
    and coalesce(ph->>'storage_path', '') <> ''
    and coalesce(ph->>'public_url', '') <> ''
    and not exists (
      select 1 from order_photos x where x.order_id = p_order_id and x.storage_path = ph->>'storage_path'
    );

  delete from orders_archive where id = p_order_id;
  return true;
end;
$function$;

revoke all on function public.restore_from_archive__impl(bigint) from public, anon, authenticated;
grant execute on function public.restore_from_archive__impl(bigint) to service_role;
