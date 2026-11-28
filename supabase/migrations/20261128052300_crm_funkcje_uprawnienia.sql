-- 28.11.2026 — decyzja D37 (właściciel: TAK, opcja a): funkcje schematu crm wykonywalne przez każdego zalogowanego.
-- Przegląd 28.11 wszystkich funkcji crm (produkcja, has_function_privilege('authenticated', …, 'execute')):
--  * SECURITY DEFINER, nie-triggerowe, z EXECUTE dla zalogowanych — 18; 16 z nich ma już sprawdzenie
--    current_user_has_crm() / current_user_is_superadmin() (oznacz_wynik, zamknij_zadanie, polacz_leady, zlec_oferte_*,
--    przelacz_etykiete, odswiez_zamowienia_bl, klient_zamowienia_sklep, ustaw/usun_skrzynke, ustaw_token_bl,
--    oznacz_oferte_poza_systemem, odstap_od_umowy, dodaj_etykiety) — bez zmian.
--    BEZ sprawdzenia były dwie:
--      - crm.zamowienie_sklepowe_wygrany(mail) — pracownik bez CRM mógł z F12 oznaczyć dowolnego klienta jako „Zamówił”
--        (i zaakceptować ofertę). Woła ją tylko trigger crm.maile_zamowienie_wygrany_tg; aplikacja i Edge nie wołają
--        (sprawdzone w src/ i supabase/functions 28.11) → odebrane EXECUTE public/anon/authenticated, zostaje service_role.
--        Trigger był SECURITY INVOKER (wywołanie szło z uprawnieniami tego, kto aktualizuje mail — Edge crm-call-ingest
--        kluczem serwisowym) → teraz SECURITY DEFINER, więc działa niezależnie od uprawnień piszącego; błąd automatu
--        „Zamówił” nie blokuje zapisu wyniku analizy maila (warning, jak trigger zamówień z Baselinkera).
--      - crm.oferty_automatyczne() — odczyt przełącznika z crm.ustawienia z pominięciem RLS (tylko boolean). Wołają ją
--        wyłącznie triggery SECURITY DEFINER (oferty_wstrzymaj_automat, zlec_oferte_po_zadaniu — jako właściciel);
--        aplikacja czyta crm.ustawienia wprost (RLS) → odebrane EXECUTE zalogowanym, zostaje service_role.
--  * funkcje triggerowe (także SECURITY DEFINER) — nie da się ich wywołać przez API („trigger functions can only be
--    called as triggers”); bez zmian.
--  * SECURITY INVOKER (znajdz_leada, duplikaty_leada, lead_po_adresach, uzupelnij_swieta, …) — działają z RLS
--    wołającego (crm.* : current_user_has_crm / superadmin), pracownik bez CRM nic nie zobaczy ani nie zapisze; czyste
--    funkcje pomocnicze (telefon_e164, kwota_z_tekstu, termin_roboczy, swieta_pl, normalizuj_nazwe, bl_id_zlecenia,
--    etykiety_z_analizy) nie czytają danych — bez zmian.
--  * anon nie ma USAGE na schemacie crm — PUBLIC na funkcjach nie daje mu dostępu (bez zmian).
--  * public.metody_dostawy_bl (czyta crm.zamowienia_sklep) — celowo dla Wysyłki (pracownicy bez CRM), zwraca tylko
--    metodę dostawy — bez zmian.
-- Nic nie przestaje działać dla osób z CRM: aplikacja nie woła żadnej z dwóch funkcji, Edge (service_role) ma EXECUTE.
-- Można uruchamiać wielokrotnie. Niezależny od 20261128052100 (ta sama treść triggera; kolejność dowolna).
-- DO WDROŻENIA (nie wgrane).

revoke all on function crm.zamowienie_sklepowe_wygrany(uuid) from public, anon, authenticated;
grant execute on function crm.zamowienie_sklepowe_wygrany(uuid) to service_role;

create or replace function crm.maile_zamowienie_wygrany_tg()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if new.status_przetwarzania = 'przetworzony' and new.typ = 'zamowienie'
     and (old.status_przetwarzania is distinct from 'przetworzony') then
    -- D37 (28.11): SECURITY DEFINER — zamowienie_sklepowe_wygrany nie jest już wykonywalna przez zalogowanych
    begin
      perform crm.zamowienie_sklepowe_wygrany(new.id);
    exception when others then
      raise warning 'crm.zamowienie_sklepowe_wygrany(%): %', new.id, sqlerrm;
    end;
  end if;
  return new;
end;
$function$;

revoke all on function crm.maile_zamowienie_wygrany_tg() from public, anon, authenticated;

revoke all on function crm.oferty_automatyczne() from public, anon, authenticated;
grant execute on function crm.oferty_automatyczne() to service_role;
