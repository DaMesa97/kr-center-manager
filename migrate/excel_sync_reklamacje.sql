-- =====================================================================
-- Reklamacje z Excela → aplikacja (Tymek 19.11.2026: „dołącz” do nocnej synchronizacji).
-- Jedna strona: Excel → complaints. Każdy skoroszyt (STA / Disting / ST / Bastion) ma arkusz
-- „Reklamacje” o własnym układzie kolumn; funkcja brzegowa excel-sync czyta go po nagłówkach
-- i woła to RPC z ujednoliconymi wierszami. Zasady:
--  * klucz importu: extra_fields.excel_nr = '<kategoria>/<nr reklamacji w arkuszu>' — tylko takie
--    reklamacje są aktualizowane przez sync; reklamacje założone w aplikacji (RK/…) nietknięte;
--  * numer importowanej reklamacji: XL/<kategoria>/<nr z arkusza> (RK/… zostaje dla aplikacji);
--  * zlecenie dopasowane po numerze (+ wykonawca Center/Profil/WZ, gdy arkusz go ma) w tej kategorii,
--    najnowsze z datą zamówienia nie późniejszą niż reklamacja; dane drzwi kopiowane ze zlecenia,
--    a gdy nie ma dopasowania — z arkusza;
--  * etapy naprawy (CNC / OŚC / SKR / MON / MAG) z kolumn arkusza, WYDANIE → release_date;
--    sam MAGAZYN bez wydania → release_date = dzień synchronizacji (szacunkowa, jak przy zleceniach);
--  * zakres: reklamacje z datą nie starszą niż 365 dni; starsze zostają tylko w Excelu;
--  * powiadomienia „Nowa reklamacja” (trg_notify_complaint) wyłączone na czas importu.
-- Log: excel_sync_runs (summary.kategoria = 'Reklamacje <kat>').
-- =====================================================================
create or replace function public.sync_complaints_from_excel(
  p_rows jsonb,
  p_category text,
  p_source text default 'excel',
  p_dry_run boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  o record;
  v_cutoff date := current_date - 365;
  v_today date := (now() at time zone 'Europe/Warsaw')::date;
  v_pair bigint;
  v_new int := 0; v_upd int := 0; v_skip int := 0; v_nomatch int := 0; v_old int := 0;
  v_key text; v_num text; v_wyk text; v_release date; v_stages jsonb; v_what text; v_details jsonb := '[]'::jsonb;
  v_existing_id bigint; v_run_id bigint; v_reason text; v_info text;
begin
  if auth.role() <> 'service_role' and not public.current_user_is_manager() then
    raise exception 'Tylko kierownik / synchronizacja może importować reklamacje';
  end if;
  if p_category not in ('STA', 'Disting', 'ST', 'Bastion') then
    raise exception 'Nieobsługiwana kategoria reklamacji: %', p_category;
  end if;

  if not p_dry_run then
    alter table public.complaints disable trigger trg_notify_complaint;
  end if;

  for r in
    select
      nullif(btrim(coalesce(e->>'nr', '')), '') as nr,
      (nullif(e->>'data', ''))::date as data,
      upper(nullif(btrim(coalesce(e->>'wyk', '')), '')) as wyk,
      nullif(btrim(coalesce(e->>'nr_zlecenia', '')), '') as nr_zlecenia,
      nullif(btrim(coalesce(e->>'firma', '')), '') as firma,
      nullif(btrim(coalesce(e->>'co', '')), '') as co,
      nullif(btrim(coalesce(e->>'system', '')), '') as system,
      nullif(btrim(coalesce(e->>'model', '')), '') as model,
      nullif(btrim(coalesce(e->>'kolor', '')), '') as kolor,
      nullif(btrim(coalesce(e->>'kolor_osc', '')), '') as kolor_osc,
      nullif(btrim(coalesce(e->>'szer', '')), '') as szer,
      nullif(btrim(coalesce(e->>'kierunek', '')), '') as kierunek,
      nullif(btrim(coalesce(e->>'otwieranie', '')), '') as otwieranie,
      nullif(btrim(coalesce(e->>'wysokosc', '')), '') as wysokosc,
      greatest(1, coalesce(nullif(regexp_replace(coalesce(e->>'ilosc', ''), '[^0-9]', '', 'g'), '')::int, 1)) as ilosc,
      nullif(btrim(coalesce(e->>'powod', '')), '') as powod,
      nullif(btrim(coalesce(e->>'info', '')), '') as info,
      nullif(btrim(coalesce(e->>'wpisal', '')), '') as wpisal,
      coalesce(e->'etapy', '{}'::jsonb) as etapy,
      nullif(btrim(coalesce(e->>'wydanie', '')), '') as wydanie,
      (e->>'wiersz')::int as wiersz
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) e
  loop
    if r.nr is null or r.data is null then v_skip := v_skip + 1; continue; end if;
    if r.data < v_cutoff then v_old := v_old + 1; continue; end if;

    v_key := p_category || '/' || r.nr;
    v_num := 'XL/' || p_category || '/' || r.nr;
    -- wykonawca z arkusza: PA/PD = Profil, CA/CD = Center, WZ = WZ
    v_wyk := case
      when r.wyk in ('CENTER', 'CA', 'CD', 'KR') then 'Center'
      when r.wyk in ('PROFIL', 'PA', 'PD', 'MR') then 'Profil'
      when r.wyk = 'WZ' then 'WZ'
      else null end;
    v_what := case upper(translate(coalesce(r.co, ''), 'ŁŚĆŻŹĄĘŃÓ', 'LSCZZAENO'))
      when 'SKRZYDLO' then 'Skrzydło'
      when 'OSCIEZNICA' then 'Ościeżnica'
      when 'KOMPLET' then 'Komplet'
      else r.co end;
    -- etapy naprawy (wartość = inicjały / znacznik z arkusza), tylko niepuste i różne od „-”
    v_stages := (
      select coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
      from jsonb_each_text(r.etapy) as t(k, v)
      where k in ('cnc', 'osc', 'skr', 'mon', 'mag') and btrim(coalesce(v, '')) not in ('', '-')
    );
    v_release := null;
    if r.wydanie is not null then
      if r.wydanie ~ '^\d{4}-\d{2}-\d{2}' then v_release := r.wydanie::date;
      else v_release := v_today;  -- „X” / tekst = wydane bez daty (szacunkowa)
      end if;
    elsif v_stages ? 'mag' then
      v_release := v_today;
    end if;
    v_reason := coalesce(r.powod, r.info);
    v_info := case when r.powod is not null and r.info is not null and r.info <> r.powod then r.info else null end;

    -- zlecenie reklamowane: numer + kategoria (+ wykonawca, jeśli arkusz go podaje), nie późniejsze niż reklamacja
    select * into o from public.orders where false;  -- pusty rekord (o.id = null), nie „not assigned yet”
    if r.nr_zlecenia is not null then
      select * into o
      from public.orders x
      where x.category = p_category
        and btrim(x.order_number) = btrim(split_part(r.nr_zlecenia, '-', 1))
        and (v_wyk is null or coalesce(nullif(x.extra_fields->>'wykonawca', ''),
              case x.extra_fields->>'typ' when 'MR' then 'Profil' when 'PA' then 'Profil' when 'PD' then 'Profil'
                                          when 'KR' then 'Center' when 'CA' then 'Center' when 'CD' then 'Center'
                                          when 'WZ' then 'WZ' end, '') = v_wyk)
        and coalesce(x.extra_fields->>'cancelled', '') <> 'true'
        -- firma z arkusza musi się zgadzać z firmą zlecenia (numery zleceń powtarzają się między latami)
        and (r.firma is null or upper(x.company) like upper(split_part(r.firma, ' ', 1)) || '%'
             or upper(r.firma) like upper(split_part(x.company, ' ', 1)) || '%')
      order by (x.order_date <= r.data) desc, x.order_date desc
      limit 1;
    end if;
    -- Disting Plus w arkuszu STA (Tymek 23.11): numer w arkuszu to zlecenie Disting; reklamacja skrzydła zostaje pod STA
    -- i dopina się do nogi STA pary (gdy para istnieje), inaczej do samego zlecenia Disting. Ościeżnica = arkusz Disting, pod Disting.
    if o.id is null and p_category = 'STA' and r.nr_zlecenia is not null and upper(coalesce(r.system, '')) like '%DISTING PLUS%' then
      select * into o
      from public.orders x
      where x.category = 'Disting'
        and btrim(x.order_number) = btrim(split_part(r.nr_zlecenia, '-', 1))
        and coalesce(x.extra_fields->>'cancelled', '') <> 'true'
        and (r.firma is null or upper(x.company) like upper(split_part(r.firma, ' ', 1)) || '%'
             or upper(r.firma) like upper(split_part(x.company, ' ', 1)) || '%')
      order by (x.order_date <= r.data) desc, x.order_date desc
      limit 1;
      v_pair := o.linked_order_id;
      if v_pair is not null then
        select * into o from public.orders x where x.id = v_pair;
      end if;
    end if;
    if o.id is null then v_nomatch := v_nomatch + 1; end if;

    select c.id into v_existing_id from public.complaints c where c.extra_fields->>'excel_nr' = v_key limit 1;

    if p_dry_run then
      v_details := v_details || jsonb_build_object('nr', r.nr, 'data', r.data, 'zlecenie', r.nr_zlecenia, 'order_id', o.id,
        'istnieje', v_existing_id, 'numer', v_num, 'co', v_what, 'wydanie', v_release, 'etapy', v_stages);
      if v_existing_id is null then v_new := v_new + 1; else v_upd := v_upd + 1; end if;
      continue;
    end if;

    if v_existing_id is null then
      insert into public.complaints (
        complaint_number, complaint_date, category, order_id, order_number, company, what_complained,
        system, model, color, wing_color, frame_color, width, direction, opening, height, reason, info, created_by,
        production_stages, release_date, order_date, production_day, quantity, sequence, threshold_color, glazing,
        decorative_panel, hardware, handle, electric_strike, peephole, top_light, top_light_glazing, side_panel,
        side_panel_glazing, extension, client_order_number, notes, defects, airtable_id, extra_fields
      ) values (
        v_num, r.data, p_category, o.id, coalesce(o.order_number, r.nr_zlecenia, ''), coalesce(o.company, r.firma, ''), v_what,
        coalesce(o.system, r.system, ''), coalesce(o.model, r.model, ''), coalesce(o.wing_color, r.kolor, ''),
        coalesce(o.wing_color, r.kolor, ''), coalesce(o.frame_color, r.kolor_osc, ''), coalesce(o.width, r.szer, ''),
        coalesce(o.direction, r.kierunek, ''), coalesce(o.opening, r.otwieranie, ''), coalesce(o.height, r.wysokosc, ''),
        v_reason, coalesce(v_info, ''), coalesce(r.wpisal, 'EXCEL'),
        v_stages, v_release::text, coalesce(o.order_date::text, ''), coalesce(o.production_day::text, ''), coalesce(o.quantity, r.ilosc),
        coalesce(o.sequence, ''), coalesce(o.threshold_color, ''), coalesce(o.glazing, ''), coalesce(o.decorative_panel, ''),
        coalesce(o.hardware, ''), coalesce(o.handle, ''), coalesce(o.electric_strike, ''), coalesce(o.peephole, ''),
        coalesce(o.top_light, ''), coalesce(o.top_light_glazing, ''), coalesce(o.side_panel, ''), coalesce(o.side_panel_glazing, ''),
        coalesce(o.extension, ''), coalesce(o.client_order_number, ''), coalesce(o.notes, ''), coalesce(o.defects, ''),
        coalesce(o.airtable_id, ''),
        jsonb_build_object('excel_nr', v_key, 'excel_wiersz', r.wiersz, 'excel_wyk', r.wyk, 'excel_firma', r.firma, 'excel_zrodlo', p_source,
                           'excel_import_at', now(), 'source', 'excel')
      );
      v_new := v_new + 1;
    else
      -- Excel wygrywa dla wierszy z Excela: powód, co reklamowane, etapy, wydanie, kto wpisał, (dopięcie zlecenia, jeśli wcześniej brak)
      update public.complaints c set
        complaint_date = r.data,
        what_complained = coalesce(v_what, c.what_complained),
        reason = coalesce(v_reason, c.reason),
        info = coalesce(v_info, c.info),
        created_by = coalesce(r.wpisal, c.created_by),
        production_stages = case when v_stages <> '{}'::jsonb then v_stages else c.production_stages end,
        release_date = coalesce(c.release_date, v_release::text),
        order_id = coalesce(c.order_id, o.id),
        order_number = case when c.order_id is null and o.id is not null then o.order_number else c.order_number end,
        company = case when c.order_id is null and o.id is not null then o.company else c.company end,
        extra_fields = coalesce(c.extra_fields, '{}'::jsonb) || jsonb_build_object('excel_wiersz', r.wiersz, 'excel_sync_at', now())
      where c.id = v_existing_id
        and (c.complaint_date is distinct from r.data
             or c.reason is distinct from coalesce(v_reason, c.reason)
             or c.what_complained is distinct from coalesce(v_what, c.what_complained)
             or (v_stages <> '{}'::jsonb and c.production_stages is distinct from v_stages)
             or (c.release_date is null and v_release is not null)
             or (c.order_id is null and o.id is not null));
      if found then v_upd := v_upd + 1; end if;
    end if;
  end loop;

  if not p_dry_run then
    alter table public.complaints enable trigger trg_notify_complaint;
  end if;

  insert into public.excel_sync_runs (source, dry_run, rows_in, summary, details)
  values (p_source, p_dry_run, jsonb_array_length(coalesce(p_rows, '[]'::jsonb)),
          jsonb_build_object('kategoria', 'Reklamacje ' || p_category, 'nowe', v_new, 'zaktualizowane', v_upd,
                             'bez_zlecenia', v_nomatch, 'pominiete', v_skip, 'starsze_niz_rok', v_old),
          v_details)
  returning id into v_run_id;

  return jsonb_build_object('run_id', v_run_id, 'summary', jsonb_build_object('kategoria', 'Reklamacje ' || p_category,
    'nowe', v_new, 'zaktualizowane', v_upd, 'bez_zlecenia', v_nomatch, 'pominiete', v_skip, 'starsze_niz_rok', v_old));
exception when others then
  if not p_dry_run then
    begin alter table public.complaints enable trigger trg_notify_complaint; exception when others then null; end;
  end if;
  raise;
end;
$$;

revoke all on function public.sync_complaints_from_excel(jsonb, text, text, boolean) from public, anon;
grant execute on function public.sync_complaints_from_excel(jsonb, text, text, boolean) to service_role, authenticated;
