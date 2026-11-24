-- 2026-11-24: Zamówienia u dostawców (Magazyn → Zamawianie) na żywo.
--
-- Tymek 24.11: „zrobiłem zamówienie u dostawcy ZD i Dorota go na żywo nie widzi” — purchase_orders
-- i purchase_order_items nie były w publikacji supabase_realtime, a aplikacja odświeżała listę
-- tylko przy wejściu w zakładkę Magazyn albo po własnym wygenerowaniu zamówienia. Teraz obie tabele
-- idą przez realtime, a useWarehouse nasłuchuje na nich i odświeża listę zamówień (debounce 1,5 s).
alter publication supabase_realtime add table public.purchase_orders;
alter publication supabase_realtime add table public.purchase_order_items;
