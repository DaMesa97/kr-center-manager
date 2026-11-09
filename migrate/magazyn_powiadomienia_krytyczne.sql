-- 2026-11-09: Magazyn — powiadomienie o braku krytycznym na półce.
--
-- Wymaga migrate/magazyn_poziomy_brakow.sql (stock_level, stock_shortage,
-- stock_incoming_for, stock_min_effective, warehouse_stock.min_quantity).
--
-- Trigger trg_stock_critical_notify (AFTER INSERT OR UPDATE OF quantity,
-- reserved_quantity, min_quantity ON warehouse_stock): gdy półka PRZECHODZI
-- w 'critical' (dostępne < 0 i dostawy w drodze nie dociągają), wpis w
-- notifications typu 'stock_critical' dla admin / manager / kierownik_magazynu:
--   title: „Brak krytyczny: <komponent> (<kod magazynu>)”
--   body:  „Dostępne -18 szt, w drodze 0, do zamówienia 18 · Magazyn → Stany”
--   link_tab 'Stany' (zakładka Magazyn → Stany), link_order_id null.
-- Bez dubli: pomija usera, który ma już 'stock_critical' z tym samym title
-- z ostatnich 24 h (wzór: notify_erp_error).
--
-- Koszt: trigger odpala się przy KAŻDYM ruchu / rezerwacji. Dlatego:
--   • szybkie wyjście, gdy nowe dostępne >= 0 (nie może być critical) — zero
--     zapytań; to zdecydowana większość przyjęć / zwolnień rezerwacji;
--   • „w drodze” liczone tylko dla tej półki (stock_incoming_for — index
--     idx_po_items_component), nie przez get_incoming_stock_per_warehouse();
--   • stock_min_effective (Smart ROP dla jednego komponentu, ~0,1 ms) tylko
--     gdy półka faktycznie wchodzi w critical — potrzebne do „do zamówienia”.
-- Całość w begin … exception when others → raise warning: powiadomienie jest
-- dodatkiem i NIE może wywrócić ruchu magazynowego ani rezerwacji.
-- Idempotentne.

create or replace function public.stock_critical_notify()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_incoming  numeric;
  v_min       numeric;
  v_old_level text;
  v_new_level text;
  v_name      text;
  v_unit      text;
  v_wh_code   text;
  v_title     text;
  v_body      text;
  v_available numeric;
  v_shortage  numeric;
begin
  begin
    -- 1) Szybkie wyjście: dostępne >= 0 → nie może być critical.
    if (new.quantity - coalesce(new.reserved_quantity, 0)) >= 0 then
      return new;
    end if;

    -- 2) W drodze dla tej półki (ta sama reguła co widok v_stock_levels).
    v_incoming := public.stock_incoming_for(new.warehouse_id, new.component_id);

    -- 3) Minimum efektywne (shelf → smart → component) — jak w widoku.
    select m.min_effective into v_min
    from public.stock_min_effective(new.warehouse_id, new.component_id, new.min_quantity) m;

    v_new_level := public.stock_level(new.quantity, new.reserved_quantity, v_incoming, v_min);
    if v_new_level <> 'critical' then
      return new;
    end if;

    if tg_op = 'INSERT' then
      v_old_level := 'ok';
    else
      -- dla OLD to samo „w drodze” i to samo minimum — czy OLD było critical
      -- zależy tylko od quantity / reserved / incoming, nie od minimum
      v_old_level := public.stock_level(old.quantity, old.reserved_quantity, v_incoming, v_min);
    end if;

    if v_old_level = 'critical' then
      return new;
    end if;

    -- 4) Treść
    select c.name, c.unit into v_name, v_unit
    from public.warehouse_components c where c.id = new.component_id;
    select w.code into v_wh_code
    from public.warehouses w where w.id = new.warehouse_id;

    v_available := new.quantity - coalesce(new.reserved_quantity, 0);
    v_shortage  := public.stock_shortage(new.quantity, new.reserved_quantity, v_incoming, v_min);

    v_title := 'Brak krytyczny: ' || coalesce(v_name, 'komponent #' || new.component_id::text)
               || ' (' || coalesce(v_wh_code, '?') || ')';
    v_body  := 'Dostępne ' || rtrim(rtrim(to_char(v_available, 'FM9999999990.999'), '0'), '.')
               || ' ' || coalesce(nullif(trim(v_unit), ''), 'szt')
               || ', w drodze ' || rtrim(rtrim(to_char(coalesce(v_incoming, 0), 'FM9999999990.999'), '0'), '.')
               || ', do zamówienia ' || rtrim(rtrim(to_char(v_shortage, 'FM9999999990.999'), '0'), '.')
               || ' · Magazyn → Stany';

    -- 5) Powiadomienia dla ról, bez dubli (ten sam title, 24 h)
    insert into public.notifications (user_id, type, title, body, link_tab, link_order_id)
    select p.id, 'stock_critical', v_title, v_body, 'Stany', null
    from public.profiles p
    where p.role in ('admin', 'manager', 'kierownik_magazynu')
      and not exists (
        select 1 from public.notifications n
        where n.user_id = p.id
          and n.type = 'stock_critical'
          and n.title = v_title
          and n.created_at > now() - interval '1 day'
      );
  exception when others then
    raise warning 'stock_critical_notify: pominięto powiadomienie (półka %): %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

-- funkcja triggera: nikt nie woła jej ręcznie (postgres jako właściciel wystarcza)
revoke all on function public.stock_critical_notify() from public, anon, authenticated, service_role;

drop trigger if exists trg_stock_critical_notify on public.warehouse_stock;
create trigger trg_stock_critical_notify
  after insert or update of quantity, reserved_quantity, min_quantity
  on public.warehouse_stock
  for each row
  execute function public.stock_critical_notify();

-- Szukanie dubli: (user_id, type, title, created_at)
create index if not exists idx_notifications_stock_critical_dedupe
  on public.notifications (user_id, title, created_at desc)
  where type = 'stock_critical';

notify pgrst, 'reload schema';
