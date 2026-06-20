-- =====================================================================
-- print_documents: kolumna 'system' do auto-doboru DoP wg systemu zamówienia
-- Puste/NULL = dokument dotyczy całej kategorii (jak dotąd).
-- Ustawione = dokument dobierany tylko dla zamówień z tym systemem.
-- =====================================================================
alter table public.print_documents add column if not exists system text;
