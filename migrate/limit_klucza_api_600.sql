-- 2026-10-23: limit klucza API „Konfigurator KR Center - prod” 60 → 600 / min.
--
-- Ten sam klucz obsługuje konfigurator (orders-intake) I import z Excela
-- (dynamic-handler / excel-intake przez Make). Make wysyła paczkę arkusza
-- naraz: 19.10 14:35 → 224 żądań/min, 268 odrzuconych 429; 05.10 → 45 odrzuconych
-- (api_request_logs). Odrzucone zlecenia z Excela przepadały, a w tej minucie
-- konfigurator też by dostał 429. 600/min mieści największą paczkę z zapasem;
-- klucz jest tajny, więc ochrona przed nadużyciem zostaje.
-- Docelowo (TODO): osobny klucz dla Excela — zmiana w scenariuszu Make.

UPDATE public.api_keys SET rate_limit_per_minute = 600 WHERE id = 2 AND rate_limit_per_minute < 600;
