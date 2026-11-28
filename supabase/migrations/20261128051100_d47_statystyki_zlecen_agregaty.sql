-- 28.11.2026 — D47 (decyzja właściciela: „ROBIMY B”). Statystyki zleceń liczone agregatami w bazie.
-- DO WDROŻENIA (nie wgrane).
--
-- Dotąd Statystyki (CategoryStatsDashboard, Firmy, scalanie nazw firm) ładowały do przeglądarki całą tabelę orders
-- (po 1f41820: 15 kolumn porcjami po id, ok. 7 MB i 24 zapytania; wcześniej 67 MB) i liczyły wszystko w JS.
-- Teraz:
--   * stat_zlecenia_podsumowanie() → jeden jsonb z gotowymi zestawieniami per kategoria (status, czasy realizacji per
--     miesiąc wydania, produkcja per miesiąc, systemy, firmy, dni tygodnia, top 15 modeli i kolorów) oraz licznikami
--     pisowni firm (lista firm / scalanie nazw). Okno miesięcy i scalanie nazw firm (aliasy) robi aplikacja.
--   * stat_zlecenia_firm(p_nazwy) → zlecenia wybranych pisowni firmy (Statystyki → Firmy → „Firma pod lupą”), tylko pola
--     potrzebne do karty firmy; jsonb (jedna wartość — bez limitu 1000 wierszy PostgREST).
--   * stat_js_trim(text) → trim jak w JS (String.prototype.trim: także twarda spacja, BOM, spacje Unicode).
-- Reguły przepisane 1:1 z dawnego liczenia w aplikacji (src/lib/statsZlecenia.ts — ścieżka zapasowa liczy to samo):
--   anulowane = extra_fields.cancelled === true (boolean); bez RO bazy MR Profil (D10: source 'optima_ro'
--   i source_metadata.optima_key 'MR:…'); zrealizowane = jest release_date albo RO zamknięte w Optimie
--   (closed_by 'optima_ro' z datą wydania albo source_metadata.state 3/4); czasy realizacji bez dat „szacunkowych”
--   (release_date_szacunkowa) i bez ujemnych; dni = release_date − order_date (bez order_date: od created_at,
--   zaokrąglenie jak Math.round); dzień tygodnia zamówienia wg order_date (bez niej: created_at w czasie polskim);
--   sztuki: brak/0 → 0 (sumy), a w dniach tygodnia i modelach/kolorach brak/0 → 1 (jak dotąd); remisy w rankingach
--   rozstrzyga najmniejsze id (kolejność pierwszego wystąpienia — jak stabilne sortowanie w aplikacji).
-- Uprawnienia jak stat_wew_*: security definer, w środku current_user_is_manager() (Statystyki widzi tylko kierownik),
-- execute dla authenticated i service_role, bez anon.
-- Aplikacja przy PGRST202 (funkcji jeszcze nie ma) wraca do starej ścieżki (ładowanie zleceń), więc kolejność wdrożenia dowolna.

create or replace function public.stat_js_trim(t text)
returns text
language sql
immutable
parallel safe
as $$
  select regexp_replace(coalesce(t, ''),
    '^[\t\n\v\f\r    -     　﻿]+|[\t\n\v\f\r    -     　﻿]+$',
    '', 'g')
$$;

create or replace function public.stat_zlecenia_podsumowanie()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v jsonb;
begin
  if not public.current_user_is_manager() then return null; end if;

  with z as materialized (
    select o.id,
           o.category,
           coalesce(o.quantity, 0) as q0,
           case when coalesce(o.quantity, 0) = 0 then 1 else o.quantity end as q1,
           o.release_date,
           o.release_date is not null as wydane,
           coalesce(o.extra_fields -> 'cancelled' = 'true'::jsonb, false) as anul,
           coalesce(o.extra_fields -> 'release_date_szacunkowa' = 'true'::jsonb, false) as szac,
           coalesce(o.source = 'optima_ro' and (
             (coalesce(o.extra_fields -> 'closed_by' = '"optima_ro"'::jsonb, false) and o.release_date is not null)
             or case jsonb_typeof(o.source_metadata -> 'state')
                  when 'number' then (o.source_metadata ->> 'state')::numeric in (3, 4)
                  when 'string' then case when btrim(o.source_metadata ->> 'state') ~ '^[0-9]+(\.[0-9]+)?$'
                                          then btrim(o.source_metadata ->> 'state')::numeric in (3, 4) else false end
                  else false
                end
           ), false) as optima_zamkniete,
           -- nogi rekordów łączonych (isLinkedSecondary): Titan poza rekordem Bastion, skrzydło STA pary Disting Plus
           (coalesce(o.extra_fields -> 'titan_group' is not null and o.extra_fields -> 'titan_group' <> 'null'::jsonb
                     and o.category is distinct from 'Bastion', false)
            or coalesce(o.linked_order_id is not null and o.category = 'STA'
                and coalesce(o.system, '') ~* 'DISTING[\t\n\v\f\r    -     　﻿]*PLUS', false)) as noga,
           public.stat_js_trim(o.company) as firma,
           coalesce(nullif(public.stat_js_trim(o.system), ''), '(brak)') as system_t,
           coalesce(nullif(public.stat_js_trim(o.model), ''), '(brak)') as model_t,
           coalesce(nullif(public.stat_js_trim(o.wing_color), ''), '(brak)') as kolor_t,
           (o.order_date is not null or o.created_at is not null) as ma_date,
           case when o.order_date is not null then o.release_date - o.order_date
                else floor(extract(epoch from ((o.release_date::timestamp at time zone 'UTC') - o.created_at)) / 86400 + 0.5)::integer
           end as dni,
           case when o.order_date is not null then extract(dow from o.order_date)::integer
                else extract(dow from (o.created_at at time zone 'Europe/Warsaw'))::integer
           end as dzien
    from public.orders o
    where not (o.source = 'optima_ro' and coalesce(o.source_metadata ->> 'optima_key', '') like 'MR:%')
  )
  select jsonb_build_object(
    'wersja', 1,
    'liczba', (select count(*) from z),
    'firmy', (
      select coalesce(jsonb_agg(jsonb_build_object('name', f.firma, 'count', f.c) order by f.pierwsze), '[]'::jsonb)
      from (select firma, count(*) as c, min(id) as pierwsze from z
            where not anul and not noga and firma <> '' group by firma) f),
    'kategorie', (
      select coalesce(jsonb_object_agg(k.category, jsonb_build_object(
        'status', (
          select jsonb_build_object(
            'zrealizowane', coalesce(sum(q0) filter (where not anul and (wydane or optima_zamkniete)), 0),
            'w_produkcji', coalesce(sum(q0) filter (where not anul and not (wydane or optima_zamkniete)), 0),
            'anulowane', coalesce(sum(q0) filter (where anul), 0))
          from z where z.category = k.category),
        'bez_daty', (select count(*) from z where z.category = k.category and not anul and wydane and szac),
        'realizacja', (
          select coalesce(jsonb_agg(jsonb_build_object('m', r.m, 'suma', r.suma, 'n', r.n, 'min', r.mn, 'max', r.mx) order by r.m), '[]'::jsonb)
          from (select to_char(release_date, 'YYYY-MM') as m, sum(dni) as suma, count(*) as n, min(dni) as mn, max(dni) as mx
                from z where z.category = k.category and not anul and wydane and not szac and ma_date and dni >= 0
                group by 1) r),
        'produkcja', (
          select coalesce(jsonb_agg(jsonb_build_object('m', p.m, 'szt', p.szt) order by p.m), '[]'::jsonb)
          from (select to_char(release_date, 'YYYY-MM') as m, sum(q0) as szt
                from z where z.category = k.category and not anul and wydane and not szac
                group by 1) p),
        'systemy', (
          select coalesce(jsonb_agg(jsonb_build_object('name', s.n, 'value', s.v) order by s.v desc, s.f), '[]'::jsonb)
          from (select system_t as n, sum(q0) as v, min(id) as f
                from z where z.category = k.category and not anul and wydane
                group by 1) s),
        'firmy', (
          select coalesce(jsonb_agg(jsonb_build_object('name', f.n, 'value', f.v, 'first', f.f) order by f.f), '[]'::jsonb)
          from (select firma as n, sum(q0) as v, min(id) as f
                from z where z.category = k.category and not anul
                group by 1) f),
        'dni', (
          select jsonb_build_array(
            coalesce(sum(q1) filter (where dzien = 0), 0), coalesce(sum(q1) filter (where dzien = 1), 0),
            coalesce(sum(q1) filter (where dzien = 2), 0), coalesce(sum(q1) filter (where dzien = 3), 0),
            coalesce(sum(q1) filter (where dzien = 4), 0), coalesce(sum(q1) filter (where dzien = 5), 0),
            coalesce(sum(q1) filter (where dzien = 6), 0))
          from z where z.category = k.category and not anul and ma_date),
        'modele', (
          select coalesce(jsonb_agg(jsonb_build_object('name', t.n, 'value', t.v) order by t.v desc, t.f), '[]'::jsonb)
          from (select model_t as n, sum(q1) as v, min(id) as f
                from z where z.category = k.category and not anul
                group by 1 order by 2 desc, 3 limit 15) t),
        'kolory', (
          select coalesce(jsonb_agg(jsonb_build_object('name', t.n, 'value', t.v) order by t.v desc, t.f), '[]'::jsonb)
          from (select kolor_t as n, sum(q1) as v, min(id) as f
                from z where z.category = k.category and not anul
                group by 1 order by 2 desc, 3 limit 15) t)
      )), '{}'::jsonb)
      from (select distinct category from z where category is not null) k)
  ) into v;
  return v;
end;
$function$;

create or replace function public.stat_zlecenia_firm(p_nazwy text[])
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.current_user_is_manager() then return null; end if;
  if p_nazwy is null or cardinality(p_nazwy) = 0 then return '[]'::jsonb; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', o.id, 'category', o.category, 'order_number', o.order_number, 'company', o.company,
             'model', o.model, 'system', o.system, 'wing_color', o.wing_color, 'quantity', o.quantity,
             'order_date', o.order_date, 'release_date', o.release_date, 'created_at', o.created_at,
             'source', o.source, 'linked_order_id', o.linked_order_id,
             -- tylko klucze czytane przez kartę firmy (anulowanie, data szacunkowa, trójka Titan)
             'extra_fields', case when jsonb_typeof(o.extra_fields) = 'object' then jsonb_strip_nulls(jsonb_build_object(
                 'cancelled', o.extra_fields -> 'cancelled',
                 'release_date_szacunkowa', o.extra_fields -> 'release_date_szacunkowa',
                 'titan_group', o.extra_fields -> 'titan_group')) end
           ) order by o.id), '[]'::jsonb)
    from public.orders o
    where public.stat_js_trim(o.company) = any(p_nazwy)
      and not (o.source = 'optima_ro' and coalesce(o.source_metadata ->> 'optima_key', '') like 'MR:%')
  );
end;
$function$;

revoke all on function public.stat_js_trim(text) from public, anon;
revoke all on function public.stat_zlecenia_podsumowanie() from public, anon;
revoke all on function public.stat_zlecenia_firm(text[]) from public, anon;
grant execute on function public.stat_js_trim(text) to authenticated, service_role;
grant execute on function public.stat_zlecenia_podsumowanie() to authenticated, service_role;
grant execute on function public.stat_zlecenia_firm(text[]) to authenticated, service_role;
