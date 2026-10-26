-- =====================================================================
-- ZKP AS 75EI — B1: NUMER KONSTRUKCJI RRRR/ZZ/PP (2026-10-26)
-- ZKP 5.9: każda konstrukcja dostaje PRZED rozpoczęciem produkcji
-- niepowtarzalny numer identyfikacyjny; numer niezmienny, nie wraca do puli.
--
-- Decyzje właściciela (26.10.2026):
--   * format RRRR/ZZ/PP, każda sztuka osobny numer,
--   * ZZ = kolejny numer zlecenia ALUMINIUM w roku (wspólny licznik całej
--     stolarki aluminiowej; reguły ZKP i tak dotyczą tylko pozycji AS 75EI),
--   * numer nadawany przy uruchomieniu zlecenia do produkcji.
--
-- Model:
--   alu_order_counters      — licznik ZZ per rok (blokada wiersza = brak kolizji),
--   alu_production_orders   — zlecenie uruchomione: rok + ZZ, kto i kiedy (serwer),
--   alu_constructions       — wiersz na SZTUKĘ: rok/ZZ/PP jako liczby, tekst numeru
--                             generowany; status aktywna/anulowana, bez kasowania.
-- Synchronizacja ze zmianami pozycji (nowa wersja LP, ręczna zmiana ilości):
--   więcej sztuk → kolejne PP; mniej sztuk / usunięta pozycja → „anulowana"
--   (numer zostaje w bazie). Anulowanie zlecenia anuluje konstrukcje,
--   przywrócenie zlecenia przywraca te anulowane razem z nim.
-- Uruchomionego zlecenia nie da się skasować (FK RESTRICT).
--
-- Wymaga: zkp_00_fundament.sql. Bezpieczne do ponownego uruchomienia.
-- =====================================================================

-- ── 1) Tabele ────────────────────────────────────────────────────────────
create table if not exists public.alu_order_counters (
  year    int primary key,
  last_zz int not null default 0 check (last_zz >= 0)
);

create table if not exists public.alu_production_orders (
  id              bigint generated always as identity primary key,
  order_id        bigint not null unique references public.orders(id) on delete restrict,
  year            int not null,
  zz              int not null check (zz > 0),
  started_at      timestamptz not null default now(),
  started_by      uuid default auth.uid(),
  started_by_name text not null default '',
  constraint alu_production_orders_year_zz_uq unique (year, zz)
);

create table if not exists public.alu_constructions (
  id                bigint generated always as identity primary key,
  order_id          bigint not null references public.orders(id) on delete restrict,
  position_id       bigint references public.order_alu_positions(id) on delete set null,
  pos_no            int not null,           -- migawka nr pozycji (pozycja może zniknąć)
  piece_index       int not null check (piece_index > 0),
  year              int not null,
  zz                int not null check (zz > 0),
  pp                int not null check (pp > 0),
  -- ZKP 5.9: RRRR/ZZ/PP, min. 2 cyfry; > 99 po prostu więcej cyfr (bez lpad — ucinałby)
  construction_no   text generated always as (
    year::text || '/'
    || case when zz < 10 then '0' || zz::text else zz::text end || '/'
    || case when pp < 10 then '0' || pp::text else pp::text end
  ) stored,
  status            text not null default 'aktywna' check (status in ('aktywna', 'anulowana')),
  status_reason     text,
  status_changed_at timestamptz,
  status_changed_by uuid,
  created_at        timestamptz not null default now(),
  created_by        uuid default auth.uid(),
  constraint alu_constructions_numer_uq unique (year, zz, pp)
);

-- jedna AKTYWNA konstrukcja na sztukę pozycji
create unique index if not exists alu_constructions_active_piece_uq
  on public.alu_constructions (position_id, piece_index) where status = 'aktywna';
create index if not exists alu_constructions_order_idx on public.alu_constructions (order_id);

-- ── 2) RLS: odczyt dla zalogowanych, zapis WYŁĄCZNIE przez funkcje ───────
-- (brak polityk INSERT/UPDATE/DELETE = brak ręcznych zmian i kasowania, pkt 10.4)
alter table public.alu_order_counters    enable row level security;
alter table public.alu_production_orders enable row level security;
alter table public.alu_constructions     enable row level security;

drop policy if exists alu_order_counters_read on public.alu_order_counters;
create policy alu_order_counters_read on public.alu_order_counters
  for select to authenticated using (true);
drop policy if exists alu_production_orders_read on public.alu_production_orders;
create policy alu_production_orders_read on public.alu_production_orders
  for select to authenticated using (true);
drop policy if exists alu_constructions_read on public.alu_constructions;
create policy alu_constructions_read on public.alu_constructions
  for select to authenticated using (true);

-- ── 3) Audyt (kto/kiedy z serwera, pkt 10.1) ─────────────────────────────
drop trigger if exists audit_alu_production_orders on public.alu_production_orders;
create trigger audit_alu_production_orders
  after insert or update or delete on public.alu_production_orders
  for each row execute function public.audit_trigger_fn();
drop trigger if exists audit_alu_constructions on public.alu_constructions;
create trigger audit_alu_constructions
  after insert or update or delete on public.alu_constructions
  for each row execute function public.audit_trigger_fn();

-- ── 4) Dopisanie kolejnych sztuk pozycji uruchomionego zlecenia ──────────
-- Kolejne PP w zleceniu; blokada wiersza alu_production_orders serializuje
-- równoległe dopisania (dwóch użytkowników nie dostanie tego samego numeru).
create or replace function public.alu_append_constructions(p_position_id bigint, p_count int)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pos  record;
  v_prod record;
  v_pp   int;
  v_idx  int;
begin
  if coalesce(p_count, 0) <= 0 then
    return;
  end if;
  select * into v_pos from public.order_alu_positions where id = p_position_id;
  if not found then
    return;
  end if;
  select * into v_prod from public.alu_production_orders where order_id = v_pos.order_id for update;
  if not found then
    return;  -- zlecenie nieuruchomione: numery nada start_alu_production
  end if;

  select coalesce(max(pp), 0) into v_pp
  from public.alu_constructions where year = v_prod.year and zz = v_prod.zz;
  select coalesce(max(piece_index), 0) into v_idx
  from public.alu_constructions where position_id = p_position_id and status = 'aktywna';

  insert into public.alu_constructions (order_id, position_id, pos_no, piece_index, year, zz, pp)
  select v_pos.order_id, v_pos.id, v_pos.pos_no, v_idx + g.i, v_prod.year, v_prod.zz, v_pp + g.i
  from generate_series(1, p_count) g(i);
end;
$function$;

revoke all on function public.alu_append_constructions(bigint, int) from public, anon, authenticated;

-- ── 5) Trigger: zmiana ilości / nowa pozycja / usunięcie pozycji ─────────
create or replace function public.alu_positions_sync_constructions()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order_id bigint := coalesce(new.order_id, old.order_id);
  v_active   int;
begin
  if not exists (select 1 from public.alu_production_orders where order_id = v_order_id) then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    -- ZKP 5.9: numer nie wraca do puli — konstrukcja zostaje jako anulowana
    update public.alu_constructions
    set status = 'anulowana', status_reason = 'pozycja usunięta ze zlecenia',
        status_changed_at = now(), status_changed_by = auth.uid()
    where position_id = old.id and status = 'aktywna';
    return old;
  end if;

  select count(*) into v_active
  from public.alu_constructions where position_id = new.id and status = 'aktywna';

  if new.quantity > v_active then
    perform public.alu_append_constructions(new.id, new.quantity - v_active);
  elsif new.quantity < v_active then
    -- zmniejszona ilość: anulujemy sztuki od końca (jak przycinanie etapów)
    update public.alu_constructions
    set status = 'anulowana', status_reason = 'zmniejszona ilość sztuk w pozycji',
        status_changed_at = now(), status_changed_by = auth.uid()
    where id in (
      select id from public.alu_constructions
      where position_id = new.id and status = 'aktywna'
      order by piece_index desc
      limit v_active - new.quantity
    );
  end if;
  return new;
end;
$function$;

revoke all on function public.alu_positions_sync_constructions() from public, anon, authenticated;

drop trigger if exists alu_positions_sync_constructions_upsert on public.order_alu_positions;
create trigger alu_positions_sync_constructions_upsert
  after insert or update of quantity on public.order_alu_positions
  for each row execute function public.alu_positions_sync_constructions();

drop trigger if exists alu_positions_sync_constructions_delete on public.order_alu_positions;
create trigger alu_positions_sync_constructions_delete
  before delete on public.order_alu_positions
  for each row execute function public.alu_positions_sync_constructions();

-- ── 6) Trigger: anulowanie / przywrócenie zlecenia ───────────────────────
create or replace function public.alu_orders_sync_constructions_status()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_was boolean := coalesce((old.extra_fields->>'cancelled')::boolean, false);
  v_is  boolean := coalesce((new.extra_fields->>'cancelled')::boolean, false);
begin
  if v_is and not v_was then
    update public.alu_constructions
    set status = 'anulowana', status_reason = 'zlecenie anulowane',
        status_changed_at = now(), status_changed_by = auth.uid()
    where order_id = new.id and status = 'aktywna';
  elsif v_was and not v_is then
    -- przywracamy tylko to, co zgasło razem ze zleceniem (i tylko gdy sztuka wolna)
    update public.alu_constructions c
    set status = 'aktywna', status_reason = null,
        status_changed_at = now(), status_changed_by = auth.uid()
    where c.order_id = new.id and c.status = 'anulowana' and c.status_reason = 'zlecenie anulowane'
      and not exists (
        select 1 from public.alu_constructions x
        where x.position_id = c.position_id and x.piece_index = c.piece_index and x.status = 'aktywna'
      );
  end if;
  return new;
end;
$function$;

revoke all on function public.alu_orders_sync_constructions_status() from public, anon, authenticated;

drop trigger if exists alu_orders_sync_constructions_status on public.orders;
create trigger alu_orders_sync_constructions_status
  after update of extra_fields on public.orders
  for each row
  when (new.category = 'Aluminium'
        and (old.extra_fields->>'cancelled') is distinct from (new.extra_fields->>'cancelled'))
  execute function public.alu_orders_sync_constructions_status();

-- ── 7) RPC: uruchomienie zlecenia do produkcji = nadanie ZZ i numerów ────
create or replace function public.start_alu_production(p_order_id bigint)
returns table(r_year int, r_zz int, r_count int, r_already_started boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order record;
  v_prod  record;
  v_year  int;
  v_zz    int;
  v_count int;
  v_name  text;
begin
  if not public.current_user_is_manager() then
    raise exception 'Uruchomić zlecenie do produkcji może tylko kierownik';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.category <> 'Aluminium' then
    raise exception 'To nie jest zlecenie aluminium';
  end if;
  if coalesce((v_order.extra_fields->>'cancelled')::boolean, false) then
    raise exception 'Zlecenie % jest anulowane', v_order.order_number;
  end if;

  -- już uruchomione: zwracamy istniejący numer (numer niezmienny, ZKP 5.9)
  select * into v_prod from public.alu_production_orders where order_id = p_order_id;
  if found then
    return query
      select v_prod.year, v_prod.zz,
             (select count(*)::int from public.alu_constructions
              where order_id = p_order_id and status = 'aktywna'),
             true;
    return;
  end if;

  if not exists (select 1 from public.order_alu_positions where order_id = p_order_id) then
    raise exception 'Zlecenie % nie ma pozycji', v_order.order_number;
  end if;

  v_year := extract(year from (now() at time zone 'Europe/Warsaw'))::int;

  -- kolejny ZZ w roku — upsert blokuje wiersz licznika do końca transakcji
  insert into public.alu_order_counters as c (year, last_zz) values (v_year, 1)
  on conflict (year) do update set last_zz = c.last_zz + 1
  returning c.last_zz into v_zz;

  select coalesce(nullif(pr.full_name, ''), nullif(pr.initials, ''), '')
  into v_name from public.profiles pr where pr.id = auth.uid();

  insert into public.alu_production_orders (order_id, year, zz, started_by, started_by_name)
  values (p_order_id, v_year, v_zz, auth.uid(), coalesce(v_name, ''));

  -- PP: kolejno po pozycjach (pos_no), w pozycji po sztukach
  insert into public.alu_constructions (order_id, position_id, pos_no, piece_index, year, zz, pp)
  select p.order_id, p.id, p.pos_no, g.i, v_year, v_zz,
         (row_number() over (order by p.pos_no, g.i))::int
  from public.order_alu_positions p
  cross join lateral generate_series(1, greatest(p.quantity, 1)) g(i)
  where p.order_id = p_order_id;
  get diagnostics v_count = row_count;

  return query select v_year, v_zz, v_count, false;
end;
$function$;

revoke all on function public.start_alu_production(bigint) from public, anon;
grant execute on function public.start_alu_production(bigint) to authenticated, service_role;

-- ── Kontrola ─────────────────────────────────────────────────────────────
select table_name from information_schema.tables
where table_schema = 'public'
  and table_name in ('alu_order_counters', 'alu_production_orders', 'alu_constructions');
-- oczekiwane: 3 wiersze

-- Test kryterium z briefu (B1) — w transakcji z ROLLBACK, nic nie zostaje.
-- Odpal osobno jako zalogowany kierownik albo podmień guard; przykład:
--   begin;
--   select * from start_alu_production(<id zlecenia z 3 pozycjami, jedna ×2>);
--   select construction_no from alu_constructions where order_id = <id> order by pp;
--   -- oczekiwane: 2026/01/01 … 2026/01/04 (pierwsze zlecenie w roku)
--   rollback;
