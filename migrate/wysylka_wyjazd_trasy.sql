-- =====================================================================
-- Wysyłka → biurko kierownika logistyki (makieta „Wysyłka — lista dnia”, decyzje Tymka 16–17.11.2026)
--
-- „Wyjechało na trasę” to NOWE zdarzenie, osobne od dzisiejszego „wydania” (release_date):
--   * release_date zostaje jak jest (Excel; dla STA/TITAN = przekazane z Marklowickiej na Bukową,
--     dla reszty ktoś coś zaznacza w arkuszu) — NIC w tym nie zmieniamy (decyzja 17.11);
--   * shipped_at + shipped_route = bus z tymi drzwiami wyjechał z Bukowej na trasę. Ustawia
--     kierownik logistyki z Wysyłki przyciskiem „Trasa wyjechała” (komputer, bez mobilnej).
-- Znacznik „do fakturowania” zostaje w extra_fields.ready_to_invoice (merge_order_extra_fields).
-- =====================================================================
alter table public.orders add column if not exists shipped_at timestamptz;
alter table public.orders add column if not exists shipped_route text;
alter table public.orders_archive add column if not exists shipped_at timestamptz;
alter table public.orders_archive add column if not exists shipped_route text;

comment on column public.orders.shipped_at is 'Wyjechało na trasę (bus z Bukowej) — ustawia kierownik logistyki w Wysyłce; osobne od release_date';
comment on column public.orders.shipped_route is 'Dzień trasy, z którą wyjechało (PONIEDZIAŁEK…), albo „Odbiór osobisty”';

create index if not exists idx_orders_shipped_at on public.orders (shipped_at) where shipped_at is not null;

-- Oznaczenie / cofnięcie wyjazdu dla listy zleceń (jedna trasa = jedno kliknięcie).
-- Tylko kierownicy (jak fakturowanie). Zwraca liczbę zmienionych zleceń.
create or replace function public.mark_orders_shipped(p_order_ids bigint[], p_route text, p_shipped boolean default true)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  if not public.current_user_is_manager() then
    raise exception 'Tylko kierownik może oznaczać wyjazd trasy';
  end if;
  if p_order_ids is null or array_length(p_order_ids, 1) is null then
    return 0;
  end if;
  if p_shipped then
    update public.orders
       set shipped_at = now(), shipped_route = nullif(btrim(coalesce(p_route, '')), '')
     where id = any(p_order_ids)
       and shipped_at is null
       and coalesce(extra_fields->>'cancelled', '') <> 'true';
  else
    update public.orders
       set shipped_at = null, shipped_route = null
     where id = any(p_order_ids)
       and shipped_at is not null;
  end if;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.mark_orders_shipped(bigint[], text, boolean) from public, anon;
grant execute on function public.mark_orders_shipped(bigint[], text, boolean) to authenticated, service_role;
