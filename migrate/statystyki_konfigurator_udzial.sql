-- =====================================================================
-- Statystyki → Konfigurator (zgłoszenie #145, Tymek 16.11.2026): udział zleceń
-- z konfiguratora (orders.source = 'bot') w liczbie zleceń per miesiąc i kategoria.
-- Cel firmy: 50% na koniec 2027. Liczymy po order_date, bez anulowanych.
-- Tylko kierownik (jak reszta Statystyk). Wywołanie: rpc konfigurator_udzial(p_months)
-- =====================================================================
create or replace function public.konfigurator_udzial(p_months integer default 12)
returns table (r_month date, r_category text, r_total integer, r_konfigurator integer)
language sql
stable
security definer
set search_path = public
as $$
  select
    date_trunc('month', o.order_date)::date as r_month,
    o.category as r_category,
    count(*)::integer as r_total,
    count(*) filter (where o.source = 'bot')::integer as r_konfigurator
  from public.orders o
  where public.current_user_is_manager()
    and o.order_date >= (date_trunc('month', now()) - make_interval(months => greatest(coalesce(p_months, 12), 1) - 1))::date
    and coalesce(o.extra_fields->>'cancelled', '') <> 'true'
  group by 1, 2
  order by 1, 2;
$$;

revoke all on function public.konfigurator_udzial(integer) from public, anon;
grant execute on function public.konfigurator_udzial(integer) to authenticated, service_role;
