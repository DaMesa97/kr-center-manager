-- 27.11.2026 wieczorem (testy agentów): odhaczenie pamięta „podpis” linii z chwili odhaczenia (ilość | kod Optimy
-- albo komponent). Po zmianie zlecenia w Optimie (ilość 1→2, rozmiar 80→90) podpis się nie zgadza i linia wraca
-- jako nieodhaczona. Stare odhaczenia (line_sig null) liczą się jak dotąd. Ponowne odhaczenie aktualizuje podpis
-- (upsert z update), stąd polityka UPDATE. Uruchamiane konektorem (apply_migration odhaczenia_podpis_linii).
alter table public.order_item_picks add column if not exists line_sig text;
drop policy if exists order_item_picks_update on public.order_item_picks;
create policy order_item_picks_update on public.order_item_picks for update
  using ((select current_user_can_pick())) with check ((select current_user_can_pick()));
