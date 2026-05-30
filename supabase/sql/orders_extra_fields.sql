-- Flagi anulowania partnera (DISTING PLUS): disting_cancelled / sta_cancelled
alter table public.orders
  add column if not exists extra_fields jsonb not null default '{}'::jsonb;

comment on column public.orders.extra_fields is 'JSON m.in. disting_cancelled, sta_cancelled przy usunięciu powiązanego zamówienia';
