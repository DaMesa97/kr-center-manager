-- 28.11.2026 — decyzja D57 (właściciel: TAK — zlecenia mieszane AS 75EI + zwykłe AS75 się zdarzają).
-- DO WDROŻENIA (nie wgrane). Wgrywać PO 20261128035100 (D54) i 20261128035300 (D53).
-- Problem: całe zlecenie stawało się ZKP — kompetencje, PIN, karty wyrobu i teczka także dla okien, które
-- nie są wyrobem przeciwpożarowym.
-- Pierwszy krok (ZKP na poziomie POZYCJI):
--  1) alu_position_is_zkp(pozycja): ręczne oznaczenie zlecenia (alu_zkp_override) ma pierwszeństwo dla
--     wszystkich pozycji („tak” = wszystkie ZKP, „nie” = żadna); bez oznaczenia — pozycja w systemie AS 75EI.
--     mark_alu_position_stage (D54/D53) już pyta o pozycję → kompetencje, PIN, blokady uruchomienia i pakowania
--     tylko dla pozycji 75EI; zwykłe pozycje zlecenia mieszanego — jak zwykłe zlecenie.
--  2) zkp_save_card: kartę wyrobu zakłada się tylko dla konstrukcji pozycji ZKP (deklaracje biorą się z kart,
--     więc też tylko 75EI).
--  3) alu_dossier_status: karty / protokoły / deklaracje w teczce liczone tylko dla konstrukcji pozycji ZKP
--     (dotąd zwykłe okna zlecenia mieszanego blokowały kompletność teczki i wydanie).
--  4) zkp_product_register (rejestr 6.33): tylko konstrukcje pozycji ZKP.
-- alu_order_is_zkp bez zmian (zlecenie jest ZKP, gdy ma choć jedną pozycję ZKP albo ręczne „tak”) — teczka
-- i blokada wydania zostają na poziomie zlecenia.
-- Funkcje 2–4 łatane w miejscu (jak 20261128021200): definicje w bazie mają CRLF — normalizujemy; kontrola
-- „już poprawione” po znaczniku „D57 (28.11)”.

create or replace function public.alu_position_is_zkp(p_position_id bigint)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  -- D57 (28.11): ręczne oznaczenie zlecenia > system pozycji (AS 75EI)
  select coalesce(
    (select o.is_zkp
     from public.order_alu_positions p
     join public.alu_zkp_override o on o.order_id = p.order_id
     where p.id = p_position_id),
    (select p.system ~* '75\s*-?\s*EI' from public.order_alu_positions p where p.id = p_position_id),
    false
  );
$function$;

revoke all on function public.alu_position_is_zkp(bigint) from public, anon;
grant execute on function public.alu_position_is_zkp(bigint) to authenticated, service_role;

do $$
declare
  d text;
  stare text;
  nowe text;
begin
  -- 2) zkp_save_card
  d := replace(pg_get_functiondef('public.zkp_save_card(bigint,jsonb)'::regprocedure), E'\r', '');
  stare := '  if not public.alu_order_is_zkp(v_con.order_id) then
    raise exception ''Zlecenie nie podlega ZKP (AS 75EI) — karta wyrobu niepotrzebna'';';
  nowe := '  -- D57 (28.11): karta wyrobu tylko dla pozycji ZKP (zlecenia mieszane)
  if not public.alu_position_is_zkp(v_con.position_id) then
    raise exception ''Pozycja % nie podlega ZKP (system nie AS 75EI) — karta wyrobu niepotrzebna'', v_con.pos_no;';
  if position('D57 (28.11)' in d) > 0 then
    raise notice 'zkp_save_card: już poprawione — bez zmian';
  elsif position(stare in d) = 0 then
    raise exception 'zkp_save_card: nie znaleziono miejsca łatki — sprawdź definicję';
  else
    execute replace(d, stare, nowe);
  end if;

  -- 3) alu_dossier_status
  d := replace(pg_get_functiondef('public.alu_dossier_status(bigint)'::regprocedure), E'\r', '');
  stare := '    where k.order_id = p_order_id and k.status = ''aktywna''
  ),';
  nowe := '    where k.order_id = p_order_id and k.status = ''aktywna''
      and public.alu_position_is_zkp(k.position_id)  -- D57 (28.11): tylko konstrukcje pozycji ZKP
  ),';
  if position('D57 (28.11)' in d) > 0 then
    raise notice 'alu_dossier_status: już poprawione — bez zmian';
  elsif position(stare in d) = 0 then
    raise exception 'alu_dossier_status: nie znaleziono miejsca łatki — sprawdź definicję';
  else
    execute replace(d, stare, nowe);
  end if;

  -- 4) zkp_product_register
  d := replace(pg_get_functiondef('public.zkp_product_register()'::regprocedure), E'\r', '');
  stare := '  where public.alu_order_is_zkp(k.order_id)';
  nowe := '  where public.alu_position_is_zkp(k.position_id)  -- D57 (28.11): tylko konstrukcje pozycji ZKP';
  if position('D57 (28.11)' in d) > 0 then
    raise notice 'zkp_product_register: już poprawione — bez zmian';
  elsif position(stare in d) = 0 then
    raise exception 'zkp_product_register: nie znaleziono miejsca łatki — sprawdź definicję';
  else
    execute replace(d, stare, nowe);
  end if;
end $$;
