-- =====================================================================
-- CRM: nowe typy zadań „pomiar” i „montaż” (zgłoszenie #143, Tymek 16.11.2026)
-- Dotąd: oddzwon / dopytaj / przygotuj_oferte / follow_up / reklamacja.
-- Lista w dwóch miejscach: CHECK na crm.leady.nastepna_akcja i walidacja
-- w crm.zamknij_zadanie (plus domyślny opis zadania). Front: types/crm.ts CRM_AKCJA.
-- =====================================================================
begin;

alter table crm.leady drop constraint if exists leady_nastepna_akcja_check;
alter table crm.leady add constraint leady_nastepna_akcja_check
  check (nastepna_akcja = any (array['oddzwon','dopytaj','przygotuj_oferte','follow_up','reklamacja','pomiar','montaz']));

create or replace function crm.zamknij_zadanie(p_lead_id uuid, p_nastepna_akcja text default null, p_za_dni integer default 3, p_opis text default null, p_wyslano_oferte boolean default false)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  uid uuid := auth.uid();
  l crm.leady;
  dzis date := (now() at time zone 'Europe/Warsaw')::date;
  opisy jsonb := '{"oddzwon":"Oddzwoń do klienta.","dopytaj":"Dopytaj o brakujące dane.","przygotuj_oferte":"Sprawdź i wyślij ofertę.","follow_up":"Zapytaj klienta o decyzję.","reklamacja":"Reklamacja, skontaktuj się z klientem.","pomiar":"Pomiar u klienta.","montaz":"Montaż u klienta."}'::jsonb;
begin
  if uid is not null and not public.current_user_has_crm() then
    raise exception 'Brak dostępu do CRM';
  end if;
  select * into l from crm.leady where id = p_lead_id;
  if not found then
    raise exception 'Nie ma takiego klienta';
  end if;
  if p_nastepna_akcja is not null and p_nastepna_akcja not in ('oddzwon', 'dopytaj', 'przygotuj_oferte', 'follow_up', 'reklamacja', 'pomiar', 'montaz') then
    raise exception 'nastepna_akcja: oddzwon, dopytaj, przygotuj_oferte, follow_up, reklamacja, pomiar albo montaz';
  end if;
  if l.nastepna_akcja is not null then
    insert into crm.zdarzenia (lead_id, typ, opis, kto, dane)
    values (p_lead_id, 'zadanie_zrobione', left(coalesce(l.akcja_opis, l.nastepna_akcja), 500), uid,
      jsonb_build_object('akcja', l.nastepna_akcja, 'zrodlo', 'klik', 'uwaga', p_opis));
  end if;
  if p_wyslano_oferte then
    insert into crm.zdarzenia (lead_id, typ, opis, kto, dane)
    values (p_lead_id, 'mail_wyslany', 'Handlowiec oznaczył: oferta wysłana poza systemem.' || coalesce(' ' || p_opis, ''), uid, jsonb_build_object('zrodlo', 'klik'));
  end if;
  update crm.leady set
    status = case when p_wyslano_oferte and status = 'nowy' then 'oferta' else status end,
    nastepna_akcja = p_nastepna_akcja,
    nastepny_krok = case when p_nastepna_akcja is null then null else dzis + greatest(coalesce(p_za_dni, 0), 0) end,
    akcja_od = case when p_nastepna_akcja is null then null else now() end,
    akcja_opis = case when p_nastepna_akcja is null then null
                      else left(coalesce(opisy->>p_nastepna_akcja, '') || coalesce(' ' || p_opis, ''), 500) end,
    ostatnia_rozmowa_at = coalesce(ostatnia_rozmowa_at, now())
  where id = p_lead_id;
  -- zadanie przygotuj_oferte ustawione przez człowieka uruchamia automat (trigger leady_zlec_oferte), gdy jest notatka i nie ma otwartej oferty
end;
$function$;

commit;
