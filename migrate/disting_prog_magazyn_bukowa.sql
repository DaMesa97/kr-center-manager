-- 24.10 (Tymek): próg do Distinga — i zwykłego, i Disting Plus — schodzi z Magazynu Bukowa.
-- Wcześniej brak przypisania → reserve_stock_for_order pomijał część 'prog'
-- („Brak przypisania magazynu”), progi Distinga nigdy się nie rezerwowały ani nie schodziły.
-- Po wstawieniu przeliczone rezerwacje otwartych Disting (rebuild_reservations_for_category):
-- 716 zleceń, 1 pominięte (coś już wydano), progi 997,5 szt. z Bukowej.

insert into public.warehouse_assignment (category, part, system, warehouse_id)
select v.category, v.part, v.system, w.id
from (values ('Disting', 'prog', null::text), ('Disting', 'prog', 'DISTING PLUS')) as v(category, part, system)
cross join (select id from public.warehouses where name = 'Magazyn Bukowa') w
where not exists (
  select 1 from public.warehouse_assignment wa
  where wa.category = v.category and wa.part = v.part and wa.system is not distinct from v.system
);
