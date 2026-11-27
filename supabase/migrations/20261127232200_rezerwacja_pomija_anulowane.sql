-- 27.11.2026 (testy 27.11, runda 3; KRYTYCZNY): edycja ANULOWANEGO zlecenia zakładała nowe rezerwacje.
-- Aplikacja po edycji (syncWarehouseStockAfterOrderEdit) woła cancel_order_reservations('superseded') — anulowane
-- zlecenie nie ma aktywnych wierszy, więc nic — a potem reserve_stock_for_order, które rezerwowało komponenty na
-- zlecenie, którego nikt nie zrobi (zlecenie testowe id 29279). Teraz reserve_stock_for_order dla zlecenia z
-- extra_fields.cancelled = true nic nie robi i zwraca pusty wynik (aplikacja nie pokazuje wtedy komunikatu).
-- „Przywróć” najpierw zdejmuje znacznik anulowania, dopiero potem rezerwuje — działa jak dotąd.
-- DO WDROŻENIA (nie wgrane w sesji).
do $$
declare d text;
  stare text := '  v_expected_parts := public.expected_parts_for_category(v_order.category);';
  nowe text := '  -- zlecenie anulowane: nic nie rezerwujemy (testy 27.11, runda 3)
  if exists (select 1 from orders o where o.id = p_order_id and o.extra_fields->>''cancelled'' = ''true'') then
    return;
  end if;
  v_expected_parts := public.expected_parts_for_category(v_order.category);';
begin
  d := pg_get_functiondef('public.reserve_stock_for_order(bigint)'::regprocedure);
  if position('testy 27.11, runda 3' in d) > 0 then
    raise notice 'reserve_stock_for_order: już poprawione — bez zmian';
    return;
  end if;
  if position(stare in d) = 0 then
    raise exception 'reserve_stock_for_order: nie znaleziono miejsca łatki — sprawdź definicję';
  end if;
  execute replace(d, stare, nowe);
end $$;
