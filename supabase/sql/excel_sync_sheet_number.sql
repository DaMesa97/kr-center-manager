-- =====================================================================
-- excel_sync_sheet_number.sql — Tymek 13.11.2026 („rób 2 i 3", zgłoszenie #119)
--
-- Synchronizacja z Excela (Make 20:00 → excel-sync → ta funkcja) zapisuje przy każdym
-- dopasowanym OTWARTYM zleceniu aktualny numer jego wiersza w arkuszu:
--   extra_fields.sheet_number        — numer z kolumny NR. ZLECENIA / NUMER ZLECENIA
--   extra_fields.sheet_number_sheet  — Center / Profil / WZ (który arkusz)
--   extra_fields.sheet_number_at     — kiedy numer ostatnio się zmienił (albo pierwszy zapis)
-- Zapis tylko gdy numer się zmienił (bez codziennego mielenia audytu) i nigdy dla wierszy
-- z dwoma kandydatami („duplikat"). Aplikacja pokazuje numer jako szarą plakietkę „ark. N"
-- obok numeru zlecenia, gdy różni się od numeru w aplikacji.
--
-- Dopasowanie po numerze arkusza (m1) bierze też ostatni znany numer (sheet_number), więc po
-- przesunięciu wierszy w arkuszu zlecenie dopasowane raz po Airtable ID / nr klienta nie gubi
-- się przy kolejnej synchronizacji.
--
-- order_number NIE jest zmieniany — decyzja Tymka 13.11: dla hali wiążący jest numer z aplikacji.
-- Reszta funkcji (zamykanie wydań, rozchód/anulowanie rezerwacji, TITAN) bez zmian.
-- =====================================================================

create or replace function public.sync_releases_from_excel__impl(p_rows jsonb, p_dry_run boolean default true, p_source text default null::text, p_category text default 'STA'::text)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_details jsonb; v_summary jsonb; v_run_id bigint;
  v_closed int := 0; v_cancelled int := 0; v_consumed int := 0; v_sheetnr int := 0; v_n int; r record;
  v_consume boolean := current_date >= coalesce((select value::date from integration_settings where key = 'excel_sync_rozchod_od'), '2999-01-01'::date);
begin
  if p_category not in ('STA','Disting','ST','Techniczne','Bastion','STA_TITAN','ST_TITAN') then
    raise exception 'Nieobsługiwana kategoria: %', p_category;
  end if;

  with x as (
    -- sheet: Center/Profil/WZ albo '*' (dowolny wykonawca, np. arkusz techniczny)
    select row_number() over () rn, s.sheet, trim(s.nr) nr,
           nullif(trim(s.wydanie),'') wyd, coalesce(s.szac, false) szac, nullif(trim(s.airtable_id),'') at,
           _xs_norm(s.model) nmodel, left(_xs_norm(s.firma),5) nfirma, _xs_norm(s.client_no) nclient
    from jsonb_to_recordset(p_rows) as s(sheet text, nr text, firma text, model text, wydanie text, airtable_id text, client_no text, szac boolean)
    where nullif(trim(s.nr),'') is not null
  ),
  o as (
    select id, order_number, category, company, model, order_date, (release_date is null) is_open,
           coalesce(airtable_id,'') airtable_id,
           coalesce(nullif(extra_fields->>'wykonawca',''),
                    case extra_fields->>'typ' when 'MR' then 'Profil' when 'PA' then 'Profil' when 'PD' then 'Profil'
                                              when 'KR' then 'Center' when 'CA' then 'Center' when 'CD' then 'Center'
                                              when 'WZ' then 'WZ' end, '') wyk,
           coalesce(nullif(extra_fields->>'sheet_number_conflict',''), order_number) sheetnr,
           -- ostatni numer z arkusza zapisany przez poprzednią synchronizację (#119)
           nullif(extra_fields->>'sheet_number','') sheetnr_latest,
           _xs_norm(model) nmodel, left(_xs_norm(company),5) nfirma, _xs_norm(client_order_number) nclient
    from orders
    where ((p_category in ('STA','Disting','ST','Techniczne','Bastion') and category = p_category and coalesce(model,'') not ilike 'G-%')
           or (p_category = 'STA_TITAN' and model ilike 'G-%' and coalesce(extra_fields->>'titan_role', category) = 'STA')
           or (p_category = 'ST_TITAN'  and model ilike 'G-%' and coalesce(extra_fields->>'titan_role', category) = 'ST'))
      and (release_date is null or order_date >= current_date - 365)
      and coalesce(extra_fields->>'cancelled','') <> 'true'
  ),
  m1 as (select o.id oid, x.rn, 'numer arkusza'::text how from o join x
           on (x.sheet = o.wyk or x.sheet = '*') and (x.nr = o.sheetnr or x.nr = o.sheetnr_latest) and x.nmodel = o.nmodel and x.nfirma = o.nfirma),
  m2 as (select o.id oid, x.rn, 'airtable'::text how from o join x on o.airtable_id <> '' and x.at = o.airtable_id
         where o.id not in (select oid from m1)
           -- wiersz już przypisany po numerze arkusza: przejęcie po airtable tylko gdy ten sam klient (= prawdziwy duplikat)
           and (x.rn not in (select rn from m1) or o.nclient = x.nclient or length(o.nclient) < 3 or length(x.nclient) < 3)),
  m3 as (select o.id oid, min(x.rn) rn, 'nr klienta + model'::text how from o join x
           on length(o.nclient) >= 3 and x.nclient = o.nclient and x.nmodel = o.nmodel
         where o.id not in (select oid from m1) and o.id not in (select oid from m2)
         group by o.id having count(*) = 1),
  m as (select distinct on (oid) * from (select * from m1 union all select * from m2 union all select * from m3) u order by oid, rn),
  dup as (select rn from m group by rn having count(*) > 1),
  res as (
    select o.id, o.order_number, o.category, o.company, o.model, o.order_date,
           x.sheet || ' ' || x.nr as excel_row, x.nr as nr_arkusza, x.sheet as arkusz_wyk, m.how, x.wyd as wydanie, x.szac as data_szacunkowa,
           case when m.rn in (select rn from dup) then 'duplikat'
                when x.wyd ~ '^\d{4}-\d{2}-\d{2}$' and x.wyd::date >= o.order_date and x.wyd::date <= current_date then 'do_zamkniecia'
                when upper(x.wyd) like 'ANUL%' then 'anulowane_w_excelu'
                when x.wyd is null then 'w_realizacji'
                else 'inne' end as status,
           (select jsonb_agg(m2x.oid) from m m2x where m2x.rn = m.rn and m2x.oid <> o.id) as powiazane_id
    from m join o on o.id = m.oid join x on x.rn = m.rn
    where o.is_open
  )
  select coalesce(jsonb_agg(to_jsonb(res) order by res.status, res.excel_row, res.id), '[]'::jsonb) into v_details from res;

  if not p_dry_run then
    for r in select (e->>'id')::bigint id, (e->>'wydanie')::date wyd, coalesce((e->>'data_szacunkowa')::boolean, false) szac
             from jsonb_array_elements(v_details) e where e->>'status' = 'do_zamkniecia'
    loop
      update orders set release_date = r.wyd,
                        bastion_completed = case when category = 'Bastion' then true else bastion_completed end,
                        extra_fields = case when r.szac then coalesce(extra_fields,'{}'::jsonb)
                                         || jsonb_build_object('release_date_szacunkowa', true, 'release_date_zrodlo', 'excel-sync: znacznik bez daty')
                                         else extra_fields end
      where id = r.id and release_date is null;
      get diagnostics v_n = row_count;
      if v_n > 0 and p_category = 'ST_TITAN' then
        declare g record;
        begin
          for g in
            update orders t set release_date = r.wyd,
                   bastion_completed = true,
                   extra_fields = coalesce(t.extra_fields,'{}'::jsonb) || jsonb_build_object('release_date_zrodlo', 'excel-sync: wydanie TITAN (rola ST)')
            where t.extra_fields->>'titan_role' = 'Bastion' and t.release_date is null
              and coalesce(t.extra_fields->>'cancelled','') <> 'true'
              and t.extra_fields->>'titan_group' = (select s.extra_fields->>'titan_group' from orders s where s.id = r.id)
            returning t.id
          loop
            v_closed := v_closed + 1;
            if v_consume then
              select v_consumed + count(*) into v_consumed from public.release_remaining_for_order(g.id, true) x where x.r_status = 'released';
            else
              v_cancelled := v_cancelled + public.cancel_order_reservations__impl(g.id, 'manual');
            end if;
          end loop;
        end;
      end if;
      if v_n > 0 then
        v_closed := v_closed + 1;
        if v_consume then
          -- wydanie końcowe jak w aplikacji: WZ + zdjęcie ze stanu (wymuszone, bo produkcja już zużyła materiał)
          select v_consumed + count(*) into v_consumed
          from public.release_remaining_for_order(r.id, true) x where x.r_status = 'released';
        else
          v_cancelled := v_cancelled + public.cancel_order_reservations__impl(r.id, 'manual');
        end if;
      end if;
    end loop;

    -- #119: aktualny numer wiersza w arkuszu → extra_fields dopasowanego zlecenia
    -- (tylko gdy się zmienił; wiersze z dwoma kandydatami pomijamy)
    with upd as (
      update orders o
         set extra_fields = coalesce(o.extra_fields,'{}'::jsonb)
             || jsonb_build_object('sheet_number', e->>'nr_arkusza',
                                   'sheet_number_sheet', e->>'arkusz_wyk',
                                   'sheet_number_at', now())
        from jsonb_array_elements(v_details) e
       where o.id = (e->>'id')::bigint
         and e->>'status' <> 'duplikat'
         and nullif(e->>'nr_arkusza','') is not null
         and coalesce(o.extra_fields->>'sheet_number','') <> e->>'nr_arkusza'
      returning o.id
    )
    select count(*) into v_sheetnr from upd;
  end if;

  select jsonb_build_object(
    'kategoria', p_category,
    'do_zamkniecia', count(*) filter (where e->>'status'='do_zamkniecia'),
    'duplikat', count(*) filter (where e->>'status'='duplikat'),
    'anulowane_w_excelu', count(*) filter (where e->>'status'='anulowane_w_excelu'),
    'inne', count(*) filter (where e->>'status'='inne'),
    'w_realizacji', count(*) filter (where e->>'status'='w_realizacji'),
    'zamknieto', v_closed,
    'anulowano_rezerwacji', v_cancelled,
    'rozchodowano_pozycji', v_consumed,
    'nr_arkusza_zapisano', v_sheetnr,
    'tryb_rezerwacji', case when v_consume then 'rozchod' else 'anulowanie' end)
  into v_summary from jsonb_array_elements(v_details) e;

  -- log zawiera wszystkie dopasowania (także w_realizacji) — do diagnostyki i widoku w aplikacji

  insert into excel_sync_runs (source, dry_run, rows_in, summary, details)
  values (p_source, p_dry_run, jsonb_array_length(p_rows), v_summary, v_details)
  returning id into v_run_id;

  return jsonb_build_object('run_id', v_run_id, 'dry_run', p_dry_run, 'summary', v_summary, 'items', v_details);
end;
$function$;
