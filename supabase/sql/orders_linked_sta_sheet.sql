-- Powiązanie zamówień STA ↔ Disting (DISTING PLUS)
alter table public.orders
  add column if not exists linked_order_id bigint references public.orders (id) on delete set null;

alter table public.orders
  add column if not exists sta_sheet text;

comment on column public.orders.linked_order_id is 'ID powiązanego zamówienia (STA↔Disting)';
comment on column public.orders.sta_sheet is 'Numer zlecenia STA (wiersz Disting)';
