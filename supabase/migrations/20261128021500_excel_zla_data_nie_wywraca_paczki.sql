-- 28.11.2026 (runda 10 (28.11); WYSOKI): literówka daty w Excelu („31.11.2026” → excel-sync robił „2026-11-31”)
-- wywracała CAŁĄ synchronizację: sync_complaints_from_excel rzutuje (e->>'data')::date w zapytaniu pętli →
-- „date/time field value out of range”, cała paczka reklamacji kategorii odrzucona (także poprawne wiersze), co
-- 15 min, a Make dostaje 200. To samo sync_releases_from_excel__impl (x.wyd::date w CTE res) dla tekstu
-- RRRR-MM-DD z niemożliwą datą. Dowód testera: sync_complaints_from_excel([{data:'2026-11-20'},{data:'2026-11-31'}],
-- 'STA', …, dry_run) → błąd; sync_releases_from_excel__impl dla zlecenia 29317 z „2026-11-31” → błąd.
-- Teraz:
--  1) public.try_date(text) — rzutowanie na date, a przy błędzie null (te same formaty co ::date);
--  2) sync_complaints_from_excel: zła data reklamacji → wiersz pominięty (jak brak daty), policzony w podsumowaniu
--     jako „zla_data” (także w „pominiete”) i wypisany w details (nr, wiersz, wartość); zła data w WYDANIE →
--     reklamacja NIE jest oznaczana jako wydana (runda 11: „jak X” zapisywało dzisiejszą datę na stałe,
--     poprawka w arkuszu już nie docierała), też policzona w „zla_data”;
--  3) sync_releases_from_excel__impl: niemożliwa data wydania → status „inne” (lista do wyjaśnienia w Weryfikacji,
--     jak każdy nierozpoznany tekst), bez zamykania zlecenia.
-- Druga połowa poprawki w Edge (supabase/functions/excel-sync, anyToIso sprawdza istnienie daty, raport zle_daty).
-- Zależności: 20261127223000 (niewgrane) zmienia w sync_complaints_from_excel inne wyrażenia (scalanie etapów) —
-- miejsca łatek się nie pokrywają, kolejność wgrania dowolna. sync_releases_from_excel__impl nie jest zmieniana
-- przez żadną niewgraną migrację tej nocy. Kontrola „już poprawione” po znaczniku „runda 10 (28.11), zła data”.
-- DO WDROŻENIA (nie wgrane w sesji).
create or replace function public.try_date(p text)
 returns date
 language plpgsql
 stable
 set search_path to 'pg_catalog'
as $function$
begin
  -- runda 10 (28.11), zła data: literówka w arkuszu nie wywraca całej paczki
  if p is null or btrim(p) = '' then
    return null;
  end if;
  return p::date;
exception when others then
  return null;
end;
$function$;
revoke all on function public.try_date(text) from public, anon;
grant execute on function public.try_date(text) to authenticated, service_role;

do $$
declare
  d text;
  zm text[][] := array[
    -- [stare, nowe]
    [ '  v_existing_id bigint; v_run_id bigint; v_reason text; v_info text;
',
      '  v_existing_id bigint; v_run_id bigint; v_reason text; v_info text;
  v_bad int := 0; v_bad_rows jsonb := ''[]''::jsonb;  -- runda 10 (28.11), zła data
' ],
    [ '      (nullif(e->>''data'', ''''))::date as data,
',
      '      public.try_date(nullif(e->>''data'', '''')) as data,
      nullif(btrim(coalesce(e->>''data'', '''')), '''') as data_txt,
' ],
    [ '    if r.nr is null or r.data is null then v_skip := v_skip + 1; continue; end if;
',
      '    if r.nr is not null and r.data is null and r.data_txt is not null then
      v_bad := v_bad + 1;
      if jsonb_array_length(v_bad_rows) < 100 then
        v_bad_rows := v_bad_rows || jsonb_build_object(''nr'', r.nr, ''wiersz'', r.wiersz, ''kolumna'', ''DATA'', ''wartosc'', r.data_txt);
      end if;
    end if;
    if r.nr is null or r.data is null then v_skip := v_skip + 1; continue; end if;
' ],
    [ '      if r.wydanie ~ ''^\d{4}-\d{2}-\d{2}'' then v_release := r.wydanie::date;
',
      '      if r.wydanie ~ ''^\d{4}-\d{2}-\d{2}'' then
        v_release := public.try_date(r.wydanie);
        if v_release is null then  -- niemożliwa data: NIE wydane (runda 11), wiersz w raporcie; po poprawce w arkuszu przyjdzie data
          v_bad := v_bad + 1;
          if jsonb_array_length(v_bad_rows) < 100 then
            v_bad_rows := v_bad_rows || jsonb_build_object(''nr'', r.nr, ''wiersz'', r.wiersz, ''kolumna'', ''WYDANIE'', ''wartosc'', r.wydanie);
          end if;
        end if;
' ],
    [ '''bez_zlecenia'', v_nomatch, ''pominiete'', v_skip, ''starsze_niz_rok'', v_old),
          v_details)',
      '''bez_zlecenia'', v_nomatch, ''pominiete'', v_skip, ''starsze_niz_rok'', v_old,
                             ''zla_data'', v_bad, ''zle_daty'', v_bad_rows),
          v_details)' ],
    [ '''nowe'', v_new, ''zaktualizowane'', v_upd, ''bez_zlecenia'', v_nomatch, ''pominiete'', v_skip, ''starsze_niz_rok'', v_old));',
      '''nowe'', v_new, ''zaktualizowane'', v_upd, ''bez_zlecenia'', v_nomatch, ''pominiete'', v_skip, ''starsze_niz_rok'', v_old,
    ''zla_data'', v_bad, ''zle_daty'', v_bad_rows));' ]
  ];
  i int;
begin
  -- 1) sync_complaints_from_excel
  d := replace(pg_get_functiondef('public.sync_complaints_from_excel(jsonb,text,text,boolean)'::regprocedure), E'\r', '');
  if position('runda 10 (28.11), zła data' in d) > 0 then
    raise notice 'sync_complaints_from_excel: już poprawione — bez zmian';
  else
    for i in 1 .. array_length(zm, 1) loop
      if position(zm[i][1] in d) = 0 then
        raise exception 'sync_complaints_from_excel: nie znaleziono miejsca łatki % — sprawdź definicję', i;
      end if;
      d := replace(d, zm[i][1], zm[i][2]);
    end loop;
    execute d;
  end if;

  -- 2) sync_releases_from_excel__impl
  d := replace(pg_get_functiondef('public.sync_releases_from_excel__impl(jsonb,boolean,text,text)'::regprocedure), E'\r', '');
  if position('runda 10 (28.11), zła data' in d) > 0 then
    raise notice 'sync_releases_from_excel__impl: już poprawione — bez zmian';
  elsif position('and x.wyd::date >= o.order_date and x.wyd::date <= current_date then ''do_zamkniecia''' in d) = 0 then
    raise exception 'sync_releases_from_excel__impl: nie znaleziono miejsca łatki — sprawdź definicję';
  else
    d := replace(d,
      'and x.wyd::date >= o.order_date and x.wyd::date <= current_date then ''do_zamkniecia''',
      'and public.try_date(x.wyd) >= o.order_date and public.try_date(x.wyd) <= current_date then ''do_zamkniecia''  -- runda 10 (28.11), zła data: niemożliwa → „inne”');
    execute d;
  end if;
end $$;
