-- =====================================================================
-- BACKFILL: firma realizująca dla istniejących zleceń z konfiguratora
-- (2026-09-07)
--
-- Konfigurator wysyła w payloadzie klucz "firmaRealizujaca": KR albo MR.
-- KR = KR Center → wykonawca 'Center'; MR = MR Profil → wykonawca 'Profil'
-- (wartości spójne z formularzem aplikacji: Center / Profil / WZ).
--
-- Nowe zlecenia dostają wykonawcę w Edge Function orders-intake
-- (applyWykonawca) — ten skrypt uzupełnia STARE, na podstawie
-- extra_fields->raw_payload. Łapie też partnerów Disting Plus i nogi
-- Titana utworzone z bota (kopiują extra_fields z bazowego zlecenia,
-- więc mają ten sam raw_payload).
--
-- Nie nadpisuje już ustawionego wykonawcy. Idempotentny.
-- Archiwum (orders_archive) celowo nie ruszam — w razie potrzeby ten sam
-- UPDATE z podmienioną nazwą tabeli.
-- =====================================================================

-- ── 0. Podgląd: ile zleceń dostanie wykonawcę ────────────────────────────
select
  upper(trim(extra_fields->'raw_payload'->>'firmaRealizujaca')) as firma,
  count(*)
from orders
where coalesce(trim(extra_fields->>'wykonawca'), '') = ''
  and upper(trim(coalesce(extra_fields->'raw_payload'->>'firmaRealizujaca', ''))) in ('KR', 'MR')
group by 1;

-- ── 1. Backfill ──────────────────────────────────────────────────────────
update orders
set extra_fields = coalesce(extra_fields, '{}'::jsonb)
  || jsonb_build_object(
       'wykonawca',
       case upper(trim(extra_fields->'raw_payload'->>'firmaRealizujaca'))
         when 'KR' then 'Center'
         when 'MR' then 'Profil'
       end
     )
where coalesce(trim(extra_fields->>'wykonawca'), '') = ''
  and upper(trim(coalesce(extra_fields->'raw_payload'->>'firmaRealizujaca', ''))) in ('KR', 'MR');

-- ── 2. Kontrola po backfillu ─────────────────────────────────────────────
select extra_fields->>'wykonawca' as wykonawca, count(*)
from orders
where source = 'bot'
group by 1;
