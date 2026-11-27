-- 27.11.2026 (testy 27.11, runda 3; ŚREDNI): funkcje magazynu przyjmowały ilość 'NaN' (w Postgresie NaN > 0 jest
-- prawdą!) — a od PG14 także 'Infinity'. Taki PZ/MM/WZ/zniszczenie/spis psuł stan komponentu na zawsze.
-- Zmiany:
--   1) create_pz_document__impl, create_mm_document__impl, create_wz_reklamacyjny, receive_purchase_order__impl:
--      pozycja z ilością NaN/Infinity jest pomijana tak jak 0 i ujemne; report_damage i spis
--      (record_inventory_count_line__impl) odrzucają NaN/Infinity błędem (pusty spis = null dalej dozwolony — czyszczenie);
--   2) create_pz_document__impl i create_mm_document__impl rzucają błąd, gdy ŻADNA pozycja nie przeszła
--      (dotąd PZ z samymi 0 / -5 kończył się „sukcesem” bez dokumentu);
--   3) check na warehouse_stock.quantity, warehouse_stock.reserved_quantity, warehouse_movements.quantity:
--      bez NaN i nieskończoności (27.11 takich wartości nie ma: 0 wierszy; tabele małe — 872 i 5746 wierszy,
--      więc check od razu sprawdzany, bez NOT VALID).
-- DO WDROŻENIA (nie wgrane w sesji).

create or replace function pg_temp.lataj(p_fn regprocedure, p_pary text[])
 returns void
 language plpgsql
as $f$
declare d text; i int;
begin
  d := pg_get_functiondef(p_fn);
  if position('testy 27.11 (runda 3): NaN' in d) > 0 then
    raise notice '%: już poprawione — bez zmian', p_fn;
    return;
  end if;
  for i in 1 .. array_length(p_pary, 1) / 2 loop
    if position(p_pary[2 * i - 1] in d) = 0 then
      raise exception '%: nie znaleziono miejsca łatki: %', p_fn, p_pary[2 * i - 1];
    end if;
    d := replace(d, p_pary[2 * i - 1], p_pary[2 * i]);
  end loop;
  execute d;
end $f$;

select pg_temp.lataj('public.create_pz_document__impl(bigint,jsonb,text,text)'::regprocedure, array[
  'v_quantity IS NULL OR v_quantity <= 0',
  'v_quantity IS NULL OR v_quantity = ''NaN'' OR v_quantity = ''Infinity'' OR v_quantity <= 0 /* testy 27.11 (runda 3): NaN */',
  'v_batch_ref text;',
  'v_batch_ref text;
  v_ok integer := 0;',
  'RETURN NEXT;',
  'v_ok := v_ok + 1;
    RETURN NEXT;',
  'END LOOP;',
  'END LOOP;
  IF v_ok = 0 THEN
    RAISE EXCEPTION ''PZ bez poprawnych pozycji (komponent i ilość > 0) — nic nie przyjęto'';
  END IF;'
]);

select pg_temp.lataj('public.create_mm_document__impl(bigint,bigint,jsonb,text,text)'::regprocedure, array[
  'v_quantity IS NULL OR v_quantity <= 0',
  'v_quantity IS NULL OR v_quantity = ''NaN'' OR v_quantity = ''Infinity'' OR v_quantity <= 0 /* testy 27.11 (runda 3): NaN */',
  'v_batch_ref text;',
  'v_batch_ref text;
  v_ok integer := 0;',
  'RETURN NEXT;',
  'v_ok := v_ok + 1;
    RETURN NEXT;',
  'END LOOP;',
  'END LOOP;
  IF v_ok = 0 THEN
    RAISE EXCEPTION ''MM bez poprawnych pozycji (komponent i ilość > 0) — nic nie przesunięto'';
  END IF;'
]);

select pg_temp.lataj('public.create_wz_reklamacyjny(bigint,jsonb,text,text,bigint,text,text)'::regprocedure, array[
  'if v_comp is null or v_qty is null or v_qty <= 0 then continue; end if;',
  'if v_comp is null or v_qty is null or v_qty = ''NaN'' or v_qty = ''Infinity'' or v_qty <= 0 then continue; end if; -- testy 27.11 (runda 3): NaN'
]);

select pg_temp.lataj('public.receive_purchase_order__impl(bigint,bigint,jsonb,text,text,boolean)'::regprocedure, array[
  'if v_qty_received is null or v_qty_received <= 0 then',
  'if v_qty_received is null or v_qty_received = ''NaN'' or v_qty_received = ''Infinity'' or v_qty_received <= 0 then -- testy 27.11 (runda 3): NaN'
]);

select pg_temp.lataj('public.report_damage(bigint,bigint,numeric,text,bigint,text)'::regprocedure, array[
  'if p_quantity is null or p_quantity <= 0 then',
  'if p_quantity is null or p_quantity = ''NaN'' or p_quantity = ''Infinity'' or p_quantity <= 0 then -- testy 27.11 (runda 3): NaN'
]);

select pg_temp.lataj('public.record_inventory_count_line__impl(bigint,numeric)'::regprocedure, array[
  'if p_counted is not null and p_counted < 0 then',
  'if p_counted is not null and (p_counted = ''NaN'' or p_counted = ''Infinity'' or p_counted < 0) then -- testy 27.11 (runda 3): NaN',
  'Policzona ilość nie może być ujemna',
  'Policzona ilość musi być liczbą nie mniejszą od zera'
]);

drop function pg_temp.lataj(regprocedure, text[]);

-- ponowne uruchomienie nie pada na „constraint already exists” (42710) (testy 27.11, runda 3)
alter table public.warehouse_stock
  drop constraint if exists warehouse_stock_quantity_finite_check,
  drop constraint if exists warehouse_stock_reserved_quantity_finite_check;
alter table public.warehouse_movements
  drop constraint if exists warehouse_movements_quantity_finite_check;

alter table public.warehouse_stock
  add constraint warehouse_stock_quantity_finite_check
    check (quantity not in ('NaN', 'Infinity', '-Infinity')),
  add constraint warehouse_stock_reserved_quantity_finite_check
    check (reserved_quantity not in ('NaN', 'Infinity', '-Infinity'));
alter table public.warehouse_movements
  add constraint warehouse_movements_quantity_finite_check
    check (quantity not in ('NaN', 'Infinity', '-Infinity'));
