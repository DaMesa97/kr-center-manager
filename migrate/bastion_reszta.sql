-- =====================================================================
-- BASTION — „RESZTA" (2026-10-31): drobne zamówienia bez drzwi (progi BOLD,
-- opaski, zabudowy kątowe, poszerzenia…), odpowiednik arkusza „Reszta".
-- Własna numeracja (arkusz skończył na 362 → od 363), 4 etapy jak w arkuszu
-- (ościeżnica CNC, skręcanie, magazyn/kontrola, stolarnia) odhaczane
-- inicjałami, naklejka, zrealizowane, anulowanie. Zapis przez funkcje
-- bastion_extra_* (kierownik: dane; etapy: kierownik lub pracownik z etapami Bastion).
-- Bezpieczne do ponownego uruchomienia.
-- =====================================================================

create table if not exists public.bastion_extras (
  id bigserial primary key,
  extra_no integer not null unique,
  order_date date not null default current_date,
  company text not null default '',
  production_day text not null default '',
  description text not null,                 -- np. PRÓG BOLD 150 BEZ USZCZELKI, OPASKI 40mm
  color text not null default '',
  width_side text not null default '',       -- SZER/STR z arkusza (np. 90, LEWE)
  system text not null default '',
  quantity numeric not null default 1 check (quantity > 0),
  order_ref text not null default '',        -- NR KR CENTER: numer(y) zlecenia na drzwi, do których to idzie
  client_order_number text not null default '',
  rush text not null default '',             -- PILNE / TERMIN WYKONANIA
  notes text not null default '',
  sales_changes text not null default '',
  stages jsonb not null default '{}'::jsonb, -- {"osc_cnc": {"v":"AW","at":...,"by":...}, ...}
  label text not null default '',            -- NAKLEJKA (A / data)
  released_at date,                          -- ZREALIZOWANE
  is_cancelled boolean not null default false,
  entered_by text not null default '',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.bastion_extras is 'Bastion „Reszta": zamówienia na same progi / opaski / zabudowy itp. (arkusz Reszta), własna numeracja od 363, 4 etapy.';
create index if not exists bastion_extras_open_idx on public.bastion_extras (released_at, is_cancelled, order_date desc);

alter table public.bastion_extras enable row level security;
drop policy if exists bastion_extras_read on public.bastion_extras;
create policy bastion_extras_read on public.bastion_extras for select to authenticated using (true);
grant select on public.bastion_extras to authenticated, service_role;

create or replace function public.bastion_extra_stage_keys()
returns text[]
language sql
immutable
as $function$
  select array['osc_cnc', 'osc_skrecanie', 'kontrola', 'stolarnia'];
$function$;

-- pola, które wolno ustawić przy tworzeniu / edycji
create or replace function public.bastion_extra_apply(p_row public.bastion_extras, p jsonb)
returns public.bastion_extras
language plpgsql
immutable
as $function$
declare
  r public.bastion_extras := p_row;
begin
  if p ? 'order_date' then r.order_date := coalesce(nullif(p->>'order_date', '')::date, r.order_date); end if;
  if p ? 'company' then r.company := trim(coalesce(p->>'company', '')); end if;
  if p ? 'production_day' then r.production_day := upper(trim(coalesce(p->>'production_day', ''))); end if;
  if p ? 'description' then r.description := trim(coalesce(p->>'description', '')); end if;
  if p ? 'color' then r.color := upper(trim(coalesce(p->>'color', ''))); end if;
  if p ? 'width_side' then r.width_side := upper(trim(coalesce(p->>'width_side', ''))); end if;
  if p ? 'system' then r.system := upper(trim(coalesce(p->>'system', ''))); end if;
  if p ? 'quantity' then r.quantity := coalesce(nullif(p->>'quantity', '')::numeric, 1); end if;
  if p ? 'order_ref' then r.order_ref := trim(coalesce(p->>'order_ref', '')); end if;
  if p ? 'client_order_number' then r.client_order_number := trim(coalesce(p->>'client_order_number', '')); end if;
  if p ? 'rush' then r.rush := upper(trim(coalesce(p->>'rush', ''))); end if;
  if p ? 'notes' then r.notes := trim(coalesce(p->>'notes', '')); end if;
  if p ? 'sales_changes' then r.sales_changes := trim(coalesce(p->>'sales_changes', '')); end if;
  if r.description = '' then
    raise exception 'Podaj, co zamówiono (opis pozycji)';
  end if;
  return r;
end;
$function$;

create or replace function public.bastion_extra_create(p jsonb)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r public.bastion_extras;
  v_id bigint;
begin
  perform public.assert_manager_or_service();
  r.extra_no := (select greatest(coalesce(max(extra_no), 0), 362) + 1 from bastion_extras);
  r.order_date := current_date; r.company := ''; r.production_day := ''; r.description := ''; r.color := '';
  r.width_side := ''; r.system := ''; r.quantity := 1; r.order_ref := ''; r.client_order_number := '';
  r.rush := ''; r.notes := ''; r.sales_changes := ''; r.stages := '{}'::jsonb; r.label := ''; r.is_cancelled := false;
  r := public.bastion_extra_apply(r, p);
  insert into bastion_extras (extra_no, order_date, company, production_day, description, color, width_side, system, quantity,
                              order_ref, client_order_number, rush, notes, sales_changes, entered_by, created_by)
  values (r.extra_no, r.order_date, r.company, r.production_day, r.description, r.color, r.width_side, r.system, r.quantity,
          r.order_ref, r.client_order_number, r.rush, r.notes, r.sales_changes,
          coalesce((select upper(coalesce(initials, '')) from profiles where id = auth.uid()), ''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$function$;

create or replace function public.bastion_extra_update(p_id bigint, p jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r public.bastion_extras;
begin
  perform public.assert_manager_or_service();
  select * into r from bastion_extras where id = p_id for update;
  if not found then raise exception 'Pozycja % nie istnieje', p_id; end if;
  r := public.bastion_extra_apply(r, p);
  update bastion_extras e
  set order_date = r.order_date, company = r.company, production_day = r.production_day, description = r.description,
      color = r.color, width_side = r.width_side, system = r.system, quantity = r.quantity, order_ref = r.order_ref,
      client_order_number = r.client_order_number, rush = r.rush, notes = r.notes, sales_changes = r.sales_changes,
      updated_at = now()
  where e.id = p_id;
end;
$function$;

-- etap: p_value = inicjały albo '' (cofnięcie); kierownik lub pracownik z etapami Bastion
create or replace function public.bastion_extra_set_stage(p_id bigint, p_stage_key text, p_value text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_stages jsonb;
begin
  if not public.bastion_batch_can_mark() then
    raise exception 'Brak uprawnień do oznaczania etapów (etapy Bastion nie są przypisane do Twojego stanowiska)';
  end if;
  if not (p_stage_key = any(public.bastion_extra_stage_keys())) then
    raise exception 'Nieznany etap: %', p_stage_key;
  end if;
  select stages into v_stages from bastion_extras where id = p_id for update;
  if v_stages is null then raise exception 'Pozycja % nie istnieje', p_id; end if;
  if coalesce(trim(p_value), '') = '' then
    v_stages := v_stages - p_stage_key;
  else
    v_stages := v_stages || jsonb_build_object(p_stage_key, jsonb_build_object('v', upper(trim(p_value)), 'at', now(), 'by', auth.uid()));
  end if;
  update bastion_extras set stages = v_stages, updated_at = now() where id = p_id;
  return v_stages;
end;
$function$;

-- naklejka (A = wydrukowana), zrealizowane (data / null), anulowanie / przywrócenie — kierownik
create or replace function public.bastion_extra_set_flags(p_id bigint, p_label text default null, p_released_at text default null, p_clear_released boolean default false, p_cancelled boolean default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.assert_manager_or_service();
  update bastion_extras
  set label = coalesce(p_label, label),
      released_at = case when p_clear_released then null when p_released_at is not null then p_released_at::date else released_at end,
      is_cancelled = coalesce(p_cancelled, is_cancelled),
      updated_at = now()
  where id = p_id;
  if not found then raise exception 'Pozycja % nie istnieje', p_id; end if;
end;
$function$;

revoke all on function public.bastion_extra_apply(public.bastion_extras, jsonb) from public, anon, authenticated;
revoke all on function public.bastion_extra_create(jsonb) from public, anon;
revoke all on function public.bastion_extra_update(bigint, jsonb) from public, anon;
revoke all on function public.bastion_extra_set_stage(bigint, text, text) from public, anon;
revoke all on function public.bastion_extra_set_flags(bigint, text, text, boolean, boolean) from public, anon;
grant execute on function public.bastion_extra_create(jsonb), public.bastion_extra_update(bigint, jsonb),
  public.bastion_extra_set_stage(bigint, text, text), public.bastion_extra_set_flags(bigint, text, text, boolean, boolean),
  public.bastion_extra_stage_keys() to authenticated, service_role;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'bastion_extras') then
    alter publication supabase_realtime add table public.bastion_extras;
  end if;
exception when others then
  raise notice 'realtime publication: %', sqlerrm;
end $$;
