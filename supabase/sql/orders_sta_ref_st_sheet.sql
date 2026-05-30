-- Titan ST ↔ STA: referencje numerów zamówień
alter table public.orders add column if not exists sta_ref text;
alter table public.orders add column if not exists st_sheet text;

comment on column public.orders.sta_ref is 'Numer zamówienia powiązanego STA (widok ST Titan)';
comment on column public.orders.st_sheet is 'Numer zamówienia powiązanego ST (widok STA dla Titan)';
