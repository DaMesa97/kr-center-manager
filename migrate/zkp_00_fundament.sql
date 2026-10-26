-- =====================================================================
-- ZKP AS 75EI — FUNDAMENT (2026-10-26)
-- Brief: docs/zkp/ETAP_A_raport.md pkt 8 krok 0.
--
-- 1) Retencja 10 lat dla aluminium (zał. 6.34, ZKP 5.1.6):
--    a) cleanup_old_logs nie kasuje audytu zleceń/pozycji/dokumentów/konstrukcji aluminium,
--    b) archive_old_orders NIE archiwizuje zleceń Aluminium — archiwizacja kasuje
--       wiersz z `orders`, a pozycje mają ON DELETE CASCADE (zniknęłyby razem
--       z numerami konstrukcji).
-- 2) Audyt (kto/kiedy z serwera, pkt 10.1 briefu) na order_alu_positions i order_documents.
-- 3) Role ZKP na koncie (pkt 10.2): profiles.zkp_roles + helper do RLS;
--    zmienia je tylko admin (rozszerzony trigger protect_profile_privileges).
--
-- Bezpieczne do ponownego uruchomienia. Uruchamia właściciel w SQL Editor.
-- =====================================================================

-- ── 1a) Retencja logów: wyłączenie aluminium / ZKP (zał. 6.34: 10 lat) ───
create or replace function public.cleanup_old_logs()
returns void
language sql
security definer
set search_path to 'public'
as $$
  delete from audit_log
  where created_at < now() - interval '12 months'
    -- ZKP 5.1.6 / zał. 6.34: zapisy stolarki aluminiowej przechowywane 10 lat
    and table_name not in ('order_alu_positions', 'order_documents',
                           'alu_constructions', 'alu_production_orders')
    and not (table_name = 'orders'
             and coalesce(new_data->>'category', old_data->>'category') = 'Aluminium');
  delete from forecast_runs where run_at < now() - interval '90 days';
  delete from api_request_logs where created_at < now() - interval '90 days';
$$;

revoke execute on function public.cleanup_old_logs() from public, anon, authenticated;

-- ── 1b) Archiwizacja: bez zleceń Aluminium (ZKP 5.9 — teczka 10 lat) ─────
-- Treść 1:1 z bazy (stan 2026-10-26) + jeden warunek `o.category <> 'Aluminium'`.
create or replace function public.archive_old_orders__impl(p_months integer default 12)
returns table(r_archived_count integer, r_oldest_archived timestamp with time zone, r_newest_archived timestamp with time zone)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cutoff timestamptz;
  v_cols text;
  v_cols_o text;
  v_count integer := 0;
  v_oldest timestamptz;
  v_newest timestamptz;
begin
  v_cutoff := now() - (p_months || ' months')::interval;

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
    with to_archive as (
      select o.id from orders o
      where o.created_at < %L
        and (o.release_date is not null or (o.extra_fields->>'cancelled' = 'true'))
        -- ZKP 5.9 / zał. 6.34: zlecenia aluminium zostają w `orders` (10 lat,
        -- pozycje i konstrukcje wiszą na nich kluczami obcymi)
        and o.category <> 'Aluminium'
    ),
    ins as (
      insert into orders_archive (%s, photos, archived_at, archived_by, archive_reason)
      select %s,
             (select jsonb_agg(jsonb_build_object(
                'public_url', ph.public_url,
                'storage_path', ph.storage_path,
                'uploaded_by_initials', ph.uploaded_by_initials,
                'created_at', ph.created_at))
              from order_photos ph where ph.order_id = o.id),
             now(), %L::uuid, 'auto-archiwizacja'
      from orders o
      where o.id in (select id from to_archive)
      returning id, created_at
    ),
    del as (
      delete from orders o where o.id in (select id from ins) returning o.id
    )
    select count(*)::int, min(created_at), max(created_at) from ins
  $f$, v_cutoff, v_cols, v_cols_o, auth.uid())
  into v_count, v_oldest, v_newest;

  r_archived_count := v_count;
  r_oldest_archived := v_oldest;
  r_newest_archived := v_newest;
  return next;
end;
$function$;

-- ── 2) Audyt pozycji i dokumentów aluminium (pkt 10.1 briefu) ────────────
-- audit_trigger_fn: auth.uid() + e-mail + now() po stronie serwera, audit_log tylko do odczytu.
drop trigger if exists audit_order_alu_positions on public.order_alu_positions;
create trigger audit_order_alu_positions
  after insert or update or delete on public.order_alu_positions
  for each row execute function public.audit_trigger_fn();

drop trigger if exists audit_order_documents on public.order_documents;
create trigger audit_order_documents
  after insert or update or delete on public.order_documents
  for each row execute function public.audit_trigger_fn();

-- ── 3) Role ZKP na koncie (pkt 10.2 briefu, ZKP 5.3.2) ───────────────────
-- Uzupełniają rolę aplikacji (nie zastępują jej): jedna osoba może być np.
-- kierownikiem_produkcji w aplikacji i jednocześnie kontrolerem w ZKP.
alter table public.profiles
  add column if not exists zkp_roles text[] not null default '{}';

alter table public.profiles drop constraint if exists profiles_zkp_roles_check;
alter table public.profiles add constraint profiles_zkp_roles_check
  check (zkp_roles <@ array['pelnomocnik', 'zastepca', 'kierownik_produkcji', 'kontroler', 'magazyn']::text[]);

-- czy zalogowany ma którąkolwiek z ról ZKP — do polityk RLS i guardów RPC w kolejnych etapach
create or replace function public.current_user_has_zkp_role(p_roles text[])
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and zkp_roles && p_roles
  );
$$;

revoke all on function public.current_user_has_zkp_role(text[]) from public, anon;
grant execute on function public.current_user_has_zkp_role(text[]) to authenticated, service_role;

-- Treść z bazy (stan 2026-10-26) + zkp_roles na liście pól tylko dla admina.
create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    return new;
  end if;
  if (new.role is distinct from old.role
      or new.categories is distinct from old.categories
      or new.department is distinct from old.department
      or new.initials is distinct from old.initials
      or new.full_name is distinct from old.full_name
      or new.zkp_roles is distinct from old.zkp_roles)  -- ZKP 5.3.2
     and not public.current_user_is_admin() then
    raise exception 'Tylko administrator może zmieniać role (także ZKP), kategorie, działy, inicjały i nazwiska';
  end if;
  return new;
end;
$function$;

-- ── Kontrola ─────────────────────────────────────────────────────────────
select tgname from pg_trigger
where tgname in ('audit_order_alu_positions', 'audit_order_documents') and not tgisinternal;
-- oczekiwane: 2 wiersze
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'profiles' and column_name = 'zkp_roles';
-- oczekiwane: 1 wiersz
