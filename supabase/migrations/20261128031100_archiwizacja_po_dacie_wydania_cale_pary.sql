-- 28.11.2026 — decyzja D26 (właściciel: TAK): archiwizacja po dacie wydania, pary i Titany tylko w całości.
-- Było: archive_old_orders__impl brało zlecenia założone (created_at) > 12 mies. temu i zamknięte (wydane albo
-- anulowane). Skutki: zlecenie założone dawno, a wydane w zeszłym miesiącu, znikało z bieżących list; archiwizacja
-- zrywała pary (orders_linked_order_id_fkey ON DELETE SET NULL — runda 6: 195 otwartych nóg traciło partnera)
-- i rozbijała zestawy Titan (STA + ST + Bastion, extra_fields.titan_group).
-- Teraz zlecenie (poza Aluminium — bez zmian, ZKP 10 lat) kwalifikuje się, gdy:
--   * jest wydane i data wydania jest starsza niż p_months miesięcy, albo
--   * jest anulowane (bez daty wydania) i data anulowania (extra_fields.cancelled_at; brak/zła → created_at)
--     jest starsza niż p_months,
--   * ORAZ zostało założone wcześniej niż p_months temu (bezpiecznik: import historii ma daty wydania sprzed lat —
--     3646 zleceń z datą wydania > 12 mies.; bez bezpiecznika zniknęłyby ze statystyk w pierwszą noc po wgraniu.
--     Zlecenia założone w normalnym trybie mają wydanie po założeniu, więc dla nich liczy się data wydania.
--     Pierwsze zlecenia w bazie są z 06.2026 — do 06.2027 archiwizacja nic nie przeniesie).
--   * Grupa (para linked_order_id w obie strony + wszystkie zlecenia z tym samym titan_group) idzie do archiwum
--     tylko w całości: jeśli któraś noga się nie kwalifikuje (otwarta, świeżo wydana, Aluminium), zostaje cała
--     grupa. Sprawdzane do skutku (pętla), więc łańcuchy powiązań też są całe.
-- Zdjęcia w orders_archive.photos z uploaded_by (jak w 20261128010300 — tamten plik po tym uzna łatkę za zrobioną,
-- kolejność dowolna). Zwracane r_oldest/newest_archived nadal z created_at (tylko do archive_run_log).
-- Niezrobione (opisane w raporcie D26): reklamacje / partie Bastion / WZ nadal tracą powiązanie przy archiwizacji,
-- statystyki nie czytają orders_archive — do zrobienia przed 06.2027.
-- DO WDROŻENIA (nie wgrane). Samodzielny.

create or replace function public.archiwum_data_bezpieczna(p text)
 returns date
 language plpgsql
 immutable
 set search_path to 'public'
as $function$
begin
  if p is null or p !~ '^\d{4}-\d{2}-\d{2}' then
    return null;
  end if;
  return left(p, 10)::date;
exception when others then
  return null;
end;
$function$;

revoke all on function public.archiwum_data_bezpieczna(text) from public, anon, authenticated;

create or replace function public.archive_old_orders__impl(p_months integer default 12)
 returns table(r_archived_count integer, r_oldest_archived timestamp with time zone, r_newest_archived timestamp with time zone)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_cutoff timestamptz;
  v_cutoff_d date;
  v_cols text;
  v_cols_o text;
  v_cand bigint[];
  v_next bigint[];
  v_count integer := 0;
  v_oldest timestamptz;
  v_newest timestamptz;
begin
  v_cutoff := now() - (p_months || ' months')::interval;
  v_cutoff_d := v_cutoff::date;

  -- D26: kandydaci po dacie wydania / anulowania (+ bezpiecznik created_at)
  select coalesce(array_agg(o.id), '{}')
  into v_cand
  from orders o
  where o.category is distinct from 'Aluminium'
    and o.created_at < v_cutoff
    and (
      (o.release_date is not null and o.release_date < v_cutoff_d)
      or (o.release_date is null
          and o.extra_fields->>'cancelled' = 'true'
          and coalesce(archiwum_data_bezpieczna(o.extra_fields->>'cancelled_at'), o.created_at::date) < v_cutoff_d)
    );

  -- D26: para / Titan tylko w całości — wyrzucamy kandydata, którego powiązane zlecenie nie jest kandydatem
  loop
    with rel as (
      select o.id as c, o.linked_order_id as p
      from orders o
      where o.id = any(v_cand) and o.linked_order_id is not null
      union all
      select o.linked_order_id, o.id
      from orders o
      where o.linked_order_id = any(v_cand)
      union all
      select a.id, b.id
      from orders a
      join orders b on b.extra_fields->>'titan_group' = a.extra_fields->>'titan_group' and b.id <> a.id
      where a.id = any(v_cand) and a.extra_fields->>'titan_group' is not null
    )
    select coalesce(array_agg(c.id), '{}')
    into v_next
    from unnest(v_cand) as c(id)
    where not exists (select 1 from rel where rel.c = c.id and not (rel.p = any(v_cand)));

    exit when cardinality(v_next) = cardinality(v_cand);
    v_cand := v_next;
  end loop;

  if cardinality(v_cand) = 0 then
    r_archived_count := 0;
    r_oldest_archived := null;
    r_newest_archived := null;
    return next;
    return;
  end if;

  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position),
         string_agg('o.' || quote_ident(c.column_name), ', ' order by c.ordinal_position)
  into v_cols, v_cols_o
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'orders'
    and exists (
      select 1 from information_schema.columns a
      where a.table_schema = 'public' and a.table_name = 'orders_archive'
        and a.column_name = c.column_name
    );

  execute format($f$
    with ins as (
      insert into orders_archive (%s, photos, archived_at, archived_by, archive_reason)
      select %s,
             (select jsonb_agg(jsonb_build_object(
                'public_url', ph.public_url,
                'storage_path', ph.storage_path,
                'uploaded_by_initials', ph.uploaded_by_initials,
                'uploaded_by', ph.uploaded_by,
                'created_at', ph.created_at))
              from order_photos ph where ph.order_id = o.id),
             now(), $2, 'auto-archiwizacja'
      from orders o
      where o.id = any($1)
      returning id, created_at
    ),
    del as (
      delete from orders o where o.id in (select id from ins) returning o.id
    )
    select count(*)::int, min(created_at), max(created_at) from ins
  $f$, v_cols, v_cols_o)
  into v_count, v_oldest, v_newest
  using v_cand, auth.uid();

  r_archived_count := v_count;
  r_oldest_archived := v_oldest;
  r_newest_archived := v_newest;
  return next;
end;
$function$;

revoke all on function public.archive_old_orders__impl(integer) from public, anon, authenticated;
