-- 28.11.2026 — decyzje D22 + D64 (właściciel: TAK): etap cofnięty w programie NIE wraca z Excela
-- (zlecenia i reklamacje; w reklamacjach także „Cofnij realizację”).
-- Problem: synchronizacja Excela (co 15 min) uzupełnia PUSTE etapy wartością z arkusza. Po cofnięciu etapu w programie
-- (towar wraca ZWR) etap jest pusty, a komórka w Excelu nadal ma inicjały → etap wracał i znowu schodził materiał
-- (zlecenie STA 17634, etap e1; reklamacja 440 — także data realizacji z dnia synchronizacji).
-- Reguła (jedna dla zleceń i reklamacji):
--  1) Gdy ZALOGOWANA osoba opróżni w programie wypełniony etap (cofnięcie, zdjęcie „nie dotyczy”; nie: zdjęcie
--     „wstrzymane”), trigger zapisuje w tabeli excel_cofniete_etapy: co było, kto, kiedy. W reklamacji to samo
--     dla daty realizacji (etap „wydanie”).
--  2) Pierwsza synchronizacja po cofnięciu zapamiętuje, co wtedy stoi w Excelu (excel; '' = pusta komórka).
--  3) Dopóki komórka w Excelu ma TĘ SAMĄ wartość — synchronizacja pomija ten etap (licznik „pominiete_cofniete”
--     w podsumowaniu przebiegu, lista „etapy_cofniete” w excel_sync_runs).
--  4) Gdy wartość w Excelu się zmieni (np. hala poprawi inicjały albo wpisze je po wyczyszczeniu komórki) —
--     Excel znowu uzupełnia etap, a wpis znika. Wpis znika też, gdy ktoś odhaczy etap ponownie w programie.
-- Synchronizacja (service_role, bez zalogowanej osoby) i poprawki SQL nie tworzą wpisów.
-- Ograniczenie: zmiana w Excelu zrobiona między cofnięciem a najbliższą synchronizacją (≤ 15 min) zostanie
-- potraktowana jak stan „w chwili cofnięcia” (bezpieczniej: nic nie wraca samo).
-- Zawartość: tabela + trigger (orders, complaints) + funkcja excel_cofniete_pomin + nowa wersja
-- sync_stages_from_excel (bez zmian poza pkt 3–4) + łatka sync_complaints_from_excel (wstawki tekstowe).
-- Zależności: łatka reklamacji nie dotyka miejsc łatek z 20261127223000 i 20261128021500 (kolejność dowolna),
-- ale sens ma dopiero z 20261127223000 (bez niej synchronizacja i tak nadpisuje cały zestaw etapów reklamacji).
-- sync_stages_from_excel nie jest zmieniana przez żadną niewgraną migrację z nocy. Druga połowa w Edge
-- (excel-sync: wiersze zleceń z wpisami „cofnięte” idą do sync_stages_from_excel także bez wartości etapów).
-- Można uruchamiać wielokrotnie. DO WDROŻENIA (nie wgrane).

create table if not exists public.excel_cofniete_etapy (
  rodzaj    text        not null check (rodzaj in ('zlecenie', 'reklamacja')),
  obiekt_id bigint      not null,                 -- orders.id albo complaints.id
  etap      text        not null,                 -- klucz etapu albo 'wydanie' (realizacja reklamacji)
  bylo      text,                                 -- wartość w programie przed cofnięciem
  kto       uuid,                                 -- auth.uid() osoby, która cofnęła
  kiedy     timestamptz not null default now(),
  excel     text,                                 -- wartość z Excela przy pierwszej synchronizacji po cofnięciu ('' = pusta)
  excel_od  timestamptz,
  primary key (rodzaj, obiekt_id, etap)
);
comment on table public.excel_cofniete_etapy is
  'D22/D64 (28.11.2026): etapy cofnięte w programie — synchronizacja Excela ich nie uzupełnia, dopóki komórka w arkuszu się nie zmieni';
alter table public.excel_cofniete_etapy enable row level security;
revoke all on public.excel_cofniete_etapy from public, anon, authenticated;
grant select on public.excel_cofniete_etapy to authenticated;
grant all on public.excel_cofniete_etapy to service_role;
drop policy if exists excel_cofniete_etapy_select on public.excel_cofniete_etapy;
create policy excel_cofniete_etapy_select on public.excel_cofniete_etapy
  for select to authenticated using (public.current_user_is_manager());

-- 1) trigger: zapamiętanie cofnięcia / zdjęcie wpisu po ponownym odhaczeniu
create or replace function public.excel_cofniete_etapy_trg()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  -- D22/D64 (28.11), cofnięte w programie
  v_rodzaj text := case tg_table_name when 'orders' then 'zlecenie' else 'reklamacja' end;
  v_uid uuid := auth.uid();
  v_os jsonb := case when jsonb_typeof(old.production_stages) = 'object' then old.production_stages else '{}'::jsonb end;
  v_ns jsonb := case when jsonb_typeof(new.production_stages) = 'object' then new.production_stages else '{}'::jsonb end;
  k text; v_o text; v_n text;
begin
  for k in select x from jsonb_object_keys(v_os || v_ns) x loop
    -- kopie etapów partnera pary (dist_* / sta_*) — Excel ich nie uzupełnia
    if k like 'dist\_%' or k like 'sta\_%' then continue; end if;
    v_o := btrim(coalesce(v_os->>k, ''));
    v_n := btrim(coalesce(v_ns->>k, ''));
    if v_o <> '' and v_n = '' then
      -- zdjęcie „wstrzymane” to nie cofnięcie pracy — Excel może potem uzupełnić etap
      if v_uid is not null and upper(v_o) not like '#WS%' then
        insert into public.excel_cofniete_etapy as c (rodzaj, obiekt_id, etap, bylo, kto, kiedy)
        values (v_rodzaj, new.id, k, v_o, v_uid, now())
        on conflict (rodzaj, obiekt_id, etap) do update
          set bylo = excluded.bylo, kto = excluded.kto, kiedy = excluded.kiedy, excel = null, excel_od = null;
      end if;
    elsif v_n <> '' and v_o = '' then
      delete from public.excel_cofniete_etapy where rodzaj = v_rodzaj and obiekt_id = new.id and etap = k;
    end if;
  end loop;

  if tg_table_name = 'complaints' then
    v_o := btrim(coalesce(old.release_date::text, ''));
    v_n := btrim(coalesce(new.release_date::text, ''));
    if v_o <> '' and v_n = '' then
      if v_uid is not null then
        insert into public.excel_cofniete_etapy as c (rodzaj, obiekt_id, etap, bylo, kto, kiedy)
        values (v_rodzaj, new.id, 'wydanie', v_o, v_uid, now())
        on conflict (rodzaj, obiekt_id, etap) do update
          set bylo = excluded.bylo, kto = excluded.kto, kiedy = excluded.kiedy, excel = null, excel_od = null;
      end if;
    elsif v_n <> '' and v_o = '' then
      delete from public.excel_cofniete_etapy where rodzaj = v_rodzaj and obiekt_id = new.id and etap = 'wydanie';
    end if;
  end if;
  return null;
end;
$function$;
revoke all on function public.excel_cofniete_etapy_trg() from public, anon, authenticated;

drop trigger if exists trg_excel_cofniete_etapy on public.orders;
create trigger trg_excel_cofniete_etapy
  after update of production_stages on public.orders
  for each row when (old.production_stages is distinct from new.production_stages)
  execute function public.excel_cofniete_etapy_trg();

drop trigger if exists trg_excel_cofniete_etapy on public.complaints;
create trigger trg_excel_cofniete_etapy
  after update of production_stages, release_date on public.complaints
  for each row when (old.production_stages is distinct from new.production_stages
                     or old.release_date is distinct from new.release_date)
  execute function public.excel_cofniete_etapy_trg();

-- 2) które etapy synchronizacja ma pominąć: p_excel = {klucz: wartość z Excela} (brak klucza / '' / '-' = pusta komórka)
create or replace function public.excel_cofniete_pomin(p_rodzaj text, p_id bigint, p_excel jsonb, p_zapis boolean)
 returns text[]
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  m record;
  v text;
  v_out text[] := '{}';
begin
  for m in
    select * from public.excel_cofniete_etapy
    where rodzaj = p_rodzaj and obiekt_id = p_id
    for update
  loop
    v := upper(btrim(coalesce(p_excel->>m.etap, '')));
    if v in ('-', '—') then v := ''; end if;
    if m.excel is null then
      -- pierwsza synchronizacja po cofnięciu: zapamiętaj stan Excela
      if p_zapis then
        update public.excel_cofniete_etapy set excel = v, excel_od = now()
        where rodzaj = m.rodzaj and obiekt_id = m.obiekt_id and etap = m.etap;
      end if;
      if v <> '' then v_out := v_out || m.etap; end if;
    elsif v = m.excel then
      if v <> '' then v_out := v_out || m.etap; end if;   -- Excel bez zmian → pomiń
    elsif v = '' then
      -- komórkę wyczyszczono: zapamiętaj pustą — ponowne wpisanie (nawet tych samych inicjałów) to już zmiana
      if p_zapis then
        update public.excel_cofniete_etapy set excel = '', excel_od = now()
        where rodzaj = m.rodzaj and obiekt_id = m.obiekt_id and etap = m.etap;
      end if;
    else
      -- wartość w Excelu się zmieniła → Excel znowu uzupełnia etap, wpis znika
      if p_zapis then
        delete from public.excel_cofniete_etapy
        where rodzaj = m.rodzaj and obiekt_id = m.obiekt_id and etap = m.etap;
      end if;
    end if;
  end loop;
  return v_out;
end;
$function$;
revoke all on function public.excel_cofniete_pomin(text, bigint, jsonb, boolean) from public, anon, authenticated;

-- 3) sync_stages_from_excel: definicja z produkcji (28.11) + pominięcie etapów cofniętych w programie
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

-- 4) sync_complaints_from_excel: te same wpisy dla reklamacji (etapy + realizacja), wstawki tekstowe
do $$
declare
  nl constant text := chr(10);
  d text;
  a1 text := '  v_existing_id bigint; v_run_id bigint; v_reason text; v_info text;' || nl;
  a2 text := '    select c.id into v_existing_id from public.complaints c where c.extra_fields->>''excel_nr'' = v_key limit 1;' || nl;
  a3 text := '''kategoria'', ''Reklamacje '' || p_category,';
begin
  d := replace(pg_get_functiondef('public.sync_complaints_from_excel(jsonb,text,text,boolean)'::regprocedure), chr(13), '');
  if position('D22/D64 (28.11), cofnięte w programie' in d) > 0 then
    raise notice 'sync_complaints_from_excel: już poprawione (D22/D64) — bez zmian';
    return;
  end if;
  if position(a1 in d) = 0 or position(a2 in d) = 0 or position(a3 in d) = 0 then
    raise exception 'sync_complaints_from_excel: nie znaleziono miejsca łatki D22/D64 — sprawdź definicję';
  end if;
  d := replace(d, a1, a1
    || '  v_pomin text[]; v_cof int := 0;  -- D22/D64 (28.11), cofnięte w programie' || nl);
  d := replace(d, a2, a2
    || '    -- D22/D64 (28.11): etap / realizacja cofnięte w programie nie wracają, dopóki komórka w Excelu się nie zmieni' || nl
    || '    if v_existing_id is not null then' || nl
    || '      v_pomin := public.excel_cofniete_pomin(''reklamacja'', v_existing_id,' || nl
    || '        r.etapy || jsonb_build_object(''wydanie'', coalesce(r.wydanie, case when v_stages ? ''mag'' then ''MAG:'' || (v_stages->>''mag'') end, '''')),' || nl
    || '        not p_dry_run);' || nl
    || '      if cardinality(v_pomin) > 0 then' || nl
    || '        v_cof := v_cof + cardinality(v_pomin);' || nl
    || '        v_stages := v_stages - v_pomin;' || nl
    || '        if ''wydanie'' = any(v_pomin) then v_release := null; end if;' || nl
    || '      end if;' || nl
    || '    end if;' || nl);
  d := replace(d, a3, a3 || ' ''pominiete_cofniete'', v_cof,');
  execute d;
end $$;
