-- 27.11.2026 (testy 27.11, runda 3; WYSOKI): get_next_order_number brał max(order_number::integer) po wszystkich
-- zleceniach kategorii. Jedna literówka (np. „47040” zamiast „4704”) przeskakiwała serię na stałe, a numer spoza
-- zakresu integer (np. „78707870787”) wywalał funkcję — numeracja kategorii stawała (formularz, bot, Excel).
-- Nowa reguła (prosta i odporna):
--   1) tylko numery czysto cyfrowe, do 18 cyfr, liczone jako bigint (nic nie wychodzi poza zakres);
--   2) punkt odniesienia = mediana 200 NAJWYŻSZYCH numerów kategorii (seria jest ciągła, więc to ok. max − 100;
--      kilka literówek na samej górze mediany nie ruszy);
--   3) numery większe niż mediana + 1000 uznajemy za literówki i pomijamy; następny numer = max z reszty + 1.
-- Anulowanych NIE pomijamy przy max: unikalny indeks orders_unique_number_per_category_new (kategoria + numer)
-- odrzuciłby nowe zlecenie z numerem anulowanego — literówkę w anulowanym zleceniu i tak odcina reguła 3.
-- Celowy skok serii o mniej niż ~900 dalej działa; większy trzeba wpisać ręcznie przy pierwszym zleceniu nowej serii,
-- a seria „dogoni” próg po kolejnych zleceniach.
-- DO WDROŻENIA (nie wgrane w sesji).
create or replace function public.get_next_order_number(p_category text)
 returns text
 language sql
 stable
 set search_path to 'public'
as $function$
  -- testy 27.11 (runda 3): odporne na literówki i numery spoza zakresu
  with nums as (
    select order_number::bigint as v
    from orders
    where category = p_category
      and order_number ~ '^[0-9]{1,18}$'
  ), ref as (
    select percentile_disc(0.5) within group (order by v) as m
    from (select v from nums order by v desc limit 200) top200
  )
  select (coalesce(max(n.v), 0) + 1)::text
  from nums n, ref
  where ref.m is null or n.v <= ref.m + 1000;
$function$;
