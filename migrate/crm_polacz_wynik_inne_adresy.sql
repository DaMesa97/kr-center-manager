-- CRM, zwiad danych 21.11 w nocy:
-- 1) crm.polacz_leady przenosił status „wygrany/przegrany” z łączonego kontaktu, ale bez wynik_at / wynik_kto /
--    wynik_powod / wynik_notatka → klient wygrany bez daty wygranej wypadał ze statystyk (Rafał Dusza, 20.11).
--    Teraz wynik idzie razem ze statusem (z tego kontaktu, którego status wygrał).
-- 2) crm.lead_po_adresach patrzy też na dodatkowe adresy klienta (inne_kontakty — zostają po połączeniu
--    kontaktów), żeby maile na drugi adres też się przypinały.
-- 3) jednorazowo: brakujący wynik_at z historii (najwcześniejsze zdarzenie o tym wyniku) + przypięcie sierot.

create or replace function crm.lead_po_adresach(p_adresy text[])
returns uuid
language sql
stable
set search_path = crm, public
as $$
  with a as (select distinct lower(trim(x)) adres from unnest(coalesce(p_adresy, '{}')) x where coalesce(trim(x), '') <> '')
  select case when count(distinct l.id) = 1 then min(l.id::text)::uuid end
  from crm.leady l
  where lower(trim(coalesce(l.email, ''))) in (select adres from a)
     or exists (
       select 1 from jsonb_array_elements(case when jsonb_typeof(l.inne_kontakty) = 'array' then l.inne_kontakty else '[]'::jsonb end) k
       where lower(trim(coalesce(k->>'email', ''))) in (select adres from a)
     )
$$;

CREATE OR REPLACE FUNCTION crm.polacz_leady(p_cel uuid, p_zrodlo uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c crm.leady%rowtype;
  z crm.leady%rowtype;
  ranga_c int; ranga_z int;
  nowy_status text;
  wynik_ze_zrodla boolean;
  przej jsonb;
  oba boolean;
begin
  if auth.uid() is not null and not public.current_user_has_crm() then raise exception 'Brak dostępu do CRM'; end if;
  if p_cel = p_zrodlo then raise exception 'To ten sam klient'; end if;
  select * into c from crm.leady where id = p_cel for update;
  select * into z from crm.leady where id = p_zrodlo for update;
  if c.id is null then raise exception 'Nie ma klienta docelowego'; end if;
  if z.id is null then raise exception 'Nie ma klienta do połączenia (może już połączony)'; end if;

  update crm.oferty set lead_id = p_cel where lead_id = p_zrodlo;
  update crm.rozmowy set lead_id = p_cel where lead_id = p_zrodlo;
  update crm.maile set lead_id = p_cel where lead_id = p_zrodlo;
  update crm.dokumenty set lead_id = p_cel where lead_id = p_zrodlo;
  update crm.zdarzenia set lead_id = p_cel where lead_id = p_zrodlo;

  przej := jsonb_strip_nulls(jsonb_build_object('nazwa', z.nazwa, 'email', z.email, 'telefon', z.telefon, 'miejscowosc', z.miejscowosc, 'zrodlo', z.zrodlo, 'polaczono', now()));
  update crm.leady set telefon = null where id = p_zrodlo;

  ranga_c := case c.status when 'wygrany' then 4 when 'oferta' then 3 when 'nowy' then 2 else 1 end;
  ranga_z := case z.status when 'wygrany' then 4 when 'oferta' then 3 when 'nowy' then 2 else 1 end;
  nowy_status := case when ranga_z > ranga_c then z.status else c.status end;
  -- wynik (data, kto, powód, notatka) idzie razem ze statusem — z kontaktu, którego status zostaje
  wynik_ze_zrodla := ranga_z > ranga_c or (c.wynik_at is null and z.wynik_at is not null and z.status = c.status);
  oba := c.nastepna_akcja is not null and z.nastepna_akcja is not null;

  update crm.leady set
    telefon = coalesce(c.telefon, z.telefon),
    email = coalesce(c.email, z.email),
    nazwa = case when c.nazwa is null or length(c.nazwa) < length(coalesce(z.nazwa, '')) and crm.normalizuj_nazwe(c.nazwa) = crm.normalizuj_nazwe(z.nazwa) then z.nazwa else coalesce(c.nazwa, z.nazwa) end,
    miejscowosc = coalesce(c.miejscowosc, z.miejscowosc),
    kategoria = coalesce(c.kategoria, z.kategoria),
    kampania = coalesce(c.kampania, z.kampania),
    podsumowanie = case when c.podsumowanie is null then z.podsumowanie when z.podsumowanie is null or c.podsumowanie = z.podsumowanie then c.podsumowanie else left(c.podsumowanie || E'\n\n[z połączonego kontaktu] ' || z.podsumowanie, 4000) end,
    brakuje = coalesce(c.brakuje, z.brakuje),
    wartosc_szac = coalesce(c.wartosc_szac, z.wartosc_szac),
    link_oferty = coalesce(c.link_oferty, z.link_oferty),
    baselinker_order_id = coalesce(c.baselinker_order_id, z.baselinker_order_id),
    asana_task_gid = coalesce(c.asana_task_gid, z.asana_task_gid),
    status = nowy_status,
    wynik_at = case when wynik_ze_zrodla then z.wynik_at else c.wynik_at end,
    wynik_kto = case when wynik_ze_zrodla then z.wynik_kto else c.wynik_kto end,
    wynik_powod = case when wynik_ze_zrodla then z.wynik_powod else c.wynik_powod end,
    wynik_notatka = case when wynik_ze_zrodla then z.wynik_notatka else c.wynik_notatka end,
    etykiety = (select coalesce(array_agg(distinct e), '{}') from unnest(c.etykiety || z.etykiety) e),
    -- zadanie: gdy oba kontakty mają zadanie, zostaje zadanie celu z wcześniejszym terminem, a drugie trafia do opisu (jeden klient = jedno zadanie)
    nastepna_akcja = coalesce(c.nastepna_akcja, z.nastepna_akcja),
    nastepny_krok = case when oba then least(c.nastepny_krok, z.nastepny_krok) when c.nastepna_akcja is not null then c.nastepny_krok else z.nastepny_krok end,
    akcja_opis = case when oba then left(coalesce(c.akcja_opis, '') || E' | Z połączonego kontaktu, zadanie „' || z.nastepna_akcja || '”: ' || coalesce(z.akcja_opis, ''), 500)
                      when c.nastepna_akcja is not null then c.akcja_opis else z.akcja_opis end,
    akcja_od = case when c.nastepna_akcja is not null then c.akcja_od else z.akcja_od end,
    szkic = case when c.nastepna_akcja is not null then c.szkic else z.szkic end,
    ostatnia_rozmowa_at = greatest(c.ostatnia_rozmowa_at, z.ostatnia_rozmowa_at),
    inne_kontakty = c.inne_kontakty || z.inne_kontakty || case when przej = '{}'::jsonb then '[]'::jsonb else jsonb_build_array(przej) end
  where id = p_cel;

  insert into crm.zdarzenia (lead_id, typ, opis, kto, dane)
  values (p_cel, 'polaczono', left('Połączono z kontaktem „' || coalesce(z.nazwa, z.email, z.telefon, '?') || '”' || coalesce(' (' || z.email || ')', '') || coalesce(' tel. ' || z.telefon, '') || '; historia, oferty i maile tego kontaktu są teraz tutaj.' || case when oba then ' Oba kontakty miały zadanie: zostało jedno, drugie jest w jego opisie.' else '' end, 500),
    auth.uid(), jsonb_build_object('zrodlo_id', p_zrodlo, 'zrodlo', przej, 'zadanie_zrodla', case when oba then jsonb_build_object('akcja', z.nastepna_akcja, 'termin', z.nastepny_krok, 'opis', z.akcja_opis) else null end));

  delete from crm.leady where id = p_zrodlo;
  return p_cel;
end $function$;

-- jednorazowo: wygrani/przegrani bez daty wyniku → data i autor z najwcześniejszego zdarzenia o tym wyniku
update crm.leady l
   set wynik_at = e.created_at, wynik_kto = coalesce(l.wynik_kto, e.kto)
  from (
    select distinct on (z.lead_id, z.typ) z.lead_id, z.typ, z.created_at, z.kto
      from crm.zdarzenia z
     where z.typ in ('wygrany', 'przegrany')
     order by z.lead_id, z.typ, z.created_at
  ) e
 where e.lead_id = l.id and e.typ = l.status
   and l.status in ('wygrany', 'przegrany') and l.wynik_at is null;

-- jednorazowo: sieroty po adresach z inne_kontakty (tylko jednoznaczne; przychodzące tylko do nie-przegranych)
update crm.maile m
   set lead_id = crm.lead_po_adresach(coalesce(m.do_adresy, '{}') || coalesce(m.cc_adresy, '{}'))
 where m.lead_id is null and m.kierunek = 'wychodzacy'
   and crm.lead_po_adresach(coalesce(m.do_adresy, '{}') || coalesce(m.cc_adresy, '{}')) is not null;

update crm.maile m
   set lead_id = x.lead_id
  from (select m2.id, crm.lead_po_adresach(array[m2.od_adres]) lead_id from crm.maile m2 where m2.lead_id is null and m2.kierunek = 'przychodzacy') x
  join crm.leady l on l.id = x.lead_id
 where m.id = x.id and x.lead_id is not null and l.status is distinct from 'przegrany';
