-- =====================================================================
-- Podział magazynu wewnętrznych drzwi na WEW1 + WEW2
-- =====================================================================
-- Decyzja: tworzymy dwa NOWE magazyny (WEW1, WEW2), a dotychczasowy
-- WEWNETRZNE wygaszamy (is_active=false). Istniejące stany ze starego
-- magazynu przenosimy do WEW1, żeby nic nie zginęło.
--
-- Wykonaj CAŁOŚĆ w jednej transakcji (Supabase SQL editor: wklej i Run).
-- Bezpieczne do ponownego uruchomienia (idempotentne na tworzeniu magazynów).
-- =====================================================================

begin;

-- 1. Utwórz nowe magazyny (jeśli jeszcze nie istnieją)
insert into warehouses (code, name, is_active)
select 'WEW1', 'Magazyn wewnętrznych #1', true
where not exists (select 1 from warehouses where code = 'WEW1');

insert into warehouses (code, name, is_active)
select 'WEW2', 'Magazyn wewnętrznych #2', true
where not exists (select 1 from warehouses where code = 'WEW2');

-- 2. Przenieś stany ze starego WEWNETRZNE do WEW1
--    (tylko jeśli stary magazyn istnieje i ma jakieś półki)
do $$
declare
  old_id bigint;
  new_id bigint;
begin
  select id into old_id from warehouses where code = 'WEWNETRZNE' limit 1;
  select id into new_id from warehouses where code = 'WEW1' limit 1;

  if old_id is not null and new_id is not null then
    -- przenieś tylko te półki, których jeszcze nie ma w WEW1 (unik. konfliktu unikalności)
    update warehouse_stock ws
      set warehouse_id = new_id
    where ws.warehouse_id = old_id
      and not exists (
        select 1 from warehouse_stock ws2
        where ws2.warehouse_id = new_id
          and ws2.component_id = ws.component_id
      );

    -- gdyby jakaś para już istniała w WEW1 — dodaj ilości i usuń duplikat ze starego
    update warehouse_stock ws_new
      set quantity = ws_new.quantity + ws_old.quantity
    from warehouse_stock ws_old
    where ws_new.warehouse_id = new_id
      and ws_old.warehouse_id = old_id
      and ws_new.component_id = ws_old.component_id;

    delete from warehouse_stock where warehouse_id = old_id;

    -- 3. Wygaś stary magazyn (zostaje dla historii ruchów/PZ/MM)
    update warehouses set is_active = false where id = old_id;
  end if;
end $$;

commit;

-- Weryfikacja:
-- select code, name, is_active from warehouses order by code;
-- select w.code, count(*) from warehouse_stock s join warehouses w on w.id=s.warehouse_id group by w.code;
