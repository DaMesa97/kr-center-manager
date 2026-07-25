-- =====================================================================
-- RECEPTURY: DYNAMICZNE KRYTERIA (2026-07-24)
-- Zamiast sztywnych kolumn (system/model/kolor/…) receptura ma listę
-- kryteriów: pole zlecenia + dozwolone wartości (jedna lub WIELE).
--   * multi-wybór wartości  → allowed_values to tablica (checkboxy)
--   * "nie dotyczy"         → po prostu brak kryterium dla pola
--   * dowolne pole zlecenia → np. zamek wg zaczepu (field='zaczep')
-- Dopasowanie: receptura pasuje, gdy KAŻDE jej kryterium jest spełnione
-- (wartość zlecenia ∈ allowed_values; porównanie po TRIM+UPPER).
-- Przy wielu pasujących w tej samej części wygrywa NAJBARDZIEJ
-- SZCZEGÓŁOWA (najwięcej kryteriów), remis → nowsza (wyższe id).
--
-- consume_stock_for_order NIE jest ruszane — podmieniamy tylko
-- match_recipes_for_order, z którego korzysta.
-- =====================================================================

-- 1) Tabela kryteriów
create table if not exists public.warehouse_recipe_criteria (
  id             bigint generated always as identity primary key,
  recipe_id      bigint not null references public.warehouse_recipes(id) on delete cascade,
  field          text   not null,
  allowed_values text[] not null default '{}',
  unique (recipe_id, field)
);

alter table public.warehouse_recipe_criteria enable row level security;

drop policy if exists wrc_read on public.warehouse_recipe_criteria;
create policy wrc_read on public.warehouse_recipe_criteria
  for select to authenticated using (true);
drop policy if exists wrc_insert on public.warehouse_recipe_criteria;
create policy wrc_insert on public.warehouse_recipe_criteria
  for insert to authenticated with check (public.current_user_is_manager());
drop policy if exists wrc_update on public.warehouse_recipe_criteria;
create policy wrc_update on public.warehouse_recipe_criteria
  for update to authenticated using (public.current_user_is_manager());
drop policy if exists wrc_delete on public.warehouse_recipe_criteria;
create policy wrc_delete on public.warehouse_recipe_criteria
  for delete to authenticated using (public.current_user_is_manager());

-- 2) Backfill: istniejące receptury → kryteria z niepustych starych kolumn
--    (idempotentny: tylko receptury, które nie mają jeszcze żadnych kryteriów)
insert into public.warehouse_recipe_criteria (recipe_id, field, allowed_values)
select r.id, f.field, array[f.value]
from public.warehouse_recipes r
cross join lateral (
  values
    ('system',           r.system),
    ('model',            r.model),
    ('wing_color',       r.wing_color),
    ('frame_color',      r.frame_color),
    ('width',            r.width),
    ('glazing',          r.glazing),
    ('direction',        r.direction),
    ('decorative_panel', r.decorative_panel),
    ('hardware',         r.hardware),
    ('handle',           r.handle),
    ('peephole',         r.peephole),
    ('electric_strike',  r.electric_strike)
) as f(field, value)
where coalesce(trim(f.value), '') <> ''
  and not exists (select 1 from public.warehouse_recipe_criteria c where c.recipe_id = r.id);

-- 3) Nowy matcher (podmienia dotychczasowy)
create or replace function public.match_recipes_for_order(p_order_id bigint)
returns table(recipe_id bigint, part text)
language sql
stable
security definer
set search_path = public
as $$
  with o as (
    select to_jsonb(orders.*) as j, orders.category
    from orders
    where orders.id = p_order_id
  ),
  cand as (
    select
      r.id,
      r.part,
      (select count(*) from warehouse_recipe_criteria c where c.recipe_id = r.id) as crit_count
    from warehouse_recipes r, o
    where r.is_active
      and r.category = o.category
      and not exists (
        select 1
        from warehouse_recipe_criteria c
        where c.recipe_id = r.id
          and upper(trim(coalesce(o.j ->> c.field, ''))) <> all (
            select upper(trim(v)) from unnest(c.allowed_values) v
          )
      )
  )
  select distinct on (cand.part) cand.id, cand.part
  from cand
  order by cand.part, cand.crit_count desc, cand.id desc
$$;

-- ── WERYFIKACJA ────────────────────────────────────────────────────────
-- ile kryteriów przeniesiono:
select count(*) as kryteria, count(distinct recipe_id) as receptury
from public.warehouse_recipe_criteria;
-- test na realnym zleceniu (podstaw ID):
-- select * from match_recipes_for_order(123);
