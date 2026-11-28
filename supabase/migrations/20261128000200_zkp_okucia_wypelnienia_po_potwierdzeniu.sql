-- Karta wyrobu: okucia (cz. D) i wypełnienia (cz. E) dało się wpisać PRZED
-- potwierdzeniem zakresu (cz. B) albo po jego cofnięciu, a etapy (zkp_record_card_stage)
-- już to blokowały. Ten sam warunek i komunikat. Testy 28.11 (runda 8, ZKP).
-- Reszta obu funkcji bez zmian.

create or replace function public.zkp_save_card_hardware(p_card_id bigint, p_slot text, p_producer_model text, p_dwu_no text, p_count integer, p_condition_ref text, p_lot_id bigint)
 returns bigint
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_card public.zkp_product_cards;
  v_id   bigint;
begin
  if not public.zkp_can_record_card() then
    raise exception 'Okucia w karcie wpisuje operator produkcji / kontroler / Kierownik Produkcji / PJ (role ZKP) albo kierownik';
  end if;
  select * into v_card from public.zkp_product_cards where id = p_card_id for update;
  if not found or v_card.decision is not null then
    raise exception 'Karta nie istnieje albo jest zamknięta';
  end if;
  -- testy 28.11 (runda 8, ZKP): jak w zkp_record_card_stage
  if v_card.range_confirmed_at is null then
    raise exception 'Najpierw sprawdzenie i potwierdzenie zakresu (cz. B) — dopiero potem produkcja';
  end if;
  if p_lot_id is not null then
    perform public.zkp_assert_card_lot(p_lot_id, v_card.range_code, array['okucie'], false);
  end if;
  insert into public.zkp_card_hardware
    (card_id, slot, producer_model, dwu_no, count, condition_ref, lot_id, recorded_by, recorded_by_name)
  values
    (p_card_id, p_slot, trim(coalesce(p_producer_model, '')), trim(coalesce(p_dwu_no, '')), coalesce(p_count, 0),
     trim(coalesce(p_condition_ref, '')), p_lot_id, auth.uid(), public.zkp_current_user_name())
  returning id into v_id;
  return v_id;
end;
$function$;

create or replace function public.zkp_save_card_filling(p_card_id bigint, p_field text, p_table_row text, p_product text, p_thickness numeric, p_dims text, p_lot_id bigint)
 returns bigint
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_card  public.zkp_product_cards;
  v_range public.zkp_ranges;
  v_id    bigint;
begin
  if not public.zkp_can_record_card() then
    raise exception 'Wypełnienia w karcie wpisuje operator produkcji / kontroler / Kierownik Produkcji / PJ (role ZKP) albo kierownik';
  end if;
  select * into v_card from public.zkp_product_cards where id = p_card_id for update;
  if not found or v_card.decision is not null then
    raise exception 'Karta nie istnieje albo jest zamknięta';
  end if;
  -- testy 28.11 (runda 8, ZKP): jak w zkp_record_card_stage
  if v_card.range_confirmed_at is null then
    raise exception 'Najpierw sprawdzenie i potwierdzenie zakresu (cz. B) — dopiero potem produkcja';
  end if;
  select * into v_range from public.zkp_ranges where code = v_card.range_code;
  if p_thickness is not null and v_range.code is not null
     and (p_thickness < v_range.fill_min or p_thickness > v_range.fill_max) then
    raise exception 'Grubość wypełnienia % mm poza zakresem % (% – % mm)', p_thickness, v_range.code, v_range.fill_min, v_range.fill_max;
  end if;
  if p_lot_id is not null then
    perform public.zkp_assert_card_lot(p_lot_id, v_card.range_code, array['szklo', 'wypelnienie'], false);
  end if;
  insert into public.zkp_card_fillings
    (card_id, field, table_row, product, thickness_mm, dims, lot_id, recorded_by, recorded_by_name)
  values
    (p_card_id, p_field, trim(coalesce(p_table_row, '')), trim(coalesce(p_product, '')), p_thickness,
     trim(coalesce(p_dims, '')), p_lot_id, auth.uid(), public.zkp_current_user_name())
  returning id into v_id;
  return v_id;
end;
$function$;
