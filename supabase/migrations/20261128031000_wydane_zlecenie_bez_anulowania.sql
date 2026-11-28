-- 28.11.2026 — decyzja D43 (właściciel: TAK): wydanego zlecenia nie da się anulować.
-- Aplikacja (od tej wersji) chowa „Anuluj zlecenie” dla wydanych i w kaskadzie pary (Disting Plus) / zestawu Titan
-- pomija wydane nogi. Tu obrona w bazie: trigger BEFORE UPDATE OF extra_fields na orders odrzuca (P0410) przejście
-- extra_fields.cancelled → true, gdy zlecenie ma datę wydania.
--  * Anulowania nie robi żadna funkcja bazy — aplikacja woła merge_order_extra_fields (SECURITY INVOKER, zwykły
--    update orders), więc trigger łapie każdą drogę z konta pracownika.
--  * Tylko dla zalogowanego użytkownika (auth.uid() is not null). Konto serwisowe (excel-sync — ANULOWANE w arkuszu,
--    synchronizacja RO z Optimy) i postgres (porządki, migracje) przechodzą bez zmian — tam źródłem prawdy jest
--    system zewnętrzny.
--  * Przywracanie (cancelled → false), zmiana innych pól extra_fields i zlecenia już anulowane — bez zmian.
--  * Dziś 0 zleceń jednocześnie wydanych i anulowanych (DECISIONS D43) — trigger niczego nie psuje wstecz.
-- DO WDROŻENIA (nie wgrane). Samodzielny, kolejność dowolna.

create or replace function public.orders_block_cancel_released()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  -- D43: wydanego zlecenia nie anulujemy (kaskada pary / Titana w aplikacji pomija wydane nogi)
  if auth.uid() is not null then
    raise exception 'Zlecenie % jest wydane (%) — nie można go anulować.',
      coalesce(new.category, '') || ' ' || coalesce(new.order_number, new.id::text), new.release_date
      using errcode = 'P0410';
  end if;
  return new;
end;
$function$;

revoke all on function public.orders_block_cancel_released() from public, anon, authenticated;

drop trigger if exists trg_orders_block_cancel_released on public.orders;
create trigger trg_orders_block_cancel_released
  before update of extra_fields on public.orders
  for each row
  when (
    new.release_date is not null
    and (new.extra_fields->>'cancelled') = 'true'
    and (old.extra_fields->>'cancelled') is distinct from 'true'
  )
  execute function public.orders_block_cancel_released();
