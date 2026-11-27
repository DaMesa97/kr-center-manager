-- 27.11.2026 (testy 27.11 (runda 6); WYSOKI): zdjęcie „#ND” z etapu ANULOWANEGO zlecenia (update_order_stage,
-- gałąź #ND → puste / „KR” / #W) wołało restore_stage_reservations__impl — rezerwacje etapu wracały do 'reserved'
-- na zleceniu, którego nikt nie zrobi (zlecenie id 29287, e2_1: restored 2).
-- Teraz (obrona w głębi — w samej funkcji, więc działa dla każdego, kto ją woła):
--  1) restore_stage_reservations__impl:
--     - zlecenie WYDANE (release_date ustawione): nic nie przywraca, zwraca 0 (update_order_stage po 20261127234400
--       i tak odmawia wcześniej błędem P0409; bez tamtego pliku etap się zmieni, rezerwacja zostaje anulowana);
--     - zlecenie ANULOWANE (extra_fields.cancelled = true): etap się zmienia, rezerwacja zostaje anulowana — zwraca 0.
--       Jej powód zmienia się ze 'stage_na' na 'order_cancelled', żeby „Przywróć” (restore_order_reservations)
--       oddał ją razem z resztą zlecenia (etap znów dotyczy). Stany magazynu bez zmian.
--  2) cancel_stage_reservations__impl (lustro): wpisanie #ND na ANULOWANYM zleceniu zmienia powód anulowanych
--     wierszy tego etapu z 'order_cancelled' na 'stage_na' — „Przywróć” nie zarezerwuje etapu, który nie dotyczy
--     (wróci dopiero po zdjęciu #ND). Stany magazynu bez zmian.
-- update_order_stage bez zmian (zwraca restored = 0). Działa po 20261127233000 (nowa wersja
-- cancel_stage_reservations__impl), 20261127234000 (uprawnienia) i 20261127234400 i bez nich — miejsca łatek są
-- w obu wersjach. Uwaga: 20261127233000 to pełne „create or replace” — gdyby wgrać go PO tym pliku, puścić ten
-- plik jeszcze raz (kontrola „już poprawione” po znaczniku „testy 27.11 (runda 6), anulowane”).
-- 27.11: żadne anulowane zlecenie nie ma aktywnych rezerwacji ani wierszy 'stage_na' (sprawdzone: 0) — porządki
-- danych niepotrzebne.
-- DO WDROŻENIA (nie wgrane w sesji).
do $$
declare
  d text;
  stare text := '  v_count integer := 0;
begin
  for v_res in';
  nowe text := '  v_count integer := 0;
begin
  -- zlecenie wydane: rezerwacja wróciłaby na zawsze (testy 27.11 (runda 6), anulowane)
  if exists (select 1 from orders o where o.id = p_order_id and o.release_date is not null) then
    return 0;
  end if;
  -- zlecenie anulowane: etap się zmienia, rezerwacja nie — wróci przy „Przywróć” razem z resztą zlecenia
  if exists (select 1 from orders o where o.id = p_order_id and o.extra_fields->>''cancelled'' = ''true'') then
    update stock_reservations sr
    set cancel_reason = ''order_cancelled'', updated_at = now()
    where sr.order_id = p_order_id and sr.stage_key = p_stage_key
      and sr.status = ''cancelled'' and sr.cancel_reason = ''stage_na'';
    return 0;
  end if;
  for v_res in';
begin
  -- 1) restore_stage_reservations__impl
  d := pg_get_functiondef('public.restore_stage_reservations__impl(bigint,text)'::regprocedure);
  if position('testy 27.11 (runda 6), anulowane' in d) > 0 then
    raise notice 'restore_stage_reservations__impl: już poprawione — bez zmian';
  elsif position(stare in d) = 0 then
    raise exception 'restore_stage_reservations__impl: nie znaleziono miejsca łatki — sprawdź definicję';
  else
    execute replace(d, stare, nowe);
  end if;

  -- 2) cancel_stage_reservations__impl (lustro)
  d := pg_get_functiondef('public.cancel_stage_reservations__impl(bigint,text)'::regprocedure);
  stare := '  if v_count > 0 then
    perform public.recompute_order_stock_status(p_order_id);';
  nowe := '  -- zlecenie anulowane: „Przywróć” nie zarezerwuje etapu „nie dotyczy” (testy 27.11 (runda 6), anulowane)
  if exists (select 1 from orders o where o.id = p_order_id and o.extra_fields->>''cancelled'' = ''true'') then
    update stock_reservations sr
    set cancel_reason = ''stage_na'', updated_at = now()
    where sr.order_id = p_order_id and sr.stage_key = p_stage_key
      and sr.status = ''cancelled'' and sr.cancel_reason = ''order_cancelled'';
  end if;
  if v_count > 0 then
    perform public.recompute_order_stock_status(p_order_id);';
  if position('testy 27.11 (runda 6), anulowane' in d) > 0 then
    raise notice 'cancel_stage_reservations__impl: już poprawione — bez zmian';
  elsif position(stare in d) = 0 then
    raise exception 'cancel_stage_reservations__impl: nie znaleziono miejsca łatki — sprawdź definicję';
  else
    execute replace(d, stare, nowe);
  end if;
end $$;
