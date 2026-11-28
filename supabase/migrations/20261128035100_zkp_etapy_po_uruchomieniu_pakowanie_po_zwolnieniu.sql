-- 28.11.2026 — decyzja D54 (właściciel: TAK). DO WDROŻENIA (nie wgrane). Wgrywać PO 20261128020000.
-- Problem: na zleceniu ZKP (AS 75EI) można było przejść wszystkie etapy — z pakowaniem — przed
-- „Uruchom do produkcji”, przed potwierdzeniem zakresu karty i bez kontroli odbiorczej.
-- Teraz (twarda blokada w bazie, kod błędu P0423, komunikat czytelny dla pracownika):
--  * pozycja podlegająca ZKP: KAŻDY etap dopiero po „Uruchom do produkcji” (wiersz w alu_production_orders);
--  * pakowanie kolejnej sztuki dopiero, gdy pozycja ma tyle ZWOLNIONYCH kart wyrobu (zkp_product_cards.decision
--    = 'zwolniony' na aktywnych konstrukcjach tej pozycji), ile sztuk będzie spakowanych (done + 1).
--  * zwykłe zlecenia aluminium — bez zmian.
-- Nowa funkcja alu_position_is_zkp(pozycja): na razie = alu_order_is_zkp(zlecenie pozycji); decyzja D57
-- (plik 20261128035400) zmienia ją na rozpoznanie per pozycja — dlatego mark_alu_position_stage pyta o pozycję.
-- mark_alu_position_stage: pełna definicja jak w 20261128020000 + powyższe blokady (ta sama sygnatura).

create or replace function public.alu_position_is_zkp(p_position_id bigint)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce((select public.alu_order_is_zkp(p.order_id) from public.order_alu_positions p where p.id = p_position_id), false);
$function$;

revoke all on function public.alu_position_is_zkp(bigint) from public, anon;
grant execute on function public.alu_position_is_zkp(bigint) to authenticated, service_role;

drop function if exists public.mark_alu_position_stage(bigint, text, text);

create or replace function public.mark_alu_position_stage(
  p_position_id bigint, p_stage_key text, p_initials text, p_expected_done integer default null
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

revoke all on function public.mark_alu_position_stage(bigint, text, text, integer) from public, anon;
grant execute on function public.mark_alu_position_stage(bigint, text, text, integer) to authenticated, service_role;
