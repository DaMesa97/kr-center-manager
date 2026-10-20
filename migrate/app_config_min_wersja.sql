-- ============================================================================
-- app_config — konfiguracja aplikacji w bazie (wdrożone przez MCP jako
-- migracja app_config_min_wersja, 2026-10-20)
--
-- Na razie jeden klucz: min_app_version — bramka minimalnej wersji klienta.
-- Migracje bazy wyprzedzają klientów; klient starszy niż min_app_version
-- dostaje po zalogowaniu pełnoekranową blokadę z prośbą o aktualizację
-- (App.tsx czyta klucz raz po zalogowaniu, porównanie: utils.isAppVersionOlder).
--
-- Brak wiersza = brak bramki. Ustawianie (kierownik lub SQL):
--   insert into app_config (key, value) values ('min_app_version', '1.0.0-beta.52')
--   on conflict (key) do update set value = excluded.value, updated_at = now();
-- Zdjęcie bramki:
--   delete from app_config where key = 'min_app_version';
-- ============================================================================

create table if not exists public.app_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.app_config enable row level security;

create policy app_config_select on public.app_config
  for select to authenticated using (true);

create policy app_config_write on public.app_config
  for all to authenticated
  using ((select current_user_is_manager()))
  with check ((select current_user_is_manager()));

revoke all on table public.app_config from anon;
