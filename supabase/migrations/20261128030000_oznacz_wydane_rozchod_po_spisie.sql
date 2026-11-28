-- 28.11.2026 — decyzja D30 (właściciel: TAK): „Oznacz jako wydane” w Wysyłkach (oznacz_wydane_wysylki) robi
-- rozchód z magazynu dla zleceń zamówionych po spisie, tak jak reszta programu.
-- Było: zawsze tylko zamknięcie rezerwacji (cancel_order_reservations__impl) — bez WZ. Od ok. 7.12 lista „stare”
-- (zlecenia sprzed 30 dni bez wydania) obejmie zlecenia zamówione po spisie 6.11: ich materiał jest w stanach
-- po spisie, więc samo zamknięcie rezerwacji zostawiałoby go na półce w systemie (zawyżony stan).
-- Teraz, spójnie z excel-sync (sync_releases_from_excel__impl):
--   * próg dnia jak w excel-sync: current_date >= integration_settings.excel_sync_rozchod_od (2026-11-07) —
--     przed tym dniem zawsze samo zamknięcie rezerwacji (jak excel-sync w trybie „anulowanie”);
--   * dodatkowo próg zlecenia: order_date >= dzień spisu (excel_sync_rozchod_od − 1 dzień = 6.11). Zlecenie
--     zamówione przed spisem — tylko zamknięcie rezerwacji jak dotąd (nie wiadomo, czy materiał zszedł przed
--     spisem; stany po spisie mogą go już nie mieć — to ten sam problem co D42, którego tu nie powielamy).
--     Brak daty zamówienia = jak sprzed spisu (bezpieczniej).
--   * rozchód = release_remaining_for_order(p_order_id, true) — wydanie końcowe jak w aplikacji i w excel-sync
--     (WZ + zdjęcie ze stanu, wymuszone, bo towar już pojechał).
-- Uwaga: D42 (próg liczony od daty wydania z Excela) NIE jest zdecydowany — excel-sync bez zmian.
-- Wynik funkcji: 'rozchod:N' (N = pozycji rozchodowanych) albo 'zamkniete_rezerwacje:N' (jak dotąd). Aplikacja
-- 1.1.7 wyniku nie czyta; od 1.1.8 pokazuje, ile zleceń rozchodowano.
-- Zależności: brak (funkcje release_remaining_for_order / cancel_order_reservations__impl już są na produkcji).
-- DO WDROŻENIA (nie wgrane).

create or replace function public.oznacz_wydane_wysylki(p_order_id bigint, p_date date)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_o record;
  v_n int;
  v_rozchod_od date := coalesce(
    (select value::date from integration_settings where key = 'excel_sync_rozchod_od'), '2999-01-01'::date);
  v_consume boolean;
begin
  -- 27.11: sprzątanie starych zleceń z listy „Do wysyłki” (pojechały, nikt nie wpisał wydania).
  -- D30 (28.11): zlecenia zamówione od dnia spisu (6.11) — rozchód jak zwykłe wydanie; starsze — tylko zamknięcie
  -- rezerwacji (nie wiadomo, czy materiał zszedł przed spisem 6.11, stany po spisie mogą go już nie mieć).
  perform public.assert_warehouse_perm('movements');
  if p_date is null then raise exception 'Podaj datę wydania'; end if;
  if p_date > (now() at time zone 'Europe/Warsaw')::date then raise exception 'Data wydania nie może być z przyszłości'; end if;
  select id, category, release_date, order_date into v_o from orders where id = p_order_id for update;
  if not found then raise exception 'Zlecenie % nie istnieje', p_order_id; end if;
  if v_o.release_date is not null and v_o.release_date <= (now() at time zone 'Europe/Warsaw')::date then
    raise exception 'Zlecenie jest już wydane';
  end if;

  v_consume := current_date >= v_rozchod_od
           and v_o.order_date is not null
           and v_o.order_date::date >= (v_rozchod_od - 1);

  if v_consume then
    select count(*) into v_n
    from public.release_remaining_for_order(p_order_id, true) x
    where x.r_status = 'released';
    update orders set release_date = p_date where id = p_order_id;
    return 'rozchod:' || v_n;
  end if;

  v_n := public.cancel_order_reservations__impl(p_order_id, 'manual');
  update orders set release_date = p_date where id = p_order_id;
  return 'zamkniete_rezerwacje:' || v_n;
end;
$function$;
