-- Runda 11 (28.11, recenzent): „Cofnij sztukę” w aluminium ma ten sam problem co oznaczanie (020000):
-- zgubiona odpowiedź i ponowne kliknięcie cofały DRUGĄ sztukę (done = v_cur - 1 bez wiedzy, co widział człowiek).
-- Opcjonalny p_expected_done: gdy podany i różny od stanu w bazie → odmowa P0409.
-- Stara sygnatura (2 parametry) usuwana, żeby PostgREST nie miał dwóch kandydatów; wersja 1.1.7 wołająca
-- z 2 parametrami działa dalej (domyślnie null = jak dotąd). Aplikacja przy braku migracji (PGRST202) woła bez parametru.

drop function if exists public.undo_alu_position_stage(bigint, text);

create or replace function public.undo_alu_position_stage(
  p_position_id bigint, p_stage_key text, p_expected_done integer default null
)
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

  -- runda 11 (28.11): ponowienie / drugie okno — stan w bazie inny niż widziany przy kliknięciu
  if p_expected_done is not null and v_cur <> p_expected_done then
    raise exception 'Stan sztuk się zmienił: etap % ma już % szt. (poprzednie cofnięcie mogło przejść albo ktoś inny zmienił) — odśwież',
      public.alu_stage_name(p_stage_key), v_cur
      using errcode = 'P0409';
  end if;

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

revoke all on function public.undo_alu_position_stage(bigint, text, integer) from public, anon;
grant execute on function public.undo_alu_position_stage(bigint, text, integer) to authenticated, service_role;
