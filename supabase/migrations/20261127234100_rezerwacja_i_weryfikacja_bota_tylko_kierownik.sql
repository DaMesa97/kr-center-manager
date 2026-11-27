-- 27.11.2026 (testy 27.11, runda 3; KRYTYCZNY): reserve_stock_for_order nie sprawdzało roli — obsługa klienta
-- (604cbf0a…) i konto bez profilu założyły 23 rezerwacje na anulowanym zleceniu 15991. Zlecenia zakładają i edytują
-- tylko kierownicy (polityka orders_insert = current_user_is_manager(); w aplikacji canCreateOrder = isManager,
-- permissions.ts: orders.create / orders.edit), a Edge orders-intake / orders-excel-intake wołają funkcję kluczem
-- serwisowym. W bazie woła ją tylko rebuild_reservations_for_category (SECURITY DEFINER, auth.uid() wywołującego).
-- Teraz: kierownik (current_user_is_manager) albo service_role albo bezpośrednio postgres (migracje, SQL Editor) —
-- reszta dostaje błąd 42501.
-- Przy okazji revalidate_bot_order (zdejmuje needs_review; „weryfikacja BOT” = review.handle, tylko kierownicy;
-- aplikacja woła ją po zapisie edycji zlecenia) — to samo sprawdzenie.
-- Działa po 20261127232200 (rezerwacja pomija anulowane) i bez niego: miejsce łatki to początek funkcji.
-- DO WDROŻENIA (nie wgrane w sesji).
do $$
declare
  d text;
  v_check text := '
  -- tylko kierownik / service_role (testy 27.11 (runda 3), uprawnienia)
  if not (coalesce(auth.role(), '''') = ''service_role'' or session_user = ''postgres''
          or public.current_user_is_manager()) then
    raise exception ''Brak uprawnień — rezerwacje zleceń zakłada kierownik.'' using errcode = ''42501'';
  end if;
';
  stare text := 'begin
  select o.id, o.category, o.system, o.quantity, o.order_number, o.production_stages';
begin
  d := pg_get_functiondef('public.reserve_stock_for_order(bigint)'::regprocedure);
  if position('testy 27.11 (runda 3), uprawnienia' in d) > 0 then
    raise notice 'reserve_stock_for_order: uprawnienia już są — bez zmian';
  elsif position(stare in d) = 0 then
    raise exception 'reserve_stock_for_order: nie znaleziono miejsca łatki — sprawdź definicję';
  else
    execute replace(d, stare, 'begin' || v_check || substr(stare, 6));
  end if;

  d := pg_get_functiondef('public.revalidate_bot_order(bigint)'::regprocedure);
  stare := 'BEGIN
  SELECT
    o.id, o.category, o.model';
  if position('testy 27.11 (runda 3), uprawnienia' in d) > 0 then
    raise notice 'revalidate_bot_order: uprawnienia już są — bez zmian';
  elsif position(stare in d) = 0 then
    raise exception 'revalidate_bot_order: nie znaleziono miejsca łatki — sprawdź definicję';
  else
    execute replace(d, stare, 'BEGIN' || replace(v_check, 'rezerwacje zleceń zakłada kierownik', 'zamówienia BOT weryfikuje kierownik') || substr(stare, 6));
  end if;
end $$;
