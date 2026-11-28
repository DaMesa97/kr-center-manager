-- Kontrola po wdrożeniu migracji z 27.11.2026 (testy 27.11, runda 3).
-- Tylko odczyt. Uruchom w SQL Editor po wgraniu WSZYSTKICH migracji 20261127221000…20261127235100 oraz 20261128000000…20261128010500 (runda 8: ZKP, powiadomienia, słowniki)
-- oraz 20261128021000… (runda 10 (28.11), tor r10-baza).
-- Wynik: lista braków. PUSTY wynik = wszystko na miejscu.
-- (Znaczniki funkcji z próby generalnej r5 + znaczniki z plików 20261127234000…235100
--  + 20261128010000…20261128010500 — noc 28.11, tor r8-baza.)
with znaczniki(fn, marker, minimum) as (
  values
    ('public.sync_complaints_from_excel(jsonb,text,text,boolean)', 'jsonb_object_agg(e.k, e.v)', 2),
    ('crm.polacz_leady(uuid,uuid)', 'zamowienia_sklep', 1),
    ('crm.polacz_leady(uuid,uuid)', 'jedna_na_grupe', 1),
    ('crm.polacz_leady(uuid,uuid)', 'firma_sprawdzono_at', 4),
    ('crm.codzienne_porzadki()', 'nastepny_krok >= dzis', 1),
    ('crm.codzienne_porzadki()', 'zamowienia_sklep', 1),
    ('crm.codzienne_porzadki()', 'ofert_odrzuconych', 1),
    ('crm.codzienne_porzadki()', 'get diagnostics n_odrz', 1),
    ('public.revert_order_stage(bigint,text)', 'P0409', 1),
    ('public.return_stock_for_stage(bigint,text)', 'P0409', 1),
    ('public.cancel_purchase_order__impl(bigint)', 'v_przyjete', 3),
    ('public.restore_order_reservations__impl(bigint)', 'cancel_reason = ''order_cancelled'' or status in', 1),
    ('public.reserve_stock_for_order(bigint)', 'zlecenie anulowane: nic nie rezerwujemy', 1),
    ('public.reserve_stock_for_order(bigint)', 'sr.cancel_reason in (''stage_na'', ''order_cancelled'')', 1),
    ('public.get_next_order_number(text)', 'percentile_disc', 1),
    ('public.create_pz_document__impl(bigint,jsonb,text,text)', 'testy 27.11 (runda 3): NaN', 1),
    ('public.create_pz_document__impl(bigint,jsonb,text,text)', 'v_ok := v_ok + 1', 1),
    ('public.create_pz_document__impl(bigint,jsonb,text,text)', 'IF v_ok = 0', 1),
    ('public.create_mm_document__impl(bigint,bigint,jsonb,text,text)', 'IF v_ok = 0', 1),
    ('public.create_wz_reklamacyjny(bigint,jsonb,text,text,bigint,text,text)', 'testy 27.11 (runda 3): NaN', 1),
    ('public.receive_purchase_order__impl(bigint,bigint,jsonb,text,text,boolean)', 'testy 27.11 (runda 3): NaN', 1),
    ('public.report_damage(bigint,bigint,numeric,text,bigint,text)', 'testy 27.11 (runda 3): NaN', 1),
    ('public.record_inventory_count_line__impl(bigint,numeric)', 'testy 27.11 (runda 3): NaN', 1),
    ('public.stat_zew_braki(text,integer)', 'release_date_szacunkowa', 2),
    ('public.get_component_consumption_history(bigint,integer)', 'v_full_months < 3', 1),
    ('public.get_component_consumption_history(bigint,integer)', 'pierwszy PEŁNY miesiąc', 1),
    ('public.forecast_component_demand(bigint,integer)', 'v_first_month', 3),
    ('public.forecast_component_demand(bigint,integer)', 'pierwszy PEŁNY miesiąc', 1),
    ('public.cancel_stage_reservations__impl(bigint,text)', 'v_back', 10),
    ('public.release_remaining_for_order(bigint,boolean)', 'cancel_stage_reservations__impl', 1),
    ('public.release_remaining_for_order(bigint,boolean)', 'PRZEBIEG 1', 1),
    ('public.return_remaining_for_order__impl(bigint)', 'cancel_stage_reservations__impl', 1),
    ('public.return_remaining_for_order__impl(bigint)', 'not like ''#%''', 1),
    ('public.issue_internal_door_stock(bigint)', 'ZWR-ORDER-', 1),
    ('public.issue_internal_door_stock(bigint)', 'P0410', 1),
    ('public.issue_internal_door_stock(bigint)', 'reference_doc = any (v_refs)', 2),
    ('public.return_stock_for_order__impl(bigint)', 'ZWR-ZN-', 2),
    ('public.zlec_przesylke_bl(bigint)', 'P0410', 1),
    ('crm.dodaj_etykiety(uuid,text[])', 'current_user_has_crm', 1),
    -- 20261127234100: rezerwacje i weryfikacja BOT tylko kierownik / service_role
    ('public.reserve_stock_for_order(bigint)', 'testy 27.11 (runda 3), uprawnienia', 1),
    ('public.revalidate_bot_order(bigint)', 'testy 27.11 (runda 3), uprawnienia', 1),
    -- 20261127234200: zakres kategorii kierownika działu
    ('public.current_user_order_in_scope(bigint,text,bigint,jsonb)', 'zakres kategorii kierownika działu', 1),
    ('public.current_user_can_delete_order(bigint,text,bigint,jsonb,timestamp with time zone)', 'cofanie nieudanego zakładania', 1),
    -- 20261127234400: #ND na wydanym
    ('public.update_order_stage(bigint,text,text)', 'testy 27.11 (runda 3), wydane', 1),
    -- 20261127234500: konta CRM tylko superadmin
    ('public.protect_superadmin_role()', 'testy 27.11 (runda 3), CRM', 1),
    -- 20261127235000: wydane zlecenie bez nowych rezerwacji (runda 6)
    ('public.reserve_stock_for_order(bigint)', 'testy 27.11 (runda 6), wydane', 1),
    ('public.restore_order_reservations__impl(bigint)', 'testy 27.11 (runda 6), wydane', 1),
    -- 20261127235100: #ND na anulowanym (runda 6) — gdyby 233000 poszło PO 235100, tu wyjdzie brak
    ('public.restore_stage_reservations__impl(bigint,text)', 'testy 27.11 (runda 6), anulowane', 1),
    ('public.cancel_stage_reservations__impl(bigint,text)', 'testy 27.11 (runda 6), anulowane', 1),
    -- 20261128000000: teczka ZKP — zlecenie produkcyjne „jest” po etapie C (runda 8)
    ('public.alu_dossier_status(bigint)', 'zlecenie produkcyjne = uruchomienie do produkcji', 1),
    -- 20261128000100: protokół badań — ocena pomiarów od nowa przy zamykaniu (runda 8)
    ('public.zkp_protocol_problems(bigint)', 'karta zmieniona po zapisaniu protokołu', 1),
    ('public.zkp_protocol_problems(bigint)', 'zkp_protocol_eval(p.card_id, p.measurements)', 1),
    ('public.zkp_close_test_protocol(bigint,text,text,text,text)', 'Ocena ZGODNY niemożliwa', 1),
    -- 20261128000200: okucia i wypełnienia dopiero po potwierdzeniu zakresu (runda 8)
    ('public.zkp_save_card_hardware(bigint,text,text,text,integer,text,bigint)', 'testy 28.11 (runda 8, ZKP): jak w zkp_record_card_stage', 1),
    ('public.zkp_save_card_filling(bigint,text,text,text,numeric,text,bigint)', 'testy 28.11 (runda 8, ZKP): jak w zkp_record_card_stage', 1),
    -- 20261128010000: powiadomienia — superadmin, bez kont zablokowanych
    ('public.notify_user_active(uuid)', 'banned_until', 1),
    ('public.notify_managers_new_review()', 'public.notify_user_active(p.id)', 1),
    ('public.notify_managers_new_review()', '''superadmin''', 1),
    ('public.notify_managers_new_complaint()', 'public.notify_user_active(p.id)', 1),
    ('public.notify_managers_new_complaint()', '''superadmin''', 1),
    ('public.notify_erp_error()', 'public.notify_user_active(p.id)', 1),
    ('public.notify_erp_error()', '''superadmin''', 1),
    ('public.stock_critical_notify()', 'public.notify_user_active(p.id)', 1),
    ('public.stock_critical_notify()', '''superadmin''', 1),
    ('public.send_route_plan_summary()', 'public.notify_user_active(p.id)', 1),
    ('public.send_route_plan_summary()', '''superadmin''', 1),
    -- 20261128010100: wzmianki tylko dla oznaczonych, raz na komentarz
    ('public.notify_comment_mentions(bigint,uuid[],text)', 'strpos(p_content, ''@'' || p.full_name)', 1),
    ('public.notify_comment_mentions(bigint,uuid[],text)', 'n.created_at >= v_comment_at', 1),
    ('public.notify_comment_mentions(bigint,uuid[],text)', 'public.notify_user_active(p.id)', 1),
    -- 20261128010200: bezpiecznik słownika — kolor ościeżnicy, receptury, wykluczenia, reguły Bastion
    ('public.config_option_usage(text,text,text)', 'total_all', 3),
    ('public.config_option_usage(text,text,text)', 'warehouse_recipe_criteria', 1),
    ('public.config_option_usage(text,text,text)', 'config_exclusions', 1),
    ('public.config_option_usage(text,text,text)', 'bastion_rules', 1),
    ('public.config_option_usage(text,text,text)', 'v_cols || array[''frame_color'']', 1),
    ('public.config_options_guard_delete()', 'total_all', 1),
    -- 20261128010300: przywracanie z archiwum — zdjęcia, bez powiadomień
    ('public.notify_muted()', 'app.restoring', 1),
    ('public.notify_managers_new_review()', 'public.notify_muted()', 1),
    ('public.notify_erp_error()', 'public.notify_muted()', 1),
    ('public.restore_from_archive__impl(bigint)', 'app.restoring', 2),
    ('public.restore_from_archive__impl(bigint)', 'insert into order_photos', 1),
    ('public.archive_old_orders__impl(integer)', '''uploaded_by'', ph.uploaded_by', 1),
    -- runda 10 (28.11), tor r10-baza
    -- 20261128021000: wydanie na etap wstrzymany / „#…” odmawia pracownikowi
    ('public.release_stock_for_stage(bigint,text,boolean)', 'runda 10 (28.11), wstrzymane', 1)
),
funkcje as (
  select z.fn, z.marker, z.minimum, to_regprocedure(z.fn) as foid from znaczniki z
),
liczone as (
  select f.fn, f.marker, f.minimum, f.foid,
         case when f.foid is null then null
              else (length(pg_get_functiondef(f.foid)) - length(replace(pg_get_functiondef(f.foid), f.marker, ''))) / length(f.marker)
         end as ile
  from funkcje f
),
braki_funkcji as (
  select 'funkcja'::text as rodzaj, l.fn::text as obiekt,
         case when l.foid is null then 'BRAK FUNKCJI'
              else 'znacznik [' || l.marker || '] jest ' || l.ile || ' raz(y), min ' || l.minimum
         end as problem
  from liczone l
  where l.foid is null or l.ile < l.minimum
),
-- polityki (20261127234200, 20261127234300)
oczekiwane_polityki(tabela, polityka, fragment) as (
  values
    ('orders', 'orders_update', 'current_user_order_in_scope'),
    ('orders', 'orders_delete', 'current_user_can_delete_order'),
    ('order_lead_time_rules', 'lead_time_write', 'current_user_is_admin'),
    ('companies', 'companies_update', 'current_user_is_admin'),
    ('companies', 'companies_delete', 'current_user_is_admin'),
    ('warehouse_stock', 'warehouse_stock_insert_zero', 'quantity'),
    ('warehouse_stock', 'warehouse_stock_delete_zero', 'quantity'),
    -- 20261128010400: zdjęcie zlecenia tylko w swoim imieniu
    ('order_photos', 'order_photos_insert', 'auth.uid()')
),
braki_polityk as (
  select 'polityka'::text, (o.tabela || '.' || o.polityka)::text,
         case when p.policyname is null then 'BRAK POLITYKI' else 'bez [' || o.fragment || ']' end
  from oczekiwane_polityki o
  left join pg_policies p on p.schemaname = 'public' and p.tablename = o.tabela and p.policyname = o.polityka
  where p.policyname is null
     or position(o.fragment in coalesce(p.qual, '') || coalesce(p.with_check, '')) = 0
  union all
  select 'polityka', 'warehouse_stock.warehouse_stock_write', 'stara polityka ALL nadal istnieje'
  from pg_policies where schemaname = 'public' and tablename = 'warehouse_stock' and policyname = 'warehouse_stock_write'
  union all
  -- 20261128010400: storage — bez SELECT dla anon na order-photos / feedback-attachments
  select 'polityka', ('storage.objects.' || s.n)::text,
         case when p.policyname is null then 'BRAK POLITYKI' else 'SELECT nadal dla public/anon albo bez [owner]' end
  from unnest(array['order_photos_read', 'feedback_attachments_read']) s(n)
  left join pg_policies p on p.schemaname = 'storage' and p.tablename = 'objects' and p.policyname = s.n
  where p.policyname is null or p.roles::text <> '{authenticated}' or position('owner' in coalesce(p.qual, '')) = 0
),
-- triggery, constrainty, indeksy
braki_obiektow as (
  select 'trigger'::text, t.n::text, 'BRAK TRIGGERA'::text
  from unnest(array['trg_orders_cancel_reservations', 'trg_orders_block_release_cancelled', 'dokumenty_umowa_zamknieta',
                    'audit_warehouse_stock', 'audit_warehouse_recipe_components',
                    -- 20261128010500
                    'audit_label_templates', 'audit_config_exclusions', 'audit_dimension_map',
                    'audit_order_lead_time_rules']) t(n)
  where not exists (select 1 from pg_trigger g where g.tgname = t.n and not g.tgisinternal)
  union all
  select 'constraint', c.n, 'BRAK CONSTRAINTU'
  from unnest(array['warehouse_stock_quantity_finite_check', 'warehouse_stock_reserved_quantity_finite_check',
                    'warehouse_movements_quantity_finite_check',
                    'label_templates_size_check']) c(n)
  where not exists (select 1 from pg_constraint k where k.conname = c.n)
  union all
  select 'indeks', 'order_lead_time_rules_warunki_uniq', 'BRAK INDEKSU'
  where not exists (select 1 from pg_indexes where indexname = 'order_lead_time_rules_warunki_uniq')
),
-- uprawnienia (20261127234000): anon nie wykonuje funkcji public poza ekranem logowania,
-- wnętrza rezerwacji niedostępne dla zalogowanych
braki_uprawnien as (
  select 'uprawnienia'::text, p.oid::regprocedure::text, 'anon może wykonać (puść ponownie 20261127234000)'::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
    and has_function_privilege('anon', p.oid, 'execute')
    and p.proname not in ('check_login_rate_limit', 'log_login_attempt')
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  union all
  select 'uprawnienia', f.n, 'authenticated może wykonać'
  from unnest(array['public.cancel_stage_reservations__impl(bigint,text)', 'public.restore_stage_reservations__impl(bigint,text)',
                    'public.recompute_order_stock_status(bigint)', 'public.return_remaining_for_order__impl(bigint)',
                    -- 20261128010000 / 010300 (runda 9, znalezisko 10)
                    'public.notify_user_active(uuid)', 'public.restore_from_archive__impl(bigint)']) f(n)
  where to_regprocedure(f.n) is not null and has_function_privilege('authenticated', to_regprocedure(f.n), 'execute')
)
select * from braki_funkcji
union all select * from braki_polityk
union all select * from braki_obiektow
union all select * from braki_uprawnien
order by 1, 2;
