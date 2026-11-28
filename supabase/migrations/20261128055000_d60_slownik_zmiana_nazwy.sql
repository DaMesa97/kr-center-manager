-- 28.11.2026 — decyzja D60 (właściciel: „ROBIMY A, ZMIANA NAZWY MUSI AKTUALIZOWAĆ TEŻ RECEPTURY”).
-- Problem: zmiana nazwy wartości słownika (config_options) to był zwykły UPDATE — wykluczenia konfiguratora, reguły
-- Bastion, receptury magazynu, przypisania magazynów i mapa wymiarów dalej wskazywały starą nazwę (dziś 90 martwych
-- wykluczeń w STA po zmianach LINEA 170 → 160 i wysokości „…1 mm” → „…0 mm”).
--
-- 1) public.config_option_rename(p_id, p_nowa, p_tylko_podglad) — JEDNA funkcja bazy zmienia nazwę i przenosi ją
--    wszędzie, gdzie wartość jest użyta (to samo pojęcie „użycia” co config_option_usage, 20261128010200; porównanie
--    _recipe_norm: wielkość liter, polskie znaki, spacje; elementy „a|b” dzielone po „|”):
--      - config_options.value                           — nowa nazwa;
--      - config_exclusions (pole źródłowe i docelowe)   — stara → nowa; powstałe duplikaty wykluczeń są usuwane;
--      - bastion_rules: wartość docelowa (tryb set / set_if_empty) — stara → nowa;
--                       warunki (when_system / when_width / when_frame / when_target_not_in) — nowa DOPISANA obok
--                       starej (reguły działają przy wstawianiu zleceń z bota / Excela, które mogą dalej pisać starą);
--      - warehouse_recipe_criteria.allowed_values i stare kolumny warehouse_recipes (system, model, kolory, szerokość…);
--      - warehouse_assignment.system (typ „system”) i dimension_map.dimension_code (typ „rozmiar”).
--    ZAMÓWIENIA (orders, orders_archive, bastion_extras) NIE są zmieniane — ani historyczne, ani otwarte:
--      - historia ma zostać taka, jak była wyprodukowana i wydana;
--      - synchronizacja Excela dopasowuje OTWARTE zlecenia po numerze arkusza + MODELU + firmie
--        (sync_releases_from_excel__impl) — zmiana modelu w otwartych zleceniach odcięłaby je od zamknięcia z Excela;
--      - zlecenia przychodzą z bota / Excela / Baselinkera słowami klienta.
--    Żeby otwarte zlecenia ze starą nazwą dalej działały, w recepturach, przypisaniach magazynów i mapie wymiarów
--    stara nazwa ZOSTAJE obok nowej, dopóki choć jedno otwarte zlecenie (bez daty wydania, nieanulowane) jej używa;
--    gdy żadne — stara jest zastępowana nową. Podgląd mówi, który wariant zajdzie.
--    Blokada: ościeżnica Bastion — aplikacja dopasowuje opcję do zlecenia przez ZAWIERANIE nazwy
--    („DREWNIANA REGULOWANA” ⊃ „REGULOWANA”), z niej bierze flagę partii i mnożnik etykiet. Jeśli otwarte zlecenia
--    straciłyby dopasowanie (dziś REGULOWANA: 117), zmiana jest zablokowana: dodaj nową wartość, a starą zostaw
--    do wydania tych zleceń.
--    p_tylko_podglad = true (domyślnie): wykonuje wszystko w podtransakcji i ją cofa — zwraca DOKŁADNIE te liczby,
--    które da prawdziwa zmiana (okno w aplikacji pokazuje je przed potwierdzeniem).
--    Audyt: wpis zbiorczy w audit_log (table_name 'config_options_zmiana_nazwy', stara / nowa nazwa i liczby) oraz
--    wpisy wierszowe istniejących triggerów (config_options, config_exclusions, warehouse_recipes) i nowych
--    (bastion_rules, warehouse_recipe_criteria, warehouse_assignment).
--    Uprawnienia: jak edycja słownika (current_user_is_manager) albo serwis (SQL Editor).
-- 2) Trigger config_options_guard_rename: zwykły UPDATE value używanej wartości (stara wersja aplikacji, API) jest
--    odrzucany z listą miejsc użycia — zmiana nazwy tylko przez funkcję z p. 1. Zmiana samej wielkości liter / spacji
--    / polskich znaków (_recipe_norm bez zmian) przechodzi — nie zrywa dopasowań.
-- 3) Unikalność: indeks unikalny (category, type, _recipe_norm(value)). Sprawdzone 28.11: 708 wartości, 0 duplikatów
--    (także po normalizacji). _recipe_norm jest IMMUTABLE.
-- Nie zależy od niewgranych plików (config_option_usage i _recipe_norm są na produkcji).
-- Plik można uruchamiać wielokrotnie. DO WDROŻENIA (nie wgrane).

-- ---------------------------------------------------------------------------------------------------------------
-- pomocnicze: kolumny zamówienia dla (kategoria, typ) — jak w config_option_usage
create or replace function public._slownik_kolumny(p_category text, p_type text)
 returns text[]
 language plpgsql
 stable
 set search_path to 'public'
as $function$
declare
  v_cols text[];
begin
  v_cols := case p_type
    when 'system'            then array['system']
    when 'model'             then array['model']
    when 'kolor'             then array['wing_color']
    when 'kolor_oscieznicy'  then array['frame_color']
    when 'kolor_progu'       then array['threshold_color']
    when 'prog'              then array['prog', 'threshold_color']
    when 'rozmiar'           then array['width']
    when 'wysokosc'          then array['height']
    when 'szklenie'          then array['glazing']
    when 'szklenie_dostawki' then array['top_light_glazing', 'side_panel_glazing', 'side_panel_a_glazing', 'side_panel_b_glazing']
    when 'wizjer'            then array['peephole']
    when 'okucia'            then array['hardware']
    when 'pochwyt'           then array['handle']
    when 'oslonki'           then array['oslonki']
    when 'samozamykacz'      then array['samozamykacz']
    when 'zaczep'            then array['zaczep']
    when 'panel'             then array['decorative_panel']
    when 'oscieznica'        then array['bastion_frame_type']
    when 'zakres'            then array['bastion_frame_range']
    when 'kolekcja'          then array['bastion_collection']
    when 'wentylacja'        then array['wentylacja']
    else array[]::text[]
  end;
  -- kolor ościeżnicy ze słownika 'kolor', gdy kategoria nie ma 'kolor_oscieznicy' (jak config_option_usage)
  if p_type = 'kolor' and not exists (
       select 1 from public.config_options o where o.category = p_category and o.type = 'kolor_oscieznicy') then
    v_cols := v_cols || array['frame_color'];
  end if;
  return v_cols;
end;
$function$;

-- pomocnicze: lista „a|b|c” — element równy (po _recipe_norm) staremu: zastąp nowym albo (p_zostaw) dopisz nowy
create or replace function public._slownik_podmien_liste(p_tekst text, p_stara_norm text, p_nowa text, p_zostaw boolean)
 returns text
 language plpgsql
 immutable
 set search_path to 'public'
as $function$
declare
  v_el text[];
  v_wynik text[] := array[]::text[];
  v_widziane text[] := array[]::text[];
  e text;
begin
  if p_tekst is null or p_stara_norm is null or p_stara_norm = '' then
    return p_tekst;
  end if;
  v_el := string_to_array(p_tekst, '|');
  if not exists (select 1 from unnest(v_el) x where public._recipe_norm(x) = p_stara_norm) then
    return p_tekst;
  end if;
  if p_zostaw then
    if exists (select 1 from unnest(v_el) x where public._recipe_norm(x) = public._recipe_norm(p_nowa)) then
      return p_tekst;
    end if;
    return p_tekst || '|' || p_nowa;
  end if;
  foreach e in array v_el loop
    if public._recipe_norm(e) = p_stara_norm then
      e := p_nowa;
    end if;
    if not (public._recipe_norm(e) = any (v_widziane)) then
      v_wynik := v_wynik || e;
      v_widziane := v_widziane || public._recipe_norm(e);
    end if;
  end loop;
  return array_to_string(v_wynik, '|');
end;
$function$;

-- pomocnicze: tablica wartości (element może mieć „a|b”) — jak wyżej
create or replace function public._slownik_podmien_tablice(p_tab text[], p_stara_norm text, p_nowa text, p_zostaw boolean)
 returns text[]
 language plpgsql
 immutable
 set search_path to 'public'
as $function$
declare
  v_wynik text[] := array[]::text[];
  v_widziane text[] := array[]::text[];
  e text;
begin
  if p_tab is null or p_stara_norm is null or p_stara_norm = '' then
    return p_tab;
  end if;
  if not exists (
       select 1 from unnest(p_tab) a(v) cross join lateral regexp_split_to_table(a.v, '\|') s(v)
       where public._recipe_norm(s.v) = p_stara_norm) then
    return p_tab;
  end if;
  if p_zostaw then
    if exists (
         select 1 from unnest(p_tab) a(v) cross join lateral regexp_split_to_table(a.v, '\|') s(v)
         where public._recipe_norm(s.v) = public._recipe_norm(p_nowa)) then
      return p_tab;
    end if;
    return p_tab || p_nowa;
  end if;
  foreach e in array p_tab loop
    e := public._slownik_podmien_liste(e, p_stara_norm, p_nowa, false);
    if not (public._recipe_norm(e) = any (v_widziane)) then
      v_wynik := v_wynik || e;
      v_widziane := v_widziane || public._recipe_norm(e);
    end if;
  end loop;
  return v_wynik;
end;
$function$;

-- pomocnicze: nazwa ościeżnicy jak normalizeBastionFrameName w aplikacji (kropki / przecinki → spacje)
create or replace function public._bastion_rama_norm(t text)
 returns text
 language sql
 immutable
 set search_path to 'public'
as $function$
  select trim(regexp_replace(public._recipe_norm(regexp_replace(coalesce(t, ''), '[.,]', ' ', 'g')), '\s+', ' ', 'g'))
$function$;

revoke all on function public._slownik_kolumny(text, text) from public, anon;
revoke all on function public._slownik_podmien_liste(text, text, text, boolean) from public, anon;
revoke all on function public._slownik_podmien_tablice(text[], text, text, boolean) from public, anon;
revoke all on function public._bastion_rama_norm(text) from public, anon;
grant execute on function public._slownik_kolumny(text, text) to authenticated, service_role;
grant execute on function public._slownik_podmien_liste(text, text, text, boolean) to authenticated, service_role;
grant execute on function public._slownik_podmien_tablice(text[], text, text, boolean) to authenticated, service_role;
grant execute on function public._bastion_rama_norm(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.config_option_rename(p_id bigint, p_nowa text, p_tylko_podglad boolean default true)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  r          public.config_options%rowtype;
  v_nowa     text := trim(coalesce(p_nowa, ''));
  v_norm     text;
  v_cat      text;
  v_cats     text[];
  v_cols     text[];
  v_where    text;
  v_otwarte  integer := 0;
  v_wszystkie integer := 0;
  v_archiwum integer := 0;
  v_zostaw   boolean;
  v_blokada  text;
  v_utrata   integer := 0;
  v_excl     integer := 0;
  v_excl_dup integer := 0;
  v_excl_ids bigint[];
  v_rules    integer := 0;
  v_kryt     integer := 0;
  v_rec_ids  bigint[] := array[]::bigint[];
  v_rec_kol  integer := 0;
  v_wa       integer := 0;
  v_dim      integer := 0;
  v_n        integer;
  v_col      text;
  v_ids      bigint[];
  v_email    text;
  v_wynik    jsonb;
begin
  if not (session_user = 'postgres' and auth.uid() is null) and not public.current_user_is_manager() then
    raise exception 'Zmieniać nazwy w słowniku może tylko kierownik.' using errcode = '42501';
  end if;

  select * into r from public.config_options where id = p_id for update;
  if not found then
    raise exception 'Nie ma takiej wartości w słowniku (id %) — odśwież listę.', p_id using errcode = 'P0405';
  end if;
  if v_nowa = '' then
    raise exception 'Podaj nową nazwę.' using errcode = 'P0405';
  end if;
  if v_nowa = r.value then
    return jsonb_build_object('podglad', p_tylko_podglad, 'zmieniono', false, 'stara', r.value, 'nowa', v_nowa,
                              'kategoria', r.category, 'typ', r.type, 'blokada', null, 'bez_zmian', true);
  end if;
  if exists (select 1 from public.config_options o
             where o.category = r.category and o.type = r.type and o.id <> r.id
               and public._recipe_norm(o.value) = public._recipe_norm(v_nowa)) then
    raise exception 'W słowniku (% / %) jest już wartość „%” — dwóch takich samych nie łączymy. Wybierz inną nazwę albo zostaw obie.',
      r.category, r.type, v_nowa using errcode = 'P0405';
  end if;

  v_norm := public._recipe_norm(r.value);
  v_cat  := case when r.category = 'Wewnetrzne' then 'DrzwiWewnetrzne' else r.category end;
  v_cats := array[r.category, v_cat];
  v_cols := public._slownik_kolumny(r.category, r.type);

  -- zamówienia: ile używa starej nazwy (wszystkie / otwarte) — warunek jak w config_option_usage
  if r.category = 'Bastion' and r.type = 'reszta' then
    select count(*) into v_wszystkie from public.bastion_extras where lower(trim(description)) = lower(trim(r.value));
  else
    select string_agg(format('lower(trim(%I::text)) = %L', c, lower(trim(r.value))), ' or ')
      into v_where from unnest(v_cols) as c;
    v_where := concat_ws(' or ', v_where, format('lower(trim(extra_fields->>%L)) = %L', r.type, lower(trim(r.value))));
    if r.category = 'Bastion' and r.type = 'oscieznica' then
      v_where := concat_ws(' or ', v_where,
        format('lower(bastion_frame_type) like %L', '%' || lower(trim(r.value)) || '%'),
        format('lower(extra_fields->>''oscieznica_typ'') like %L', '%' || lower(trim(r.value)) || '%'));
    end if;
    execute format('select count(*), count(*) filter (where release_date is null and coalesce(extra_fields->>''cancelled'', '''') <> ''true'')
                    from public.orders where category = %L and (%s)', v_cat, v_where)
      into v_wszystkie, v_otwarte;
    execute format('select count(*) from public.orders_archive where category = %L and (%s)', v_cat, v_where)
      into v_archiwum;
  end if;
  v_zostaw := v_otwarte > 0;

  -- ościeżnica Bastion: otwarte zlecenia nie mogą stracić dopasowania (flaga partii, mnożnik etykiet)
  if r.category = 'Bastion' and r.type = 'oscieznica' then
    select count(*) into v_utrata
    from public.orders o
    where o.category = 'Bastion'
      and o.release_date is null and coalesce(o.extra_fields->>'cancelled', '') <> 'true'
      and position(public._bastion_rama_norm(r.value)
                   in public._bastion_rama_norm(coalesce(nullif(o.bastion_frame_type, ''), o.extra_fields->>'oscieznica_typ'))) > 0
      and position(public._bastion_rama_norm(v_nowa)
                   in public._bastion_rama_norm(coalesce(nullif(o.bastion_frame_type, ''), o.extra_fields->>'oscieznica_typ'))) = 0;
    if v_utrata > 0 then
      v_blokada := format('%s otwartych zleceń Bastion ma ościeżnicę zawierającą „%s” — po zmianie nazwy straciłyby flagę partii i mnożnik etykiet. Dodaj nową wartość (ustaw jej flagę i mnożnik), a „%s” zostaw, aż te zlecenia zostaną wydane.',
                          v_utrata, r.value, r.value);
    end if;
  end if;

  if v_blokada is null then
    begin
      perform set_config('app.slownik_zmiana_nazwy', '1', true);
      update public.config_options set value = v_nowa where id = r.id;
      perform set_config('app.slownik_zmiana_nazwy', '', true);

      if coalesce(array_length(v_cols, 1), 0) > 0 then
        -- wykluczenia konfiguratora: zawsze zastąp (konfigurator podpowiada tylko wartości ze słownika)
        with u as (
          update public.config_exclusions e
             set source_value = case when e.source_field = any (v_cols)
                                     then public._slownik_podmien_liste(e.source_value, v_norm, v_nowa, false) else e.source_value end,
                 target_value = case when e.target_field = any (v_cols)
                                     then public._slownik_podmien_liste(e.target_value, v_norm, v_nowa, false) else e.target_value end
           where e.category = any (v_cats)
             and ((e.source_field = any (v_cols)
                   and public._slownik_podmien_liste(e.source_value, v_norm, v_nowa, false) is distinct from e.source_value)
               or (e.target_field = any (v_cols)
                   and public._slownik_podmien_liste(e.target_value, v_norm, v_nowa, false) is distinct from e.target_value))
          returning e.id)
        select count(*), array_agg(id) into v_excl, v_excl_ids from u;

        if v_excl > 0 then
          with d as (
            delete from public.config_exclusions e
             where e.id = any (v_excl_ids)
               and exists (select 1 from public.config_exclusions x
                           where x.id <> e.id and x.category = e.category
                             and x.source_field = e.source_field and x.source_value = e.source_value
                             and x.target_field = e.target_field and x.target_value = e.target_value
                             and (not (x.id = any (v_excl_ids)) or x.id < e.id))
            returning 1)
          select count(*) into v_excl_dup from d;
        end if;

        -- receptury magazynu: kryteria
        with u as (
          update public.warehouse_recipe_criteria c
             set allowed_values = public._slownik_podmien_tablice(c.allowed_values, v_norm, v_nowa, v_zostaw)
            from public.warehouse_recipes w
           where w.id = c.recipe_id and w.category = any (v_cats)
             and c.field = any (v_cols)
             and public._slownik_podmien_tablice(c.allowed_values, v_norm, v_nowa, v_zostaw) is distinct from c.allowed_values
          returning c.recipe_id)
        select count(*), coalesce(array_agg(distinct recipe_id), array[]::bigint[]) into v_kryt, v_rec_ids from u;

        -- receptury magazynu: stare kolumny receptury (system, model, kolory, szerokość…)
        for v_col in
          select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'warehouse_recipes'
            and data_type = 'text' and column_name = any (v_cols)
        loop
          execute format(
            'with u as (update public.warehouse_recipes w set %1$I = public._slownik_podmien_liste(w.%1$I, $1, $2, $3)
                         where w.category = any ($4) and w.%1$I is not null
                           and public._slownik_podmien_liste(w.%1$I, $1, $2, $3) is distinct from w.%1$I
                         returning w.id)
             select count(*), coalesce(array_agg(id), array[]::bigint[]) from u', v_col)
            using v_norm, v_nowa, v_zostaw, v_cats
            into v_n, v_ids;
          v_rec_kol := v_rec_kol + v_n;
          v_rec_ids := v_rec_ids || v_ids;
        end loop;
      end if;

      -- reguły Bastion: wartość docelowa zastąp, warunki — dopisz nową obok starej
      if v_cat = 'Bastion' then
        with n as (
          select b.id,
                 case when b.target = any (v_cols) and b.mode in ('set', 'set_if_empty')
                           and public._recipe_norm(b.value) = v_norm then v_nowa else b.value end as nv,
                 case when r.type = 'system' then public._slownik_podmien_tablice(b.when_system, v_norm, v_nowa, true)
                      else b.when_system end as ns,
                 case when r.type = 'rozmiar' then public._slownik_podmien_tablice(b.when_width, v_norm, v_nowa, true)
                      else b.when_width end as nw,
                 case when r.type = 'oscieznica' then public._slownik_podmien_tablice(b.when_frame, v_norm, v_nowa, true)
                      else b.when_frame end as nf,
                 case when b.target = any (v_cols) then public._slownik_podmien_tablice(b.when_target_not_in, v_norm, v_nowa, true)
                      else b.when_target_not_in end as nt
          from public.bastion_rules b),
        u as (
          update public.bastion_rules b
             set value = n.nv, when_system = n.ns, when_width = n.nw, when_frame = n.nf, when_target_not_in = n.nt,
                 updated_at = now()
            from n
           where n.id = b.id
             and (b.value, b.when_system, b.when_width, b.when_frame, b.when_target_not_in)
                 is distinct from (n.nv, n.ns, n.nw, n.nf, n.nt)
          returning 1)
        select count(*) into v_rules from u;
      end if;

      -- przypisania magazynów (część receptury → magazyn) dla systemu
      if r.type = 'system' then
        if v_zostaw then
          with i as (
            insert into public.warehouse_assignment (category, system, part, warehouse_id)
            select w.category, v_nowa, w.part, w.warehouse_id
            from public.warehouse_assignment w
            where w.category = any (v_cats) and w.system is not null and public._recipe_norm(w.system) = v_norm
              and not exists (select 1 from public.warehouse_assignment x
                              where x.category = w.category and x.system = v_nowa and x.part = w.part)
            returning 1)
          select count(*) into v_wa from i;
        else
          with d as (
            delete from public.warehouse_assignment w
             where w.category = any (v_cats) and w.system is not null and public._recipe_norm(w.system) = v_norm
               and exists (select 1 from public.warehouse_assignment x
                           where x.category = w.category and x.system = v_nowa and x.part = w.part)
            returning 1)
          select count(*) into v_n from d;
          with u as (
            update public.warehouse_assignment w set system = v_nowa, updated_at = now()
             where w.category = any (v_cats) and w.system is not null and public._recipe_norm(w.system) = v_norm
            returning 1)
          select count(*) + v_n into v_wa from u;
        end if;
      end if;

      -- mapa wymiarów (rozmiar → mm, liczenie szyb)
      if r.type = 'rozmiar' then
        if v_zostaw then
          with i as (
            insert into public.dimension_map (category, dimension_code, width_mm, height_mm)
            select d.category, v_nowa, d.width_mm, d.height_mm
            from public.dimension_map d
            where d.category = any (v_cats) and public._recipe_norm(d.dimension_code) = v_norm
              and not exists (select 1 from public.dimension_map x where x.category = d.category and x.dimension_code = v_nowa)
            returning 1)
          select count(*) into v_dim from i;
        else
          with u as (
            update public.dimension_map d set dimension_code = v_nowa
             where d.category = any (v_cats) and public._recipe_norm(d.dimension_code) = v_norm
               and not exists (select 1 from public.dimension_map x where x.category = d.category and x.dimension_code = v_nowa)
            returning 1)
          select count(*) into v_dim from u;
        end if;
      end if;

      v_wynik := jsonb_build_object(
        'podglad', p_tylko_podglad, 'zmieniono', not p_tylko_podglad, 'blokada', null,
        'stara', r.value, 'nowa', v_nowa, 'kategoria', r.category, 'typ', r.type,
        'wykluczenia', v_excl, 'wykluczenia_scalone', v_excl_dup,
        'reguly', v_rules,
        'receptury', (select count(distinct x) from unnest(v_rec_ids) x),
        'receptury_kryteria', v_kryt, 'receptury_kolumny', v_rec_kol,
        'receptury_nazwy', coalesce((select to_jsonb((array_agg(w.name order by w.id))[1:3])
                                     from public.warehouse_recipes w where w.id = any (v_rec_ids)), '[]'::jsonb),
        'przypisania_magazynow', v_wa, 'wymiary', v_dim,
        'zostawiono_stara', v_zostaw,
        'zlecenia_otwarte', v_otwarte, 'zlecenia_wszystkie', v_wszystkie, 'zlecenia_archiwum', v_archiwum);

      if p_tylko_podglad then
        raise exception using errcode = 'P0499', message = 'podglad';
      end if;

      select email into v_email from auth.users where id = auth.uid();
      insert into public.audit_log (table_name, record_id, operation, user_id, user_email, old_data, new_data, changed_fields)
      values ('config_options_zmiana_nazwy', r.id::text, 'UPDATE', auth.uid(), v_email,
              jsonb_build_object('value', r.value, 'category', r.category, 'type', r.type),
              v_wynik || jsonb_build_object('value', v_nowa),
              array['value']);
    exception when sqlstate 'P0499' then
      null;  -- podgląd: wszystko cofnięte, v_wynik zostaje
    end;
    return v_wynik;
  end if;

  return jsonb_build_object(
    'podglad', p_tylko_podglad, 'zmieniono', false, 'blokada', v_blokada,
    'stara', r.value, 'nowa', v_nowa, 'kategoria', r.category, 'typ', r.type,
    'zlecenia_otwarte', v_otwarte, 'zlecenia_wszystkie', v_wszystkie, 'zlecenia_archiwum', v_archiwum,
    'zlecenia_traca_dopasowanie', v_utrata);
end;
$function$;

revoke all on function public.config_option_rename(bigint, text, boolean) from public, anon;
grant execute on function public.config_option_rename(bigint, text, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 2) zwykły UPDATE value używanej wartości — tylko przez config_option_rename
create or replace function public.config_options_guard_rename()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  u jsonb;
  v_gdzie text;
begin
  if new.value is not distinct from old.value
     or coalesce(current_setting('app.slownik_zmiana_nazwy', true), '') = '1'
     or (session_user = 'postgres' and auth.uid() is null) then
    return new;
  end if;
  -- sama wielkość liter / spacje / polskie znaki — dopasowania (_recipe_norm) się nie zrywają
  if public._recipe_norm(new.value) = public._recipe_norm(old.value) then
    return new;
  end if;
  u := public.config_option_usage(old.category, old.type, old.value);
  if coalesce((u->>'total_all')::integer, (u->>'total')::integer, 0) > 0 then
    v_gdzie := concat_ws('; ',
      case when (u->>'total')::integer > 0 then format('zamówienia: %s', u->>'total') end,
      case when (u->>'recipes')::integer > 0 then format('receptury magazynu: %s', u->>'recipes') end,
      case when (u->>'exclusions')::integer > 0 then format('wykluczenia konfiguratora: %s', u->>'exclusions') end,
      case when (u->>'rules')::integer > 0 then format('reguły Bastion: %s', u->>'rules') end);
    raise exception 'Wartość „%” jest używana (%). Zmień nazwę przyciskiem w Konfiguracji (nowa wersja programu przenosi nazwę do wykluczeń, reguł i receptur) — zwykła zmiana zerwałaby te powiązania.',
      old.value, v_gdzie using errcode = 'P0405';
  end if;
  return new;
end;
$function$;

revoke all on function public.config_options_guard_rename() from public, anon, authenticated;

drop trigger if exists trg_config_options_guard_rename on public.config_options;
create trigger trg_config_options_guard_rename
  before update of value on public.config_options
  for each row execute function public.config_options_guard_rename();

-- ---------------------------------------------------------------------------------------------------------------
-- audyt tabel, które zmienia config_option_rename, a nie miały triggera
drop trigger if exists audit_bastion_rules on public.bastion_rules;
create trigger audit_bastion_rules
  after insert or update or delete on public.bastion_rules
  for each row execute function public.audit_trigger_fn();

drop trigger if exists audit_warehouse_recipe_criteria on public.warehouse_recipe_criteria;
create trigger audit_warehouse_recipe_criteria
  after insert or update or delete on public.warehouse_recipe_criteria
  for each row execute function public.audit_trigger_fn();

drop trigger if exists audit_warehouse_assignment on public.warehouse_assignment;
create trigger audit_warehouse_assignment
  after insert or update or delete on public.warehouse_assignment
  for each row execute function public.audit_trigger_fn();

-- ---------------------------------------------------------------------------------------------------------------
-- 3) unikalność wartości w słowniku (po normalizacji)
create unique index if not exists config_options_kategoria_typ_wartosc_uq
  on public.config_options (category, type, public._recipe_norm(value));
