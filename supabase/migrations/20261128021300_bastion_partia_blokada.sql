-- 28.11.2026 (runda 10 (28.11); NISKI): bastion_batch_recalc liczyła skręcone ościeżnice partii bez blokady —
-- dwa równoczesne skręcenia dwóch ostatnich ościeżnic (osobne transakcje) mogły nie zobaczyć nawzajem swoich
-- zmian i żadne nie zamykało partii. Teraz na początku blokujemy wiersz partii (bastion_batches, for update):
-- przeliczenia tej samej partii idą po kolei, drugie widzi skręcenie pierwszego i zamyka partię.
-- Wołają: trigger bastion_batch_on_order_stage, bastion_batch_add_orders / remove_order / create_batch.
-- Kontrola „już poprawione” po znaczniku „runda 10 (28.11), blokada partii”.
-- DO WDROŻENIA (nie wgrane w sesji).
do $$
declare
  d text;
  stare text := 'begin
  update bastion_batch_items bi
';
  nowe text := 'begin
  -- przeliczenia tej samej partii po kolei (runda 10 (28.11), blokada partii)
  perform 1 from bastion_batches where id = p_batch_id for update;

  update bastion_batch_items bi
';
begin
  d := replace(pg_get_functiondef('public.bastion_batch_recalc(bigint)'::regprocedure), E'\r', '');
  if position('runda 10 (28.11), blokada partii' in d) > 0 then
    raise notice 'bastion_batch_recalc: już poprawione — bez zmian';
  elsif position(stare in d) = 0 then
    raise exception 'bastion_batch_recalc: nie znaleziono miejsca łatki — sprawdź definicję';
  else
    execute replace(d, stare, nowe);
  end if;
end $$;
