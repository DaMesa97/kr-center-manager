-- =====================================================================
-- Etapy produkcji aluminium ZGODNE Z ZKP AS 75EI (Tymek, 4.11.2026).
--
-- 1. Kolejność etapów per sztuka jak w zał. 6.25 / instrukcjach stanowiskowych:
--    cięcie (IS-01) → składanie = łączenie profili, uszczelki (IS-03) →
--    okucia (IS-04) → szklenie (IS-05) → pakowanie. Dotąd okuwanie było przed
--    składaniem. Klucze bez zmian (worker_stages zostają), zmienia się tylko
--    kolejność w alu_stage_keys() — a od niej zależy przepływ sztukowy
--    (mark/undo). Otwarte zlecenia nie mają jeszcze postępu, więc bez migracji danych.
-- 2. Dla zlecenia ZKP (alu_order_is_zkp) sztukę może oznaczyć tylko osoba
--    z AKTYWNYM uprawnieniem do operacji etapu w matrycy kompetencji 6.27 —
--    ta sama reguła co podpis etapu karty wyrobu (zkp_record_card_stage).
--    Inicjały z kafelka → osoba (zkp_profile_by_initials), potem
--    zkp_assert_competency. Bez uprawnień = czytelna odmowa z nazwiskiem.
-- Lustro w kliencie: ALU_STAGE_DEFS / ALU_STAGE_ZKP_OPERATION (constants.ts).
-- Idempotentne.
-- =====================================================================

create or replace function public.alu_stage_keys()
returns text[]
language sql
immutable
set search_path to 'public'
as $function$
  select array['ciecie', 'skladanie', 'okuwanie', 'szklenie', 'pakowanie']::text[];
$function$;

create or replace function public.alu_stage_name(p_stage_key text)
returns text
language sql
immutable
set search_path to 'public'
as $function$
  select case p_stage_key
    when 'ciecie'    then 'cięcie i obróbka (IS-01)'
    when 'skladanie' then 'składanie / łączenie (IS-03)'
    when 'okuwanie'  then 'okucia (IS-04)'
    when 'szklenie'  then 'szklenie (IS-05)'
    when 'pakowanie' then 'pakowanie'
    else coalesce(p_stage_key, '?')
  end;
$function$;

-- operacja z matrycy 6.27 dla etapu produkcji (null = poza matrycą: pakowanie)
create or replace function public.alu_stage_zkp_operation(p_stage_key text)
returns text
language sql
immutable
set search_path to 'public'
as $function$
  select case p_stage_key
    when 'ciecie'    then 'IS-01'
    when 'skladanie' then 'IS-03'
    when 'okuwanie'  then 'IS-04'
    when 'szklenie'  then 'IS-05'
  end;
$function$;

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
  v_operation  text;
  v_person     uuid;
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

  v_initials := coalesce(nullif(trim(p_initials), ''), 'T');

  -- ZKP AS 75EI: etap = operacja z matrycy 6.27, podpisuje ją tylko osoba z uprawnieniem
  v_operation := public.alu_stage_zkp_operation(p_stage_key);
  if v_operation is not null and public.alu_order_is_zkp(v_order_id) then
    if v_initials = 'T' then
      raise exception 'Zlecenie ZKP: wybierz osobę (kafelek z inicjałami) — etap % podpisuje konkretna osoba z matrycy 6.27',
        public.alu_stage_name(p_stage_key);
    end if;
    v_person := public.zkp_profile_by_initials(v_initials);
    perform public.zkp_assert_competency(v_person, v_operation);
    -- inicjały w zapisie = jak w profilu (bez różnic wielkości liter)
    select upper(trim(initials)) into v_initials from public.profiles where id = v_person;
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
