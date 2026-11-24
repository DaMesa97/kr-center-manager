-- 2026-11-24 (Tymek: „te przepisywanie etapów już będzie normalnie triggerowało zwolnienie rezerwacji i zużycie
-- materiału, co?” → nie; „Tak, wymuszaj”).
--
-- Dotąd zapis etapów z Excela (sync_stages_from_excel) wpisywał sam etap, a wydanie materiału z magazynu
-- robi wyłącznie aplikacja: przed zapisem etapu woła release_stock_for_stage (rezerwacje etapu → WZ, stan
-- fizyczny w dół), przy braku pyta „Wydaj mimo braku”. W bazie nie ma wyzwalacza na production_stages, który
-- by to robił. Po pierwszym zapisie 24.11 na etapach odhaczonych z Excela zostało 1153 aktywnych rezerwacji
-- w 132 zleceniach (Disting 906, STA 247; e2_1 1045, e1 70, e3 38).
--
-- Od teraz: każdy ZWYKŁY etap wpisany z Excela (inicjały; nie '#ND' / '#WS') wydaje materiał tak samo jak
-- odhaczenie w aplikacji, Z WYMUSZENIEM przy braku (nikt nie kliknie „Wydaj mimo braku” w nocnym przebiegu;
-- materiał fizycznie poszedł w drzwi, minusowy stan to sygnał do inwentaryzacji, WZ dostaje „[WYMUSZONE brak N]”).
-- Błąd wydania nie blokuje zapisu etapu (jak w aplikacji: produkcja ważniejsza niż magazyn) — trafia do raportu.
-- Mirrory pary Disting Plus (dist_*/sta_*) nie są pisane z Excela, więc nie wydają (jak w aplikacji).
-- Raport przebiegu (summary.etapy) dostaje: wydano_pozycji, wymuszone_pozycji, bledy_wydania;
-- summary.etapy_wymuszone = lista (max 100) pozycji wydanych na minus; summary.etapy_bledy_wydania = błędy.
-- Jednorazowe dogonienie 1153 rezerwacji z 24.11 wykonane osobnym zapytaniem (patrz koniec pliku).

create or replace function public.sync_stages_from_excel(
  p_items jsonb,
  p_dry_run boolean default true,
  p_run_id bigint default null,
  p_category text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '120s'
as $$
declare
  it record;
  st record;
  v_cur jsonb;
  v_old text;
  v_new text;
  v_changed boolean;
  v_zlecen int := 0;
  v_uzup int := 0;
  v_zgodne int := 0;
  v_rozne int := 0;
  v_nietyp int := 0;
  v_wydano int := 0;
  v_wymuszone int := 0;
  v_bledy int := 0;
  v_rel_n int;
  v_rel_forced int;
  v_zmiany jsonb := '[]'::jsonb;
  v_rozne_lista jsonb := '[]'::jsonb;
  v_nietyp_lista jsonb := '[]'::jsonb;
  v_wymuszone_lista jsonb := '[]'::jsonb;
  v_bledy_lista jsonb := '[]'::jsonb;
  v_summary jsonb;
begin
  perform assert_manager_or_service();

  for it in
    select (e->>'id')::bigint as id, e->>'order_number' as nr, e->>'excel_row' as excel_row,
           coalesce(e->'stages', '{}'::jsonb) as stages, coalesce(e->'nietypowe', '[]'::jsonb) as nietyp
    from jsonb_array_elements(p_items) e
    where (e->>'id') is not null
  loop
    select production_stages into v_cur
    from orders
    where id = it.id and coalesce(extra_fields->>'cancelled', '') <> 'true'
    for update;
    if not found then continue; end if;
    v_zlecen := v_zlecen + 1;
    v_cur := coalesce(v_cur, '{}'::jsonb);
    v_changed := false;

    -- nietypowe wartości z Excela: tylko do raportu
    if jsonb_array_length(it.nietyp) > 0 then
      v_nietyp := v_nietyp + jsonb_array_length(it.nietyp);
      if jsonb_array_length(v_nietyp_lista) < 100 then
        v_nietyp_lista := v_nietyp_lista || (
          select coalesce(jsonb_agg(jsonb_build_object('id', it.id, 'nr', it.nr, 'wiersz', it.excel_row, 'etap', n->>'etap', 'excel', n->>'wartosc')), '[]'::jsonb)
          from jsonb_array_elements(it.nietyp) n
        );
      end if;
    end if;

    for st in select key, value from jsonb_each_text(it.stages) loop
      v_new := trim(coalesce(st.value, ''));
      if v_new = '' then continue; end if;
      v_old := coalesce(trim(v_cur->>st.key), '');
      if v_old = '' then
        v_uzup := v_uzup + 1;
        if jsonb_array_length(v_zmiany) < 300 then
          v_zmiany := v_zmiany || jsonb_build_object('id', it.id, 'nr', it.nr, 'wiersz', it.excel_row, 'etap', st.key, 'na', v_new);
        end if;
        if not p_dry_run then
          v_cur := v_cur || jsonb_build_object(st.key, v_new);
          v_changed := true;
          if upper(v_new) = '#ND' then
            perform public.cancel_stage_reservations__impl(it.id, st.key);
          elsif left(v_new, 1) <> '#' then
            -- zwykły etap (inicjały): wydanie z magazynu jak w aplikacji, z wymuszeniem przy braku
            begin
              select count(*) filter (where r_status = 'released'),
                     count(*) filter (where r_status = 'released' and r_shortage > 0)
                into v_rel_n, v_rel_forced
              from public.release_stock_for_stage(it.id, st.key, true);
              v_wydano := v_wydano + coalesce(v_rel_n, 0);
              v_wymuszone := v_wymuszone + coalesce(v_rel_forced, 0);
              if coalesce(v_rel_forced, 0) > 0 and jsonb_array_length(v_wymuszone_lista) < 100 then
                -- szczegóły pozycji (komponent, ile na minus) są w WZ „[WYMUSZONE brak N]” i w audit_log (release_stage)
                v_wymuszone_lista := v_wymuszone_lista || jsonb_build_object('id', it.id, 'nr', it.nr, 'etap', st.key, 'pozycji_na_minus', v_rel_forced);
              end if;
            exception when others then
              v_bledy := v_bledy + 1;
              if jsonb_array_length(v_bledy_lista) < 100 then
                v_bledy_lista := v_bledy_lista || jsonb_build_object('id', it.id, 'nr', it.nr, 'etap', st.key, 'blad', sqlerrm);
              end if;
            end;
          end if;
        end if;
      elsif upper(v_old) = upper(v_new) then
        v_zgodne := v_zgodne + 1;
      else
        v_rozne := v_rozne + 1;
        if jsonb_array_length(v_rozne_lista) < 100 then
          v_rozne_lista := v_rozne_lista || jsonb_build_object('id', it.id, 'nr', it.nr, 'wiersz', it.excel_row, 'etap', st.key, 'program', v_old, 'excel', v_new);
        end if;
      end if;
    end loop;

    if v_changed then
      update orders set production_stages = v_cur where id = it.id;
    end if;
  end loop;

  v_summary := jsonb_build_object(
    'kategoria', p_category,
    'tryb', case when p_dry_run then 'podglad' else 'zapis' end,
    'zlecen', v_zlecen,
    'uzupelnione', v_uzup,
    'zgodne', v_zgodne,
    'rozne', v_rozne,
    'nietypowe', v_nietyp,
    'wydano_pozycji', v_wydano,
    'wymuszone_pozycji', v_wymuszone,
    'bledy_wydania', v_bledy
  );

  if p_run_id is not null then
    update excel_sync_runs
    set summary = coalesce(summary, '{}'::jsonb)
      || jsonb_build_object('etapy', v_summary, 'etapy_zmiany', v_zmiany, 'etapy_rozne', v_rozne_lista, 'etapy_nietypowe', v_nietyp_lista,
                            'etapy_wymuszone', v_wymuszone_lista, 'etapy_bledy_wydania', v_bledy_lista)
    where id = p_run_id;
  end if;

  return v_summary || jsonb_build_object('zmiany', v_zmiany, 'rozne_lista', v_rozne_lista, 'nietypowe_lista', v_nietyp_lista,
                                         'wymuszone_lista', v_wymuszone_lista, 'bledy_wydania_lista', v_bledy_lista);
end;
$$;

comment on function public.sync_stages_from_excel(jsonb, boolean, bigint, text) is
  'Etapy z Excela → program (24.11.2026): uzupełnia tylko puste etapy zleceń z listy items (id + stages); zwykły etap wydaje materiał jak w aplikacji (release_stock_for_stage z wymuszeniem), #ND zwalnia rezerwacje; raport do excel_sync_runs.summary.etapy.';

grant execute on function public.sync_stages_from_excel(jsonb, boolean, bigint, text) to service_role;

-- ── Jednorazowe dogonienie (wykonane 24.11 osobnym zapytaniem, NIE część migracji) ──────────────────────
-- Etapy wpisane z Excela w przebiegach 249–258 (pierwszy zapis), na których zostały aktywne rezerwacje:
--   with zm as (select distinct (z->>'id')::bigint id, z->>'etap' etap
--               from excel_sync_runs e, jsonb_array_elements(e.summary->'etapy_zmiany') z where e.id in (249,250,252,254,255,258)),
--        do_wydania as (select zm.* from zm where exists (select 1 from stock_reservations r where r.order_id = zm.id and r.stage_key = zm.etap and r.status = 'reserved'))
--   select count(*) filter (where r_status='released') wydano, count(*) filter (where r_shortage > 0) na_minus
--   from do_wydania d cross join lateral public.release_stock_for_stage(d.id, d.etap, true);
