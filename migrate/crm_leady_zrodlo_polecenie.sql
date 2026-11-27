-- CRM v3 (27.11.2026, Tymek): „Dodaj klienta” — źródło do wyboru także telefon (inne numery niż Ringostat), mail, polecenie, inne.
-- Addytywnie: nowa wartość 'polecenie' w leady.zrodlo + kolumna zrodlo_szczegol (na który nasz numer dzwonił / kto polecił / skąd dokładnie).
-- Wgrane konektorem jako migracja crm_leady_zrodlo_polecenie.
alter table crm.leady drop constraint if exists leady_zrodlo_check;
alter table crm.leady add constraint leady_zrodlo_check
  check (zrodlo = any (array['telefon', 'formularz', 'mail', 'wizyta', 'social', 'polecenie', 'inne']));
alter table crm.leady add column if not exists zrodlo_szczegol text;
comment on column crm.leady.zrodlo_szczegol is 'Szczegół źródła klienta dodanego ręcznie: na który nasz numer dzwonił, kto polecił, skąd dokładnie (CRM v3, 27.11.2026)';
