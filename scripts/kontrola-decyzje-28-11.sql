-- Kontrola po wgraniu migracji z decyzji właściciela 28.11.2026 (TESTING_LOG: „Decyzje właściciela 28.11”).
-- Tylko odczyt. KAŻDE zapytanie: pusty wynik = OK. Uruchamiać po wgraniu odpowiednich plików.

-- D7 (232800): kolumna orientacyjna w alertach
select 'D7 brak r_forecast_indicative' where not exists (select 1 from pg_proc where proname = 'get_stock_alerts' and pg_get_function_result(oid) like '%r_forecast_indicative%');
-- D14 (030200): blokada na zamkniętym spisie
select 'D14 blokada na zamkniętym spisie', id from inventory_sessions where blokada_ruchow and status <> 'open';
-- D16 (030300): jedna wersja create_mm_document
select 'D16 dwie wersje create_mm_document' where (select count(*) from pg_proc where proname = 'create_mm_document') <> 1;
-- D15 (030400)
select 'D15 brak r_partial_rebuilt' where not exists (select 1 from pg_proc where proname = 'rebuild_reservations_for_category' and pg_get_function_result(oid) like '%r_partial_rebuilt%');
-- D41 (030100): niesprawdzone błędy zdjęcia starsze niż 2 dni (do przejrzenia w Weryfikacji)
select 'D41 niesprawdzone zdjęcie', order_id, kind, stage_key from stock_release_failures where resolved_at is null and created_at < now() - interval '2 days';

-- D12 / D43 / D31 / D59 (0310xx)
select 'D12 cena w orders' k, id from orders where configurator_value is not null or extra_fields->'raw_payload' ? 'wartoscKonfigurator'
union all select 'D12 cena w reklamacji', id from complaints where nullif(btrim(configurator_value), '') is not null
union all select 'brak triggera ' || t, null from unnest(array['trg_orders_block_cancel_released', 'trg_ceny_konfiguratora', 'trg_orders_block_route_pin_magazynier']) t where not exists (select 1 from pg_trigger where tgname = t)
union all select 'D59 polityka nie-admin', null from pg_policies where tablename in ('label_templates', 'print_documents') and cmd <> 'SELECT' and coalesce(qual, with_check) not ilike '%current_user_is_admin%'
union all select 'D12 brak RLS ceny', null where not exists (select 1 from pg_policies where tablename = 'ceny_konfiguratora' and policyname = 'ceny_konfiguratora_select');

-- D22/D64 / D25 (032000, 032100)
select 'D22: brak tabeli excel_cofniete_etapy' where to_regclass('public.excel_cofniete_etapy') is null;
select 'D22: brak triggera ' || t from unnest(array['public.orders', 'public.complaints']) t
 where not exists (select 1 from pg_trigger where tgname = 'trg_excel_cofniete_etapy' and tgrelid = t::regclass);
select 'D22: sync_complaints_from_excel bez łatki' where position('D22/D64 (28.11), cofnięte w programie' in pg_get_functiondef('public.sync_complaints_from_excel(jsonb,text,text,boolean)'::regprocedure)) = 0;
select 'D25: sync_stages_from_excel bez dat etapów' where position('daty_etapow' in pg_get_functiondef('public.sync_stages_from_excel(jsonb,boolean,bigint,text)'::regprocedure)) = 0;
select 'D22: anon widzi excel_cofniete_etapy' where has_table_privilege('anon', 'public.excel_cofniete_etapy', 'select');

-- CRM D17 / D18 / D19 / D21 (0330xx)
select 'CRM brak znacznika ' || f || ' [' || z || ']'
from (values
  ('crm.dokumenty_umowa_zamknieta()', 'crm.odstapienie_umowy'),
  ('crm.odstap_od_umowy(uuid,text)', 'umowa_odstapienie'),
  ('crm.zamowienie_bl_wygrany(bigint)', 'automatycznie z Baselinkera'),
  ('crm.przywroc_do_gry(uuid,text,boolean,uuid)', 'ofert_przywroconych'),
  ('crm.po_wyslaniu_oferty()', 'crm.przywracanie_ofert')
) v(f, z)
where to_regprocedure(f) is null or position(z in pg_get_functiondef(to_regprocedure(f))) = 0;
select 'CRM brak triggera zamowienia_sklep_wygrany' where not exists (select 1 from pg_trigger where tgname = 'zamowienia_sklep_wygrany');

-- D62 (034000)
select 'D62 nie wgrane' where pg_get_functiondef('public.current_user_can_pick()'::regprocedure) not ilike '%DrzwiWewnetrzne%';

-- ZKP D52 / D53 / D54 / D57 / D58 (0350xx)
select 'D52 brak p_reason' where not exists (select 1 from pg_proc where proname = 'set_alu_order_zkp' and pg_get_function_identity_arguments(oid) like '%p_reason%');
select 'D53 brak p_pin' where not exists (select 1 from pg_proc where proname = 'mark_alu_position_stage' and pg_get_function_identity_arguments(oid) like '%p_pin%');
select 'D53 stara sygnatura etapu' from pg_proc where proname = 'mark_alu_position_stage' and pg_get_function_identity_arguments(oid) not like '%p_pin%';
select 'D53 PIN dostępny dla klientów' where has_table_privilege('authenticated', 'public.zkp_signature_pins', 'select');
select 'D53 zkp_check_pin dostępna' where has_function_privilege('authenticated', 'public.zkp_check_pin(uuid,text)', 'execute');
select 'D54/D57 brak blokady' where position('P0423' in pg_get_functiondef('public.mark_alu_position_stage(bigint,text,text,integer,text)'::regprocedure)) = 0;
select 'D57 łatka' where position('D57 (28.11)' in pg_get_functiondef('public.zkp_save_card(bigint,jsonb)'::regprocedure)) = 0
   or position('D57 (28.11)' in pg_get_functiondef('public.alu_dossier_status(bigint)'::regprocedure)) = 0
   or position('D57 (28.11)' in pg_get_functiondef('public.zkp_product_register()'::regprocedure)) = 0;
select 'D58 kwalifikacja bez terminu' where position('next_assessment_on' in pg_get_functiondef('public.zkp_supplier_is_qualified(bigint)'::regprocedure)) = 0;

-- D68 / D10 (0360xx)
select 'D68 tabele migracja_* nadal w public' where to_regclass('public.migracja_arkusz_sta') is not null or to_regclass('public.migracja_sta_akcje') is not null or to_regclass('public.migracja_sta_backup') is not null;
select 'D10 brak tabeli nieudanych RO albo MR_WEW' where to_regclass('public.optima_ro_failures') is null or not exists (select 1 from warehouses where code = 'MR_WEW');
select 'D10 uprawnienia funkcji RO' where has_function_privilege('anon', 'public.optima_ro_blad_ponow(bigint)', 'execute') or has_function_privilege('authenticated', 'public.optima_ro_blad_zapisz(text,bigint,text,text,jsonb)', 'execute');
select 'D10 stat_wew bez p_firma', proname from pg_proc where proname in ('stat_wew_sprzedaz', 'stat_wew_miesiace', 'stat_wew_braki') group by proname having count(*) > 1 or bool_and(pg_get_function_identity_arguments(oid) not like '%p_firma%');
-- po wdrożeniu Edge optima-ro-import:
select 'D10 zlecenie MR bez przedrostka', id from orders where source = 'optima_ro' and source_metadata->>'optima_key' like 'MR:%' and order_number not like 'MR/%';
-- D8 (036200, po potwierdzeniu):
-- select 'D8 nie wgrane' where position('D8 (28.11), Disting Plus' in pg_get_functiondef('public.release_stock_for_stage(bigint,text,boolean)'::regprocedure)) = 0;
