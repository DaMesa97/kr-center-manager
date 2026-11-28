-- 28.11.2026 — decyzja D25 (właściciel: TAK): hala może wpisywać w Excelu DATĘ zamiast samego „X” przy ST / Bastion
-- (dla statystyk czasu realizacji).
-- Druga połowa w Edge (supabase/functions/excel-sync, plik daty.ts): komórka „X albo data” (liczba seryjna Excela,
-- dd.mm, dd.mm.rrrr, dd.mm.rr, ISO). W kolumnach WYDANIE / ZREALIZOWANE i „MAGAZYN, KONTROLA ODBIORCZA” data =
-- PRAWDZIWA data wydania (bez flagi „szacunkowa”, więc liczy się w czasie realizacji); w kolumnach etapów ST /
-- Techniczne / ST_TITAN / Bastion data = etap zrobiony tego dnia: w etapie zapis jak dla „X” (#ND — zrobione,
-- bez osoby i bez wydania z magazynu), a data idzie do sync_stages_from_excel w items[].daty.
-- Ta migracja: sync_stages_from_excel zapisuje te daty w orders.extra_fields.etapy_daty_excel = {klucz: 'RRRR-MM-DD'}
-- (tylko klucze, których jeszcze nie ma — pierwsza data wygrywa; bez etapów cofniętych w programie, D22/D64);
-- licznik „daty_etapow” w podsumowaniu. Złe daty (np. 31.11) Edge wpisuje do raportu przebiegu (zle_daty), nie do SQL.
-- Zależność: PO 20261128032000 (ta sama funkcja + excel_cofniete_pomin). Treść = funkcja z 032000 + pkt D25.
-- Aplikacja bez tej migracji działa jak dotąd (Edge wysyła dodatkowe pole „daty”, stara funkcja je pomija).
-- Można uruchamiać wielokrotnie. DO WDROŻENIA (nie wgrane).
create or replace function public.sync_stages_from_excel(p_items jsonb, p_dry_run boolean default true, p_run_id bigint default null::bigint, p_category text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
 set statement_timeout to '120s'
as $function$
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
  -- D22/D64 (28.11), cofnięte w programie
  v_pomin text[];
  v_cof int := 0;
  v_cof_lista jsonb := '[]'::jsonb;
  -- D25 (28.11), daty etapów z Excela
  v_daty_old jsonb;
  v_daty_nowe jsonb;
  v_daty int := 0;
begin
  perform assert_manager_or_service();

  for it in
    select (e->>'id')::bigint as id, e->>'order_number' as nr, e->>'excel_row' as excel_row,
           coalesce(e->'stages', '{}'::jsonb) as stages, coalesce(e->'nietypowe', '[]'::jsonb) as nietyp,
           case when jsonb_typeof(e->'daty') = 'object' then e->'daty' else '{}'::jsonb end as daty
    from jsonb_array_elements(p_items) e
    where (e->>'id') is not null
  loop
    select production_stages,
           case when jsonb_typeof(extra_fields->'etapy_daty_excel') = 'object' then extra_fields->'etapy_daty_excel' else '{}'::jsonb end
      into v_cur, v_daty_old
    from orders
    where id = it.id and coalesce(extra_fields->>'cancelled', '') <> 'true'
    for update;
    if not found then continue; end if;
    v_zlecen := v_zlecen + 1;
    v_cur := coalesce(v_cur, '{}'::jsonb);
    v_changed := false;
    -- etapy cofnięte w programie, których komórka w Excelu się nie zmieniła (D22/D64)
    v_pomin := public.excel_cofniete_pomin('zlecenie', it.id, it.stages, not p_dry_run);

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
      if v_old = '' and st.key = any(v_pomin) then
        -- cofnięte w programie, Excel bez zmian → nie przywracamy
        v_cof := v_cof + 1;
        if jsonb_array_length(v_cof_lista) < 100 then
          v_cof_lista := v_cof_lista || jsonb_build_object('id', it.id, 'nr', it.nr, 'wiersz', it.excel_row, 'etap', st.key, 'excel', v_new);
        end if;
        continue;
      end if;
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

    -- D25 (28.11): data wykonania etapu z komórki z datą (zamiast „X”) — tylko nowe klucze, bez etapów cofniętych
    v_daty_nowe := (
      select coalesce(jsonb_object_agg(d.key, d.value), '{}'::jsonb)
      from jsonb_each(it.daty) d
      where (d.value #>> '{}') ~ '^\d{4}-\d{2}-\d{2}$'
        and not (d.key = any(v_pomin))
        and not (v_daty_old ? d.key)
    );
    if v_daty_nowe <> '{}'::jsonb then
      v_daty := v_daty + (select count(*)::int from jsonb_object_keys(v_daty_nowe));
      if not p_dry_run then
        update orders
        set extra_fields = coalesce(extra_fields, '{}'::jsonb)
          || jsonb_build_object('etapy_daty_excel', coalesce(extra_fields->'etapy_daty_excel', '{}'::jsonb) || v_daty_nowe)
        where id = it.id;
      end if;
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
    'pominiete_cofniete', v_cof,
    'daty_etapow', v_daty,
    'wydano_pozycji', v_wydano,
    'wymuszone_pozycji', v_wymuszone,
    'bledy_wydania', v_bledy
  );

  if p_run_id is not null then
    update excel_sync_runs
    set summary = coalesce(summary, '{}'::jsonb)
      || jsonb_build_object('etapy', v_summary, 'etapy_zmiany', v_zmiany, 'etapy_rozne', v_rozne_lista, 'etapy_nietypowe', v_nietyp_lista,
                            'etapy_wymuszone', v_wymuszone_lista, 'etapy_bledy_wydania', v_bledy_lista, 'etapy_cofniete', v_cof_lista)
    where id = p_run_id;
  end if;

  return v_summary || jsonb_build_object('zmiany', v_zmiany, 'rozne_lista', v_rozne_lista, 'nietypowe_lista', v_nietyp_lista,
                                         'wymuszone_lista', v_wymuszone_lista, 'bledy_wydania_lista', v_bledy_lista,
                                         'cofniete_lista', v_cof_lista);
end;
$function$;
