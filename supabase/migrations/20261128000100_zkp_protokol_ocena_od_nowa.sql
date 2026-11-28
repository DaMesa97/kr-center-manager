-- Protokół badań (zał. 6.17.5): zamknięcie jako ZWOLNIONY szło na podstawie STAREJ
-- oceny pomiarów (kolumna eval zapisana raz w zkp_save_test_protocol). Po cofnięciu
-- zakresu karty, zmianie wymiarów (np. 1000 → 1300) i ponownym potwierdzeniu protokół
-- nadal był „OK”. Testy 28.11 (runda 8, ZKP).
-- Teraz (bez zmiany schematu):
--  1) zkp_protocol_problems liczy ocenę pomiarów OD NOWA z bieżącej karty
--     (zkp_protocol_eval(card_id, measurements)), a nie z zapisanej eval;
--  2) jeśli zakres karty potwierdzono ponownie PO ostatnim zapisie protokołu
--     (range_confirmed_at > updated_at protokołu), protokół „wymaga ponownej oceny”:
--     zwolnienie blokowane, dopóki kontroler nie zapisze protokołu ponownie;
--  3) zkp_close_test_protocol: ocena ZGODNY niemożliwa, gdy świeża ocena ma NOK
--     (także przy decyzji „wstrzymany”); przy zamknięciu zapisuje świeżą ocenę
--     (eval, nok_count), żeby archiwalny protokół pokazywał to, co oceniono.
-- zkp_reopen_card_range bez zmian — znacznik „wymaga ponownej oceny” wynika z dat (pkt 2).

create or replace function public.zkp_protocol_problems(p_protocol_id bigint)
 returns table(r_problem text)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  p public.zkp_test_protocols;
  c public.zkp_product_cards;
  req_checks text[] := array['b1','b2','b3','b4','b5','d1','d2','d3','d4','d5','d6','d7','d8','e1','e2','e3','e4','e5','e6','e7','f1','f2'];
  k text;
  e record;
begin
  select * into p from public.zkp_test_protocols where id = p_protocol_id;
  if not found then r_problem := 'protokół nie istnieje'; return next; return; end if;
  if p.inspector_id is null then r_problem := 'brak kontrolera'; return next; end if;

  -- testy 28.11 (runda 8, ZKP): karta zmieniona po zapisaniu protokołu → wymaga ponownej oceny
  select * into c from public.zkp_product_cards where id = p.card_id;
  if c.range_confirmed_at is not null and c.range_confirmed_at > p.updated_at then
    r_problem := 'karta zmieniona po zapisaniu protokołu (zakres potwierdzony ponownie '
      || to_char(c.range_confirmed_at at time zone 'Europe/Warsaw', 'DD.MM.YYYY HH24:MI')
      || ') — sprawdź pomiary i zapisz protokół ponownie';
    return next;
  end if;

  foreach k in array req_checks loop
    if p.checks->>k is null then
      r_problem := 'sprawdzenie ' || upper(k) || ' bez wyniku'; return next;
    elsif p.checks->>k = 'NOK' then
      r_problem := 'sprawdzenie ' || upper(k) || ' = NOK'; return next;
    end if;
  end loop;

  -- testy 28.11 (runda 8, ZKP): ocena pomiarów od nowa wg BIEŻĄCEJ karty (nie zapisana p.eval)
  if exists (select 1 from public.zkp_ranges r where r.code = c.range_code) then
    for e in select * from public.zkp_protocol_eval(p.card_id, p.measurements) loop
      if e.r_result is null then
        r_problem := 'pomiar „' || e.r_label || '” bez wyniku'; return next;
      elsif e.r_result = 'NOK' then
        r_problem := 'pomiar „' || e.r_label || '” = NOK (wg bieżącej karty)'; return next;
      end if;
    end loop;
  else
    r_problem := 'karta bez zakresu raportu — nie można ocenić pomiarów'; return next;
  end if;

  -- karta musi być kompletna (etapy, okucia, wypełnienia) — jak przy ręcznym zwolnieniu
  return query select pr.r_problem from public.zkp_card_release_problems(p.card_id) pr;
end;
$function$;

create or replace function public.zkp_close_test_protocol(p_protocol_id bigint, p_assessment text, p_decision text, p_nonconformity_ref text, p_notes text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  p      public.zkp_test_protocols;
  v_bad  text;
  v_eval jsonb;
  v_nok  int;
begin
  if not public.current_user_has_zkp_role(array['pelnomocnik', 'zastepca']) then
    raise exception 'Protokół zamyka i konstrukcję zwalnia Pełnomocnik ZKP albo Zastępca (zał. 6.4)';
  end if;
  if p_assessment not in ('zgodny', 'niezgodny') then raise exception 'Ocena: zgodny albo niezgodny'; end if;
  if p_decision not in ('zwolniony', 'wstrzymany') then raise exception 'Decyzja: zwolniony albo wstrzymany'; end if;
  select * into p from public.zkp_test_protocols where id = p_protocol_id and decision is null for update;
  if not found then raise exception 'Protokół nie istnieje albo jest już zamknięty'; end if;

  -- testy 28.11 (runda 8, ZKP): ocena pomiarów od nowa wg bieżącej karty (zapisana eval mogła się zestarzeć)
  v_eval := p.eval;
  v_nok := p.nok_count;
  if exists (select 1 from public.zkp_product_cards c join public.zkp_ranges r on r.code = c.range_code where c.id = p.card_id) then
    select coalesce(jsonb_agg(jsonb_build_object('sort', e.r_sort, 'key', e.r_key, 'label', e.r_label, 'nominal', e.r_nominal,
             'measured', e.r_measured, 'criterion', e.r_criterion, 'result', e.r_result, 'auto', e.r_auto) order by e.r_sort), '[]'::jsonb),
           count(*) filter (where e.r_result = 'NOK'),
           string_agg('„' || e.r_label || '”', ', ' order by e.r_sort) filter (where e.r_result = 'NOK')
    into v_eval, v_nok, v_bad
    from public.zkp_protocol_eval(p.card_id, p.measurements) e;
    v_nok := v_nok + (select count(*) from jsonb_each_text(p.checks) where value = 'NOK');
    if p_assessment = 'zgodny' and v_bad is not null then
      raise exception 'Ocena ZGODNY niemożliwa — pomiary NOK wg bieżącej karty: %. Sprawdź pomiary i zapisz protokół ponownie albo oceń jako niezgodny', v_bad;
    end if;
    v_bad := null;
  end if;

  if p_decision = 'zwolniony' then
    if p_assessment <> 'zgodny' then raise exception 'Zwolnić można tylko konstrukcję ocenioną jako zgodna'; end if;
    select string_agg(r_problem, '; ') into v_bad from public.zkp_protocol_problems(p_protocol_id);
    if v_bad is not null then raise exception 'Nie można zwolnić — %', v_bad; end if;
  end if;
  if p_assessment = 'niezgodny' and length(trim(coalesce(p_nonconformity_ref, ''))) = 0 then
    raise exception 'Ocena NIEZGODNY wymaga numeru wpisu w rejestrze 6.20';
  end if;

  update public.zkp_test_protocols
  set assessment = p_assessment, decision = p_decision, nonconformity_ref = trim(coalesce(p_nonconformity_ref, '')),
      eval = v_eval, nok_count = v_nok,
      notes = case when length(trim(coalesce(p_notes, ''))) > 0 then trim(p_notes) else notes end,
      closed_at = now(), closed_by = auth.uid(), closed_by_name = public.zkp_current_user_name(), updated_at = now()
  where id = p_protocol_id;

  if p_decision = 'zwolniony' then
    update public.zkp_product_cards
    set decision = 'zwolniony', test_protocol_no = p.protocol_no, released_on = current_date,
        decision_notes = trim(coalesce(p_notes, '')),
        decided_at = now(), decided_by = auth.uid(), decided_by_name = public.zkp_current_user_name(),
        updated_at = now(), updated_by = auth.uid()
    where id = p.card_id and decision is null;
  elsif p_assessment = 'niezgodny' then
    update public.zkp_product_cards
    set decision = 'niezgodny', test_protocol_no = p.protocol_no, nonconformity_ref = trim(p_nonconformity_ref),
        decision_notes = trim(coalesce(p_notes, '')),
        decided_at = now(), decided_by = auth.uid(), decided_by_name = public.zkp_current_user_name(),
        updated_at = now(), updated_by = auth.uid()
    where id = p.card_id and decision is null;
  end if;
end;
$function$;
