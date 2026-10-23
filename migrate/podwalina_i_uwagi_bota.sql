-- 2026-10-23: podwalina z konfiguratora + uwagi „-” / „undefined”.
--
-- * Konfigurator przysyła pole "podwalina" jako TEKST z JSON-em:
--   '[{"Nazwa":"Podwalina 100 mm","Ilość":"1"}, ...]' albo 'NIE'. create_bot_order
--   nie przepisywał go nigdzie — podwalina była tylko w extra_fields.raw_payload
--   (~45 zleceń STA/Disting), nikt jej nie widział na hali ani na etykiecie.
--   Teraz extra_fields.podwalina = 'Podwalina 100 mm ×1, Podwalina 50 mm ×1'
--   (puste przy 'NIE'); aplikacja pokazuje ją w formularzu, na stanowisku i etykiecie.
-- * Uwagi z konfiguratora przychodziły jako '-' (450 zleceń) albo 'undefined' (6)
--   — w tabeli wyglądało to jak wpisana uwaga. clean_bot_text zamienia śmieci na NULL.
-- * Uzupełnienie istniejących zleceń z bota (podwalina + wyczyszczenie uwag).
-- Stara definicja: migrate/backup_create_bot_order_2026-10-23.sql

CREATE OR REPLACE FUNCTION public.format_podwalina(p_raw text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare
  v_json jsonb;
  v_out text;
begin
  if p_raw is null or trim(p_raw) = '' or upper(trim(p_raw)) in ('NIE', 'BRAK', '-', 'NULL', 'UNDEFINED') then
    return null;
  end if;
  begin
    v_json := p_raw::jsonb;
  exception when others then
    return trim(p_raw); -- nie JSON — zostaw tekst jak przyszedł
  end;
  if jsonb_typeof(v_json) <> 'array' then
    return trim(p_raw);
  end if;
  select string_agg(
           trim(coalesce(el->>'Nazwa', el->>'nazwa', ''))
             || case when coalesce(el->>'Ilość', el->>'Ilosc', el->>'ilosc', '') ~ '[0-9]'
                     then ' ×' || trim(coalesce(el->>'Ilość', el->>'Ilosc', el->>'ilosc')) else '' end,
           ', ')
  into v_out
  from jsonb_array_elements(v_json) el
  where trim(coalesce(el->>'Nazwa', el->>'nazwa', '')) <> '';
  return nullif(v_out, '');
end;
$function$;

CREATE OR REPLACE FUNCTION public.clean_bot_text(p_raw text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case
    when p_raw is null then null
    when lower(trim(p_raw)) in ('', '-', '--', 'undefined', 'null', 'none') then null
    else p_raw
  end
$function$;

REVOKE ALL ON FUNCTION public.format_podwalina(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.clean_bot_text(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.format_podwalina(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.clean_bot_text(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_bot_order(p_payload jsonb, p_api_key_id bigint, p_intake_metadata jsonb DEFAULT NULL::jsonb)
 RETURNS TABLE(order_id bigint, order_number text, needs_review boolean, warnings text[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order_id bigint;
  v_order_number text;
  v_next_number integer;
  v_category text;
  v_needs_review boolean := false;
  v_warnings text[] := ARRAY[]::text[];
  v_quantity integer;
  v_configurator_value numeric;
  v_wing_color text;
  v_frame_color text;
  v_handle text;
  v_electric_strike text;
  v_oslonki text;
  v_prog text;
  v_extras jsonb;
  v_external_id text;
  v_sp_a text;
  v_sp_b text;
  v_sp_glazing text;
  v_top_light text;
  v_top_light_glazing text;
  v_dup_id bigint;
  v_dup_number text;
  v_try integer;
BEGIN
  IF p_payload IS NULL THEN
    RAISE EXCEPTION 'Payload nie moze byc pusty';
  END IF;

  v_category := p_payload->>'category';
  IF v_category IS NULL OR v_category = '' THEN
    RAISE EXCEPTION 'Pole category jest wymagane';
  END IF;

  v_category := TRIM(v_category);

  IF UPPER(v_category) = 'BASTION' THEN v_category := 'Bastion';
  ELSIF UPPER(v_category) = 'DISTING' THEN v_category := 'Disting';
  ELSIF UPPER(v_category) = 'STA' THEN v_category := 'STA';
  ELSIF UPPER(v_category) = 'ST' THEN v_category := 'ST';
  ELSIF UPPER(v_category) = 'DRZWIWEWNETRZNE' THEN v_category := 'DrzwiWewnetrzne';
  ELSE
    v_warnings := array_append(v_warnings, 'Nieznana kategoria: ' || v_category);
    v_needs_review := true;
  END IF;

  SELECT COALESCE(MAX(NULLIF(o.order_number, '')::integer), 0) + 1
  INTO v_next_number
  FROM orders o
  WHERE o.category = v_category
    AND o.order_number ~ '^[0-9]+$';

  v_order_number := v_next_number::text;

  BEGIN
    v_quantity := COALESCE((p_payload->>'ilosc')::integer, 1);
    IF v_quantity < 1 THEN v_quantity := 1; END IF;
  EXCEPTION WHEN OTHERS THEN
    v_quantity := 1;
    v_warnings := array_append(v_warnings, 'Nie udalo sie sparsowac ilosc');
  END;

  BEGIN
    v_configurator_value := (p_payload->>'wartoscKonfigurator')::numeric;
  EXCEPTION WHEN OTHERS THEN
    v_configurator_value := NULL;
  END;

  v_wing_color := COALESCE(
    p_payload->>'kolorSkrzydla',
    p_payload->>'kolorSkrzydlaCalk',
    p_payload->>'kolorSkrzydlaWF'
  );

  v_frame_color := COALESCE(
    p_payload->>'kolorOscieznicy',
    p_payload->>'kolorOscieznicyCalk',
    p_payload->>'kolorOscieznicyWF'
  );

  v_handle := p_payload->>'pochwyt';
  v_electric_strike := p_payload->>'elektrozaczep';
  -- #57: normalizacja do slownika Zaczepy (BRAK/MECHANICZNY/ELEKTROZACZEP);
  -- konfigurator wysyla "Nie" gdy zaczepu brak, historyczne "Tak" = elektrozaczep
  IF UPPER(TRIM(COALESCE(v_electric_strike, ''))) = 'NIE' THEN
    v_electric_strike := 'BRAK';
  ELSIF UPPER(TRIM(COALESCE(v_electric_strike, ''))) = 'TAK' THEN
    v_electric_strike := 'ELEKTROZACZEP';
  END IF;
  v_oslonki := p_payload->>'oslonki';
  v_prog := p_payload->>'rodzajProgu';

  -- Dostawki boczne i naświetle górne (format jak formularz: "SZER×WYS")
  v_sp_a := CASE
    WHEN COALESCE(p_payload->>'szerokoscDostawkiBocznejA', '') ~ '[1-9]' THEN
      TRIM(p_payload->>'szerokoscDostawkiBocznejA')
      || CASE WHEN COALESCE(p_payload->>'wysokoscDostawkiBocznej', '') ~ '[1-9]'
              THEN '×' || TRIM(p_payload->>'wysokoscDostawkiBocznej') ELSE '' END
    ELSE '' END;
  v_sp_b := CASE
    WHEN COALESCE(p_payload->>'szerokoscDostawkiBocznejB', '') ~ '[1-9]' THEN
      TRIM(p_payload->>'szerokoscDostawkiBocznejB')
      || CASE WHEN COALESCE(p_payload->>'wysokoscDostawkiBocznej', '') ~ '[1-9]'
              THEN '×' || TRIM(p_payload->>'wysokoscDostawkiBocznej') ELSE '' END
    ELSE '' END;
  v_sp_glazing := CASE WHEN v_sp_a <> '' OR v_sp_b <> ''
                       THEN COALESCE(p_payload->>'szklenieDostawkiBocznej', '') ELSE '' END;
  v_top_light := CASE
    WHEN COALESCE(p_payload->>'szerokoscNaswietlaGornego', '') ~ '[1-9]' THEN
      TRIM(p_payload->>'szerokoscNaswietlaGornego')
      || CASE WHEN COALESCE(p_payload->>'wysokoscNaswietlaGornego', '') ~ '[1-9]'
              THEN '×' || TRIM(p_payload->>'wysokoscNaswietlaGornego') ELSE '' END
    ELSE '' END;
  v_top_light_glazing := CASE WHEN v_top_light <> ''
                              THEN COALESCE(p_payload->>'szklenieNaswietlaGornego', '') ELSE '' END;

  v_external_id := p_payload->>'recordId';

  IF p_payload->>'modelDrzwi' IS NULL OR p_payload->>'modelDrzwi' = '' THEN
    v_warnings := array_append(v_warnings, 'Brak modelu drzwi');
    v_needs_review := true;
  END IF;

  IF p_payload->>'numerZamowienia' IS NULL OR p_payload->>'numerZamowienia' = '' THEN
    v_warnings := array_append(v_warnings, 'Brak numeru zamowienia klienta');
    v_needs_review := true;
  END IF;

  IF p_payload->>'nazwaFirmy' IS NULL OR p_payload->>'nazwaFirmy' = '' THEN
    v_warnings := array_append(v_warnings, 'Brak nazwy firmy');
    v_needs_review := true;
  END IF;

  IF v_external_id IS NOT NULL AND v_external_id != '' THEN
    IF EXISTS (SELECT 1 FROM orders WHERE airtable_id = v_external_id) THEN
      RAISE EXCEPTION 'Zamowienie z recordId % juz istnieje (duplikat)', v_external_id;
    END IF;
  END IF;

  -- Dedup bot<->bot ZMIĘKCZONY (2026-10-18): identyczny payload bez recordId
  -- NIE jest odrzucany, tylko flagowany do weryfikacji. Powód: Airtable
  -- wysyła wieloelementowe rekordy jako N identycznych żądań po 1 szt.
  -- (44 legalne przypadki w pół roku) — twarde odrzucenie gubiłoby realne
  -- zamówienia. Prawdziwe duble wyłapuje kierownik (badge ⚠️ + dzwonek).
  SELECT o.id, o.order_number INTO v_dup_id, v_dup_number
  FROM orders o
  WHERE o.source = 'bot'
    AND o.created_at > now() - interval '21 days'
    AND (o.extra_fields->'raw_payload') - 'recordId' = (p_payload - 'recordId')
  LIMIT 1;
  IF v_dup_id IS NOT NULL THEN
    v_warnings := array_append(v_warnings,
      'MOZLIWY DUPLIKAT: identyczny payload jak zlecenie ' || v_dup_number || ' (id ' || v_dup_id || ')');
    v_needs_review := true;
  ELSIF COALESCE(p_payload->>'numerZamowienia', '') <> '' AND EXISTS (
    SELECT 1 FROM orders o
    WHERE o.source = 'bot'
      AND o.created_at > now() - interval '21 days'
      AND o.category = v_category
      AND UPPER(TRIM(COALESCE(o.client_order_number, ''))) = UPPER(TRIM(p_payload->>'numerZamowienia'))
      AND UPPER(TRIM(COALESCE(o.company, ''))) = UPPER(TRIM(COALESCE(p_payload->>'nazwaFirmy', '')))
  ) THEN
    v_warnings := array_append(v_warnings, 'Mozliwy duplikat: ta sama firma i numer zamowienia klienta w ostatnich 21 dniach');
    v_needs_review := true;
  END IF;

  v_extras := jsonb_build_object(
    'bot_received_at', now(),
    'api_key_id', p_api_key_id,
    'raw_payload', p_payload,
    'needs_review', v_needs_review,
    'warnings', to_jsonb(v_warnings),
    'wzorDwustronny', p_payload->>'wzorDwustronny',
    'wymiarPoszerzenia', p_payload->>'wymiarPoszerzenia',
    'firmaRealizujaca', p_payload->>'firmaRealizujaca',
    'nowyBot', p_payload->>'nowyBot',
    'panelBoczny_legacy', p_payload->>'panelBoczny',
    'regulacjaOscieznicy', p_payload->>'regulacjaOscieznicy',
    'oscieznica_typ', p_payload->>'oscieznica',
    'uwagi2', p_payload->>'uwagi2',
    -- 2026-10-23: podwalina z konfiguratora ginęła (była tylko w raw_payload)
    'podwalina', public.format_podwalina(p_payload->>'podwalina')
  );

  -- INSERT z ponowieniem przy kolizji numeru (unikalny indeks od 2026-10-17)
  FOR v_try IN 1..3 LOOP
    BEGIN
      INSERT INTO orders (
        order_number,
        category, company, client_order_number, quantity, order_date,
        system, model, wing_color, frame_color, threshold_color,
        width, height, direction, opening,
        glazing, decorative_panel, hardware, handle, electric_strike, peephole,
        oslonki, zaczep, prog,
        top_light, top_light_glazing,
        side_panel, side_panel_glazing,
        side_panel_a, side_panel_b, side_panel_a_glazing, side_panel_b_glazing,
        bastion_frame_type, bastion_frame_range, bastion_notes_2,
        production_day, notes, info, configurator_value, airtable_id,
        source, source_metadata, extra_fields, entered_by
      ) VALUES (
        v_order_number,
        COALESCE(NULLIF(v_category, ''), p_payload->>'category'),
        p_payload->>'nazwaFirmy', p_payload->>'numerZamowienia', v_quantity, CURRENT_DATE,
        p_payload->>'system', p_payload->>'modelDrzwi', v_wing_color, v_frame_color, p_payload->>'kolorProgu',
        p_payload->>'szerokosc', p_payload->>'wysokosc', p_payload->>'kierunek', p_payload->>'otwieranie',
        p_payload->>'szklenie', p_payload->>'panelDekoracyjny', p_payload->>'okucia', v_handle, v_electric_strike, p_payload->>'wizjer',
        v_oslonki, v_electric_strike, v_prog,
        v_top_light, v_top_light_glazing,
        v_sp_a, v_sp_glazing,
        v_sp_a, v_sp_b, v_sp_glazing, v_sp_glazing,
        p_payload->>'oscieznica', p_payload->>'regulacjaOscieznicy',
        -- uwagi2 bota ("DOSTAWA DO...", "nawiercic otwory") byly niewidoczne
        -- w extra_fields — teraz trafiaja do kolumny Uwagi 2 jak z Excela
        COALESCE(public.clean_bot_text(p_payload->>'uwagi2'), ''),
        p_payload->>'dzienProdukcji', public.clean_bot_text(p_payload->>'uwagi'), NULL /* info: firmaRealizujaca tylko w extra_fields -> wykonawca */, v_configurator_value, v_external_id,
        'bot', COALESCE(p_intake_metadata, '{}'::jsonb), v_extras, 'BOT (Konfigurator)'
      ) RETURNING id INTO v_order_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_try = 3 THEN RAISE; END IF;
      SELECT COALESCE(MAX(NULLIF(o.order_number, '')::integer), 0) + 1
      INTO v_next_number
      FROM orders o
      WHERE o.category = v_category
        AND o.order_number ~ '^[0-9]+$';
      v_order_number := v_next_number::text;
    END;
  END LOOP;

  RETURN QUERY SELECT v_order_id, v_order_number, v_needs_review, v_warnings;
END;
$function$;

-- Uzupełnienie istniejących zleceń z bota
UPDATE public.orders o
SET extra_fields = o.extra_fields || jsonb_build_object('podwalina', public.format_podwalina(o.extra_fields->'raw_payload'->>'podwalina'))
WHERE o.source = 'bot'
  AND o.extra_fields->'raw_payload' ? 'podwalina'
  AND public.format_podwalina(o.extra_fields->'raw_payload'->>'podwalina') IS NOT NULL
  AND NOT (o.extra_fields ? 'podwalina' AND coalesce(o.extra_fields->>'podwalina', '') <> '');

UPDATE public.orders
SET notes = NULL
WHERE source = 'bot' AND notes IS NOT NULL AND public.clean_bot_text(notes) IS NULL;
