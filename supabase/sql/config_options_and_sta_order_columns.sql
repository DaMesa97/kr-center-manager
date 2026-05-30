-- Uruchom w Supabase SQL Editor (lub przez CLI).
-- Tabela opcji konfiguracyjnych dla formularzy (np. STA).

create table if not exists public.config_options (
  id bigint generated always as identity primary key,
  category text not null,
  type text not null,
  value text not null,
  sort_order integer not null default 0
);

create index if not exists config_options_category_type_idx
  on public.config_options (category, type);

comment on table public.config_options is 'Wartości selectów formularzy; filtr: category + type';

-- Kolumny używane przez formularz STA (jeśli jeszcze nie istnieją w orders)
alter table public.orders add column if not exists oslonki text;
alter table public.orders add column if not exists zaczep text;
alter table public.orders add column if not exists podwalina_1 text;
alter table public.orders add column if not exists podwalina_1_qty integer;
alter table public.orders add column if not exists podwalina_2 text;
alter table public.orders add column if not exists podwalina_2_qty integer;
