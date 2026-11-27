-- 27.11.2026 (testy 27.11, runda 3) — JEDNORAZOWA KOREKTA DANYCH. DO DECYZJI WŁAŚCICIELA PRZED WGRANIEM.
-- Skutek błędu poprawionego w 20261127233000: przy wydaniu z Excela zeszły ramy etapu „oścież.” (osc), który chwilę
-- później dostał #ND (nie dotyczy). Wszystkie 5 pozycji zeszło jako WYMUSZONE (na minus). Policzone 27.11 z bazy
-- (WZ …-wydanie minus ZWR …-wydanie z tym samym [RES-id]; w całej bazie tylko te 5 rezerwacji ma taki stan):
--   zlecenie id 17431 (ST 5624): RES-162632, komponent id 185 „RAMA KR 68 P15 200 C/90/ANTRACYT/80N/P”,  1 szt., magazyn id 2 BUKOWA, WZ id 7505
--   zlecenie id 17437 (ST 5625): RES-162634, komponent id 195 „RAMA KR 68 P15 200 C/90/ZŁOTY DĄB/90E/P”, 1 szt., magazyn id 2 BUKOWA, WZ id 7012
--   zlecenie id 17588 (ST 5644): RES-162638, komponent id 185 „RAMA KR 68 P15 200 C/90/ANTRACYT/80N/P”,  1 szt., magazyn id 2 BUKOWA, WZ id 7496
--   zlecenie id 17589 (ST 5645): RES-162640, komponent id 183 „RAMA KR 68 P15 200 C/90/ANTRACYT/90E/P”,  1 szt., magazyn id 2 BUKOWA, WZ id 7016
--   zlecenie id 17625 (ST 5648): RES-162643, komponent id 180 „RAMA KR 68 P15 200 C/90/ANTRACYT/100E/L”, 3 szt., magazyn id 2 BUKOWA, WZ id 7471
-- Razem 7 ram. Stany 27.11 (BUKOWA): komp. 185 = −2, 195 = −1, 183 = −1, 180 = −3 → po korekcie 0, 0, 0, 0.
-- Co robi: dla każdej z 5 rezerwacji ruch ZWR (ten sam magazyn, ta sama ilość, reference_doc ZWR-ST-<nr>-wydanie,
-- opis „Korekta — etap nie dotyczy (#ND) … [RES-id]”), stan +ilość, rezerwacja → 'cancelled' / 'stage_na',
-- quantity_released = 0 (jak po poprawce 233000). Bezpieczne do ponownego uruchomienia: pozycja jest pomijana, jeśli
-- rezerwacja nie jest już 'released', etap nie ma #ND albo bilans WZ−ZWR „-wydanie” dla [RES-id] jest już 0.
-- NIE WGRANE.
do $$
declare
  k record;
  v_net numeric;
  v_n int := 0;
begin
  for k in
    select v.order_id, v.res_id, v.component_id, v.warehouse_id, v.qty, o.category, o.order_number
    from (values
      (17431::bigint, 162632::bigint, 185::bigint, 2::bigint, 1::numeric),
      (17437, 162634, 195, 2, 1),
      (17588, 162638, 185, 2, 1),
      (17589, 162640, 183, 2, 1),
      (17625, 162643, 180, 2, 3)
    ) v(order_id, res_id, component_id, warehouse_id, qty)
    join orders o on o.id = v.order_id
    join stock_reservations sr on sr.id = v.res_id and sr.order_id = v.order_id
      and sr.component_id = v.component_id and sr.warehouse_id = v.warehouse_id
    where sr.status = 'released'
      and sr.quantity_released = v.qty
      and upper(trim(coalesce(o.production_stages ->> sr.stage_key, ''))) = '#ND'
    for update of sr
  loop
    select coalesce(sum(case when m.movement_type = 'WZ' then m.quantity else -m.quantity end), 0) into v_net
    from warehouse_movements m
    where m.order_id = k.order_id and m.movement_type in ('WZ', 'ZWR')
      and m.reference_doc like '%-wydanie' and m.notes like '%[RES-' || k.res_id || ']%';
    if v_net <> k.qty then
      raise notice 'Pomijam RES-% (bilans wydania % zamiast %)', k.res_id, v_net, k.qty;
      continue;
    end if;

    insert into warehouse_movements(
      movement_type, warehouse_to_id, component_id, quantity,
      order_id, reference_doc, notes, created_by
    ) values (
      'ZWR', k.warehouse_id, k.component_id, k.qty,
      k.order_id,
      'ZWR-' || k.category || '-' || coalesce(nullif(trim(k.order_number), ''), k.order_id::text) || '-wydanie',
      'Korekta — etap nie dotyczy (#ND), rama zeszła przy wydaniu z Excela — zamówienie ' || k.category
        || ' #' || coalesce(k.order_number, k.order_id::text) || ' [RES-' || k.res_id || ']',
      null
    );

    insert into warehouse_stock as ws (warehouse_id, component_id, quantity, reserved_quantity)
    values (k.warehouse_id, k.component_id, k.qty, 0)
    on conflict (warehouse_id, component_id)
    do update set quantity = ws.quantity + k.qty, updated_at = now();

    update stock_reservations sr
    set status = 'cancelled', cancel_reason = 'stage_na', quantity_released = 0, updated_at = now()
    where sr.id = k.res_id;

    v_n := v_n + 1;
  end loop;
  raise notice 'Korekta #ND: zwrócono % pozycji', v_n;
end $$;
