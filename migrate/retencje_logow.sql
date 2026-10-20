-- ============================================================================
-- Retencje logów (wdrożone przez MCP jako migracja retencje_logow, 2026-10-20)
--
--   audit_log         > 12 miesięcy (historia zamówień czyta stąd wpisy
--                       magazynowe — aktywne zamówienia są dużo młodsze)
--   forecast_runs     > 90 dni (prognozy liczone codziennie od nowa)
--   api_request_logs  > 90 dni (diagnostyka intake)
--
-- Codzienny job pg_cron 'cleanup-old-logs-daily' o 03:30 (wzór jak
-- archive-old-orders-daily). Pierwsze odpalenie ręczne 2026-10-20 usunęło
-- 954 forecast_runs i 1561 api_request_logs (audit_log nie miał jeszcze
-- wierszy starszych niż rok).
-- ============================================================================

create or replace function public.cleanup_old_logs()
returns void
language sql
security definer
set search_path to 'public'
as $$
  delete from audit_log where created_at < now() - interval '12 months';
  delete from forecast_runs where run_at < now() - interval '90 days';
  delete from api_request_logs where created_at < now() - interval '90 days';
$$;

revoke execute on function public.cleanup_old_logs() from public, anon, authenticated;

select cron.schedule(
  'cleanup-old-logs-daily',
  '30 3 * * *',
  $$select public.cleanup_old_logs()$$
);
