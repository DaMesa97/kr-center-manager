-- 28.11.2026 — decyzja D67 (c): codzienne sprzątanie osieroconych zdjęć zleceń (bucket order-photos).
-- pg_cron o 03:45 (po archiwizacji 03:00 i czyszczeniu logów 03:30) woła funkcję Edge sprzatanie-zdjec tak jak
-- pozostałe zadania (crm.wolaj_funkcje: pg_net + nagłówek x-internal-key z vault). Funkcja bierze listę z
-- public.order_photos_sieroty (20261128055200) i kasuje pliki przez Storage API (najwyżej 1000 na przebieg).
-- Wynik przebiegu: odpowiedź HTTP w net._http_response (JSON: znalezione / usuniete / bledy).
-- WGRYWAĆ DOPIERO PO: 20261128055200 i `supabase functions deploy sprzatanie-zdjec --no-verify-jwt` (bez funkcji
-- zadanie co noc dostawałoby 404 — nic by nie zepsuło, ale śmieci w logach).
-- Plik można uruchamiać wielokrotnie (cron.schedule z tą samą nazwą podmienia zadanie).
-- DO WDROŻENIA (nie wgrane).

select cron.schedule(
  'sprzatanie-zdjec-daily',
  '45 3 * * *',
  $cron$select crm.wolaj_funkcje('sprzatanie-zdjec', '{}'::jsonb)$cron$
);
