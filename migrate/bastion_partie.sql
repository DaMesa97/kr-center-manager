-- =====================================================================
-- BASTION — PARTIE OŚCIEŻNIC REGULOWANYCH / OPASKOWYCH (2026-10-31)
--
-- Odpowiednik arkusza „OŚC.REG. NOWE": kierownik zaznacza zlecenia Bastion
-- z ościeżnicą oznaczoną w słowniku flagą add_to_batch i tworzy z nich partię.
-- Partia ma 7 etapów produkcji paneli/opasek (wspólne dla całej partii,
-- inicjały + data). Skręcanie zostaje NA ZLECENIU (etap oscieznica_skrecanie);
-- partia zamyka się sama, gdy wszystkie jej zlecenia są skręcone, i otwiera
-- z powrotem, gdy ktoś cofnie skręcanie albo dołoży zlecenie.
--
-- Zlecenie może być tylko w jednej partii (unique order_id). Numeracja partii
-- kontynuuje arkusz (ostatnia 33 → pierwsza w systemie 34).
-- Zapis WYŁĄCZNIE przez funkcje bastion_batch_* (RLS: tylko odczyt).
-- Bezpieczne do ponownego uruchomienia.
-- =====================================================================

create table if not exists public.bastion_batches (
  id bigserial primary key,
  batch_no integer not null unique,
  status text not null default 'open' check (status in ('open', 'closed')),
  notes text,
  -- {"panele_cnc": {"v": "AW", "at": "2026-10-31T10:00:00Z", "by": "<uuid>"}, ...}
  stages jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);
comment on table public.bastion_batches is 'Partie ościeżnic regulowanych/opaskowych Bastion (arkusz OŚC.REG. NOWE). Etapy paneli/opasek per partia; skręcanie per zlecenie.';

create table if not exists public.bastion_batch_items (
  batch_id bigint not null references public.bastion_batches(id) on delete cascade,
  order_id bigint not null references public.orders(id) on delete cascade,
  position integer not null default 0,
  added_at timestamptz not null default now(),
  -- kiedy zlecenie dostało etap „ościeżnica skręcanie" (zakres dat skręcania partii)
  screwed_at timestamptz,
  primary key (batch_id, order_id),
  unique (order_id)
);
create index if not exists bastion_batch_items_batch_idx on public.bastion_batch_items (batch_id, position);

alter table public.bastion_batches enable row level security;
alter table public.bastion_batch_items enable row level security;
drop policy if exists bastion_batches_read on public.bastion_batches;
create policy bastion_batches_read on public.bastion_batches for select to authenticated using (true);
drop policy if exists bastion_batch_items_read on public.bastion_batch_items;
create policy bastion_batch_items_read on public.bastion_batch_items for select to authenticated using (true);
grant select on public.bastion_batches, public.bastion_batch_items to authenticated, service_role;

-- słownik: OPASKOWA też idzie w partie (Excel: DREWNIANA OPASKOWA, 2 etykiety)
insert into public.config_options (category, type, value, sort_order, label_multiplier, add_to_batch)
select 'Bastion', 'oscieznica', 'OPASKOWA',
       coalesce((select max(sort_order) from public.config_options where category = 'Bastion' and type = 'oscieznica'), 0) + 1,
       2, true
where not exists (select 1 from public.config_options where category = 'Bastion' and type = 'oscieznica' and upper(value) = 'OPASKOWA');

-- ── etapy partii ────────────────────────────────────────────────────────
create or replace function public.bastion_batch_stage_keys()
returns text[]
language sql
immutable
as $function$
  select array['panele_ciecie', 'panele_frezarki', 'panele_cnc', 'panele_lakiernia', 'panele_oklejarki', 'opaski_ciecie', 'opaski_cnc'];
$function$;

-- kto może odhaczać etapy partii: kierownik albo pracownik z etapami Bastion na stanowisku
create or replace function public.bastion_batch_can_mark()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(auth.role(), '') = 'service_role'
      or public.current_user_is_manager()
      or exists (select 1 from public.worker_stages ws where ws.worker_id = auth.uid() and ws.category = 'Bastion');
$function$;

-- przelicz: screwed_at z etapu zlecenia, status partii
create or replace function public.bastion_batch_recalc(p_batch_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_total integer;
  v_screwed integer;
  v_status text;
begin
  -- zlecenia skręcone bez stempla (np. skręcone zanim trafiły do partii) → stempel teraz;
  -- cofnięte skręcanie → stempel znika
  update bastion_batch_items bi
  set screwed_at = case
    when coalesce(o.production_stages->>'oscieznica_skrecanie', '') <> '' then coalesce(bi.screwed_at, now())
    else null end
  from orders o
  where o.id = bi.order_id and bi.batch_id = p_batch_id
    and (case when coalesce(o.production_stages->>'oscieznica_skrecanie', '') <> '' then coalesce(bi.screwed_at, now()) else null end)
        is distinct from bi.screwed_at;

  select count(*), count(*) filter (where screwed_at is not null)
  into v_total, v_screwed
  from bastion_batch_items where batch_id = p_batch_id;

  select status into v_status from bastion_batches where id = p_batch_id;
  if v_total > 0 and v_screwed = v_total then
    if v_status <> 'closed' then
      update bastion_batches set status = 'closed', closed_at = now(), updated_at = now() where id = p_batch_id;
    end if;
  else
    if v_status <> 'open' then
      update bastion_batches set status = 'open', closed_at = null, updated_at = now() where id = p_batch_id;
    end if;
  end if;
end;
$function$;

-- zmiana etapów zlecenia → stempel skręcania i status partii
create or replace function public.bastion_batch_on_order_stage()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_batch bigint;
begin
  if coalesce(old.production_stages->>'oscieznica_skrecanie', '') is distinct from coalesce(new.production_stages->>'oscieznica_skrecanie', '') then
    select batch_id into v_batch from bastion_batch_items where order_id = new.id;
    if v_batch is not null then
      perform public.bastion_batch_recalc(v_batch);
    end if;
  end if;
  return new;
end;
$function$;
drop trigger if exists trg_bastion_batch_on_order_stage on public.orders;
create trigger trg_bastion_batch_on_order_stage
  after update of production_stages on public.orders
  for each row execute function public.bastion_batch_on_order_stage();

-- walidacja zleceń do partii
create or replace function public.bastion_batch_check_orders(p_order_ids bigint[])
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_bad text;
begin
  if p_order_ids is null or coalesce(array_length(p_order_ids, 1), 0) = 0 then
    raise exception 'Zaznacz co najmniej jedno zlecenie';
  end if;
  select string_agg(x::text, ', ') into v_bad
  from unnest(p_order_ids) x where not exists (select 1 from orders o where o.id = x);
  if v_bad is not null then
    raise exception 'Zlecenia nie istnieją: %', v_bad;
  end if;
  select string_agg(o.order_number, ', ') into v_bad
  from orders o where o.id = any(p_order_ids) and o.category <> 'Bastion';
  if v_bad is not null then
    raise exception 'Do partii trafiają tylko zlecenia Bastion (nie: %)', v_bad;
  end if;
  select string_agg(o.order_number, ', ') into v_bad
  from orders o where o.id = any(p_order_ids) and coalesce((o.extra_fields->>'cancelled')::boolean, false);
  if v_bad is not null then
    raise exception 'Zlecenie anulowane nie wchodzi do partii: %', v_bad;
  end if;
  select string_agg(o.order_number || ' (partia ' || b.batch_no || ')', ', ') into v_bad
  from orders o join bastion_batch_items bi on bi.order_id = o.id join bastion_batches b on b.id = bi.batch_id
  where o.id = any(p_order_ids);
  if v_bad is not null then
    raise exception 'Zlecenie jest już w partii: %', v_bad;
  end if;
end;
$function$;

create or replace function public.bastion_create_batch(p_order_ids bigint[], p_notes text default null)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id bigint;
  v_no integer;
begin
  perform public.assert_manager_or_service();
  perform public.bastion_batch_check_orders(p_order_ids);
  -- numeracja kontynuuje arkusz OŚC.REG. NOWE (ostatnia partia 33)
  select greatest(coalesce(max(batch_no), 0), 33) + 1 into v_no from bastion_batches;
  insert into bastion_batches (batch_no, notes, created_by)
  values (v_no, nullif(trim(coalesce(p_notes, '')), ''), auth.uid())
  returning id into v_id;
  insert into bastion_batch_items (batch_id, order_id, position)
  select v_id, x.id, x.ord
  from unnest(p_order_ids) with ordinality as x(id, ord);
  perform public.bastion_batch_recalc(v_id);
  begin
    insert into audit_log (table_name, record_id, operation, user_id, new_data)
    values ('bastion_batches', v_id::text, 'INSERT', auth.uid(),
            jsonb_build_object('action', 'create_batch', 'batch_no', v_no, 'order_ids', to_jsonb(p_order_ids)));
  exception when others then null;
  end;
  return v_id;
end;
$function$;

create or replace function public.bastion_batch_add_orders(p_batch_id bigint, p_order_ids bigint[])
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pos integer;
begin
  perform public.assert_manager_or_service();
  if not exists (select 1 from bastion_batches where id = p_batch_id) then
    raise exception 'Partia % nie istnieje', p_batch_id;
  end if;
  perform public.bastion_batch_check_orders(p_order_ids);
  select coalesce(max(position), 0) into v_pos from bastion_batch_items where batch_id = p_batch_id;
  insert into bastion_batch_items (batch_id, order_id, position)
  select p_batch_id, x.id, v_pos + x.ord
  from unnest(p_order_ids) with ordinality as x(id, ord);
  update bastion_batches set updated_at = now() where id = p_batch_id;
  perform public.bastion_batch_recalc(p_batch_id);
end;
$function$;

create or replace function public.bastion_batch_remove_order(p_batch_id bigint, p_order_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.assert_manager_or_service();
  delete from bastion_batch_items where batch_id = p_batch_id and order_id = p_order_id;
  if not found then
    raise exception 'Zlecenia nie ma w tej partii';
  end if;
  update bastion_batches set updated_at = now() where id = p_batch_id;
  perform public.bastion_batch_recalc(p_batch_id);
end;
$function$;

create or replace function public.bastion_delete_batch(p_batch_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_no integer;
  v_n integer;
begin
  perform public.assert_manager_or_service();
  select batch_no into v_no from bastion_batches where id = p_batch_id;
  if v_no is null then
    raise exception 'Partia % nie istnieje', p_batch_id;
  end if;
  select count(*) into v_n from bastion_batch_items where batch_id = p_batch_id;
  delete from bastion_batches where id = p_batch_id;
  begin
    insert into audit_log (table_name, record_id, operation, user_id, new_data)
    values ('bastion_batches', p_batch_id::text, 'DELETE', auth.uid(),
            jsonb_build_object('action', 'delete_batch', 'batch_no', v_no, 'orders', v_n));
  exception when others then null;
  end;
end;
$function$;

-- etap partii: p_value = inicjały (odhaczenie) albo '' (cofnięcie)
create or replace function public.bastion_batch_set_stage(p_batch_id bigint, p_stage_key text, p_value text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_stages jsonb;
begin
  if not public.bastion_batch_can_mark() then
    raise exception 'Brak uprawnień do oznaczania etapów partii (etapy Bastion nie są przypisane do Twojego stanowiska)';
  end if;
  if not (p_stage_key = any(public.bastion_batch_stage_keys())) then
    raise exception 'Nieznany etap partii: %', p_stage_key;
  end if;
  select stages into v_stages from bastion_batches where id = p_batch_id for update;
  if v_stages is null then
    raise exception 'Partia % nie istnieje', p_batch_id;
  end if;
  if coalesce(trim(p_value), '') = '' then
    v_stages := v_stages - p_stage_key;
  else
    v_stages := v_stages || jsonb_build_object(p_stage_key, jsonb_build_object('v', trim(p_value), 'at', now(), 'by', auth.uid()));
  end if;
  update bastion_batches set stages = v_stages, updated_at = now() where id = p_batch_id;
  return v_stages;
end;
$function$;

create or replace function public.bastion_batch_set_notes(p_batch_id bigint, p_notes text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.assert_manager_or_service();
  update bastion_batches set notes = nullif(trim(coalesce(p_notes, '')), ''), updated_at = now() where id = p_batch_id;
  if not found then
    raise exception 'Partia % nie istnieje', p_batch_id;
  end if;
end;
$function$;

-- przegląd partii z pozycjami (jedno zapytanie dla UI)
create or replace view public.bastion_batches_overview as
select
  b.id, b.batch_no, b.status, b.notes, b.stages, b.created_at, b.created_by, b.updated_at, b.closed_at,
  count(bi.order_id)::integer as items_count,
  count(bi.order_id) filter (where bi.screwed_at is not null)::integer as screwed_count,
  min(bi.screwed_at) as screwed_from,
  max(bi.screwed_at) as screwed_to,
  coalesce(array_agg(bi.order_id order by bi.position, bi.order_id) filter (where bi.order_id is not null), array[]::bigint[]) as order_ids,
  coalesce(array_agg(o.order_number order by bi.position, bi.order_id) filter (where bi.order_id is not null), array[]::text[]) as order_numbers,
  coalesce(array_agg((bi.screwed_at is not null) order by bi.position, bi.order_id) filter (where bi.order_id is not null), array[]::boolean[]) as order_screwed
from bastion_batches b
left join bastion_batch_items bi on bi.batch_id = b.id
left join orders o on o.id = bi.order_id
group by b.id;
grant select on public.bastion_batches_overview to authenticated, service_role;

revoke all on function public.bastion_create_batch(bigint[], text) from public, anon;
revoke all on function public.bastion_batch_add_orders(bigint, bigint[]) from public, anon;
revoke all on function public.bastion_batch_remove_order(bigint, bigint) from public, anon;
revoke all on function public.bastion_delete_batch(bigint) from public, anon;
revoke all on function public.bastion_batch_set_stage(bigint, text, text) from public, anon;
revoke all on function public.bastion_batch_set_notes(bigint, text) from public, anon;
revoke all on function public.bastion_batch_recalc(bigint) from public, anon, authenticated;
revoke all on function public.bastion_batch_check_orders(bigint[]) from public, anon, authenticated;
grant execute on function public.bastion_create_batch(bigint[], text), public.bastion_batch_add_orders(bigint, bigint[]),
  public.bastion_batch_remove_order(bigint, bigint), public.bastion_delete_batch(bigint),
  public.bastion_batch_set_stage(bigint, text, text), public.bastion_batch_set_notes(bigint, text),
  public.bastion_batch_can_mark(), public.bastion_batch_stage_keys() to authenticated, service_role;

-- realtime dla partii (odświeżanie panelu u innych)
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'bastion_batches') then
    alter publication supabase_realtime add table public.bastion_batches;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'bastion_batch_items') then
    alter publication supabase_realtime add table public.bastion_batch_items;
  end if;
exception when others then
  raise notice 'realtime publication: %', sqlerrm;
end $$;
