-- 28.11.2026 — decyzja D53 (właściciel: TAK). DO WDROŻENIA (nie wgrane). Wgrywać PO 20261128035100 (D54).
-- Problem: kompetencje sprawdzane były dla osoby, której inicjały podano, nie dla zalogowanej — pracownik bez
-- kompetencji podpisał etapy inicjałami kontrolera (na wspólnym telefonie wystarczy kliknąć cudzy kafelek).
-- Teraz (tylko etapy z operacją ZKP — cięcie, składanie, okuwanie, szklenie — na pozycji podlegającej ZKP):
--  * podpis potwierdza PIN osoby podpisującej (osoby z wybranych inicjałów), weryfikowany w bazie;
--  * PIN przechowywany wyłącznie jako hash bcrypt (pgcrypto: extensions.crypt / gen_salt('bf')) w tabeli
--    zkp_signature_pins bez dostępu dla klientów (RLS bez polityk + revoke); 5 błędnych prób = blokada 15 min;
--  * PIN ustawia sam pracownik (zmiana istniejącego wymaga obecnego PIN-u) albo administrator (zkp_set_pin);
--    administrator może PIN usunąć (zkp_clear_pin); zkp_pin_status — kto ma PIN (admin: wszyscy, inni: siebie);
--  * każde oznaczenie sztuki (także zwykłe zlecenia) zapisuje w alu_stage_signatures: inicjały, osobę z inicjałów,
--    auth.uid() klikającego, czy PIN był sprawdzony, czy pozycja ZKP — audyt „kto naprawdę kliknął”;
--  * zwykłe zlecenia i pakowanie — bez PIN-u, jak dotąd.
-- Kody błędów dla aplikacji: P0428 = wpisz PIN (aplikacja pokazuje okienko PIN), P0424 = osoba nie ma PIN-u,
-- P0429 = PIN zablokowany. BŁĘDNY PIN nie jest wyjątkiem (licznik prób musi się zapisać): funkcja zwraca
-- {"_zkp_pin_error": "…"} bez zmiany etapów — aplikacja zamienia to na komunikat (kod P0401).
-- mark_alu_position_stage: pełna definicja jak w 20261128035100 + nowy parametr p_pin (domyślnie null).
-- Stara sygnatura (4 parametry) usuwana; aplikacja przy PGRST202 ponawia bez p_pin.

create table if not exists public.zkp_signature_pins (
  profile_id   uuid primary key references public.profiles(id) on delete cascade,
  pin_hash     text not null,
  set_at       timestamptz not null default now(),
  set_by       uuid,
  failed_count int not null default 0,
  locked_until timestamptz
);
alter table public.zkp_signature_pins enable row level security;
revoke all on table public.zkp_signature_pins from public, anon, authenticated;

create table if not exists public.alu_stage_signatures (
  id           bigserial primary key,
  position_id  bigint not null,
  order_id     bigint not null,
  stage_key    text not null,
  piece_no     int not null,
  initials     text not null,
  signer_id    uuid,
  clicked_by   uuid,
  pin_verified boolean not null default false,
  is_zkp       boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists alu_stage_signatures_position_idx on public.alu_stage_signatures (position_id, stage_key);
create index if not exists alu_stage_signatures_order_idx on public.alu_stage_signatures (order_id);
alter table public.alu_stage_signatures enable row level security;
revoke all on table public.alu_stage_signatures from public, anon;
grant select on table public.alu_stage_signatures to authenticated;
drop policy if exists alu_stage_signatures_read on public.alu_stage_signatures;
create policy alu_stage_signatures_read on public.alu_stage_signatures for select to authenticated using (true);

-- null = PIN poprawny w formie; inaczej komunikat
create or replace function public.zkp_pin_problem(p_pin text)
 returns text
 language sql
 immutable
 set search_path to 'public'
as $function$
  select case
    when p_pin is null or p_pin !~ '^[0-9]{4,8}$' then 'PIN: od 4 do 8 cyfr'
    when p_pin ~ '^(.)\1*$' then 'PIN nie może być jedną powtórzoną cyfrą'
    when position(p_pin in '0123456789') > 0 or position(p_pin in '9876543210') > 0
      then 'PIN nie może być kolejnymi cyframi (np. 1234)'
  end;
$function$;

-- Wewnętrzna (bez grantu dla klientów): 'ok' | 'brak_pinu' | 'zablokowany' | 'bledny'; liczy błędne próby.
create or replace function public.zkp_check_pin(p_profile_id uuid, p_pin text)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  r public.zkp_signature_pins;
begin
  select * into r from public.zkp_signature_pins where profile_id = p_profile_id for update;
  if not found then
    return 'brak_pinu';
  end if;
  if r.locked_until is not null and r.locked_until > now() then
    return 'zablokowany';
  end if;
  if coalesce(p_pin, '') <> '' and r.pin_hash = extensions.crypt(p_pin, r.pin_hash) then
    update public.zkp_signature_pins set failed_count = 0, locked_until = null where profile_id = p_profile_id;
    return 'ok';
  end if;
  update public.zkp_signature_pins
  set failed_count = case when r.failed_count + 1 >= 5 then 0 else r.failed_count + 1 end,
      locked_until = case when r.failed_count + 1 >= 5 then now() + interval '15 minutes' else null end
  where profile_id = p_profile_id;
  return 'bledny';
end;
$function$;
revoke all on function public.zkp_check_pin(uuid, text) from public, anon, authenticated;

-- Ustawienie PIN-u: sam pracownik (zmiana istniejącego — z obecnym PIN-em) albo administrator.
-- false = obecny PIN błędny (licznik prób zapisany), true = ustawiono.
create or replace function public.zkp_set_pin(p_profile_id uuid, p_new_pin text, p_current_pin text default null)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_admin   boolean := public.current_user_is_admin();
  v_problem text;
  v_state   text;
begin
  if auth.uid() is null or not (v_admin or auth.uid() = p_profile_id) then
    raise exception 'PIN podpisu ZKP ustawia sam pracownik albo administrator';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile_id) then
    raise exception 'Nie ma takiego użytkownika';
  end if;
  v_problem := public.zkp_pin_problem(p_new_pin);
  if v_problem is not null then
    raise exception '%', v_problem;
  end if;
  if not v_admin and exists (select 1 from public.zkp_signature_pins where profile_id = p_profile_id) then
    v_state := public.zkp_check_pin(p_profile_id, p_current_pin);
    if v_state = 'zablokowany' then
      raise exception 'PIN zablokowany po 5 błędnych próbach — spróbuj za 15 minut albo poproś administratora o nowy PIN'
        using errcode = 'P0429';
    elsif v_state <> 'ok' then
      return false;
    end if;
  end if;
  insert into public.zkp_signature_pins (profile_id, pin_hash, set_at, set_by, failed_count, locked_until)
  values (p_profile_id, extensions.crypt(p_new_pin, extensions.gen_salt('bf', 8)), now(), auth.uid(), 0, null)
  on conflict (profile_id) do update
    set pin_hash = excluded.pin_hash, set_at = now(), set_by = auth.uid(), failed_count = 0, locked_until = null;
  return true;
end;
$function$;
revoke all on function public.zkp_set_pin(uuid, text, text) from public, anon;
grant execute on function public.zkp_set_pin(uuid, text, text) to authenticated;

create or replace function public.zkp_clear_pin(p_profile_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not public.current_user_is_admin() then
    raise exception 'PIN podpisu ZKP usuwa tylko administrator';
  end if;
  delete from public.zkp_signature_pins where profile_id = p_profile_id;
end;
$function$;
revoke all on function public.zkp_clear_pin(uuid) from public, anon;
grant execute on function public.zkp_clear_pin(uuid) to authenticated;

-- Kto ma PIN (bez hashy): administrator — wszyscy, pozostali — tylko siebie.
create or replace function public.zkp_pin_status()
 returns table(r_profile_id uuid, r_has_pin boolean, r_set_at timestamptz, r_locked boolean)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select p.id, s.profile_id is not null, s.set_at, coalesce(s.locked_until > now(), false)
  from public.profiles p
  left join public.zkp_signature_pins s on s.profile_id = p.id
  where p.id = auth.uid() or public.current_user_is_admin();
$function$;
revoke all on function public.zkp_pin_status() from public, anon;
grant execute on function public.zkp_pin_status() to authenticated;

drop function if exists public.mark_alu_position_stage(bigint, text, text);
drop function if exists public.mark_alu_position_stage(bigint, text, text, integer);

create or replace function public.mark_alu_position_stage(
  p_position_id bigint, p_stage_key text, p_initials text, p_expected_done integer default null,
  p_pin text default null
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_keys       text[] := public.alu_stage_keys();
  v_idx        int;
  v_order_id   bigint;
  v_qty        int;
  v_stages     jsonb;
  v_cur        int;
  v_prev_key   text;
  v_prev_limit int;
  v_marks      jsonb;
  v_initials   text;
  v_blocked    boolean;
  v_operation  text;
  v_person     uuid;
  v_zkp        boolean;
  v_released   int;
  v_pin_state  text;
  v_pin_ok     boolean := false;
begin
  if not public.can_write_alu_position(p_position_id) then
    raise exception 'Brak uprawnień do oznaczania etapów tej pozycji';
  end if;

  v_idx := array_position(v_keys, p_stage_key);
  if v_idx is null then
    raise exception 'Nieznany etap: %', coalesce(p_stage_key, '(brak)');
  end if;

  select ap.order_id, ap.quantity,
         case when jsonb_typeof(ap.production_stages) = 'object' then ap.production_stages else '{}'::jsonb end
  into v_order_id, v_qty, v_stages
  from public.order_alu_positions ap
  where ap.id = p_position_id
  for update;
  if not found then
    raise exception 'Pozycja % nie istnieje', p_position_id;
  end if;

  select (coalesce(o.extra_fields->>'cancelled', '') = 'true' or o.release_date is not null)
  into v_blocked
  from public.orders o
  where o.id = v_order_id;
  if coalesce(v_blocked, true) then
    raise exception 'Zlecenie jest wydane/anulowane';
  end if;

  v_initials := coalesce(nullif(trim(p_initials), ''), 'T');
  v_zkp := public.alu_position_is_zkp(p_position_id);

  -- D54: pozycja ZKP — etapy dopiero po „Uruchom do produkcji”
  if v_zkp and not exists (select 1 from public.alu_production_orders po where po.order_id = v_order_id) then
    raise exception 'Zlecenie ZKP (AS 75EI): etapy można oznaczać dopiero po „Uruchom do produkcji” — kierownik uruchamia zlecenie w szczegółach zlecenia'
      using errcode = 'P0423';
  end if;

  v_operation := public.alu_stage_zkp_operation(p_stage_key);
  if v_operation is not null and v_zkp then
    if v_initials = 'T' then
      raise exception 'Zlecenie ZKP: wybierz osobę (kafelek z inicjałami) — etap % podpisuje konkretna osoba z matrycy 6.27',
        public.alu_stage_name(p_stage_key);
    end if;
    v_person := public.zkp_profile_by_initials(v_initials);
    perform public.zkp_assert_competency(v_person, v_operation);
    select upper(trim(initials)) into v_initials from public.profiles where id = v_person;
  end if;

  v_cur := coalesce(nullif(v_stages->p_stage_key->>'done', '')::int, 0);

  -- runda 10 (28.11): ponowienie / drugie okno — stan w bazie inny niż widziany przy kliknięciu
  if p_expected_done is not null and v_cur <> p_expected_done then
    raise exception 'Stan sztuk się zmienił: etap % ma już % z % szt. (poprzedni zapis mógł przejść albo ktoś inny oznaczył) — odśwież',
      public.alu_stage_name(p_stage_key), v_cur, v_qty
      using errcode = 'P0409';
  end if;

  if v_idx = 1 then
    v_prev_limit := v_qty;
  else
    v_prev_key   := v_keys[v_idx - 1];
    v_prev_limit := coalesce(nullif(v_stages->v_prev_key->>'done', '')::int, 0);
  end if;

  if v_cur >= v_qty then
    raise exception 'Wszystkie sztuki tej pozycji mają już ten etap';
  end if;
  if v_cur >= v_prev_limit then
    raise exception 'Najpierw poprzedni etap: % ma % z % szt.',
      public.alu_stage_name(v_prev_key), v_prev_limit, v_qty;
  end if;

  -- D54: pozycja ZKP — pakowanie sztuki dopiero po zwolnieniu jej karty wyrobu
  if v_zkp and p_stage_key = 'pakowanie' then
    select count(*) into v_released
    from public.alu_constructions k
    join public.zkp_product_cards c on c.construction_id = k.id
    where k.position_id = p_position_id and k.status = 'aktywna' and c.decision = 'zwolniony';
    if v_released < v_cur + 1 then
      raise exception 'Zlecenie ZKP (AS 75EI): pakowanie dopiero po zwolnieniu karty wyrobu — ta pozycja ma % zwolnionych kart z % szt. (zwalnia kontroler / Pełnomocnik w zakładce ZKP)',
        v_released, v_qty
        using errcode = 'P0423';
    end if;
  end if;

  -- D53: podpis etapu ZKP potwierdzony PIN-em osoby podpisującej (po wszystkich innych kontrolach —
  -- okienko PIN pojawia się tylko, gdy oznaczenie może przejść)
  if v_operation is not null and v_zkp then
    if not exists (select 1 from public.zkp_signature_pins s where s.profile_id = v_person) then
      raise exception 'Podpis etapu ZKP: % nie ma ustawionego PIN-u — ustawia go sam pracownik („PIN ZKP”) albo administrator (Użytkownicy)',
        v_initials
        using errcode = 'P0424';
    end if;
    if coalesce(p_pin, '') = '' then
      raise exception 'Podpis etapu ZKP (%): wpisz PIN osoby %', public.alu_stage_name(p_stage_key), v_initials
        using errcode = 'P0428';
    end if;
    v_pin_state := public.zkp_check_pin(v_person, p_pin);
    if v_pin_state = 'zablokowany' then
      raise exception 'PIN osoby % zablokowany po 5 błędnych próbach — spróbuj za 15 minut albo administrator ustawi nowy PIN',
        v_initials
        using errcode = 'P0429';
    elsif v_pin_state <> 'ok' then
      -- bez wyjątku: licznik błędnych prób musi się zapisać; etapy bez zmian
      return jsonb_build_object('_zkp_pin_error',
        format('Błędny PIN osoby %s — etap nie został podpisany (5 błędów = blokada na 15 minut)', v_initials));
    end if;
    v_pin_ok := true;
  end if;

  v_marks := case when jsonb_typeof(v_stages->p_stage_key->'marks') = 'array'
                  then v_stages->p_stage_key->'marks' else '[]'::jsonb end;
  if jsonb_array_length(v_marks) > v_cur then
    select coalesce(jsonb_agg(m.value order by m.ordinality), '[]'::jsonb)
    into v_marks
    from jsonb_array_elements(v_marks) with ordinality m
    where m.ordinality <= v_cur;
  end if;
  v_marks := v_marks || to_jsonb(v_initials);

  update public.order_alu_positions ap
  set production_stages = v_stages
        || jsonb_build_object(p_stage_key, jsonb_build_object('done', v_cur + 1, 'marks', v_marks)),
      updated_at = now()
  where ap.id = p_position_id
  returning ap.production_stages into v_stages;

  -- D53: kto podpisał i kto kliknął (auth.uid()) — także zwykłe zlecenia
  insert into public.alu_stage_signatures (position_id, order_id, stage_key, piece_no, initials, signer_id, clicked_by, pin_verified, is_zkp)
  values (p_position_id, v_order_id, p_stage_key, v_cur + 1, v_initials, v_person, auth.uid(), v_pin_ok, v_zkp);

  return v_stages;
end;
$function$;

revoke all on function public.mark_alu_position_stage(bigint, text, text, integer, text) from public, anon;
grant execute on function public.mark_alu_position_stage(bigint, text, text, integer, text) to authenticated, service_role;
