-- 27.11.2026 wieczorem (testy agentów): automat (analiza maila / rozmowy, funkcje Edge = service role, auth.uid() pusty)
-- nie ustawia „Zapytaj o decyzję” (follow_up) klientowi, który już ma wynik (wygrany / przegrany) — przykład: potwierdzenie
-- przelewu po zamówieniu dało klientowi „Zamówił” zadanie „Zapytaj o decyzję”. Zadanie zostaje takie, jakie było.
-- Ręcznie (handlowiec w aplikacji) dalej można — np. „zapytaj przegranego za pół roku”.
-- Uruchamiane konektorem (apply_migration crm_bez_decyzji_po_wyniku).
create or replace function crm.leady_bez_decyzji_po_wyniku()
 returns trigger
 language plpgsql
 set search_path to 'crm', 'public'
as $function$
begin
  if auth.uid() is null
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

drop trigger if exists leady_bez_decyzji_po_wyniku on crm.leady;
create trigger leady_bez_decyzji_po_wyniku before update of nastepna_akcja on crm.leady
  for each row execute function crm.leady_bez_decyzji_po_wyniku();
