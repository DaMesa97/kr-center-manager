\set ON_ERROR_STOP on
\pset footer off
begin;
-- receptura 520: komponent = SKRZYDŁO ... 80P, kryterium i nazwa mówiły 90E (duplikat 522) → 80N
update warehouse_recipe_criteria set allowed_values = '{80N}' where recipe_id = 520 and field = 'width' and allowed_values = '{90E}';
update warehouse_recipes set name = replace(name, '/ 90E / PRAWE /', '/ 80N / PRAWE /'), updated_at = now() where id = 520 and name like '%/ 90E / PRAWE /%';
select id, name from warehouse_recipes where id = 520;
select field, allowed_values from warehouse_recipe_criteria where recipe_id = 520 and field = 'width';

select id as uid from profiles where role = 'admin' order by id limit 1 \gset
select set_config('request.jwt.claims', json_build_object('sub', :'uid', 'role', 'authenticated')::text, true);
set local role authenticated;

-- 3 otwarte zlecenia 80N PRAWE bez receptury skrzydła → rezerwacja od nowa
create temp table fix_orders as
select o.id, o.order_number from orders o
where o.category = 'ST' and upper(o.system) = 'ST68 TERMO' and upper(o.wing_color) = 'ANTRACYT'
  and upper(o.width) = '80N' and upper(o.direction) = 'PRAWE'
  and (o.release_date is null or o.release_date::text = '')
  and coalesce((o.extra_fields->>'cancelled')::boolean, false) = false
  and not exists (select 1 from stock_reservations sr where sr.order_id = o.id and sr.status in ('released', 'partially_released'));
select * from fix_orders;
select f.order_number, (select count(*) from stock_reservations sr where sr.order_id = f.id and sr.status in ('reserved','partially_released')) as aktywne_przed from fix_orders f;
do $$
declare r record;
begin
  for r in select id from fix_orders loop
    perform public.cancel_order_reservations__impl(r.id, 'superseded');
    perform 1 from public.reserve_stock_for_order(r.id);
  end loop;
end $$;
select f.order_number, o.stock_status, (select count(*) from stock_reservations sr where sr.order_id = f.id and sr.status = 'reserved') as rezerwacje,
       (select string_agg(e->>'type' || ':' || coalesce(e->>'part',''), ', ') from jsonb_array_elements(coalesce(o.stock_issues,'[]')) e) as issues
from fix_orders f join orders o on o.id = f.id;
commit;
