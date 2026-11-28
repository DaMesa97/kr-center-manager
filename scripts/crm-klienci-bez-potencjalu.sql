-- 28.11.2026 — zgłoszenie właściciela (CRM Po Drzwi): „klienci-śmieci” założeni z rozmów / maili bez potencjału
-- sprzedażowego, zanim Edge crm-call-ingest zaczął je odsiewać (pole analiza.potencjal).
-- TYLKO ODCZYT (select) — nic nie kasuje. Porządek (usunięcie klientów z odpięciem rozmów / maili do listy
-- „Bez klienta”) jest w propozycji migracji scripts/propozycja_crm_porzadek_klienci_bez_potencjalu.sql — czeka na decyzję.
--
-- Kryterium „klient-śmieć” (wszystkie warunki naraz):
--   * status 'nowy', źródło 'telefon' albo 'mail' (formularz ze strony, wizyta, polecenie itd. — nie ruszamy),
--   * bez zadania (nastepna_akcja null), bez wartości wstępnej, bez połączonych kontaktów (inne_kontakty),
--   * bez ofert, bez dokumentów, bez zamówień sklepu,
--   * nikt nic przy nim nie zrobił ręcznie (żadnego zdarzenia z wypełnionym „kto”),
--   * żadnej rozmowy wychodzącej ani maila wychodzącego (nikt do niego nie dzwonił / nie pisał),
--   * żadnej rozmowy nieodebranej / bez analizy / z błędem (status bez_ai, nowa, blad) — krótkie „pominięte” mogą być,
--   * co najmniej jedna rozmowa / mail przeanalizowane przez AI, i KAŻDA taka rozmowa / mail ma nastepna_akcja 'brak',
--     sprawa inna niż 'klient' i 'reklamacja', a co najmniej jedna to 'zapytanie'.
-- To jest odpowiednik dzisiejszej reguły „nowy kontakt bez potencjału” (AI zwracało wtedy akcję 'brak' dla rozmów
-- czysto informacyjnych, rezygnacji i braku danych).

with kandydaci as (
  select l.id, l.zrodlo, l.created_at
  from crm.leady l
  where l.status = 'nowy'
    and l.zrodlo in ('telefon', 'mail')
    and l.nastepna_akcja is null
    and l.wartosc_wstepna is null
    and coalesce(jsonb_array_length(l.inne_kontakty), 0) = 0
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
      or exists (select 1 from crm.maile m where m.lead_id = l.id and m.kierunek = 'przychodzacy' and m.status_przetwarzania = 'przetworzony' and m.typ = 'zapytanie'))
)
select k.id as lead_id, k.zrodlo, k.created_at::date as zalozony,
       (select count(*) from crm.rozmowy r where r.lead_id = k.id) as rozmow,
       (select count(*) from crm.maile m where m.lead_id = k.id) as maili,
       coalesce(
         (select r.podsumowanie from crm.rozmowy r where r.lead_id = k.id and r.status_przetwarzania = 'przetworzona' order by r.data_rozmowy desc limit 1),
         (select m.podsumowanie from crm.maile m where m.lead_id = k.id and m.status_przetwarzania = 'przetworzony' order by m.data desc limit 1)
       ) as podsumowanie
from kandydaci k
order by k.created_at desc;
