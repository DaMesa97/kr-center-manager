-- =====================================================================
-- Optima RO — ciąg dalszy (4.11.2026):
-- 1. orders_archive dostaje kolumny erp_* (archive_old_orders kopiuje część
--    wspólną kolumn, więc numer RO nie ginie przy archiwizacji; Archiwum
--    pokazuje RO).
-- 2. integration_settings — klucz/wartość dla integracji (na start adres
--    webhooka Make „Ponów wysyłkę do Optimy"). Czyta i pisze tylko admin
--    (Konfiguracja → Integracje); edge function erp-retry czyta service_role.
-- Idempotentne.
-- =====================================================================

alter table public.orders_archive add column if not exists erp_ro_number text;
alter table public.orders_archive add column if not exists erp_status text;
alter table public.orders_archive add column if not exists erp_error text;
alter table public.orders_archive add column if not exists erp_updated_at timestamptz;

create table if not exists public.integration_settings (
  key text primary key,
  value text not null default '',
  description text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid
);
comment on table public.integration_settings is 'Ustawienia integracji (adresy webhooków Make itp.). Admin w Konfiguracja → Integracje; edge functions czytają service_role.';

alter table public.integration_settings enable row level security;
drop policy if exists integration_settings_admin_select on public.integration_settings;
create policy integration_settings_admin_select on public.integration_settings
  for select to authenticated using (public.current_user_is_admin());
drop policy if exists integration_settings_admin_update on public.integration_settings;
create policy integration_settings_admin_update on public.integration_settings
  for update to authenticated using (public.current_user_is_admin()) with check (public.current_user_is_admin());
drop policy if exists integration_settings_admin_insert on public.integration_settings;
create policy integration_settings_admin_insert on public.integration_settings
  for insert to authenticated with check (public.current_user_is_admin());
grant select, insert, update on public.integration_settings to authenticated;
grant all on public.integration_settings to service_role;

insert into public.integration_settings (key, value, description)
values ('erp_retry_webhook_url', '',
        'Webhook Make: „Ponów wysyłkę do Optimy". Aplikacja wysyła POST JSON {airtable_id, order_id, order_number, category, company, requested_by}. Pusty = przycisk wyłączony.')
on conflict (key) do nothing;
