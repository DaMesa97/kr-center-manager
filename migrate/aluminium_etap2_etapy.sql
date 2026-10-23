-- 2026-10-23: Stolarka aluminiowa — etap 2 (etapy produkcji per pozycja i per sztuka).
--
-- Pozycje LP (order_alu_positions.production_stages) trzymają etapy w postaci
--   { "<etap>": { "done": <ile sztuk>, "marks": ["MK", "T", …] } }
-- Kolejność etapów STAŁA (jak ALU_STAGE_DEFS w src/constants.ts):
--   ciecie → okuwanie → skladanie → szklenie → pakowanie
-- Jedno kliknięcie = jedna sztuka: done rośnie o 1, na koniec marks dopisują się
-- inicjały klikającego. Przepływ sztukowy: sztukę można oznaczyć na etapie k tylko,
-- gdy poprzedni etap ma done większe niż bieżące done etapu k (pierwszy etap: limit
-- = quantity). Cofnąć można tylko, gdy następny etap nie „zużył” tej sztuki.
--
-- 1) alu_stage_keys() / alu_stage_name(key) — lista etapów i polskie nazwy.
-- 2) can_write_alu_position(position): kierownik / service_role / postgres ZAWSZE;
--    pracownik produkcji z dowolnym przypisaniem w worker_stages w kategorii
--    'Aluminium' (spójnie z can_write_order_stage — sprawdzana jest kategoria,
--    nie konkretny etap).
-- 3) mark_alu_position_stage(position, etap, inicjały) → nowe production_stages.
-- 4) undo_alu_position_stage(position, etap) → nowe production_stages.
--    Oba: FOR UPDATE na wierszu pozycji (dwa stanowiska klikają naraz), blokada
--    dla zleceń wydanych (release_date) i anulowanych (extra_fields.cancelled).
-- 5) alu_order_progress(order) → (r_done, r_total): postęp zlecenia w „sztuko-etapach”
--    (total = Σ quantity × liczba etapów, done = Σ min(done, quantity) po etapach).
-- RPC zapisu: SECURITY DEFINER z własnym guardem, REVOKE FROM PUBLIC, anon,
-- GRANT TO authenticated, service_role.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Lista etapów i nazwy
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.alu_stage_keys()
 returns text[]
 language sql
 immutable
 set search_path to 'public'
as $function$
  select array['ciecie', 'okuwanie', 'skladanie', 'szklenie', 'pakowanie']::text[];
$function$;

revoke all on function public.alu_stage_keys() from public, anon;
grant execute on function public.alu_stage_keys() to authenticated, service_role;

create or replace function public.alu_stage_name(p_stage_key text)
 returns text
 language sql
 immutable
 set search_path to 'public'
as $function$
  select case p_stage_key
    when 'ciecie'    then 'cięcie i frezowanie'
    when 'okuwanie'  then 'okuwanie'
    when 'skladanie' then 'składanie'
    when 'szklenie'  then 'szklenie'
    when 'pakowanie' then 'pakowanie'
    else coalesce(p_stage_key, '?')
  end;
$function$;

revoke all on function public.alu_stage_name(text) from public, anon;
grant execute on function public.alu_stage_name(text) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Guard: kto może ruszyć etap pozycji aluminiowej
-- ─────────────────────────────────────────────────────────────────────────────
-- p_position_id na razie nie zawęża (wszystkie pozycje są w kategorii Aluminium),
-- ale sygnatura jest per pozycja — gdyby kiedyś doszły reguły per zlecenie.
create or replace function public.can_write_alu_position(p_position_id bigint)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select
    coalesce(auth.role(), '') = 'service_role'
    or session_user = 'postgres'
    or public.current_user_is_manager()
    or exists (
      select 1
      from public.worker_stages ws
      where ws.worker_id = auth.uid()
        and ws.category = 'Aluminium'
    );
$function$;

revoke all on function public.can_write_alu_position(bigint) from public, anon;
grant execute on function public.can_write_alu_position(bigint) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Oznaczenie jednej sztuki na etapie
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.mark_alu_position_stage(p_position_id bigint, p_stage_key text, p_initials text)
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
begin
  if not public.can_write_alu_position(p_position_id) then
    raise exception 'Brak uprawnień do oznaczania etapów tej pozycji';
  end if;

  v_idx := array_position(v_keys, p_stage_key);
  if v_idx is null then
    raise exception 'Nieznany etap: %', coalesce(p_stage_key, '(brak)');
  end if;

  -- blokada wiersza pozycji: dwa stanowiska klikające naraz nie zgubią sztuki
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

  v_cur := coalesce(nullif(v_stages->p_stage_key->>'done', '')::int, 0);
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

  -- marks: przycięte do bieżącego done (gdyby były dłuższe), potem dopisane inicjały
  v_marks := case when jsonb_typeof(v_stages->p_stage_key->'marks') = 'array'
                  then v_stages->p_stage_key->'marks' else '[]'::jsonb end;
  if jsonb_array_length(v_marks) > v_cur then
    select coalesce(jsonb_agg(m.value order by m.ordinality), '[]'::jsonb)
    into v_marks
    from jsonb_array_elements(v_marks) with ordinality m
    where m.ordinality <= v_cur;
  end if;
  v_initials := coalesce(nullif(trim(p_initials), ''), 'T');
  v_marks := v_marks || to_jsonb(v_initials);

  update public.order_alu_positions ap
  set production_stages = v_stages
        || jsonb_build_object(p_stage_key, jsonb_build_object('done', v_cur + 1, 'marks', v_marks)),
      updated_at = now()
  where ap.id = p_position_id
  returning ap.production_stages into v_stages;

  return v_stages;
end;
$function$;

revoke all on function public.mark_alu_position_stage(bigint, text, text) from public, anon;
grant execute on function public.mark_alu_position_stage(bigint, text, text) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Cofnięcie jednej sztuki na etapie
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.undo_alu_position_stage(p_position_id bigint, p_stage_key text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_keys      text[] := public.alu_stage_keys();
  v_idx       int;
  v_order_id  bigint;
  v_stages    jsonb;
  v_cur       int;
  v_next_key  text;
  v_next_done int;
  v_marks     jsonb;
  v_blocked   boolean;
begin
  if not public.can_write_alu_position(p_position_id) then
    raise exception 'Brak uprawnień do cofania etapów tej pozycji';
  end if;

  v_idx := array_position(v_keys, p_stage_key);
  if v_idx is null then
    raise exception 'Nieznany etap: %', coalesce(p_stage_key, '(brak)');
  end if;

  select ap.order_id,
         case when jsonb_typeof(ap.production_stages) = 'object' then ap.production_stages else '{}'::jsonb end
  into v_order_id, v_stages
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

  v_cur := coalesce(nullif(v_stages->p_stage_key->>'done', '')::int, 0);
  if v_cur <= 0 then
    raise exception 'Ten etap nie ma czego cofnąć';
  end if;

  if v_idx < array_length(v_keys, 1) then
    v_next_key  := v_keys[v_idx + 1];
    v_next_done := coalesce(nullif(v_stages->v_next_key->>'done', '')::int, 0);
    if v_next_done > v_cur - 1 then
      raise exception 'Najpierw cofnij następny etap: %', public.alu_stage_name(v_next_key);
    end if;
  end if;

  -- marks przycięte do nowego done (zdejmowane są ostatnie kliknięcia)
  v_marks := case when jsonb_typeof(v_stages->p_stage_key->'marks') = 'array'
                  then v_stages->p_stage_key->'marks' else '[]'::jsonb end;
  select coalesce(jsonb_agg(m.value order by m.ordinality), '[]'::jsonb)
  into v_marks
  from jsonb_array_elements(v_marks) with ordinality m
  where m.ordinality <= v_cur - 1;

  update public.order_alu_positions ap
  set production_stages = v_stages
        || jsonb_build_object(p_stage_key, jsonb_build_object('done', v_cur - 1, 'marks', v_marks)),
      updated_at = now()
  where ap.id = p_position_id
  returning ap.production_stages into v_stages;

  return v_stages;
end;
$function$;

revoke all on function public.undo_alu_position_stage(bigint, text) from public, anon;
grant execute on function public.undo_alu_position_stage(bigint, text) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Postęp zlecenia (pasek postępu): sztuko-etapy zrobione / wszystkie
-- ─────────────────────────────────────────────────────────────────────────────
-- SECURITY INVOKER — pozycje i tak są czytelne dla zalogowanych (RLS select true).
create or replace function public.alu_order_progress(p_order_id bigint)
 returns table(r_done int, r_total int)
 language sql
 stable
 set search_path to 'public'
as $function$
  select
    coalesce(sum(d.done_sum), 0)::int,
    coalesce(sum(ap.quantity) * array_length(public.alu_stage_keys(), 1), 0)::int
  from public.order_alu_positions ap
  left join lateral (
    select sum(least(coalesce(nullif(s.value->>'done', '')::int, 0), ap.quantity)) as done_sum
    from jsonb_each(case when jsonb_typeof(ap.production_stages) = 'object'
                         then ap.production_stages else '{}'::jsonb end) s
    where s.key = any (public.alu_stage_keys())
  ) d on true
  where ap.order_id = p_order_id;
$function$;

revoke all on function public.alu_order_progress(bigint) from public, anon;
grant execute on function public.alu_order_progress(bigint) to authenticated, service_role;
