-- =====================================================================
-- Kategoria door_accessory (zamki, wkładki, skrócenia… z kartotek Optimy)
-- w CHECK warehouse_components.product_category.
--
-- Brief importu kartotek mówi, że wartość „dojdzie do CHECK-a w bazie”.
-- Ten plik robi to TYLKO, jeśli jeszcze jej nie ma (bezpieczny do ponownego
-- uruchomienia, nic nie zmienia, gdy import już ją dodał). Addytywne:
-- dopuszcza nową wartość, istniejących nie zabiera.
-- =====================================================================
do $$
declare
  v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
  from pg_constraint
  where conrelid = 'public.warehouse_components'::regclass
    and conname = 'warehouse_components_product_category_check';

  if v_def is null or v_def not like '%door_accessory%' then
    alter table public.warehouse_components drop constraint if exists warehouse_components_product_category_check;
    alter table public.warehouse_components add constraint warehouse_components_product_category_check
      check (product_category = any (array['raw', 'door_wing', 'door_frame', 'door_handle', 'door_hinge_cover', 'door_accessory']));
  end if;
end $$;
