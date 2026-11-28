-- 28.11.2026, decyzja D62 (właściciel: TAK).
-- Odhaczanie pozycji drzwi wewnętrznych (tabela order_item_picks — „przygotowane do pakowania”) mogą robić tylko:
-- kierownicy (current_user_is_manager), magazynier (oraz stara rola worker z działu magazyn — to samo co magazynier)
-- i kierownik działu, który ma w profilu kategorię DrzwiWewnetrzne (profiles.categories, te same nazwy co
-- orders.category). Dotąd current_user_can_pick() wpuszczał każdego kierownika działu — także kierownika działu
-- tylko STA (sprawdzone w cofniętej transakcji, opis D62 w DECISIONS.md).
-- current_user_can_pick() jest używana WYŁĄCZNIE w politykach order_item_picks (insert / update / delete) —
-- sprawdzone w pg_proc / pg_policies 28.11; set_components_stocked ma własne sprawdzenie i się nie zmienia.
-- Aplikacja (canPickIntDoor w src/lib/orderPicks.ts) stosuje tę samą regułę.
-- DO WDROŻENIA (nie wgrane).

create or replace function public.current_user_can_pick()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- D62: kierownik działu tylko z kategorią DrzwiWewnetrzne
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'magazynier'
        or (p.role = 'worker' and p.department = 'magazyn')
        or (p.role = 'kierownik_dzialu' and 'DrzwiWewnetrzne' = any(coalesce(p.categories, '{}'::text[])))
      )
  )
  or (
    public.current_user_is_manager()
    and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'kierownik_dzialu')
  );
$$;

revoke all on function public.current_user_can_pick() from public, anon;
grant execute on function public.current_user_can_pick() to authenticated;
