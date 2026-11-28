-- 28.11.2026 (decyzja właściciela D18 — TAK, opcja a): klient wracający po przegranej odzyskuje swoje oferty.
-- Problem: przy „przegrany” (ręcznie crm.oznacz_wynik bez wskazanej oferty albo nocne porządki z pliku 225000) oferty
-- 'wyslana' dostają 'odrzucona'. Po „Przywróć do gry” zostawały odrzucone, więc późniejsze „Zamówił” nie miało oferty
-- do zaakceptowania, a formularz umowy — oferty do podpowiedzi.
-- Teraz crm.przywroc_do_gry (wspólna dla „Przywróć do gry”, „Cofnij »Zamówił«”, powrotu po telefonie / mailu klienta
-- i po wysłaniu nowej oferty) przywraca 'odrzucona' → 'wyslana' dla ofert odrzuconych W TEJ SAMEJ CHWILI co przegrana
-- (oferty.updated_at = leady.wynik_at — obie wartości to now() jednej transakcji). Nie wracają: oferta wskazana jako
-- odrzucona przez klienta (dane.oferta_id zdarzenia „przegrany” — „Klient odrzucił” konkretną ofertę), oferty odrzucone
-- wcześniej / później ani zmienione po przegranej (inne updated_at). Liczba trafia do zdarzenia „przywrocony”
-- (dane.ofert_przywroconych, dopisek w opisie).
-- Przywrócenie oferty to zmiana statusu na 'wyslana', więc odpaliłby się trigger crm.po_wyslaniu_oferty (zadanie
-- „Zapytaj o decyzję” z dzisiejszą datą, inne oferty 'do_sprawdzenia' → 'robocza'). Żeby tego uniknąć, przywracanie
-- ustawia flagę transakcji crm.przywracanie_ofert, a po_wyslaniu_oferty ją sprawdza (reszta funkcji bez zmian —
-- definicja z produkcji 28.11; plik D21 20261128033300 definiuje ją ponownie, z tą samą flagą).
-- DO WDROŻENIA (nie wgrane).

create or replace function crm.przywroc_do_gry(p_lead_id uuid, p_zrodlo text, p_zadanie boolean default false, p_kto uuid default null::uuid)
 returns text
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  l crm.leady;
  nowy_status text;
  dzis date := (now() at time zone 'Europe/Warsaw')::date;
  wskazana uuid;
  n_ofert int := 0;
begin
  select * into l from crm.leady where id = p_lead_id for update;
  if not found or l.status is distinct from 'przegrany' then
    return l.status;
  end if;
  -- D18 (28.11): oferty odrzucone razem z przegraną wracają do „wysłana” (bez oferty odrzuconej wprost przez klienta)
  if l.wynik_at is not null then
    select nullif(z.dane->>'oferta_id', '')::uuid into wskazana
    from crm.zdarzenia z where z.lead_id = p_lead_id and z.typ = 'przegrany'
    order by z.created_at desc, z.id desc limit 1;
    perform set_config('crm.przywracanie_ofert', '1', true);
    update crm.oferty set status = 'wyslana'
    where lead_id = p_lead_id and status = 'odrzucona' and updated_at = l.wynik_at and id is distinct from wskazana;
    get diagnostics n_ofert = row_count;
    perform set_config('crm.przywracanie_ofert', '', true);
  end if;
  nowy_status := case when exists (select 1 from crm.oferty o where o.lead_id = p_lead_id) then 'oferta' else 'nowy' end;
  update crm.leady set status = nowy_status, wynik_powod = null, wynik_notatka = null, wynik_at = null, wynik_kto = null
  where id = p_lead_id;
  if p_zadanie then
    update crm.leady set nastepna_akcja = 'follow_up', nastepny_krok = crm.termin_roboczy(dzis), akcja_od = now(),
      akcja_opis = 'Klient przywrócony do gry: odezwij się i zapytaj, czy temat drzwi jest nadal aktualny.'
    where id = p_lead_id;
  end if;
  insert into crm.zdarzenia (lead_id, typ, opis, kto, dane)
  values (p_lead_id, 'przywrocony',
    'Klient przywrócony do gry (' || p_zrodlo || ')' || coalesce('; wcześniej przegrany: ' || l.wynik_powod, '')
      || case when n_ofert > 0 then '; oferty znów „wysłane”: ' || n_ofert else '' end || '.',
    p_kto, jsonb_build_object('zrodlo', p_zrodlo, 'poprzedni_powod', l.wynik_powod, 'poprzednia_notatka', l.wynik_notatka,
      'poprzednio_at', l.wynik_at, 'status', nowy_status, 'zadanie', p_zadanie, 'ofert_przywroconych', n_ofert));
  return nowy_status;
end;
$function$;

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
      and (nastepna_akcja is null or nastepna_akcja in ('przygotuj_oferte', 'follow_up', 'dopytaj'));
    update crm.oferty set status = 'robocza'
    where lead_id = new.lead_id and id <> new.id and status = 'do_sprawdzenia';
  end if;
  return new;
end;
$function$;
