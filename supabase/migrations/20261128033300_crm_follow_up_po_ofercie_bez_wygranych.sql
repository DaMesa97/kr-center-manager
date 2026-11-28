-- 28.11.2026 (decyzja właściciela D21 — TAK, opcja a): „Zapytaj o decyzję” po wysłaniu oferty pomija klienta „Zamówił”.
-- Problem: trigger crm.po_wyslaniu_oferty (oferta → 'wyslana': z aplikacji „Wysłałem”, z Outlooka przez crm-mail-sent)
-- ustawiał zadanie follow_up także klientowi 'wygrany' (np. oferta z montażem pod umowę po zamówieniu) — migracja
-- 20261127221000 opisywała to jako zamierzone. Aplikacja („Wysłałem”, useCrm.markOfertaWyslana) i crm-mail-sent
-- (oferta z poczty bez dopasowania) już pomijają wygranych, więc trigger był jedynym miejscem, które to robiło —
-- aplikacja mówiła „zadanie bez zmian”, a zadanie i tak się pojawiało.
-- Teraz: dla klienta 'wygrany' trigger nie zmienia zadania (status 'nowy' → 'oferta' i tak go nie dotyczy); oferty
-- 'do_sprawdzenia' → 'robocza' działają jak dotąd. Klient przegrany: najpierw przywroc_do_gry (status nowy/oferta),
-- więc follow-up dostaje jak dotąd.
-- Zawiera flagę crm.przywracanie_ofert z D18 (plik 20261128033100) — ten plik idzie PO 033100 (gdyby szedł sam:
-- flaga bez przywracania niczego nie zmienia). Reszta funkcji = definicja z produkcji 28.11.
-- Nie zmienia istniejących zadań: 28.11 jest 1 klient „Zamówił” z follow_up — do ręcznego przejrzenia (kontrola po
-- wdrożeniu). DO WDROŻENIA (nie wgrane).

create or replace function crm.po_wyslaniu_oferty()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  dzis date := (now() at time zone 'Europe/Warsaw')::date;
  kwota numeric := coalesce(new.brutto, new.cena_razem + coalesce(new.dostawa_koszt, 0));
begin
  -- D18 (28.11): przywrócenie ofert po „Przywróć do gry” to nie nowe wysłanie — bez zadania i bez ruszania innych ofert
  if coalesce(current_setting('crm.przywracanie_ofert', true), '') = '1' then
    return new;
  end if;
  if new.status = 'wyslana' and old.status is distinct from 'wyslana' and new.lead_id is not null then
    if exists (select 1 from crm.leady where id = new.lead_id and status = 'przegrany') then
      perform crm.przywroc_do_gry(new.lead_id, 'wysłano ofertę', false, auth.uid());
    end if;
    update crm.leady set
      status = case when status = 'nowy' then 'oferta' else status end,
      nastepna_akcja = 'follow_up',
      nastepny_krok = dzis + 3,
      akcja_od = now(),
      akcja_opis = 'Zapytaj klienta o decyzję w sprawie oferty ' || coalesce('nr ' || new.numer || ' ', '') || 'z ' || to_char(dzis, 'DD.MM')
                   || coalesce(' (' || to_char(round(kwota), 'FM999999990') || ' zł brutto)', '') || '.'
    where id = new.lead_id
      -- D21 (28.11): klient „Zamówił” nie dostaje „Zapytaj o decyzję”
      and status is distinct from 'wygrany'
      and (nastepna_akcja is null or nastepna_akcja in ('przygotuj_oferte', 'follow_up', 'dopytaj'));
    update crm.oferty set status = 'robocza'
    where lead_id = new.lead_id and id <> new.id and status = 'do_sprawdzenia';
  end if;
  return new;
end;
$function$;
