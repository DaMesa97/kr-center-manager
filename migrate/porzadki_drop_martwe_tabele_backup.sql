-- ============================================================================
-- Porządki 2026-10-20: DROP martwych tabel/funkcji (wykonane przez MCP jako
-- migracja porzadki_drop_martwe_tabele) + BACKUP danych na wypadek powrotu.
--
-- Usunięte obiekty i dlaczego są martwe:
--  - integration_api_keys (0 wierszy) + generate_api_key() — stare UI kluczy
--    API pisało tutaj, ale edge functions zawsze walidowały po tabeli api_keys;
--    w beta.50 UI przepięte na api_keys + create_api_key.
--  - label_printers (2 wiersze, backup niżej) — druk ZPL po TCP 9100 usunięty
--    w beta.21; cały druk idzie po nazwach drukarek Windows (printers:list).
--  - extension_width_map (9 wierszy, backup niżej) — poszerzenia liczone są
--    z extension_profile_widths + extension_qtys; mapa nieczytana od wiosny.
--  - consume_stock_for_order() — zastąpione przez reserve/release (rezerwacja →
--    WZ); w kliencie wołał ją tylko wrapper, którego nikt nie wywoływał
--    (usunięty w tym samym commicie).
--
-- Kolumn orders.stage1–5/wpisal/release NIE ruszamy, dopóki w terenie są
-- klienci, którzy mogą je wysyłać — DROP dopiero po beta.52 + bramka
-- min_app_version (plan w HelpView/backlogu).
-- ============================================================================

drop function if exists public.generate_api_key();
drop function if exists public.consume_stock_for_order(bigint);
drop table if exists public.integration_api_keys;
drop table if exists public.label_printers;
drop table if exists public.extension_width_map;

-- ── BACKUP: label_printers (stan z 2026-10-20) ──────────────────────────────
-- create table public.label_printers (id bigint, name text, ip text, port int,
--   is_default boolean, windows_name text, created_at timestamptz);
-- insert into label_printers (id, name, ip, port, is_default, windows_name, created_at) values
--   (1, 'Zebra-Sznapik', '192.168.1.83', 9100, true,  null, '2026-06-18T08:11:24.119847+00'),
--   (2, 'Zebra-Haki',    '192.168.1.82', 9100, false, null, '2026-06-18T08:12:13.356898+00');

-- ── BACKUP: extension_width_map (stan z 2026-10-20) ─────────────────────────
-- insert into extension_width_map (id, category, width_code, extension_dim_mm, created_at) values
--   (1, 'Disting', '80N',  897,  '2026-04-14T17:29:19.374606+00'),
--   (2, 'STA',     '80E',  920,  '2026-04-14T17:29:19.374606+00'),
--   (3, 'Disting', '80E',  920,  '2026-04-14T17:29:19.374606+00'),
--   (4, 'STA',     '90T',  980,  '2026-04-14T17:29:19.374606+00'),
--   (5, 'Disting', '90T',  980,  '2026-04-14T17:29:19.374606+00'),
--   (6, 'STA',     '90E',  1020, '2026-04-14T17:29:19.374606+00'),
--   (7, 'Disting', '90E',  1020, '2026-04-14T17:29:19.374606+00'),
--   (8, 'STA',     '100E', 1080, '2026-04-14T17:29:19.374606+00'),
--   (9, 'Disting', '100E', 1120, '2026-04-14T17:29:19.374606+00');
-- integration_api_keys było puste (0 wierszy) — bez backupu.
