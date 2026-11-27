-- =====================================================================
-- Usuwa WSZYSTKIE dane testowe oznaczone prefiksem TEST_ (scripts/seed-test-data.sql i rekordy założone
-- ręcznie w czasie testów z TEST_ w numerze / firmie / kodzie), razem z rekordami zależnymi, w kolejności
-- zgodnej z kluczami obcymi. Na końcu zwraca, ile czego usunięto, i sprawdza, że nic TEST_ nie zostało.
-- Prawdziwych danych nie dotyka: zakres wyznaczają wyłącznie zlecenia / komponenty / reklamacje TEST_.
-- =====================================================================
do $$
declare
  v_orders bigint[];
  v_comps bigint[];
  v_compl bigint[];
  n jsonb := '{}'::jsonb;
  k int;
begin
  select coalesce(array_agg(id), '{}') into v_orders from orders
    where order_number like 'TEST\_%' escape '\' or company like 'TEST\_%' escape '\' or extra_fields->>'test' = 'true';
  select coalesce(array_agg(id), '{}') into v_comps from warehouse_components where code like 'TEST\_%' escape '\';
  select coalesce(array_agg(id), '{}') into v_compl from complaints
    where complaint_number like 'TEST\_%' escape '\' or company like 'TEST\_%' escape '\' or order_id = any (v_orders);

  -- dokumenty magazynowe powiązane z testami
  delete from wz_reklamacyjne_pozycje where wz_id in (select id from wz_reklamacyjne where complaint_id = any (v_compl) or firma like 'TEST\_%' escape '\')
     or component_id = any (v_comps);
  get diagnostics k = row_count; n := n || jsonb_build_object('wz_reklamacyjne_pozycje', k);
  delete from wz_reklamacyjne where complaint_id = any (v_compl) or firma like 'TEST\_%' escape '\';
  get diagnostics k = row_count; n := n || jsonb_build_object('wz_reklamacyjne', k);

  delete from stock_reservations where order_id = any (v_orders) or component_id = any (v_comps);
  get diagnostics k = row_count; n := n || jsonb_build_object('stock_reservations', k);
  delete from warehouse_movements where order_id = any (v_orders) or component_id = any (v_comps) or reference_doc like 'TEST\_%' escape '\';
  get diagnostics k = row_count; n := n || jsonb_build_object('warehouse_movements', k);
  delete from warehouse_stock where component_id = any (v_comps);
  get diagnostics k = row_count; n := n || jsonb_build_object('warehouse_stock', k);
  delete from purchase_order_items where component_id = any (v_comps);
  get diagnostics k = row_count; n := n || jsonb_build_object('purchase_order_items', k);

  -- pozycje i powiązania zleceń
  delete from order_item_picks where order_id = any (v_orders);
  get diagnostics k = row_count; n := n || jsonb_build_object('order_item_picks', k);
  delete from order_internal_door_items where order_id = any (v_orders) or component_id = any (v_comps);
  get diagnostics k = row_count; n := n || jsonb_build_object('order_internal_door_items', k);
  delete from order_shipment_orders where order_id = any (v_orders);
  get diagnostics k = row_count; n := n || jsonb_build_object('order_shipment_orders', k);

  -- powiadomienia
  delete from notifications where link_order_id = any (v_orders) or title like '%TEST\_%' escape '\' or body like '%TEST\_%' escape '\';
  get diagnostics k = row_count; n := n || jsonb_build_object('notifications', k);

  -- reklamacje (najpierw odpięcie par), zlecenia (najpierw odpięcie par Disting Plus / Titan), komponenty
  update complaints set linked_complaint_id = null where id = any (v_compl);
  delete from complaints where id = any (v_compl);
  get diagnostics k = row_count; n := n || jsonb_build_object('complaints', k);
  update orders set linked_order_id = null where id = any (v_orders) or linked_order_id = any (v_orders);
  delete from orders where id = any (v_orders);
  get diagnostics k = row_count; n := n || jsonb_build_object('orders', k);
  delete from warehouse_components where id = any (v_comps);
  get diagnostics k = row_count; n := n || jsonb_build_object('warehouse_components', k);

  -- historia zmian NA KOŃCU (audit_log trzyma record_id jako tekst): kasowania powyżej same dopisują wpisy DELETE,
  -- więc czyszczone razem z wpisami z czasu testów
  delete from audit_log where (table_name = 'orders' and record_id::text = any (select unnest(v_orders)::text))
     or (table_name = 'complaints' and record_id::text = any (select unnest(v_compl)::text))
     or (table_name in ('warehouse_components', 'warehouse_stock', 'warehouse_movements', 'stock_reservations', 'order_internal_door_items')
         and (new_data::text like '%TEST\_%' escape '\' or old_data::text like '%TEST\_%' escape '\'
              or new_data->>'order_id' = any (select unnest(v_orders)::text) or old_data->>'order_id' = any (select unnest(v_orders)::text)
              or new_data->>'component_id' = any (select unnest(v_comps)::text) or old_data->>'component_id' = any (select unnest(v_comps)::text)));
  get diagnostics k = row_count; n := n || jsonb_build_object('audit_log', k);

  -- kontrola: nic TEST_ nie zostało
  if exists (select 1 from orders where order_number like 'TEST\_%' escape '\' or company like 'TEST\_%' escape '\')
     or exists (select 1 from warehouse_components where code like 'TEST\_%' escape '\')
     or exists (select 1 from complaints where complaint_number like 'TEST\_%' escape '\')
     or exists (select 1 from warehouse_movements where reference_doc like 'TEST\_%' escape '\') then
    raise exception 'Zostały rekordy TEST_ — sprawdź skrypt (usunięto: %)', n;
  end if;
  raise notice 'Usunięto: %', n;
end $$;
