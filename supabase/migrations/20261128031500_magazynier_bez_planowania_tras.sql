-- 28.11.2026 — decyzja D31 (właściciel: NIE — magazynier nie planuje tras dostaw).
-- Było: „Dodaj do trasy” / „Odepnij od tej trasy” (Wysyłka → Biurko logistyki) widoczne dla magazyniera; zapis
-- extra_fields.route_pin przez merge_order_extra_fields. Polityka orders_update (20261127234200) wpuszcza
-- magazyniera do zleceń DrzwiWewnetrzne (potrzebne do wydania i kompletacji), więc dla nich przypięcie przechodziło.
-- Teraz: trigger BEFORE UPDATE OF extra_fields na orders odrzuca (P0001) zmianę extra_fields.route_pin, gdy zmienia
-- ją konto z rolą magazynier. Inne zmiany extra_fields magazyniera (kompletacja, wydanie) — bez zmian; pozostałe
-- role, konto serwisowe i postgres — bez zmian.
-- Aplikacja od tej wersji chowa „Dodaj do trasy” / „Odepnij” bez uprawnienia shipping.routes (permissions.ts).
-- DO WDROŻENIA (nie wgrane). Samodzielny.

create or replace function public.orders_block_route_pin_magazynier()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  -- D31: magazynier nie planuje tras
  if auth.uid() is not null
     and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'magazynier') then
    raise exception 'Magazynier nie planuje tras — przypięcie do trasy zmienia kierownik.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$function$;

revoke all on function public.orders_block_route_pin_magazynier() from public, anon, authenticated;

drop trigger if exists trg_orders_block_route_pin_magazynier on public.orders;
create trigger trg_orders_block_route_pin_magazynier
  before update of extra_fields on public.orders
  for each row
  when ((old.extra_fields->'route_pin') is distinct from (new.extra_fields->'route_pin'))
  execute function public.orders_block_route_pin_magazynier();
