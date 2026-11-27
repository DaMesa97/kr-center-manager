-- =====================================================================
-- Dane testowe do sesji testów KR Center (27.11.2026). Wszystko oznaczone prefiksem TEST_
-- (numer zlecenia, firma, kod komponentu, numer reklamacji, dokument) i extra_fields.test = true.
-- Usuwa je scripts/cleanup-test-data.sql.
--
-- UWAGA: baza projektu to produkcja obu firm. Skrypt NIE dotyka prawdziwych komponentów ani stanów:
-- rezerwacje i ruchy są tylko na komponentach TEST_. Nie zakłada danych CRM (triggery leadów wołają
-- funkcje Edge / AI) ani wysyłek (zlecenie przesyłki idzie do BaseLinkera).
-- Uruchomienie: w edytorze SQL Supabase albo konektorem; najpierw najlepiej w transakcji z rollback.
-- Skrypt jest powtarzalny: najpierw sprząta poprzednie dane TEST_ (wywołuje to samo co cleanup).
-- =====================================================================
do $$
declare
  v_mark bigint := (select id from warehouses where code = 'MARKLOWICKA');
  v_wew1 bigint := (select id from warehouses where code = 'WEW1');
  c_skrz bigint; c_okuc bigint; c_wew bigint;
  o_sta bigint; o_dist bigint; o_bastion bigint;
begin
  if exists (select 1 from orders where order_number like 'TEST\_%' escape '\') then
    raise exception 'Są już dane TEST_ — najpierw uruchom scripts/cleanup-test-data.sql';
  end if;

  -- komponenty testowe (stan tylko na nich)
  insert into warehouse_components (code, name, unit) values ('TEST_SKRZYDLO', 'TEST_ Skrzydło testowe 80 L', 'szt') returning id into c_skrz;
  insert into warehouse_components (code, name, unit) values ('TEST_OKUCIE', 'TEST_ Okucie testowe', 'szt') returning id into c_okuc;
  insert into warehouse_components (code, name, unit) values ('TEST_WEW', 'TEST_ Skrzydło wewnętrzne testowe', 'szt') returning id into c_wew;
  insert into warehouse_stock (warehouse_id, component_id, quantity) values (v_mark, c_skrz, 10), (v_mark, c_okuc, 50), (v_wew1, c_wew, 4);
  insert into warehouse_movements (movement_type, warehouse_to_id, component_id, quantity, reference_doc, notes)
  values ('PZ', v_mark, c_skrz, 10, 'TEST_PZ-1', 'TEST_ przyjęcie startowe'),
         ('PZ', v_mark, c_okuc, 50, 'TEST_PZ-1', 'TEST_ przyjęcie startowe'),
         ('PZ', v_wew1, c_wew, 4, 'TEST_PZ-1', 'TEST_ przyjęcie startowe');

  -- zlecenia ze wszystkich kategorii
  insert into orders (order_number, category, company, model, quantity, order_date, extra_fields)
  values ('TEST_STA_001', 'STA', 'TEST_FIRMA', 'TEST NORMAL', 1, current_date, '{"test": true}') returning id into o_sta;
  insert into orders (order_number, category, company, model, quantity, order_date, extra_fields)
  values ('TEST_DIST_001', 'Disting', 'TEST_FIRMA', 'TEST DS68', 1, current_date, '{"test": true}') returning id into o_dist;
  update orders set linked_order_id = o_sta where id = o_dist;           -- para Disting Plus (STA + Disting)
  update orders set linked_order_id = o_dist where id = o_sta;
  insert into orders (order_number, category, company, model, quantity, order_date, extra_fields)
  values ('TEST_BAS_001', 'Bastion', 'TEST_FIRMA', 'TITAN G-08 TEST', 1, current_date, '{"test": true}') returning id into o_bastion;
  insert into orders (order_number, category, company, model, quantity, order_date, extra_fields) values
    ('TEST_ST_001', 'ST', 'TEST_FIRMA', 'TEST ST68', 2, current_date, '{"test": true}'),
    ('TEST_TECH_001', 'Techniczne', 'TEST_FIRMA', 'TEST EI30', 1, current_date, '{"test": true}'),
    ('TEST_WEW_001', 'DrzwiWewnetrzne', 'TEST_FIRMA', 'TEST MALEO', 1, current_date, '{"test": true}'),
    ('TEST_ALU_001', 'Aluminium', 'TEST_FIRMA', 'TEST MB-70', 1, current_date, '{"test": true}');
  insert into order_internal_door_items (order_id, component_id, quantity)
  select id, c_wew, 1 from orders where order_number = 'TEST_WEW_001';

  -- rezerwacje tylko na komponentach TEST_
  insert into stock_reservations (order_id, warehouse_id, component_id, stage_key, quantity_reserved, quantity_released, status)
  values (o_sta, v_mark, c_skrz, 'e1', 1, 0, 'reserved'), (o_sta, v_mark, c_okuc, 'e2', 3, 0, 'reserved'),
         (o_bastion, v_mark, c_okuc, 'cnc', 2, 0, 'reserved');
  -- licznik rezerwacji na stanie jak przy reserve_stock_for_order (trigger przy kasowaniu rezerwacji go odejmuje)
  update warehouse_stock ws set reserved_quantity = coalesce(ws.reserved_quantity, 0) + r.q
  from (select warehouse_id, component_id, sum(quantity_reserved) q from stock_reservations
        where order_id in (o_sta, o_bastion) and status = 'reserved' group by 1, 2) r
  where ws.warehouse_id = r.warehouse_id and ws.component_id = r.component_id;

  -- reklamacja do zlecenia testowego
  insert into complaints (complaint_number, category, order_id, order_number, company, what_complained, reason, complaint_date)
  values ('TEST_RK/001', 'STA', o_sta, 'TEST_STA_001', 'TEST_FIRMA', 'Skrzydło', 'TEST_ porysowane skrzydło', current_date);

  raise notice 'TEST_: 3 komponenty, 7 zleceń (w tym para Disting Plus i Titan), 3 rezerwacje, 1 reklamacja';
end $$;
