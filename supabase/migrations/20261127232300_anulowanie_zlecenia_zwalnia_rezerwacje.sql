-- 27.11.2026 (testy 27.11, runda 3; ŚREDNI): anulowanie zlecenia przerwane w połowie zostawiało rezerwacje.
-- Aplikacja anuluje kilkoma osobnymi żądaniami (znacznik cancelled → stock_status → powiązane → na końcu
-- cancel_order_reservations); zerwane połączenie po pierwszym kroku = zlecenie anulowane, a komponenty dalej
-- zarezerwowane (zlecenie testowe id 29277). Teraz baza sama zwalnia rezerwacje z powodem 'order_cancelled' w chwili,
-- gdy extra_fields.cancelled zmienia się na true (także przy anulowaniu z importu). Późniejsze
-- cancel_order_reservations z aplikacji nie ma już czego zwolnić (zwraca 0) — nieszkodliwe. „Przywróć”
-- (restore_order_reservations) przywraca wiersze 'order_cancelled' jak dotąd.
-- DO WDROŻENIA (nie wgrane w sesji).
create or replace function public.orders_cancel_reservations_on_cancel()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  -- testy 27.11 (runda 3): zwolnienie rezerwacji razem ze znacznikiem anulowania
  perform public.cancel_order_reservations__impl(new.id, 'order_cancelled');
  return null;
end;
$function$;

revoke all on function public.orders_cancel_reservations_on_cancel() from public, anon, authenticated;

drop trigger if exists trg_orders_cancel_reservations on public.orders;
create trigger trg_orders_cancel_reservations
  after update of extra_fields on public.orders
  for each row
  when ((old.extra_fields->>'cancelled') is distinct from 'true' and (new.extra_fields->>'cancelled') = 'true')
  execute function public.orders_cancel_reservations_on_cancel();
