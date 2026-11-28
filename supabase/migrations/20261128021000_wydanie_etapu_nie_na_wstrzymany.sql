-- 28.11.2026 (runda 10 (28.11); WYSOKI): towar schodził z magazynu na etap, który kierownik w międzyczasie
-- ustawił na „wstrzymane” (#WS:…) albo inny stan „#…”. Aplikacja (telefon, Moje stanowisko, tabela) woła
-- NAJPIERW release_stock_for_stage, potem update_order_stage. update_order_stage odrzuca pracownikowi stan „#…”
-- (P0404), ale WZ już poszło. Dowód testera: STA 29279, etap e2_1 = '#WS:test', release (force) → 12 ruchów WZ.
-- Teraz release_stock_for_stage:
--  1) blokuje wiersz zlecenia (for update) — ta sama kolejność blokad co update_order_stage (orders → rezerwacje);
--  2) odmawia (P0404, ten sam komunikat co update_order_stage), gdy etap ma stan „#…”, a wołający NIE jest
--     kierownikiem / service_role / postgres — dokładnie ten sam warunek, przy którym update_order_stage odmówi.
--     Kierownik może w update_order_stage nadpisać „#WS” inicjałami, więc i wydanie mu przepuszczamy (inaczej
--     tabela — która po błędzie wydania i tak zapisuje etap — oznaczyłaby etap bez WZ).
-- NIE zmienia: etapu już wypełnionego inicjałami (sync_stages_from_excel woła wydanie tylko dla pustego etapu
-- i nie dla „#…”); ścieżki #ND (update_order_stage → cancel_stage_reservations__impl, bez wydania).
-- Żadna wcześniejsza niewgrana migracja tej nocy nie zmienia tej funkcji. Wiersze definicji z bazy mają CRLF —
-- normalizujemy do LF przed łatką. Kontrola „już poprawione” po znaczniku „runda 10 (28.11), wstrzymane”.
-- DO WDROŻENIA (nie wgrane w sesji).
do $$
declare
  d text;
  stare text := '  select o.id, o.category, o.order_number into v_order
  from orders o where o.id = p_order_id;
  if not found then
    raise exception ''Zamówienie % nie istnieje'', p_order_id;
  end if;
';
  nowe text := '  -- blokada wiersza: kierownik nie zmieni stanu etapu w trakcie wydania (runda 10 (28.11), wstrzymane)
  select o.id, o.category, o.order_number,
         coalesce(trim(o.production_stages->>p_stage_key), '''') as stage_val
    into v_order
  from orders o where o.id = p_order_id
  for update;
  if not found then
    raise exception ''Zamówienie % nie istnieje'', p_order_id;
  end if;
  -- stan „#…” (wstrzymane / nie dotyczy): wydaje tylko ten, kto może go zdjąć — jak w update_order_stage
  if v_order.stage_val like ''#%''
     and not (coalesce(auth.role(), '''') = ''service_role'' or session_user = ''postgres''
              or public.current_user_is_manager()) then
    raise exception ''Etap jest wstrzymany albo „nie dotyczy” (%) — nic nie wydano z magazynu. Stan ustawia i zdejmuje kierownik.'',
      v_order.stage_val using errcode = ''P0404'';
  end if;
';
begin
  d := replace(pg_get_functiondef('public.release_stock_for_stage(bigint,text,boolean)'::regprocedure), E'\r', '');
  if position('runda 10 (28.11), wstrzymane' in d) > 0 then
    raise notice 'release_stock_for_stage: już poprawione — bez zmian';
  elsif position(stare in d) = 0 then
    raise exception 'release_stock_for_stage: nie znaleziono miejsca łatki — sprawdź definicję';
  else
    execute replace(d, stare, nowe);
  end if;
end $$;
