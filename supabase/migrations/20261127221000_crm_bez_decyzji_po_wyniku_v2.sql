-- 27.11.2026 (sesja testów, recenzent 2. seria): poprawka triggera crm.leady_bez_decyzji_po_wyniku z migracji
-- crm_bez_decyzji_po_wyniku. Klient „Zamówił” dostaje ofertę z montażem pod umowę: wysłana z aplikacji → trigger
-- po_wyslaniu_oferty ustawia „Zapytaj o decyzję” (auth.uid() jest), wysłana z Outlooka → crm-mail-sent zmienia ofertę
-- jako serwis (auth.uid() pusty) i blokada cofała zadanie. Teraz blokujemy tylko zmianę bezpośrednią (analiza maila /
-- rozmowy), a przepuszczamy zmianę z innego triggera (pg_trigger_depth() > 1 = np. po_wyslaniu_oferty).
-- WGRANE na produkcję 27.11 (regresja z dzisiejszej poprawki).
create or replace function crm.leady_bez_decyzji_po_wyniku()
 returns trigger
 language plpgsql
 set search_path to 'crm', 'public'
as $function$
begin
  if auth.uid() is null
     and pg_trigger_depth() <= 1
     and new.status in ('wygrany', 'przegrany')
     and new.nastepna_akcja = 'follow_up'
     and old.nastepna_akcja is distinct from 'follow_up' then
    new.nastepna_akcja := old.nastepna_akcja;
    new.nastepny_krok := old.nastepny_krok;
    new.akcja_opis := old.akcja_opis;
    new.akcja_od := old.akcja_od;
  end if;
  return new;
end;
$function$;
