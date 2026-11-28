-- 28.11.2026 (runda 10 (28.11); WYSOKI): pozycje ZD (purchase_order_items) dało się zmieniać przy każdym statusie
-- ZD — polityka po_items_modify sprawdza tylko rolę. Dowód testera: zakończona ZD 28, admin przez API (RLS):
-- update quantity_ordered, delete pozycji z przyjętą ilością, insert nowej pozycji — wszystko przeszło.
-- Teraz trigger BEFORE INSERT/UPDATE/DELETE:
--  - insert pozycji — tylko do ZD w statusie 'draft' (szkic);
--  - zmiana quantity_ordered / component_id / purchase_order_id — tylko w szkicu (stara i nowa ZD);
--  - delete — tylko w szkicu, a pozycji z quantity_received > 0 NIGDY (także przy kasowaniu całej ZD kaskadą);
--    kaskada z usuwanego szkicu (ZD już nie ma) przechodzi.
-- Przepuszcza bez zmian: przyjęcie (receive_purchase_order__impl: quantity_received, status_per_item przy sent/
-- partial), anulowanie ZD i pozycji (status_per_item), tworzenie ZD z listy zakupów (create_purchase_order__impl
-- wstawia pozycje do świeżego szkicu), edycję szkicu w aplikacji (PurchaseOrderDetailsModal: update ilości,
-- insert, delete przy statusie draft), notatki (notes). Kolumn ceny w tabeli nie ma.
-- Wyjątek serwisowy: sesja postgres bez zalogowanego użytkownika (SQL Editor, scripts/cleanup-test-data.sql).
-- Nie zależy od niewgranych migracji tej nocy (20261127231000 zmienia tylko cancel_purchase_order__impl, który
-- pisze status_per_item — przepuszczany).
-- DO WDROŻENIA (nie wgrane w sesji).
create or replace function public.purchase_order_items_guard()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_old_status text;
  v_new_status text;
begin
  -- serwis (SQL Editor / skrypt porządków): bez zalogowanego użytkownika (runda 10 (28.11), pozycje ZD)
  if session_user = 'postgres' and auth.uid() is null then
    return coalesce(new, old);
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    select status into v_old_status from purchase_orders where id = old.purchase_order_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    select status into v_new_status from purchase_orders where id = new.purchase_order_id;
  end if;

  if tg_op = 'INSERT' then
    if v_new_status is distinct from 'draft' then
      raise exception 'Pozycje można dodawać tylko do szkicu zamówienia (ta ZD ma status %).', coalesce(v_new_status, '?')
        using errcode = 'P0420';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if coalesce(old.quantity_received, 0) > 0 then
      raise exception 'Nie można usunąć pozycji, z której już przyjęto towar (% szt.). Zamknij ją przyciskiem „Zamknij pozycję”.',
        old.quantity_received using errcode = 'P0420';
    end if;
    -- v_old_status null = kaskada z usuwanej ZD
    if v_old_status is not null and v_old_status <> 'draft' then
      raise exception 'Pozycje można usuwać tylko ze szkicu zamówienia (ta ZD ma status %). Niepotrzebną pozycję zamknij.',
        v_old_status using errcode = 'P0420';
    end if;
    return old;
  end if;

  -- UPDATE
  if (new.quantity_ordered is distinct from old.quantity_ordered
      or new.component_id is distinct from old.component_id
      or new.purchase_order_id is distinct from old.purchase_order_id)
     and (v_old_status is distinct from 'draft' or v_new_status is distinct from 'draft') then
    raise exception 'Ilość i komponent pozycji można zmieniać tylko w szkicu zamówienia (ta ZD ma status %).',
      coalesce(v_old_status, '?') using errcode = 'P0420';
  end if;
  return new;
end;
$function$;

revoke all on function public.purchase_order_items_guard() from public, anon, authenticated;

drop trigger if exists trg_purchase_order_items_guard on public.purchase_order_items;
create trigger trg_purchase_order_items_guard
  before insert or update or delete on public.purchase_order_items
  for each row execute function public.purchase_order_items_guard();
