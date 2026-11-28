-- 28.11.2026 — decyzja D67 (właściciel: TAK, opcje a + c): sprzątanie osieroconych zdjęć zleceń.
-- Problem: gdy plik doszedł do bucketu order-photos, a wpis w order_photos się nie udał, aplikacja próbuje skasować
-- plik — ale pracownik nie ma prawa kasować plików (polityka order_photos_delete: tylko kierownik), więc zostaje
-- sierota. To samo po skasowaniu zlecenia (wpisy order_photos znikają kaskadą, pliki zostają).
-- Bezpośrednie DELETE ze storage.objects jest zablokowane (trigger storage.protect_delete) i i tak zostawiłoby
-- plik w magazynie — pliki usuwa funkcja Edge sprzatanie-zdjec przez Storage API. Ten plik daje jej listę.
-- Sierota = obiekt w buckecie order-photos:
--   - starszy niż p_starsze_niz_godzin (domyślnie 24 h, najmniej 12 h — trwające wysyłanie / ponowienie po D66
--     „mogło się zapisać” nie może zostać skasowane),
--   - bez wpisu w order_photos.storage_path,
--   - i bez wpisu w orders_archive.photos[*].storage_path (archiwizacja przenosi zdjęcia do jsonb, przywracanie
--     z archiwum odtwarza je w order_photos — 20261128010300 / 20261128031100).
-- Tylko service_role (funkcja Edge) — kierownik widzi i kasuje pliki w aplikacji jak dotąd.
-- Stan 28.11: bucket order-photos ma 0 plików, order_photos 0 wierszy.
-- Plik można uruchamiać wielokrotnie. Nie zależy od niewgranych plików.
-- DO WDROŻENIA (nie wgrane). Kolejność: ten plik → deploy funkcji Edge sprzatanie-zdjec → 20261128055201 (harmonogram).

create or replace function public.order_photos_sieroty(p_starsze_niz_godzin integer default 24, p_limit integer default 1000)
 returns table (sciezka text, utworzono timestamptz, rozmiar bigint)
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  with archiwum as (
    select distinct ph.x->>'storage_path' as sciezka
    from public.orders_archive a
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(a.photos) = 'array' then a.photos else '[]'::jsonb end) ph(x)
    where ph.x->>'storage_path' is not null
  )
  select o.name, o.created_at, nullif(o.metadata->>'size', '')::bigint
  from storage.objects o
  where o.bucket_id = 'order-photos'
    and o.created_at < now() - make_interval(hours => greatest(coalesce(p_starsze_niz_godzin, 24), 12))
    and not exists (select 1 from public.order_photos p where p.storage_path = o.name)
    and not exists (select 1 from archiwum a where a.sciezka = o.name)
  order by o.created_at
  limit greatest(least(coalesce(p_limit, 1000), 5000), 1);
$function$;

revoke all on function public.order_photos_sieroty(integer, integer) from public, anon, authenticated;
grant execute on function public.order_photos_sieroty(integer, integer) to service_role;
