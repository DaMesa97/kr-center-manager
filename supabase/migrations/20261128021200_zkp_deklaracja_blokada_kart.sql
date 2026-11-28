-- 28.11.2026 (runda 10 (28.11); NISKI): zkp_issue_declaration sprawdzała „karty zwolnione i bez deklaracji”
-- bez blokady — dwie równoczesne deklaracje mogły objąć te same konstrukcje (dwa numery DWU/KDWU na jednej karcie).
-- Teraz przed kontrolą blokujemy wybrane karty (zkp_product_cards, for update, po id — bez zakleszczeń); druga
-- deklaracja czeka, a jej kontrola (nowy odczyt) widzi już numer pierwszej i odmawia.
-- Pliki 20261128000000…000200 tej nocy tej funkcji nie zmieniają. Definicja w bazie ma CRLF — normalizujemy.
-- Kontrola „już poprawione” po znaczniku „runda 10 (28.11), blokada kart”.
-- DO WDROŻENIA (nie wgrane w sesji).
do $$
declare
  d text;
  stare text := '  select count(*), count(distinct c.type_code)
  into v_cards, v_types
';
  nowe text := '  -- dwie równoczesne deklaracje nie obejmą tych samych kart (runda 10 (28.11), blokada kart)
  perform 1 from public.zkp_product_cards c
  where c.construction_id = any(p_construction_ids)
  order by c.id
  for update;

  select count(*), count(distinct c.type_code)
  into v_cards, v_types
';
begin
  d := replace(pg_get_functiondef('public.zkp_issue_declaration(bigint,bigint[],jsonb)'::regprocedure), E'\r', '');
  if position('runda 10 (28.11), blokada kart' in d) > 0 then
    raise notice 'zkp_issue_declaration: już poprawione — bez zmian';
  elsif position(stare in d) = 0 then
    raise exception 'zkp_issue_declaration: nie znaleziono miejsca łatki — sprawdź definicję';
  else
    execute replace(d, stare, nowe);
  end if;
end $$;
