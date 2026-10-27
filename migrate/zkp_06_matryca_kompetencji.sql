-- =====================================================================
-- ZKP AS 75EI — MATRYCA KOMPETENCJI (zał. 6.27), SKŁAD ZAKŁADU (zał. 6.1),
-- OKNA TECHNICZNE POZA ZAKRESEM (brief v2, 2026-10-27)
--
-- 1) Karta wyrobu: typ wyrobu tylko drzwi wewnętrzne / zewnętrzne (brief pkt 5:
--    okna techniczne poza zakresem ZKP).
-- 2) profiles.zkp_position — stanowisko wg zał. 6.1 (właściciel, Pełnomocnik ZKP =
--    Kierownik Produkcji, Zastępca, operator CNC i piły, monter, pomocnik montera);
--    zmienia tylko admin (protect_profile_privileges).
-- 3) zkp_competencies — matryca kompetencji 6.27: osoba × operacja (IS-01…IS-06,
--    kontrola odbiorcza, montaż), nadanie przez Pełnomocnika / Zastępcę z podstawą,
--    wycofanie z powodem (bez kasowania, zał. 6.34), audyt.
-- 4) Każdy podpis operacji sprawdzany w matrycy (brief pkt 10.2): zkp_record_card_stage
--    przyjmuje inicjały operatora, znajduje osobę w profiles i odmawia, gdy nie ma
--    aktywnego uprawnienia do operacji tego etapu. Wpis etapu pamięta osobę (operator_id).
--    zkp_assert_competency — do kontroli odbiorczej (etap D) i montażu (6.28).
-- Wymaga: zkp_05. Bezpieczne do ponownego uruchomienia.
-- =====================================================================

-- ── 1) Okna techniczne poza zakresem ZKP ─────────────────────────────────
update public.zkp_product_cards set product_type = null where product_type = 'okno';
alter table public.zkp_product_cards drop constraint if exists zkp_product_cards_product_type_check;
alter table public.zkp_product_cards add constraint zkp_product_cards_product_type_check
  check (product_type in ('drzwi_wewn', 'drzwi_zewn'));

-- ── 2) Stanowisko wg zał. 6.1 ────────────────────────────────────────────
alter table public.profiles add column if not exists zkp_position text;
alter table public.profiles drop constraint if exists profiles_zkp_position_check;
alter table public.profiles add constraint profiles_zkp_position_check
  check (zkp_position is null or zkp_position in
         ('wlasciciel', 'pelnomocnik_kp', 'zastepca', 'operator_cnc', 'monter', 'pomocnik'));

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
      or new.zkp_roles is distinct from old.zkp_roles        -- ZKP 5.3.2
      or new.zkp_position is distinct from old.zkp_position)  -- zał. 6.1
     and not public.current_user_is_admin() then
    raise exception 'Tylko administrator może zmieniać role (także ZKP), stanowisko, kategorie, działy, inicjały i nazwiska';
  end if;
  return new;
end;
$function$;

-- ── 3) Matryca kompetencji 6.27 ──────────────────────────────────────────
create table if not exists public.zkp_competencies (
  id                bigint generated always as identity primary key,
  profile_id        uuid not null references public.profiles(id) on delete restrict,
  operation         text not null check (operation in
                      ('IS-01', 'IS-02', 'IS-03', 'IS-04', 'IS-05', 'IS-06', 'kontrola_odbiorcza', 'montaz')),
  granted_on        date not null default current_date,
  basis             text not null default '',          -- szkolenie / instruktaż / dokument
  granted_by        uuid default auth.uid(),
  granted_by_name   text not null default '',
  created_at        timestamptz not null default now(),
  withdrawn_at      timestamptz,
  withdrawn_by      uuid,
  withdrawn_by_name text not null default '',
  withdraw_reason   text,
  constraint zkp_competencies_withdraw_check
    check (withdrawn_at is null or length(trim(coalesce(withdraw_reason, ''))) >= 3)
);
create unique index if not exists zkp_competencies_active_uq
  on public.zkp_competencies (profile_id, operation) where withdrawn_at is null;
create index if not exists zkp_competencies_profile_idx on public.zkp_competencies (profile_id);

alter table public.zkp_competencies enable row level security;
drop policy if exists zkp_competencies_read on public.zkp_competencies;
create policy zkp_competencies_read on public.zkp_competencies for select to authenticated using (true);

drop trigger if exists audit_zkp_competencies on public.zkp_competencies;
create trigger audit_zkp_competencies after insert or update or delete on public.zkp_competencies
  for each row execute function public.audit_trigger_fn();

-- Aktywne uprawnienie osoby do operacji (zał. 6.27)
create or replace function public.zkp_has_competency(p_profile_id uuid, p_operation text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.zkp_competencies c
    where c.profile_id = p_profile_id and c.operation = p_operation and c.withdrawn_at is null
  );
$$;

-- Osoba po inicjałach (konta hali są wspólne — podpis operacji to osoba z matrycy)
create or replace function public.zkp_profile_by_initials(p_initials text)
returns uuid
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_n  int;
begin
  select count(*) into v_n
  from public.profiles
  where upper(trim(initials)) = upper(trim(coalesce(p_initials, ''))) and trim(coalesce(initials, '')) <> '';
  if v_n = 0 then
    raise exception 'Brak pracownika o inicjałach „%" w programie', trim(coalesce(p_initials, ''));
  end if;
  if v_n > 1 then
    raise exception 'Inicjały „%" ma więcej niż jedna osoba — ujednolić w Użytkownikach', trim(p_initials);
  end if;
  select id into v_id from public.profiles
  where upper(trim(initials)) = upper(trim(p_initials)) and trim(coalesce(initials, '')) <> '';
  return v_id;
end;
$function$;

-- Podpis operacji: osoba musi mieć aktywne uprawnienie (brief pkt 10.2, zał. 6.27)
create or replace function public.zkp_assert_competency(p_profile_id uuid, p_operation text)
returns void
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_name text;
begin
  if not public.zkp_has_competency(p_profile_id, p_operation) then
    select coalesce(nullif(full_name, ''), initials, '') into v_name from public.profiles where id = p_profile_id;
    raise exception '% nie ma uprawnienia do „%" w matrycy kompetencji (zał. 6.27) — nadaje Pełnomocnik ZKP', v_name, p_operation;
  end if;
end;
$function$;

-- Operacja (instrukcja stanowiskowa) etapu karty 6.25
create or replace function public.zkp_stage_operation(p_stage_key text)
returns text
language sql
immutable
as $$
  select case p_stage_key
    when 'ciecie' then 'IS-01'
    when 'wklady' then 'IS-02'
    when 'usz_skrzydlo' then 'IS-03'
    when 'usz_prog' then 'IS-03'
    when 'usz_wypelnienie' then 'IS-03'
    when 'usz_styk' then 'IS-03'
    when 'laczenie' then 'IS-03'
    when 'okucia' then 'IS-04'
    when 'szklenie' then 'IS-05'
    when 'regulacja' then 'IS-06'
  end;
$$;

create or replace function public.zkp_grant_competency(p_profile_id uuid, p_operation text, p_granted_on date, p_basis text)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id bigint;
begin
  if not public.current_user_has_zkp_role(array['pelnomocnik', 'zastepca']) then
    raise exception 'Matrycę kompetencji (zał. 6.27) prowadzi Pełnomocnik ZKP lub Zastępca';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile_id) then
    raise exception 'Pracownik nie istnieje';
  end if;
  if public.zkp_has_competency(p_profile_id, p_operation) then
    raise exception 'Osoba ma już aktywne uprawnienie do „%"', p_operation;
  end if;
  insert into public.zkp_competencies (profile_id, operation, granted_on, basis, granted_by, granted_by_name)
  values (p_profile_id, p_operation, coalesce(p_granted_on, current_date), trim(coalesce(p_basis, '')),
          auth.uid(), public.zkp_current_user_name())
  returning id into v_id;
  return v_id;
end;
$function$;

create or replace function public.zkp_withdraw_competency(p_id bigint, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.current_user_has_zkp_role(array['pelnomocnik', 'zastepca']) then
    raise exception 'Matrycę kompetencji (zał. 6.27) prowadzi Pełnomocnik ZKP lub Zastępca';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Podaj powód wycofania uprawnienia';
  end if;
  update public.zkp_competencies
  set withdrawn_at = now(), withdrawn_by = auth.uid(), withdrawn_by_name = public.zkp_current_user_name(),
      withdraw_reason = trim(p_reason)
  where id = p_id and withdrawn_at is null;
  if not found then
    raise exception 'Uprawnienie nie istnieje albo jest już wycofane';
  end if;
end;
$function$;

-- ── 4) Etap karty: podpis operatora sprawdzany w matrycy ─────────────────
alter table public.zkp_card_stage_records add column if not exists operator_id uuid references public.profiles(id) on delete restrict;

create or replace function public.zkp_record_card_stage(
  p_card_id bigint, p_stage_key text, p_catalog_no text, p_lot_id bigint, p_result text,
  p_gaps jsonb, p_notes text, p_operator text
)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_card  public.zkp_product_cards;
  v_range public.zkp_ranges;
  v_kinds text[];
  v_bad   text;
  v_id    bigint;
  v_op    uuid;
  v_op_initials text;
begin
  if not public.zkp_can_record_card() then
    raise exception 'Etapy karty wyrobu wpisuje operator produkcji / kontroler / Kierownik Produkcji / PJ (role ZKP) albo kierownik';
  end if;
  select * into v_card from public.zkp_product_cards where id = p_card_id for update;
  if not found then
    raise exception 'Karta % nie istnieje', p_card_id;
  end if;
  if v_card.decision is not null then
    raise exception 'Karta jest zamknięta decyzją „%"', v_card.decision;
  end if;
  if v_card.range_confirmed_at is null then
    raise exception 'Najpierw sprawdzenie i potwierdzenie zakresu (cz. B) — dopiero potem produkcja';
  end if;
  if length(trim(coalesce(p_operator, ''))) = 0 then
    raise exception 'Podaj operatora (inicjały)';
  end if;
  if p_result not in ('OK', 'NOK', 'nd') then
    raise exception 'Wynik: OK, NOK albo n/d';
  end if;
  if p_result = 'nd' and p_stage_key not in ('usz_prog', 'usz_styk') then
    raise exception '„Nie dotyczy" dopuszczalne tylko dla uszczelek progu i styku z profilem odwracającym / ścianą';
  end if;

  -- brief pkt 10.2 / zał. 6.27: podpis operacji tylko przez osobę z uprawnieniem
  v_op := public.zkp_profile_by_initials(p_operator);
  perform public.zkp_assert_competency(v_op, public.zkp_stage_operation(p_stage_key));
  select initials into v_op_initials from public.profiles where id = v_op;

  select * into v_range from public.zkp_ranges where code = v_card.range_code;

  v_kinds := case p_stage_key
    when 'wklady' then array['wklad']
    when 'usz_skrzydlo' then array['uszczelka']
    when 'usz_prog' then array['uszczelka']
    when 'usz_wypelnienie' then array['uszczelka']
    when 'usz_styk' then array['uszczelka']
    else null end;

  -- etapy K z komponentem krytycznym: partia obowiązkowa przy OK
  if v_kinds is not null and p_result = 'OK' and p_lot_id is null then
    raise exception 'Etap krytyczny — wybierz partię komponentu (nr partii z rejestru przyjęć 6.24)';
  end if;
  if p_lot_id is not null then
    perform public.zkp_assert_card_lot(p_lot_id, v_card.range_code, v_kinds, v_kinds is not null);
  end if;

  if p_stage_key = 'regulacja' and p_result = 'OK' then
    select string_agg(g.k || ' ' || e.k || ' ' || (p_gaps->g.k->>e.k) || ' > ' || (v_range.gaps->g.k->>e.k), ', ')
    into v_bad
    from (values ('A'), ('B'), ('C')) g(k) cross join (values ('zaw'), ('zamk'), ('nad')) e(k)
    where p_gaps->g.k->>e.k is null
       or (p_gaps->g.k->>e.k)::numeric > (v_range.gaps->g.k->>e.k)::numeric;
    if v_bad is not null then
      raise exception 'Szczeliny poza limitem zakresu % albo niewpisane (mm): %', v_range.code, v_bad;
    end if;
  end if;

  insert into public.zkp_card_stage_records
    (card_id, stage_key, catalog_no, lot_id, result, gaps, notes, operator, operator_id, recorded_by, recorded_by_name)
  values
    (p_card_id, p_stage_key, trim(coalesce(p_catalog_no, '')), p_lot_id, p_result,
     case when p_stage_key = 'regulacja' then p_gaps end, trim(coalesce(p_notes, '')), v_op_initials, v_op,
     auth.uid(), public.zkp_current_user_name())
  returning id into v_id;
  return v_id;
end;
$function$;

-- ── Uprawnienia do funkcji ───────────────────────────────────────────────
revoke all on function public.zkp_has_competency(uuid, text) from public, anon;
revoke all on function public.zkp_profile_by_initials(text) from public, anon;
revoke all on function public.zkp_assert_competency(uuid, text) from public, anon;
revoke all on function public.zkp_stage_operation(text) from public, anon;
revoke all on function public.zkp_grant_competency(uuid, text, date, text) from public, anon;
revoke all on function public.zkp_withdraw_competency(bigint, text) from public, anon;
grant execute on function public.zkp_has_competency(uuid, text) to authenticated, service_role;
grant execute on function public.zkp_profile_by_initials(text) to authenticated, service_role;
grant execute on function public.zkp_assert_competency(uuid, text) to authenticated, service_role;
grant execute on function public.zkp_stage_operation(text) to authenticated, service_role;
grant execute on function public.zkp_grant_competency(uuid, text, date, text) to authenticated, service_role;
grant execute on function public.zkp_withdraw_competency(bigint, text) to authenticated, service_role;
