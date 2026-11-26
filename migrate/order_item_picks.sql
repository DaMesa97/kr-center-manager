-- =====================================================================
-- Drzwi wewnętrzne: magazyn odznacza pozycje zlecenia jako przygotowane
-- do pakowania (Tymek 26.11.2026).
--
-- Osobna tabela, bo import z Optimy (optima-ro-import) kasuje i wstawia
-- pozycje order_internal_door_items na nowo przy każdej zmianie RO — id pozycji
-- się zmieniają. Klucz linii:
--   'optima:<optima_element_id>' — pozycja z Optimy (id linii w Optimie, stały),
--   'item:<id>'                  — pozycja zlecenia ręcznego.
--
-- ADDYTYWNE: nowa tabela + polityki + realtime; nic nie zmienia w imporcie,
-- order_internal_door_items ani optima_*. Wgrane przez konektor (apply_migration
-- order_item_picks) 26.11.2026; plik zostaje jako zapis.
-- =====================================================================

create table if not exists public.order_item_picks (
  order_id bigint not null references public.orders(id) on delete cascade,
  line_key text not null check (line_key ~ '^(optima|item):[0-9]+$'),
  picked_at timestamptz not null default now(),
  picked_by uuid default auth.uid(),
  picked_initials text,
  primary key (order_id, line_key)
);

comment on table public.order_item_picks is
  'Pozycje zlecenia drzwi wewnętrznych przygotowane przez magazyn do pakowania. line_key = optima:<optima_element_id> albo item:<id>.';

alter table public.order_item_picks enable row level security;

-- kto może odznaczać: kierownicy (current_user_is_manager) + magazynier + pracownik działu magazyn
create or replace function public.current_user_can_pick()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_is_manager()
      or exists (
        select 1 from public.profiles p
        where p.id = auth.uid()
          and (p.role = 'magazynier' or (p.role = 'worker' and p.department = 'magazyn'))
      );
$$;
revoke all on function public.current_user_can_pick() from public, anon;
grant execute on function public.current_user_can_pick() to authenticated;

drop policy if exists order_item_picks_read on public.order_item_picks;
create policy order_item_picks_read on public.order_item_picks
  for select to authenticated using (true);

drop policy if exists order_item_picks_insert on public.order_item_picks;
create policy order_item_picks_insert on public.order_item_picks
  for insert to authenticated with check ((select public.current_user_can_pick()));

drop policy if exists order_item_picks_delete on public.order_item_picks;
create policy order_item_picks_delete on public.order_item_picks
  for delete to authenticated using ((select public.current_user_can_pick()));

grant select, insert, delete on public.order_item_picks to authenticated;

-- realtime: biuro widzi na żywo, co magazyn już przygotował
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'order_item_picks'
  ) then
    alter publication supabase_realtime add table public.order_item_picks;
  end if;
end $$;

-- przy DELETE realtime ma oddać order_id i line_key (nie tylko klucz główny — tu to i tak klucz)
alter table public.order_item_picks replica identity full;

notify pgrst, 'reload schema';
