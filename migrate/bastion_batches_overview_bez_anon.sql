-- Zwiad danych 21.11: widok bastion_batches_overview działa z prawami właściciela (bez security_invoker),
-- więc omija RLS — a rola anon (bez logowania) miała do niego pełne prawa. Aplikacja czyta go jako zalogowany
-- (useBastionBatches), więc anon jest niepotrzebny.
revoke all on public.bastion_batches_overview from anon;
