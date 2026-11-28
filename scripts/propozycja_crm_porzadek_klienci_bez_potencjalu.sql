-- 28.11.2026 — PROPOZYCJA, NIE WGRYWAĆ bez decyzji właściciela (zgłoszenie: „takie zapytanie nie powinno się w ogóle
-- zapisywać jako Klienci”). Po decyzji TAK: skopiować do supabase/migrations/20261128060100_crm_porzadek_klienci_bez_potencjalu.sql
-- (z nagłówkiem decyzji) i wgrać PO 20261128060000 (lista „Bez klienta” i „Utwórz klienta” muszą już działać).
--
-- Co robi: porządek wstecz po klientach-śmieciach założonych, zanim Edge crm-call-ingest zaczął odsiewać kontakty bez
-- potencjału. Kryterium — to samo co w scripts/crm-klienci-bez-potencjalu.sql (status 'nowy', źródło telefon/mail, bez
-- zadania, ofert, dokumentów, zamówień sklepu, wartości, ręcznych zdarzeń i kontaktu wychodzącego; wszystkie rozmowy/maile
-- przeanalizowane z akcją 'brak', co najmniej jedno 'zapytanie'). Na produkcji 28.11: 13 klientów (wszyscy z telefonu,
-- po 1 rozmowie), z czego 2 w wyjątkach poniżej (granica: zapowiedziana wizyta w salonie, zakup w sklepie w trakcie).
-- Klientów NIE gubimy po cichu:
--   1. kopia pełnych wierszy do crm.porzadek_bez_potencjalu_kopia (RLS bez polityk — czyta tylko serwis / SQL),
--   2. rozmowy i maile tych klientów zostają (lead_id → null; UWAGA: FK rozmowy.lead_id ma ON DELETE CASCADE, dlatego
--      odpinamy PRZED usunięciem), dostają dopisek „Bez potencjału: …” i analiza.potencjal = 'nie' → widać je
--      w aplikacji: Klienci → „Bez klienta” (stamtąd „Utwórz klienta” przywraca klienta jednym kliknięciem),
--   3. zdarzenia rozmów / maili (analiza) odpięte, nie skasowane („Utwórz klienta” przypina je z powrotem);
--      zdarzenie „lead_utworzony” znika razem z klientem,
--   4. zdarzenie 'porzadek' (bez klienta) z listą id usuniętych klientów,
--   5. bezpiecznik: więcej niż 25 kandydatów = przerwij (baza zmieniła się od 28.11 — przejrzeć listę od nowa).
-- Można uruchamiać wielokrotnie (drugi raz nie znajdzie już kandydatów).

create table if not exists crm.porzadek_bez_potencjalu_kopia (like crm.leady including defaults);
alter table crm.porzadek_bez_potencjalu_kopia add column if not exists usunieto_at timestamptz not null default now();
alter table crm.porzadek_bez_potencjalu_kopia enable row level security;
revoke all on table crm.porzadek_bez_potencjalu_kopia from public, anon, authenticated;
comment on table crm.porzadek_bez_potencjalu_kopia is
  '28.11: kopia klientów bez potencjału usuniętych przy porządku (rozmowy/maile odpięte do listy „Bez klienta”).';

do $porzadek$
declare
  -- klienci wyłączeni z porządku (decyzja właściciela; domyślnie dwa przypadki graniczne z przeglądu 28.11)
  wyjatki uuid[] := array[
    '2760a651-072b-42ce-8524-66ea711cbf3b',   -- zapowiedział wizytę w salonie
    '2e51a651-dc0d-42e8-baf8-f27b8df046c5'    -- kupował w sklepie internetowym (problem z koszykiem)
  ]::uuid[];
  bezpiecznik int := 25;
  ids uuid[];
  n_roz int;
  n_mail int;
  n_zd int;
  dopisek constant text := 'Bez potencjału: klient bez zadania i oferty, usunięty przy porządku 28.11.';
begin
  select coalesce(array_agg(l.id), '{}') into ids
  from crm.leady l
  where l.status = 'nowy'
    and l.zrodlo in ('telefon', 'mail')
    and l.nastepna_akcja is null
    and l.wartosc_wstepna is null
    and coalesce(jsonb_array_length(l.inne_kontakty), 0) = 0
    and not (l.id = any (wyjatki))
    and not exists (select 1 from crm.oferty o where o.lead_id = l.id)
    and not exists (select 1 from crm.dokumenty d where d.lead_id = l.id)
    and not exists (select 1 from crm.zamowienia_sklep s where s.lead_id = l.id)
    and not exists (select 1 from crm.zdarzenia z where z.lead_id = l.id and z.kto is not null)
    and not exists (
      select 1 from crm.rozmowy r where r.lead_id = l.id and (
        r.kierunek = 'wychodzaca'
        or r.status_przetwarzania in ('bez_ai', 'nowa', 'blad')
        or (r.status_przetwarzania = 'przetworzona' and (r.nastepna_akcja is distinct from 'brak' or r.typ in ('klient', 'reklamacja')))))
    and not exists (
      select 1 from crm.maile m where m.lead_id = l.id and (
        m.kierunek = 'wychodzacy'
        or m.status_przetwarzania not in ('przetworzony', 'pominiety')
        or (m.status_przetwarzania = 'przetworzony' and (m.nastepna_akcja is distinct from 'brak' or m.typ in ('klient', 'reklamacja', 'odpowiedz')))))
    and (
      exists (select 1 from crm.rozmowy r where r.lead_id = l.id and r.status_przetwarzania = 'przetworzona' and r.typ = 'zapytanie')
      or exists (select 1 from crm.maile m where m.lead_id = l.id and m.kierunek = 'przychodzacy' and m.status_przetwarzania = 'przetworzony' and m.typ = 'zapytanie'));

  if cardinality(ids) = 0 then
    raise notice 'Porządek: brak klientów bez potencjału do usunięcia.';
    return;
  end if;
  if cardinality(ids) > bezpiecznik then
    raise exception 'Porządek przerwany: % kandydatów (bezpiecznik %). Przejrzyj listę z scripts/crm-klienci-bez-potencjalu.sql.', cardinality(ids), bezpiecznik;
  end if;

  insert into crm.porzadek_bez_potencjalu_kopia select l.*, now() from crm.leady l where l.id = any (ids);

  update crm.rozmowy r
     set lead_id = null,
         podsumowanie = case when coalesce(r.podsumowanie, '') like '%Bez potencjału:%' then r.podsumowanie
                             else btrim(coalesce(r.podsumowanie, '') || ' ' || dopisek) end,
         nastepna_akcja = case when r.status_przetwarzania = 'przetworzona' then 'brak' else r.nastepna_akcja end,
         analiza = case when jsonb_typeof(r.analiza) = 'object' and not (r.analiza ? 'potencjal')
                        then r.analiza || jsonb_build_object('potencjal', 'nie', 'powod_braku_potencjalu', 'porządek 28.11: klient bez zadania i oferty')
                        else r.analiza end
   where r.lead_id = any (ids);
  get diagnostics n_roz = row_count;

  update crm.maile m
     set lead_id = null,
         podsumowanie = case when m.kierunek <> 'przychodzacy' or m.status_przetwarzania <> 'przetworzony' or coalesce(m.podsumowanie, '') like '%Bez potencjału:%' then m.podsumowanie
                             else btrim(coalesce(m.podsumowanie, '') || ' ' || dopisek) end,
         analiza = case when m.status_przetwarzania = 'przetworzony' and jsonb_typeof(m.analiza) = 'object' and not (m.analiza ? 'potencjal')
                        then m.analiza || jsonb_build_object('potencjal', 'nie', 'powod_braku_potencjalu', 'porządek 28.11: klient bez zadania i oferty')
                        else m.analiza end
   where m.lead_id = any (ids);
  get diagnostics n_mail = row_count;

  update crm.zdarzenia z set lead_id = null
   where z.lead_id = any (ids) and (z.dane->>'rozmowa_id' is not null or z.dane->>'mail_id' is not null);
  get diagnostics n_zd = row_count;

  delete from crm.leady l where l.id = any (ids);

  insert into crm.zdarzenia (lead_id, typ, opis, dane)
  values (null, 'porzadek',
          format('Porządek 28.11: usunięto %s klientów bez potencjału (bez zadania i oferty); %s rozmów i %s maili przeniesiono do listy „Bez klienta”.', cardinality(ids), n_roz, n_mail),
          jsonb_build_object('lead_ids', to_jsonb(ids), 'rozmow', n_roz, 'maili', n_mail, 'zdarzen_odpietych', n_zd, 'kopia', 'crm.porzadek_bez_potencjalu_kopia'));

  raise notice 'Porządek: usunięto % klientów, odpięto % rozmów, % maili, % zdarzeń.', cardinality(ids), n_roz, n_mail, n_zd;
end
$porzadek$;
