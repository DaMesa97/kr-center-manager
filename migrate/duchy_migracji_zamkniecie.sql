-- 2026-10-22: zamknięcie „duchów” z pierwszej migracji Excel → program.
--
-- 21 zleceń Disting z source='migracja' (zlecenia 2024-01 … 2026-06) nigdy nie
-- dostało daty wydania — wisiały jako otwarte, jako najstarsze lądowały NA
-- GÓRZE „Moje stanowisko” i (po przeliczeniu rezerwacji) blokowały magazyn
-- rezerwacjami po 14–18 pozycji. Większość ma etapy oznaczone X/T (zrobione).
--
-- Zamknięcie BEZ wydania z magazynu (towar nie szedł przez program):
--  * rezerwacje anulowane (cancel_order_reservations__impl — zdejmuje reserved_quantity),
--  * release_date = order_date (nie dzisiaj — statystyki wydań z dziś byłyby fałszywe),
--  * extra_fields.ghost_closed = notatka, żeby było wiadomo, skąd ta data.
-- Przed startem bazę i tak czyścimy i migrujemy od nowa — wtedy zakończone
-- zlecenia z Excela muszą przyjść od razu z datą wydania.

do $$
declare r record; n int := 0;
begin
  for r in
    select id from orders
    where source = 'migracja'
      and release_date is null
      and coalesce((extra_fields->>'cancelled')::boolean, false) = false
  loop
    perform public.cancel_order_reservations__impl(r.id);
    update orders
    set release_date = order_date,
        extra_fields = coalesce(extra_fields, '{}'::jsonb)
          || jsonb_build_object('ghost_closed', '2026-10-22: duch z migracji Excel — zamknięty bez wydania z magazynu')
    where id = r.id;
    n := n + 1;
  end loop;
  raise notice 'zamknięto % zleceń z migracji', n;
end $$;
