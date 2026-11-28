-- 28.11.2026 — JEDNORAZOWE porządki danych z decyzji właściciela (Excel Decyzje_TAK_NIE_2.xlsx, „OK, działaj”).
-- 1) D44 (TAK): 5 nóg Disting par Disting Plus przy anulowanym STA (10376, 10378, 13071, 13357, 13407) — anulowane
--    (extra_fields.cancelled jak w aplikacji; rezerwacje zwalnia trigger z 20261127232300). Tylko niewydane i nieanulowane.
-- 2) D8 zaległość (TAK): aktywne rezerwacje części skrzydła (e3/e4) nóg Disting par Disting Plus, gdy STA jest już WYDANE
--    i nie ma odhaczonego e3/e4 — zwolnione BEZ zdejmowania z magazynu (spis 6.11 już ich nie liczył):
--    status 'cancelled', cancel_reason 'manual' (jak ręczne zwolnienie; powód w audit_log), reserved_quantity na stanie pomniejszone (jak cancel_reservation).
-- 3) Spis #20 (WEW1, otwarty 27.11, 0 z 934 pozycji policzonych): zamknięty BEZ rozliczania (zwykłe zamknięcie
--    potraktowałoby niepoliczone pozycje). Blokada ruchów zdjęta.
-- Bezpieczne do ponownego uruchomienia (każdy krok pomija to, co już zrobione).
do $$
declare
  v_n44 int := 0;
  v_n8 int := 0;
  v_q8 numeric := 0;
  r record;
  v_rest numeric;
begin
  -- 1) D44
  update orders o
     set extra_fields = coalesce(o.extra_fields, '{}'::jsonb) || jsonb_build_object(
           'cancelled', true, 'cancelled_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
           'cancelled_by', 'SYSTEM', 'cancel_note', 'D44 (28.11): noga Disting przy anulowanym STA — decyzja właściciela')
   where o.id in (10376, 10378, 13071, 13357, 13407)
     and o.category = 'Disting'
     and o.release_date is null
     and coalesce(o.extra_fields->>'cancelled', 'false') <> 'true';
  get diagnostics v_n44 = row_count;

  -- 2) D8 zaległość
  for r in
    select sr.id, sr.warehouse_id, sr.component_id, sr.quantity_reserved, sr.quantity_released, sr.order_id
    from stock_reservations sr
    join orders d on d.id = sr.order_id and d.category = 'Disting'
    join orders s on s.id = d.linked_order_id and s.category = 'STA'
    join warehouses w on w.id = sr.warehouse_id and w.code = 'MARKLOWICKA'
    where sr.status in ('reserved', 'partially_released')
      and sr.stage_key in ('e3', 'e4')
      and s.release_date is not null
      and coalesce(trim(s.production_stages->>sr.stage_key), '') = ''
    for update of sr
  loop
    v_rest := r.quantity_reserved - coalesce(r.quantity_released, 0);
    if v_rest > 0 then
      update warehouse_stock ws set reserved_quantity = ws.reserved_quantity - v_rest, updated_at = now()
       where ws.warehouse_id = r.warehouse_id and ws.component_id = r.component_id;
      v_q8 := v_q8 + v_rest;
    end if;
    update stock_reservations set status = 'cancelled', cancel_reason = 'manual', updated_at = now() where id = r.id;
    v_n8 := v_n8 + 1;
  end loop;
  begin
    insert into audit_log (table_name, record_id, operation, user_id, new_data)
    values ('stock_reservations', 'D8-zaleglosc', 'UPDATE', null,
            jsonb_build_object('action', 'disting_plus_zaleglosc', 'rezerwacji', v_n8, 'szt', v_q8, 'decyzja', 'właściciel 28.11'));
  exception when others then null;
  end;

  -- 3) spis #20
  update inventory_sessions
     set status = 'closed', closed_at = now(), blokada_ruchow = false,
         notes = coalesce(notes || ' · ', '') || 'Zamknięta 28.11 bez rozliczania (0 pozycji policzonych) — decyzja właściciela'
   where id = 20 and status = 'open'
     and not exists (select 1 from inventory_lines l where l.session_id = 20 and l.counted_qty is not null);

  raise notice 'porzadki: D44 anulowano % nóg; D8 zwolniono % rezerwacji (% szt.)', v_n44, v_n8, v_q8;
end $$;
