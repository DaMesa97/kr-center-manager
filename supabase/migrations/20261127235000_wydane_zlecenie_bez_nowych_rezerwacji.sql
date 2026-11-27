-- 27.11.2026 (testy 27.11 (runda 6); WYSOKI): WYDANE zlecenie (release_date ustawione) po edycji albo po
-- „Anuluj” → „Przywróć” dostawało nowe rezerwacje, których potem nikt nie zdejmie (wydania już nie będzie).
-- Symulacja: zlecenie id 14395 (wydane 3.11), zmiana szerokości → syncWarehouseStockAfterOrderEdit
-- (cancel_order_reservations 'superseded' + reserve_stock_for_order) → 23 aktywne rezerwacje. Narażonych 724
-- wydanych zleceń z samymi anulowanymi rezerwacjami (Disting 546, STA 157, ST 21); 27.11: żadne wydane zlecenie
-- nie ma jeszcze aktywnej rezerwacji (sprawdzone: 0), więc porządki danych nie są potrzebne.
-- Teraz, spójnie z rebuild_reservations_for_category (pomija release_date is not null; kolumna jest typu date):
--  1) reserve_stock_for_order dla wydanego zlecenia nic nie robi i zwraca pusty wynik (aplikacja nie pokazuje
--     wtedy komunikatu — tak jak dla anulowanego po 20261127232200);
--  2) restore_order_reservations__impl dla wydanego zlecenia zwraca 0 i niczego nie przywraca (aplikacja woła
--     potem reserve_stock_for_order, które też nic nie zrobi).
-- Działa po 20261127232000 / 232200 / 234100 i bez nich (miejsca łatek są w każdej wersji). Kontrola „już
-- poprawione” po znaczniku „testy 27.11 (runda 6), wydane”.
-- DO WDROŻENIA (nie wgrane w sesji).
do $$
declare
  d text;
  stare text := '    raise exception ''Zamówienie % nie istnieje'', p_order_id;
  end if;
';
  nowe text := '    raise exception ''Zamówienie % nie istnieje'', p_order_id;
  end if;
  -- zlecenie wydane: nowych rezerwacji nikt by nie zdjął (testy 27.11 (runda 6), wydane)
  if exists (select 1 from orders o where o.id = p_order_id and o.release_date is not null) then
    return;
  end if;
';
begin
  -- 1) reserve_stock_for_order
  d := pg_get_functiondef('public.reserve_stock_for_order(bigint)'::regprocedure);
  if position('testy 27.11 (runda 6), wydane' in d) > 0 then
    raise notice 'reserve_stock_for_order: już poprawione — bez zmian';
  elsif position(stare in d) = 0 then
    raise exception 'reserve_stock_for_order: nie znaleziono miejsca łatki — sprawdź definicję';
  else
    execute replace(d, stare, nowe);
  end if;

  -- 2) restore_order_reservations__impl
  d := pg_get_functiondef('public.restore_order_reservations__impl(bigint)'::regprocedure);
  stare := '  v_n int;
begin
';
  nowe := '  v_n int;
begin
  -- zlecenie wydane: przywrócone rezerwacje zostałyby na zawsze (testy 27.11 (runda 6), wydane)
  if exists (select 1 from orders o where o.id = p_order_id and o.release_date is not null) then
    return 0;
  end if;
';
  if position('testy 27.11 (runda 6), wydane' in d) > 0 then
    raise notice 'restore_order_reservations__impl: już poprawione — bez zmian';
  elsif position(stare in d) = 0 then
    raise exception 'restore_order_reservations__impl: nie znaleziono miejsca łatki — sprawdź definicję';
  else
    execute replace(d, stare, nowe);
  end if;
end $$;
