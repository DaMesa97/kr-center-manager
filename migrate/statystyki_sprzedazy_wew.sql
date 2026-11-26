-- =====================================================================
-- Statystyki sprzedaży (Etap 25, 26.11.2026, właściciel: „statystyki mają mówić, co się
-- sprzedaje po grupach modelowych, kolorach i rozmiarach, co spada, a na co czeka klient”).
--
-- 1. Słownik cech pozycji drzwi wewnętrznych: kod Optimy → grupa modelowa, model, linia
--    (BLACK / PLUS / BEZPRZYLGOWE / NORMA CZ-SK), wykonanie (WEW = z półki, NSTD = na zamówienie),
--    numer wzoru, kolor, rozmiar, strona, dodatek. Cechy rozbijane z NAZWY kartoteki Optimy
--    (`interior_item_parse`), bo `optima_group` jest niekonsekwentne, a kartoteki nie mają
--    kolorów. Wiersz z `reczne = true` (poprawka kierownika przez `interior_item_dict_set`)
--    nigdy nie jest nadpisywany przez automat. `parser_version` – podbić przy zmianie regexów,
--    wtedy `interior_item_dict_refresh` przepisze wiersze automatyczne.
-- 2. RPC statystyk (tylko kierownik, security definer, ciężka robota w bazie – pozycji jest 50 tys.):
--    stat_wew_sprzedaz(p_from, p_to)   – sprzedaż po cechach (grupa/model/linia/wykonanie/kolor/rozmiar)
--    stat_wew_miesiace(p_months)       – sztuki per miesiąc i grupa (trend liczy aplikacja)
--    stat_wew_braki(p_days, p_prog)    – na co czeka klient: otwarte zlecenia i historia czekania
--    stat_zew_miesiace(p_category, p_months) – zewnętrzne/Bastion: miesiąc × system / model / kolor
--    stat_zew_braki(p_category, p_days)      – zewnętrzne/Bastion: wymuszone wydania („brak”) per komponent
-- Zwraca puste wyniki, gdy wołający nie jest kierownikiem (current_user_is_manager()).
-- =====================================================================

create table if not exists public.interior_item_dict (
  optima_code    text primary key,
  optima_name    text,
  item_type      text,
  grupa          text,
  model          text,
  linia          text,
  wykonanie      text,
  wzor           text,
  kolor          text,
  rozmiar        text,
  strona         text,
  dodatek        text,
  rozpoznane     boolean not null default false,
  reczne         boolean not null default false,
  parser_version integer not null default 0,
  updated_at     timestamptz not null default now(),
  updated_by     uuid
);
comment on table public.interior_item_dict is 'Cechy pozycji drzwi wewnętrznych rozbite z nazwy kartoteki Optimy (statystyki sprzedaży); reczne = poprawka kierownika, nie nadpisywać.';

-- v3 (26.11 w nocy, właściciel: „BOLD to Bastion – nie pokazujemy w statystykach wewnętrznych”):
-- pomijane = pozycja nie jest drzwiami wewnętrznymi (BOLD / Bastion, „DRZWI ZEW…”); RPC stat_wew_* ją pomijają.
alter table public.interior_item_dict add column if not exists pomijane boolean not null default false;
drop function if exists public.interior_item_parse(text, text, text);

alter table public.interior_item_dict enable row level security;
drop policy if exists iid_select on public.interior_item_dict;
create policy iid_select on public.interior_item_dict for select to authenticated using (true);
grant select on public.interior_item_dict to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Rozbiór nazwy kartoteki. p_group = optima_group (kolor klamek/osłonek, gdy nazwa go nie ma).
-- ---------------------------------------------------------------------
create or replace function public.interior_item_parse(p_name text, p_type text, p_group text default null)
returns table (grupa text, model text, linia text, wykonanie text, wzor text, kolor text, rozmiar text, strona text, dodatek text, rozpoznane boolean, pomijane boolean)
language plpgsql
immutable
as $$
declare
  n text := upper(coalesce(trim(p_name), ''));
  m text[];
  flags text[] := '{}';
  tok text;
  sz integer;
begin
  grupa := null; model := null; linia := null; wykonanie := null; wzor := null; kolor := null;
  rozmiar := null; strona := null; dodatek := null; rozpoznane := false; pomijane := false;
  if n = '' then return next; return; end if;
  n := regexp_replace(n, '\s+', ' ', 'g');
  -- nie drzwi wewnętrzne: skrzydła i akcesoria BOLD (Bastion), drzwi zewnętrzne wpisane w RO
  if n ~ '(^| )BOLD( |$)' or n like 'DRZWI ZEW%' or n like '%BASTION%' then pomijane := true; end if;

  if p_type = 'door_wing' then
    -- dodatki z końca nazwy
    m := regexp_match(n, '\((SZKLENIE [^)]*)\)\s*$');
    if m is not null then dodatek := m[1]; n := regexp_replace(n, '\s*\((SZKLENIE [^)]*)\)\s*$', ''); end if;
    if n ~ ' Z SYSTEMEM PRZESUWNYM$' then dodatek := 'PRZESUWNE'; n := regexp_replace(n, ' Z SYSTEMEM PRZESUWNYM$', ''); end if;
    m := regexp_match(n, ' (PRZESUWNE|BIERNA)$');
    if m is not null then dodatek := m[1]; n := regexp_replace(n, ' (PRZESUWNE|BIERNA)$', ''); end if;
    n := replace(n, 'BLECK', 'BLACK');

    -- SKRZYDŁO <WEW|NSTD|BEZPRZYLGOWE|NORMA CZ-SK>* <MODEL> <wzór> <KOLOR> <rozmiar><L|P>
    m := regexp_match(n,
      '^(?:SKRZYD[ŁL]O|DRZWI) (.+?) (\d{2}|PEŁNE|N\d{2,3}|P\d{3}|A\d{2,3}(?:-[A-Z]+)?|LUX\d{2,3}|T\d{2,3}|L\d{2}|STD-\d{2}|UNI-45) (.+?) (\d{2,3}) ?([LP])?\.?$');
    if m is null then return next; return; end if;
    sz := m[4]::integer;
    if sz < 40 or sz > 130 then return next; return; end if;

    model := m[1];
    -- przedrostki wykonania/linii przed nazwą modelu
    loop
      tok := split_part(model, ' ', 1);
      exit when tok not in ('WEW', 'NSTD', 'BEZPRZYLGOWE', 'NORMA', 'TECHNICZNE');
      if tok = 'NORMA' then
        exit when split_part(model, ' ', 2) <> 'CZ-SK';
        flags := array_append(flags, 'NORMA CZ-SK'); model := trim(substr(model, length('NORMA CZ-SK') + 1));
      elsif tok = 'TECHNICZNE' then
        model := 'TECHNIC' || substr(model, length('TECHNICZNE') + 1);
        exit;
      else
        flags := array_append(flags, tok); model := trim(substr(model, length(tok) + 1));
      end if;
      exit when model = '';
    end loop;
    if model = '' then return next; return; end if;

    wykonanie := case when 'NSTD' = any(flags) or n ~ ' NSTD( |$)' then 'NSTD' else 'WEW' end;
    linia := nullif(trim(concat_ws(' ',
      case when model like '% BLACK' or model like '% BLACK %' then 'BLACK' end,
      case when model like '% PLUS' or model like '% PLUS %' then 'PLUS' end,
      case when 'BEZPRZYLGOWE' = any(flags) then 'BEZPRZYLGOWE' end,
      case when 'NORMA CZ-SK' = any(flags) then 'NORMA CZ-SK' end)), '');
    grupa := split_part(model, ' ', 1);
    wzor := m[2];
    if grupa = 'TECHNIC' then linia := case when wzor = 'UNI-45' then 'UNI-45' else 'TECHNIC 01' end; end if;
    kolor := m[3];
    rozmiar := m[4];
    strona := m[5];
    rozpoznane := true;
    return next; return;
  end if;

  if p_type = 'door_frame' then
    -- BAZA/BELKA <OR2 (100-140) | OŚCIEŻNICY PROSTEJ | OŚC PR> <KOLOR> <LEWA|PRAWA|szerokość>
    m := regexp_match(n, '^(BAZA|BELKA) (?:(OR\d|ORS\d-\d{2}) ?\((\d+-\d+)\)|(OŚCIEŻNIC[AY] PROST[AEJ]+|OŚC\.? PR(?:OSTA)?)) (.+?) (LEWA|PRAWA|\d{2,3})$');
    if m is not null then
      grupa := coalesce(m[2], 'PROSTA');
      model := case when m[2] is not null then m[2] || ' (' || m[3] || ')' else 'PROSTA' end;
      wzor := m[1];
      kolor := m[5];
      if m[6] in ('LEWA', 'PRAWA') then strona := left(m[6], 1); else rozmiar := m[6]; end if;
      rozpoznane := true; return next; return;
    end if;
    m := regexp_match(n, '^OŚC\.? PROSTA 3 ZAWIASY (.+?) (\d{2,3}) ?([LP])?$');
    if m is not null then
      grupa := 'PROSTA 3 ZAWIASY'; model := grupa; kolor := m[1]; rozmiar := m[2]; strona := m[3];
      rozpoznane := true; return next; return;
    end if;
    -- kompletna ościeżnica regulowana / tunel: OŚC REGULOWANA 100-140 DĄB WOTAN 80P, TUNEL REGULOWANY 140-180 BIAŁY 80
    m := regexp_match(n, '^(OŚC\.? REGULOWANA|TUNEL REGULOWANY) (\d+)-(\d+) (.+?) (\d{2,3}) ?([LP])?\.?$');
    if m is not null then
      grupa := case when m[1] like 'TUNEL%' then 'TUNEL'
                    else case m[2] when '80' then 'OR1' when '100' then 'OR2' when '140' then 'OR3' when '180' then 'OR4'
                                   when '220' then 'OR5' when '260' then 'OR6' when '300' then 'OR7' when '340' then 'OR8' else 'OR INNE' end end;
      model := grupa || ' (' || m[2] || '-' || m[3] || ')';
      wzor := 'KOMPLET'; kolor := m[4]; rozmiar := m[5]; strona := m[6];
      rozpoznane := true; return next; return;
    end if;
    m := regexp_match(n, '^(LISTWA OPASK\w*|OPASKA CPL|ĆWIERĆWAŁEK(?: CPL)?)(?: (\d+)(?: ?CM)?)? (.+)$');
    if m is not null then
      grupa := case when m[1] like 'LISTWA%' then 'LISTWA OPASKOWA' else m[1] end;
      model := grupa; wzor := m[2]; kolor := m[3];
      -- szerokość opaski doklejona do koloru: „BERGEN 80MM”, „BIAŁY "100"”, samo „10CM”
      m := regexp_match(kolor, '^(.*?) ?"?(\d{1,3})"? ?(MM|CM)?$');
      if m is not null then rozmiar := m[2]; kolor := nullif(trim(m[1]), ''); end if;
      rozpoznane := true; return next; return;
    end if;
    if n like 'SYSTEM RENOWACJI%' or n like 'RENOW%' then
      grupa := 'RENOWACJA'; model := grupa; rozpoznane := true; return next; return;
    end if;
    return next; return;
  end if;

  if p_type = 'door_handle' then
    -- KLAMKA IBERIA CZARNY / ROZETA IBERIA KLUCZ CZARNY / ROZETA CARMEN/ORLANDO/VENA KWADRAT WC NIKIEL SATYNA
    m := regexp_match(n, '^(KLAMKA|ROZETA|SZYLD) ([^ ]+)(?: (KWADRAT|OKRĄGŁ[AY]))?(?: (KLUCZ|WC|WB|PZ))? ?(.*)$');
    if m is not null then
      grupa := m[2]; model := trim(concat_ws(' ', m[2], m[3]));
      wzor := trim(concat_ws(' ', m[1], m[4]));
      kolor := nullif(trim(coalesce(nullif(m[5], ''), p_group)), '');
      if kolor like '%KOLOR %' then kolor := trim(substr(kolor, position('KOLOR ' in kolor) + 6)); end if;
      if grupa = 'DO' then grupa := 'TECHNIC'; model := 'TECHNIC'; end if;
      rozpoznane := true; return next; return;
    end if;
    return next; return;
  end if;

  if p_type = 'door_hinge_cover' then
    grupa := 'OSŁONKA'; model := case when n like '%NORMIE CZESKIEJ%' then 'OSŁONKA NORMA CZ' else 'OSŁONKA' end;
    m := regexp_match(n, 'KOLOR (.+)$');
    kolor := coalesce(m[1], p_group);
    rozpoznane := true; return next; return;
  end if;

  -- akcesoria: pierwszy wyraz jako grupa, kolor z grupy Optimy
  grupa := split_part(n, ' ', 1); model := grupa; kolor := p_group;
  rozpoznane := grupa <> '';
  return next; return;
end;
$$;

-- ---------------------------------------------------------------------
-- Odświeżenie słownika: nowe kody + ponowny rozbiór po zmianie parsera (wiersze ręczne nietykane).
-- ---------------------------------------------------------------------
create or replace function public.interior_item_dict_refresh()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version constant integer := 3;
  v_n integer := 0;
begin
  with codes as (
    select i.optima_code,
           max(i.optima_name) as optima_name,
           max(i.item_type)   as item_type,
           max(i.optima_group) as optima_group
    from public.order_internal_door_items i
    left join public.interior_item_dict d on d.optima_code = i.optima_code
    where i.optima_code is not null
      and (d.optima_code is null or (d.reczne = false and d.parser_version < v_version))
    group by i.optima_code
  ), parsed as (
    select c.*, p.*
    from codes c
    cross join lateral public.interior_item_parse(coalesce(c.optima_name, c.optima_code), c.item_type, c.optima_group) p
  )
  insert into public.interior_item_dict as d
    (optima_code, optima_name, item_type, grupa, model, linia, wykonanie, wzor, kolor, rozmiar, strona, dodatek, rozpoznane, pomijane, parser_version, updated_at)
  select optima_code, optima_name, item_type, grupa, model, linia, wykonanie, wzor, kolor, rozmiar, strona, dodatek, rozpoznane, pomijane, v_version, now()
  from parsed
  on conflict (optima_code) do update set
    optima_name = excluded.optima_name, item_type = excluded.item_type,
    grupa = excluded.grupa, model = excluded.model, linia = excluded.linia, wykonanie = excluded.wykonanie,
    wzor = excluded.wzor, kolor = excluded.kolor, rozmiar = excluded.rozmiar, strona = excluded.strona,
    dodatek = excluded.dodatek, rozpoznane = excluded.rozpoznane, pomijane = excluded.pomijane, parser_version = excluded.parser_version, updated_at = now()
  where d.reczne = false;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.interior_item_dict_refresh() from public, anon;
grant execute on function public.interior_item_dict_refresh() to authenticated, service_role;

-- Ręczna poprawka kierownika (puste pole = zostaw jak jest; p_reset = wróć do automatu).
create or replace function public.interior_item_dict_set(
  p_code text, p_grupa text default null, p_kolor text default null, p_rozmiar text default null,
  p_wykonanie text default null, p_reset boolean default false, p_pomijane boolean default null)
returns setof public.interior_item_dict
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.current_user_is_manager() then
    raise exception 'Tylko kierownik może poprawiać słownik cech';
  end if;
  if p_reset then
    update public.interior_item_dict set reczne = false, parser_version = 0, updated_by = auth.uid() where optima_code = p_code;
    perform public.interior_item_dict_refresh();
  else
    update public.interior_item_dict set
      grupa = coalesce(nullif(upper(trim(p_grupa)), ''), grupa),
      kolor = coalesce(nullif(upper(trim(p_kolor)), ''), kolor),
      rozmiar = coalesce(nullif(trim(p_rozmiar), ''), rozmiar),
      wykonanie = coalesce(nullif(upper(trim(p_wykonanie)), ''), wykonanie),
      model = case when nullif(trim(p_grupa), '') is not null and (model is null or rozpoznane = false) then upper(trim(p_grupa)) else model end,
      pomijane = coalesce(p_pomijane, pomijane),
      rozpoznane = case when p_pomijane is not null and p_grupa is null then rozpoznane else true end,
      reczne = true, updated_at = now(), updated_by = auth.uid()
    where optima_code = p_code;
  end if;
  return query select * from public.interior_item_dict where optima_code = p_code;
end;
$$;
drop function if exists public.interior_item_dict_set(text, text, text, text, text, boolean);
revoke all on function public.interior_item_dict_set(text, text, text, text, text, boolean, boolean) from public, anon;
grant execute on function public.interior_item_dict_set(text, text, text, text, text, boolean, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Otwarte zlecenie drzwi wewnętrznych = niewydane, nieanulowane, RO w Optimie w stanie 0/1/2.
-- ---------------------------------------------------------------------
create or replace function public.wew_zlecenie_otwarte(o public.orders)
returns boolean
language sql
immutable
as $$
  select o.release_date is null
     and coalesce(o.extra_fields->>'cancelled', '') <> 'true'
     and coalesce(o.source_metadata->>'state', '0') not in ('3', '4');
$$;

-- ---------------------------------------------------------------------
-- Sprzedaż po cechach (po dacie zlecenia, bez anulowanych; otwarte też liczą się jako sprzedane).
-- ---------------------------------------------------------------------
create or replace function public.stat_wew_sprzedaz(p_from date, p_to date default current_date)
returns table (
  item_type text, grupa text, model text, linia text, wykonanie text, kolor text, rozmiar text,
  rozpoznane boolean, szt bigint, zlecenia bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.current_user_is_manager() then return; end if;
  perform public.interior_item_dict_refresh();
  return query
    select coalesce(d.item_type, i.item_type, 'inne') as item_type,
           d.grupa, d.model, d.linia, d.wykonanie, d.kolor, d.rozmiar,
           coalesce(d.rozpoznane, false) as rozpoznane,
           sum(i.quantity)::bigint as szt,
           count(distinct i.order_id)::bigint as zlecenia
    from public.orders o
    join public.order_internal_door_items i on i.order_id = o.id
    left join public.interior_item_dict d on d.optima_code = i.optima_code
    where o.category = 'DrzwiWewnetrzne'
      and o.order_date >= p_from and o.order_date <= coalesce(p_to, current_date)
      and coalesce(o.extra_fields->>'cancelled', '') <> 'true'
      and coalesce(d.pomijane, false) = false
    group by 1, 2, 3, 4, 5, 6, 7, 8;
end;
$$;
revoke all on function public.stat_wew_sprzedaz(date, date) from public, anon;
grant execute on function public.stat_wew_sprzedaz(date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Sztuki per miesiąc × typ × grupa × wykonanie (trend „spada / rośnie” liczy aplikacja).
-- ---------------------------------------------------------------------
create or replace function public.stat_wew_miesiace(p_months integer default 13)
returns table (miesiac date, item_type text, grupa text, wykonanie text, szt bigint, zlecenia bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.current_user_is_manager() then return; end if;
  perform public.interior_item_dict_refresh();
  return query
    select date_trunc('month', o.order_date)::date as miesiac,
           coalesce(d.item_type, i.item_type, 'inne') as item_type,
           d.grupa, d.wykonanie,
           sum(i.quantity)::bigint as szt,
           count(distinct i.order_id)::bigint as zlecenia
    from public.orders o
    join public.order_internal_door_items i on i.order_id = o.id
    left join public.interior_item_dict d on d.optima_code = i.optima_code
    where o.category = 'DrzwiWewnetrzne'
      and o.order_date >= (date_trunc('month', now()) - make_interval(months => greatest(coalesce(p_months, 13), 1) - 1))::date
      and coalesce(o.extra_fields->>'cancelled', '') <> 'true'
      and coalesce(d.pomijane, false) = false
    group by 1, 2, 3, 4;
end;
$$;
revoke all on function public.stat_wew_miesiace(integer) from public, anon;
grant execute on function public.stat_wew_miesiace(integer) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Na co czeka klient: per kod Optimy – otwarte zlecenia (dni od daty zlecenia do dziś) oraz
-- historia z p_days dni (wydane zlecenia, które czekały dłużej niż p_prog dni).
-- Stan z magazynu WEWNETRZNE (dziś 0 – pojawi się po inwentaryzacji).
-- ---------------------------------------------------------------------
create or replace function public.stat_wew_braki(p_days integer default 180, p_prog integer default 7)
returns table (
  optima_code text, optima_name text, item_type text, grupa text, model text, kolor text, rozmiar text, wykonanie text,
  component_id bigint, is_stocked boolean, stan numeric,
  otwarte_zlecenia bigint, otwarte_szt bigint, otwarte_sr_dni numeric, otwarte_max_dni integer, otwarte_najstarsze date,
  hist_zlecenia bigint, hist_czekaly bigint, hist_sr_dni numeric, hist_max_dni integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wh bigint := (select w.id from public.warehouses w where w.code = 'WEWNETRZNE' limit 1);
begin
  if not public.current_user_is_manager() then return; end if;
  perform public.interior_item_dict_refresh();
  return query
    with otw as (
      select i.optima_code,
             count(distinct i.order_id) as zlecenia,
             sum(i.quantity) as szt,
             round(avg(current_date - o.order_date), 1) as sr_dni,
             max(current_date - o.order_date) as max_dni,
             min(o.order_date) as najstarsze
      from public.orders o
      join public.order_internal_door_items i on i.order_id = o.id
      where o.category = 'DrzwiWewnetrzne' and public.wew_zlecenie_otwarte(o) and i.optima_code is not null
      group by 1
    ), hist as (
      select i.optima_code,
             count(distinct i.order_id) as zlecenia,
             count(distinct i.order_id) filter (where o.release_date - o.order_date > p_prog) as czekaly,
             round(avg(o.release_date - o.order_date) filter (where o.release_date - o.order_date > p_prog), 1) as sr_dni,
             max(o.release_date - o.order_date) as max_dni
      from public.orders o
      join public.order_internal_door_items i on i.order_id = o.id
      where o.category = 'DrzwiWewnetrzne' and o.release_date is not null
        and o.order_date >= current_date - greatest(coalesce(p_days, 180), 1)
        and coalesce(o.extra_fields->>'cancelled', '') <> 'true' and i.optima_code is not null
      group by 1
    ), kody as (
      select coalesce(a.optima_code, h.optima_code) as optima_code from otw a full join hist h on h.optima_code = a.optima_code
    )
    select k.optima_code, d.optima_name, d.item_type, d.grupa, d.model, d.kolor, d.rozmiar, d.wykonanie,
           c.id as component_id, c.is_stocked,
           (select sum(s.quantity) from public.warehouse_stock s where s.component_id = c.id and (v_wh is null or s.warehouse_id = v_wh)) as stan,
           coalesce(a.zlecenia, 0)::bigint, coalesce(a.szt, 0)::bigint, a.sr_dni, a.max_dni, a.najstarsze,
           coalesce(h.zlecenia, 0)::bigint, coalesce(h.czekaly, 0)::bigint, h.sr_dni, h.max_dni
    from kody k
    left join public.interior_item_dict d on d.optima_code = k.optima_code
    left join otw a on a.optima_code = k.optima_code
    left join hist h on h.optima_code = k.optima_code
    left join lateral (
      select wc.id, wc.is_stocked from public.warehouse_components wc
      where wc.id = (select m.component_id from public.optima_component_map m where m.optima_code = k.optima_code)
         or wc.code = k.optima_code
      order by (wc.code = k.optima_code) limit 1
    ) c on true
    where (coalesce(a.zlecenia, 0) > 0 or coalesce(h.czekaly, 0) > 0)
      and coalesce(d.pomijane, false) = false;
end;
$$;
revoke all on function public.stat_wew_braki(integer, integer) from public, anon;
grant execute on function public.stat_wew_braki(integer, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Zewnętrzne i Bastion: sztuki per miesiąc × wymiar (system / model / kolor skrzydła).
-- ---------------------------------------------------------------------
create or replace function public.stat_zew_miesiace(p_category text, p_months integer default 13)
returns table (miesiac date, wymiar text, wartosc text, zlecenia bigint, szt bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.current_user_is_manager() then return; end if;
  return query
    with o as (
      select date_trunc('month', ord.order_date)::date as mies,
             nullif(trim(ord.system), '') as sys, nullif(trim(ord.model), '') as mod, nullif(trim(ord.wing_color), '') as kol,
             greatest(coalesce(ord.quantity, 1), 1) as q
      from public.orders ord
      where ord.category = p_category
        and ord.order_date >= (date_trunc('month', now()) - make_interval(months => greatest(coalesce(p_months, 13), 1) - 1))::date
        and coalesce(ord.extra_fields->>'cancelled', '') <> 'true'
    )
    select o.mies, 'system'::text, coalesce(o.sys, '(brak)'), count(*)::bigint, sum(o.q)::bigint from o group by 1, 3
    union all
    select o.mies, 'model'::text, coalesce(o.mod, '(brak)'), count(*)::bigint, sum(o.q)::bigint from o group by 1, 3
    union all
    select o.mies, 'kolor'::text, coalesce(o.kol, '(brak)'), count(*)::bigint, sum(o.q)::bigint from o group by 1, 3;
end;
$$;
revoke all on function public.stat_zew_miesiace(text, integer) from public, anon;
grant execute on function public.stat_zew_miesiace(text, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Zewnętrzne i Bastion: braki materiałowe = wymuszone wydania (WZ „[WYMUSZONE brak N]”) z p_days dni,
-- per komponent: ile zleceń, ile sztuk brakowało, średnia realizacja tych zleceń vs całej kategorii,
-- stan / rezerwacje / dostępne dziś (v_stock_levels, wszystkie magazyny).
-- ---------------------------------------------------------------------
create or replace function public.stat_zew_braki(p_category text, p_days integer default 90)
returns table (
  component_id bigint, kod text, nazwa text, kategoria text,
  zlecenia bigint, wydania bigint, brak_szt numeric, pierwsze date, ostatnie date,
  sr_realizacja numeric, sr_realizacja_kat numeric,
  stan numeric, rezerwacje numeric, dostepne numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_od timestamptz := now() - make_interval(days => greatest(coalesce(p_days, 90), 1));
  v_kat numeric := (
    select round(avg(o.release_date - o.order_date), 1) from public.orders o
    where o.category = p_category and o.release_date is not null and o.order_date >= v_od::date
      and coalesce(o.extra_fields->>'cancelled', '') <> 'true');
begin
  if not public.current_user_is_manager() then return; end if;
  return query
    with w as (
      select m.component_id, m.order_id, m.created_at,
             (regexp_match(coalesce(m.notes, ''), '\[WYMUSZONE brak ([0-9]+(?:[.,][0-9]+)?)\]'))[1] as brak_txt,
             o.release_date - o.order_date as dni
      from public.warehouse_movements m
      join public.orders o on o.id = m.order_id
      where m.movement_type = 'WZ' and m.notes ilike '%WYMUSZONE%' and m.created_at >= v_od
        and o.category = p_category
    )
    select w.component_id, c.code, c.name, c.category,
           count(distinct w.order_id)::bigint, count(*)::bigint,
           sum(replace(coalesce(w.brak_txt, '0'), ',', '.')::numeric),
           min(w.created_at)::date, max(w.created_at)::date,
           round(avg(w.dni), 1), v_kat,
           s.stan, s.rez, s.dost
    from w
    join public.warehouse_components c on c.id = w.component_id
    left join lateral (
      select sum(v.quantity) as stan, sum(v.reserved_quantity) as rez, sum(v.available_quantity) as dost
      from public.v_stock_levels v where v.component_id = w.component_id
    ) s on true
    group by w.component_id, c.code, c.name, c.category, s.stan, s.rez, s.dost;
end;
$$;
revoke all on function public.stat_zew_braki(text, integer) from public, anon;
grant execute on function public.stat_zew_braki(text, integer) to authenticated, service_role;

-- pierwsze wypełnienie słownika
select public.interior_item_dict_refresh();
