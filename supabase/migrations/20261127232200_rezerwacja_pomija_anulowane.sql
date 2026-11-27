-- 27.11.2026 (testy 27.11, runda 3; KRYTYCZNY): edycja ANULOWANEGO zlecenia zakładała nowe rezerwacje.
-- Aplikacja po edycji (syncWarehouseStockAfterOrderEdit) woła cancel_order_reservations('superseded') — anulowane
-- zlecenie nie ma aktywnych wierszy, więc nic — a potem reserve_stock_for_order, które rezerwowało komponenty na
-- zlecenie, którego nikt nie zrobi (zlecenie testowe id 29279). Teraz reserve_stock_for_order dla zlecenia z
-- extra_fields.cancelled = true nic nie robi i zwraca pusty wynik (aplikacja nie pokazuje wtedy komunikatu).
-- „Przywróć” najpierw zdejmuje znacznik anulowania, dopiero potem rezerwuje — działa jak dotąd.
-- Poprawka (testy 27.11, runda 3; WYSOKI, recenzent): przed założeniem świeżych rezerwacji stare wiersze anulowane
-- z powodem 'order_cancelled' (i stare bez powodu) dostają 'superseded' — tak jak już 'stage_na'. Inaczej „Przywróć”
-- przerwane po zdjęciu znacznika (bez restore_order_reservations) → edycja zakłada świeże → drugie Anuluj→Przywróć
-- przywracało obie paczki (zlecenie id 29278: 62,75 → 125,5). Funkcja dochodzi tu tylko, gdy zlecenie nie ma
-- żadnej aktywnej rezerwacji, więc każdy anulowany wiersz jest już zastąpiony świeżym.
-- DO WDROŻENIA (nie wgrane w sesji).
do $$
declare d text;
  stare text := '  v_expected_parts := public.expected_parts_for_category(v_order.category);';
  nowe text := '  -- zlecenie anulowane: nic nie rezerwujemy (testy 27.11, runda 3)
  if exists (select 1 from orders o where o.id = p_order_id and o.extra_fields->>''cancelled'' = ''true'') then
    return;
  end if;
  v_expected_parts := public.expected_parts_for_category(v_order.category);';
  stare2 text := 'where sr.order_id = p_order_id and sr.status = ''cancelled'' and sr.cancel_reason = ''stage_na'';';
  nowe2 text := 'where sr.order_id = p_order_id and sr.status = ''cancelled''
    -- świeże rezerwacje zastępują też stare anulowania zlecenia (testy 27.11, runda 3)
    and (sr.cancel_reason in (''stage_na'', ''order_cancelled'') or sr.cancel_reason is null);';
begin
  d := pg_get_functiondef('public.reserve_stock_for_order(bigint)'::regprocedure);
  if position('testy 27.11, runda 3' in d) > 0 then
    raise notice 'reserve_stock_for_order: już poprawione — bez zmian';
    return;
  end if;
  if position(stare in d) = 0 or position(stare2 in d) = 0 then
    raise exception 'reserve_stock_for_order: nie znaleziono miejsca łatki — sprawdź definicję';
  end if;
  execute replace(replace(d, stare, nowe), stare2, nowe2);
end $$;
