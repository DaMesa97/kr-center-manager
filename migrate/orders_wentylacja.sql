-- =====================================================================
-- Wentylacja (zgłoszenie Dawida): parametr dla drzwi Technicznych
-- i wewnętrznych (Classic) — zamiast wpisywania z palca w uwagach.
-- Wartości słownika dodajesz w Konfiguracji:
--   Techniczne → Wentylacja, Wewnętrzne → Wentylacja
-- =====================================================================
alter table public.orders add column if not exists wentylacja text;
