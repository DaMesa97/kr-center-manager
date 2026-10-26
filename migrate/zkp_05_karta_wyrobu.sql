-- =====================================================================
-- ZKP AS 75EI — etap C: KARTA WYROBU (zał. 6.25) + REJESTR WYROBÓW (6.33)
-- (2026-10-26)
--
-- Karta wyrobu = jedna na KONSTRUKCJĘ (numer RRRR/ZZ/PP) zlecenia ZKP:
--   A. identyfikacja (typ, skrzydła, kierunek, zakres raportu, ewakuacja, nad-/doświetle)
--      → kod typu wyrobu wg zał. 6.8 (AS75EI-W-EI30-S-1-E / AS75EI-Z-…-DW/NZ-…),
--   B. sprawdzenie zakresu przed uruchomieniem — limity z TABELI K liczone w bazie
--      (zkp_card_checks), potwierdza PJ / Zastępca / Kierownik Produkcji,
--   C. etapy z kontrolą międzyoperacyjną i NUMERAMI PARTII — partia musi być przyjęta
--      (zał. 6.24), właściwego rodzaju, a jej nr katalogowy na liście 6.10.5 DLA ZAKRESU
--      (zkp_range_components) — spoza listy = odmowa (zasada „spoza listy = kwarantanna"),
--      regulacja: szczeliny A/B/C porównane z limitem zakresu,
--   D. okucia, E. wypełnienia (grubość w limicie zakresu),
--   F. zwolnienie — decyzja Pełnomocnika / Zastępcy, podpis z serwera.
-- Zapisy etapów, okuć i wypełnień tylko DOPISYWANE (bieżący = najnowszy wpis),
-- karta bez kasowania. Teczka: karta wyrobu / PZ / RW = „jest", gdy wszystkie
-- aktywne konstrukcje zlecenia mają zwolnione karty.
--
-- Słownik zakresów (tabela K z zał. 6.25 i pkt A zał. 6.10.5) w zkp_ranges;
-- lista numerów katalogowych per zakres: migrate/zkp_05b_zakresy_6105.sql
-- (wygenerowana z zał. 6.10.5 — docs/zkp/as75ei_zakresy.json).
--
-- Wymaga: zkp_00 … zkp_03. Bezpieczne do ponownego uruchomienia.
-- =====================================================================

-- ── 0) Wypełnienia nieprzezierne (LB Therm) też są komponentem krytycznym ─
alter table public.warehouse_components drop constraint if exists warehouse_components_zkp_critical_kind_check;
alter table public.warehouse_components add constraint warehouse_components_zkp_critical_kind_check
  check (zkp_critical_kind is null or zkp_critical_kind in ('wklad', 'uszczelka', 'szklo', 'wypelnienie', 'okucie'));

-- ── 1) Zakresy raportów + tabela K ───────────────────────────────────────
create table if not exists public.zkp_ranges (
  code               text primary key,
  sort               int not null,
  label              text not null,
  report             text not null,
  classification     text not null default '',
  leaf1_w            numeric not null,
  leaf1_h            numeric not null,
  leaf1_area         numeric not null,
  leaf2_h            numeric not null,
  leaf2_active_w     numeric not null,
  leaf2_passive_w    numeric not null,
  leaf2_sum_w        numeric not null,
  leaf2_active_area  numeric not null,
  leaf2_passive_area numeric not null,
  leaf2_sum_area     numeric not null,
  transom_w          numeric,           -- null = nadświetle niedopuszczone
  transom_h          numeric,
  transom_area       numeric,
  side_w             numeric,           -- null = doświetle niedopuszczone
  side_h             numeric,
  side_area          numeric,
  mass_max           numeric not null,
  fill_min           numeric not null,
  fill_max           numeric not null,
  hinge_steps        jsonb not null,    -- [[h_max, min_liczba], …] rosnąco
  pin_steps          jsonb not null,
  pins_mandatory     boolean not null,
  gaps               jsonb not null     -- {"A":{"zaw":…,"zamk":…,"nad":…},"B":{…},"C":{…}} [mm]
);

insert into public.zkp_ranges as r (code, sort, label, report, classification,
  leaf1_w, leaf1_h, leaf1_area, leaf2_h, leaf2_active_w, leaf2_passive_w, leaf2_sum_w,
  leaf2_active_area, leaf2_passive_area, leaf2_sum_area,
  transom_w, transom_h, transom_area, side_w, side_h, side_area,
  mass_max, fill_min, fill_max, hinge_steps, pin_steps, pins_mandatory, gaps)
values
  ('EI30', 1, 'EI2 30 bez dymoszczelności', 'K-1/8 pkt 2.2.2', 'EI₁ 15-C, EI₂ 30-C, EW 30-C, E 30-C',
   1320, 2800, 3.70, 2800, 1320, 1320, 2620, 3.70, 3.70, 7.33,
   2740, 1557, 4.26, 1592, 2588, 4.12,
   350, 15.0, 56.0, '[[1533,2],[2300,3],[2800,4]]', '[[2500,2],[2800,3]]', true,
   '{"A":{"zaw":7.0,"zamk":7.0,"nad":7.0},"B":{"zaw":15.0,"zamk":15.0,"nad":15.0},"C":{"zaw":6.0,"zamk":7.5,"nad":7.0}}'),
  ('EI30S', 2, 'EI2 30 + S200 / Sa4', 'K-1/8 pkt 2.2.3', 'EI₂ 30-S₂₀₀-C / EI₂ 30-Sₐ₄-C',
   1320, 2800, 3.70, 2800, 1320, 1320, 2620, 3.70, 3.70, 7.33,
   null, null, null, null, null, null,
   350, 15.0, 56.0, '[[1533,2],[2300,3],[2800,4]]', '[[2500,2],[2800,3]]', true,
   '{"A":{"zaw":5.0,"zamk":5.0,"nad":5.0},"B":{"zaw":13.0,"zamk":13.0,"nad":13.0},"C":{"zaw":5.0,"zamk":5.0,"nad":5.0}}'),
  ('EI60', 3, 'EI2 60 bez dymoszczelności', 'K-2/8 pkt 2.2.2', 'EI₁ 30-C, EI₂ 60-C, EW 60-C, E 60-C',
   1560, 2760, 3.62, 2500, 1320, 1320, 2620, 3.30, 3.30, 6.55,
   2740, 1557, 4.26, 1592, 2588, 4.12,
   350, 27.0, 56.0, '[[1533,2],[2300,3],[2760,4]]', '[[2300,2],[2760,3]]', true,
   '{"A":{"zaw":7.0,"zamk":6.5,"nad":6.5},"B":{"zaw":15.0,"zamk":15.0,"nad":15.0},"C":{"zaw":6.0,"zamk":7.5,"nad":7.0}}'),
  ('EI60S', 4, 'EI2 60 + S200 / Sa4', 'K-2/8 pkt 2.2.3', 'EI₂ 60-S₂₀₀-C / EI₂ 60-Sₐ₄-C',
   1560, 2760, 3.62, 2500, 1320, 1320, 2620, 3.30, 3.30, 6.55,
   null, null, null, null, null, null,
   350, 27.0, 56.0, '[[1533,2],[2300,3],[2760,4]]', '[[2500,2],[2760,3]]', true,
   '{"A":{"zaw":5.0,"zamk":5.0,"nad":5.0},"B":{"zaw":13.0,"zamk":13.0,"nad":13.0},"C":{"zaw":5.0,"zamk":5.0,"nad":5.0}}'),
  ('S', 5, 'wyłącznie S200 / Sa4', '3060_1556/K/2 pkt 2.2.2', 'S200-C / Sa4-C',
   1650, 3125, 4.13, 3125, 1650, 1650, 3274, 4.13, 4.13, 8.18,
   null, null, null, null, null, null,
   350, 12.6, 56.0, '[[1533,2],[2300,3],[3066,4],[3125,5]]', '[[2300,2],[3125,3]]', false,
   '{"A":{"zaw":5.0,"zamk":5.0,"nad":5.0},"B":{"zaw":13.0,"zamk":13.0,"nad":13.0},"C":{"zaw":5.0,"zamk":5.0,"nad":5.0}}')
on conflict (code) do update set
  sort = excluded.sort, label = excluded.label, report = excluded.report, classification = excluded.classification,
  leaf1_w = excluded.leaf1_w, leaf1_h = excluded.leaf1_h, leaf1_area = excluded.leaf1_area,
  leaf2_h = excluded.leaf2_h, leaf2_active_w = excluded.leaf2_active_w, leaf2_passive_w = excluded.leaf2_passive_w,
  leaf2_sum_w = excluded.leaf2_sum_w, leaf2_active_area = excluded.leaf2_active_area,
  leaf2_passive_area = excluded.leaf2_passive_area, leaf2_sum_area = excluded.leaf2_sum_area,
  transom_w = excluded.transom_w, transom_h = excluded.transom_h, transom_area = excluded.transom_area,
  side_w = excluded.side_w, side_h = excluded.side_h, side_area = excluded.side_area,
  mass_max = excluded.mass_max, fill_min = excluded.fill_min, fill_max = excluded.fill_max,
  hinge_steps = excluded.hinge_steps, pin_steps = excluded.pin_steps,
  pins_mandatory = excluded.pins_mandatory, gaps = excluded.gaps;

-- Lista numerów katalogowych dopuszczonych w zakresie (zał. 6.10.5). Kod z „XX"
-- na końcu = dowolny kolor (2 znaki). Dane: zkp_05b_zakresy_6105.sql.
create table if not exists public.zkp_range_components (
  range_code text not null references public.zkp_ranges(code) on delete cascade,
  code       text not null,
  sections   text[] not null default '{}',
  primary key (range_code, code)
);

-- ── 2) Karta wyrobu ──────────────────────────────────────────────────────
create table if not exists public.zkp_product_cards (
  id                      bigint generated always as identity primary key,
  construction_id         bigint not null unique references public.alu_constructions(id) on delete restrict,
  order_id                bigint not null references public.orders(id) on delete restrict,
  -- A. identyfikacja
  product_type            text check (product_type in ('drzwi_wewn', 'drzwi_zewn', 'okno')),
  leaves                  int check (leaves in (1, 2)),
  opening                 text check (opening in ('do_wewnatrz', 'na_zewnatrz')),
  hand                    text check (hand in ('L', 'P')),
  range_code              text references public.zkp_ranges(code),
  evacuation              text not null default 'nie' check (evacuation in ('nie', 'EN179', 'EN1125')),
  light                   text not null default 'brak' check (light in ('brak', 'nadswietle', 'doswietle_L', 'doswietle_P')),
  type_code               text not null default '',
  -- B. sprawdzenie zakresu (wymiary skrzydeł w świetle skrzydła, mm; masa kg)
  active_w                numeric check (active_w > 0),
  active_h                numeric check (active_h > 0),
  passive_w               numeric check (passive_w > 0),
  passive_h               numeric check (passive_h > 0),
  light_w                 numeric check (light_w > 0),
  light_h                 numeric check (light_h > 0),
  leaf_mass_kg            numeric check (leaf_mass_kg > 0),
  fill_thickness_mm       numeric check (fill_thickness_mm > 0),
  hinges_count            int check (hinges_count >= 0),
  pins_count              int check (pins_count >= 0),
  fill_ref                text not null default '',   -- tabela / wiersz raportu (cz. D)
  profiles_ref            text not null default '',   -- wiersze tabel profili i wkładów (cz. B)
  threshold_ref           text not null default '',   -- rozwiązanie progowe (cz. C)
  mounting_ref            text not null default '',   -- konstrukcja mocująca: rodzaj, grubość, gęstość (cz. G)
  profiles_ok             boolean not null default false,
  threshold_ok            boolean not null default false,
  hardware_ok             boolean not null default false,
  mounting_ok             boolean not null default false,
  range_confirmed_at      timestamptz,
  range_confirmed_by      uuid,
  range_confirmed_by_name text not null default '',
  range_reopen_reason     text not null default '',
  -- F. zwolnienie
  decision                text check (decision in ('zwolniony', 'niezgodny')),
  test_protocol_no        text not null default '',   -- protokół badań 6.17.5
  declaration_no          text not null default '',   -- KDWU / DWU
  nonconformity_ref       text not null default '',   -- rejestr 6.20
  released_on             date,
  decision_notes          text not null default '',
  decided_at              timestamptz,
  decided_by              uuid,
  decided_by_name         text not null default '',
  created_at              timestamptz not null default now(),
  created_by              uuid default auth.uid(),
  updated_at              timestamptz not null default now(),
  updated_by              uuid default auth.uid()
);
create index if not exists zkp_product_cards_order_idx on public.zkp_product_cards (order_id);

-- C. etapy (dopisywane; bieżący wpis etapu = najnowszy)
create table if not exists public.zkp_card_stage_records (
  id               bigint generated always as identity primary key,
  card_id          bigint not null references public.zkp_product_cards(id) on delete restrict,
  stage_key        text not null check (stage_key in (
                     'ciecie', 'wklady', 'usz_skrzydlo', 'usz_prog', 'usz_wypelnienie', 'usz_styk',
                     'laczenie', 'okucia', 'szklenie', 'regulacja')),
  catalog_no       text not null default '',
  lot_id           bigint references public.zkp_material_lots(id) on delete restrict,
  result           text not null check (result in ('OK', 'NOK', 'nd')),
  gaps             jsonb,             -- regulacja: {"A":{"zaw":…},…}
  notes            text not null default '',
  operator         text not null check (length(trim(operator)) > 0),
  recorded_at      timestamptz not null default now(),
  recorded_by      uuid default auth.uid(),
  recorded_by_name text not null default ''
);
create index if not exists zkp_card_stage_records_card_idx on public.zkp_card_stage_records (card_id);
create index if not exists zkp_card_stage_records_lot_idx on public.zkp_card_stage_records (lot_id);

-- D. okucia
create table if not exists public.zkp_card_hardware (
  id               bigint generated always as identity primary key,
  card_id          bigint not null references public.zkp_product_cards(id) on delete restrict,
  slot             text not null check (slot in (
                     'zamek', 'przeciwzamek', 'klamka', 'zawiasy', 'trzpienie', 'samozamykacz',
                     'rkz', 'elektro', 'odwodnienie')),
  producer_model   text not null default '',
  dwu_no           text not null default '',
  count            int not null default 0 check (count >= 0),
  condition_ref    text not null default '',
  lot_id           bigint references public.zkp_material_lots(id) on delete restrict,
  recorded_at      timestamptz not null default now(),
  recorded_by      uuid default auth.uid(),
  recorded_by_name text not null default ''
);
create index if not exists zkp_card_hardware_card_idx on public.zkp_card_hardware (card_id);

-- E. wypełnienia
create table if not exists public.zkp_card_fillings (
  id               bigint generated always as identity primary key,
  card_id          bigint not null references public.zkp_product_cards(id) on delete restrict,
  field            text not null check (field in ('czynne', 'bierne', 'nadswietle', 'doswietle')),
  table_row        text not null default '',
  product          text not null default '',
  thickness_mm     numeric check (thickness_mm > 0),
  dims             text not null default '',
  lot_id           bigint references public.zkp_material_lots(id) on delete restrict,
  recorded_at      timestamptz not null default now(),
  recorded_by      uuid default auth.uid(),
  recorded_by_name text not null default ''
);
create index if not exists zkp_card_fillings_card_idx on public.zkp_card_fillings (card_id);

-- ── 3) RLS: odczyt dla zalogowanych, zapis wyłącznie funkcjami ───────────
do $$
declare t text;
begin
  foreach t in array array['zkp_ranges', 'zkp_range_components', 'zkp_product_cards',
                           'zkp_card_stage_records', 'zkp_card_hardware', 'zkp_card_fillings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_read', t);
    execute format('drop trigger if exists %I on public.%I', 'audit_' || t, t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_trigger_fn()', 'audit_' || t, t);
  end loop;
end $$;

-- ── 4) Pomocnicze ────────────────────────────────────────────────────────
create or replace function public.zkp_current_user_name()
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce((select coalesce(nullif(full_name, ''), nullif(initials, ''), '') from public.profiles where id = auth.uid()), '');
$$;

-- kto wypełnia kartę (etapy, okucia, wypełnienia, część A/B): role ZKP produkcji albo kierownik
create or replace function public.zkp_can_fill_card()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.current_user_has_zkp_role(array['pelnomocnik', 'zastepca', 'kierownik_produkcji', 'kontroler'])
         or public.current_user_is_manager();
$$;

-- minimalna liczba z progów [[h_max, n], …]; null = wysokość ponad ostatni próg
create or replace function public.zkp_step_min(p_steps jsonb, p_h numeric)
returns int
language sql
immutable
as $$
  select (s->>1)::int
  from jsonb_array_elements(p_steps) with ordinality as e(s, i)
  where p_h <= (s->>0)::numeric
  order by i
  limit 1;
$$;

-- nr katalogowy partii na liście 6.10.5 dla zakresu? Kod „…XX" = dowolne 2 znaki koloru.
create or replace function public.zkp_catalog_allowed(p_range text, p_catalog text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  with t as (
    select upper(substring(regexp_replace(coalesce(p_catalog, ''), '\s', '', 'g') from '[A-Za-z][0-9]{3,4}(?:[Xx]{2}|[0-9]{2})?')) as tok
  )
  select coalesce((
    select exists (
      select 1 from public.zkp_range_components c
      where c.range_code = p_range
        and (c.code = t.tok
             or (c.code like '%XX' and t.tok ~ ('^' || left(c.code, length(c.code) - 2) || '([0-9]{2}|XX)$')))
    )
    from t where t.tok is not null
  ), false);
$$;

-- kod typu wyrobu wg zał. 6.8: AS75EI-W-[EI30/EI60/S]-[S/–]-[1/2]-[E/–],
-- zewnętrzne dodatkowo -[DW/NZ] przed E
create or replace function public.zkp_type_code(p_product_type text, p_range text, p_leaves int, p_opening text, p_evacuation text)
returns text
language sql
immutable
as $$
  select case when p_product_type is null or p_range is null or p_leaves is null then ''
  else 'AS75EI-' || case when p_product_type = 'drzwi_zewn' then 'Z' else 'W' end
       || '-' || case when p_range = 'S' then 'S' else left(p_range, 4) end
       || '-' || case when p_range like '%S' then 'S' else '–' end
       || '-' || p_leaves::text
       || case when p_product_type = 'drzwi_zewn'
               then '-' || case p_opening when 'do_wewnatrz' then 'DW' when 'na_zewnatrz' then 'NZ' else '?' end
               else '' end
       || '-' || case when coalesce(p_evacuation, 'nie') = 'nie' then '–' else 'E' end
  end;
$$;

-- partia do karty: przyjęta (6.24), właściwego rodzaju; opcjonalnie nr katalogowy z listy 6.10.5 zakresu
create or replace function public.zkp_assert_card_lot(p_lot_id bigint, p_range text, p_kinds text[], p_check_catalog boolean)
returns void
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v record;
begin
  select l.*, c.zkp_critical_kind as kind, c.name as component_name
  into v
  from public.zkp_material_lots l join public.warehouse_components c on c.id = l.component_id
  where l.id = p_lot_id;
  if not found then
    raise exception 'Partia % nie istnieje', p_lot_id;
  end if;
  if v.decision <> 'przyjeto' then
    raise exception 'Partia % (%) jest w stanie „%" — do produkcji tylko partie przyjęte (zał. 6.24)', v.lot_no, v.component_name, v.decision;
  end if;
  if p_kinds is not null and not (coalesce(v.kind, '') = any(p_kinds)) then
    raise exception 'Partia % to „%" — ten etap wymaga: %', v.lot_no, v.component_name, array_to_string(p_kinds, ' / ');
  end if;
  if p_check_catalog and not public.zkp_catalog_allowed(p_range, v.catalog_no) then
    raise exception 'Nr katalogowy „%" partii % nie jest na liście zał. 6.10.5 dla zakresu % — komponent spoza listy = KWARANTANNA',
      v.catalog_no, v.lot_no, p_range;
  end if;
end;
$function$;

-- ── 5) Sprawdzenie zakresu (tabela K) ────────────────────────────────────
create or replace function public.zkp_card_checks(p_card_id bigint)
returns table(r_sort int, r_key text, r_label text, r_value text, r_limit text, r_ok boolean)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  c   public.zkp_product_cards;
  r   public.zkp_ranges;
  h   numeric;
  a1  numeric;
  a2  numeric;
  n   int;
  fmt constant text := 'FM999990.00';
begin
  select * into c from public.zkp_product_cards where id = p_card_id;
  if not found then
    raise exception 'Karta % nie istnieje', p_card_id;
  end if;
  select * into r from public.zkp_ranges where code = c.range_code;

  r_sort := 1; r_key := 'ident'; r_label := 'Identyfikacja (cz. A): typ, skrzydła, kierunek, strona, zakres';
  r_value := concat_ws(' · ', c.product_type, c.leaves::text, c.opening, c.hand, c.range_code);
  r_limit := 'wszystkie pola';
  r_ok := c.product_type is not null and c.leaves is not null and c.opening is not null and c.hand is not null and c.range_code is not null;
  return next;
  if r.code is null then
    return;  -- bez zakresu nie ma limitów
  end if;

  -- skrzydło czynne
  r_sort := 2; r_key := 'leaf_active'; r_label := 'Skrzydło czynne: szer. × wys. / pow.';
  a1 := round(c.active_w * c.active_h / 1000000.0, 2);
  r_value := case when c.active_w is null or c.active_h is null then '—'
                  else c.active_w::text || ' × ' || c.active_h::text || ' mm / ' || to_char(a1, fmt) || ' m²' end;
  if coalesce(c.leaves, 1) = 1 then
    r_limit := '≤ ' || r.leaf1_w || ' × ' || r.leaf1_h || ' mm / ' || r.leaf1_area || ' m²';
    r_ok := c.active_w <= r.leaf1_w and c.active_h <= r.leaf1_h and a1 <= r.leaf1_area;
  else
    r_limit := 'szer. ≤ ' || r.leaf2_active_w || ', wys. ≤ ' || r.leaf2_h || ' mm / ' || r.leaf2_active_area || ' m²';
    r_ok := c.active_w <= r.leaf2_active_w and c.active_h <= r.leaf2_h and a1 <= r.leaf2_active_area;
  end if;
  r_ok := coalesce(r_ok, false);
  return next;

  if c.leaves = 2 then
    r_sort := 3; r_key := 'leaf_passive'; r_label := 'Skrzydło bierne; sumy szerokości i powierzchni';
    a2 := round(c.passive_w * c.passive_h / 1000000.0, 2);
    r_value := case when c.passive_w is null or c.passive_h is null then '—'
                    else c.passive_w::text || ' × ' || c.passive_h::text || ' mm / ' || to_char(a2, fmt) || ' m²; suma '
                         || (c.active_w + c.passive_w)::text || ' mm / ' || to_char(a1 + a2, fmt) || ' m²' end;
    r_limit := 'szer. ≤ ' || r.leaf2_passive_w || ', wys. ≤ ' || r.leaf2_h || ', pow. ≤ ' || r.leaf2_passive_area
               || '; suma ≤ ' || r.leaf2_sum_w || ' mm / ' || r.leaf2_sum_area || ' m²';
    r_ok := coalesce(c.passive_w <= r.leaf2_passive_w and c.passive_h <= r.leaf2_h and a2 <= r.leaf2_passive_area
                     and c.active_w + c.passive_w <= r.leaf2_sum_w and a1 + a2 <= r.leaf2_sum_area, false);
    return next;
  end if;

  if c.light <> 'brak' then
    r_sort := 4; r_key := 'light';
    r_label := case when c.light = 'nadswietle' then 'Nadświetle' else 'Doświetle' end || ': szer. × wys. / pow.';
    a2 := round(c.light_w * c.light_h / 1000000.0, 2);
    r_value := case when c.light_w is null or c.light_h is null then '—'
                    else c.light_w::text || ' × ' || c.light_h::text || ' mm / ' || to_char(a2, fmt) || ' m²' end;
    if c.light = 'nadswietle' then
      r_limit := case when r.transom_w is null then 'niedopuszczone w zakresie ' || r.code
                      else '≤ ' || r.transom_w || ' × ' || r.transom_h || ' mm / ' || r.transom_area || ' m²' end;
      r_ok := coalesce(r.transom_w is not null and c.light_w <= r.transom_w and c.light_h <= r.transom_h and a2 <= r.transom_area, false);
    else
      r_limit := case when r.side_w is null then 'niedopuszczone w zakresie ' || r.code
                      else '≤ ' || r.side_w || ' × ' || r.side_h || ' mm / ' || r.side_area || ' m²' end;
      r_ok := coalesce(r.side_w is not null and c.light_w <= r.side_w and c.light_h <= r.side_h and a2 <= r.side_area, false);
    end if;
    return next;
  end if;

  r_sort := 5; r_key := 'mass'; r_label := 'Masa skrzydła (obliczona)';
  r_value := coalesce(c.leaf_mass_kg::text || ' kg', '—');
  r_limit := '≤ ' || r.mass_max || ' kg';
  r_ok := coalesce(c.leaf_mass_kg <= r.mass_max, false);
  return next;

  r_sort := 6; r_key := 'fill'; r_label := 'Grubość wypełnienia G';
  r_value := coalesce(c.fill_thickness_mm::text || ' mm', '—') || case when c.fill_ref <> '' then ' · ' || c.fill_ref else '' end;
  r_limit := r.fill_min || '–' || r.fill_max || ' mm (zał. 6.10.5 cz. D)';
  r_ok := coalesce(c.fill_thickness_mm between r.fill_min and r.fill_max, false);
  return next;

  h := greatest(c.active_h, coalesce(c.passive_h, 0));
  n := public.zkp_step_min(r.hinge_steps, h);
  r_sort := 7; r_key := 'hinges'; r_label := 'Liczba zawiasów (na skrzydło)';
  r_value := coalesce(c.hinges_count::text, '—');
  r_limit := case when h is null then 'podaj wysokość skrzydła'
                  when n is null then 'wysokość ponad tabelę K'
                  else 'min. ' || n || ' przy h = ' || h || ' mm' end;
  r_ok := coalesce(n is not null and c.hinges_count >= n, false);
  return next;

  n := public.zkp_step_min(r.pin_steps, h);
  r_sort := 8; r_key := 'pins'; r_label := 'Trzpienie antywyważeniowe (B731 + B732)';
  r_value := coalesce(c.pins_count::text, '—');
  if not r.pins_mandatory and coalesce(c.pins_count, 0) = 0 then
    r_limit := 'opcjonalne w zakresie ' || r.code;
    r_ok := true;
  else
    r_limit := case when h is null then 'podaj wysokość skrzydła'
                    when n is null then 'wysokość ponad tabelę K'
                    else 'min. ' || n || ' przy h = ' || h || ' mm' || case when r.pins_mandatory then ' (obowiązkowe)' else '' end end;
    r_ok := coalesce(n is not null and c.pins_count >= n, false);
  end if;
  return next;

  r_sort := 9; r_key := 'profiles'; r_label := 'Profile i wkłady — wiersze tabel raportu (6.10.5 cz. B)';
  r_value := nullif(c.profiles_ref, ''); r_limit := 'potwierdzenie'; r_ok := c.profiles_ok; return next;
  r_sort := 10; r_key := 'threshold'; r_label := 'Rozwiązanie progowe (6.10.5 cz. C)';
  r_value := nullif(c.threshold_ref, ''); r_limit := 'potwierdzenie'; r_ok := c.threshold_ok; return next;
  r_sort := 11; r_key := 'hardware'; r_label := 'Okucia z listy dla zakresu (6.10.5 cz. F)';
  r_value := null; r_limit := 'potwierdzenie'; r_ok := c.hardware_ok; return next;
  r_sort := 12; r_key := 'mounting'; r_label := 'Konstrukcja mocująca w obiekcie (6.10.5 cz. G)';
  r_value := nullif(c.mounting_ref, ''); r_limit := 'potwierdzenie'; r_ok := c.mounting_ok; return next;
end;
$function$;

-- ── 6) RPC: zapis części A/B (tworzy kartę przy pierwszym zapisie) ───────
create or replace function public.zkp_save_card(p_construction_id bigint, p_data jsonb)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_con  record;
  v_card public.zkp_product_cards;
  d      jsonb := coalesce(p_data, '{}'::jsonb);
begin
  if not public.zkp_can_fill_card() then
    raise exception 'Kartę wyrobu wypełnia Pełnomocnik, Zastępca, Kierownik Produkcji, kontroler (role ZKP) albo kierownik';
  end if;
  select * into v_con from public.alu_constructions where id = p_construction_id;
  if not found then
    raise exception 'Konstrukcja % nie istnieje', p_construction_id;
  end if;
  if v_con.status <> 'aktywna' then
    raise exception 'Konstrukcja % jest anulowana', v_con.construction_no;
  end if;
  if not public.alu_order_is_zkp(v_con.order_id) then
    raise exception 'Zlecenie nie podlega ZKP (AS 75EI) — karta wyrobu niepotrzebna';
  end if;

  select * into v_card from public.zkp_product_cards where construction_id = p_construction_id for update;
  if found and v_card.decision is not null then
    raise exception 'Karta % jest już zamknięta decyzją „%"', v_con.construction_no, v_card.decision;
  end if;
  if found and v_card.range_confirmed_at is not null then
    raise exception 'Zakres karty % jest potwierdzony — zmiana części A/B wymaga cofnięcia potwierdzenia', v_con.construction_no;
  end if;
  if not found then
    insert into public.zkp_product_cards (construction_id, order_id) values (p_construction_id, v_con.order_id)
    returning * into v_card;
  end if;

  update public.zkp_product_cards set
    product_type      = nullif(d->>'product_type', ''),
    leaves            = nullif(d->>'leaves', '')::int,
    opening           = nullif(d->>'opening', ''),
    hand              = nullif(d->>'hand', ''),
    range_code        = nullif(d->>'range_code', ''),
    evacuation        = coalesce(nullif(d->>'evacuation', ''), 'nie'),
    light             = coalesce(nullif(d->>'light', ''), 'brak'),
    active_w          = nullif(d->>'active_w', '')::numeric,
    active_h          = nullif(d->>'active_h', '')::numeric,
    passive_w         = case when nullif(d->>'leaves', '')::int = 2 then nullif(d->>'passive_w', '')::numeric end,
    passive_h         = case when nullif(d->>'leaves', '')::int = 2 then nullif(d->>'passive_h', '')::numeric end,
    light_w           = case when coalesce(nullif(d->>'light', ''), 'brak') <> 'brak' then nullif(d->>'light_w', '')::numeric end,
    light_h           = case when coalesce(nullif(d->>'light', ''), 'brak') <> 'brak' then nullif(d->>'light_h', '')::numeric end,
    leaf_mass_kg      = nullif(d->>'leaf_mass_kg', '')::numeric,
    fill_thickness_mm = nullif(d->>'fill_thickness_mm', '')::numeric,
    hinges_count      = nullif(d->>'hinges_count', '')::int,
    pins_count        = nullif(d->>'pins_count', '')::int,
    fill_ref          = trim(coalesce(d->>'fill_ref', '')),
    profiles_ref      = trim(coalesce(d->>'profiles_ref', '')),
    threshold_ref     = trim(coalesce(d->>'threshold_ref', '')),
    mounting_ref      = trim(coalesce(d->>'mounting_ref', '')),
    profiles_ok       = coalesce((d->>'profiles_ok')::boolean, false),
    threshold_ok      = coalesce((d->>'threshold_ok')::boolean, false),
    hardware_ok       = coalesce((d->>'hardware_ok')::boolean, false),
    mounting_ok       = coalesce((d->>'mounting_ok')::boolean, false),
    type_code         = public.zkp_type_code(nullif(d->>'product_type', ''), nullif(d->>'range_code', ''),
                          nullif(d->>'leaves', '')::int, nullif(d->>'opening', ''), coalesce(nullif(d->>'evacuation', ''), 'nie')),
    updated_at        = now(),
    updated_by        = auth.uid()
  where id = v_card.id;

  return v_card.id;
end;
$function$;

-- Potwierdzenie zakresu (zał. 6.25 cz. B): PJ / Zastępca / Kierownik Produkcji, wszystkie sprawdzenia OK
create or replace function public.zkp_confirm_card_range(p_card_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_bad text;
begin
  if not public.current_user_has_zkp_role(array['pelnomocnik', 'zastepca', 'kierownik_produkcji']) then
    raise exception 'Zakres potwierdza Pełnomocnik ZKP, Zastępca albo Kierownik Produkcji';
  end if;
  perform 1 from public.zkp_product_cards where id = p_card_id and decision is null and range_confirmed_at is null for update;
  if not found then
    raise exception 'Karta jest już potwierdzona albo zamknięta';
  end if;
  select string_agg(r_label, '; ' order by r_sort) into v_bad from public.zkp_card_checks(p_card_id) where not r_ok;
  if v_bad is not null then
    raise exception 'Zakres niezgodny albo niekompletny: %', v_bad;
  end if;
  update public.zkp_product_cards
  set range_confirmed_at = now(), range_confirmed_by = auth.uid(), range_confirmed_by_name = public.zkp_current_user_name()
  where id = p_card_id;
end;
$function$;

create or replace function public.zkp_reopen_card_range(p_card_id bigint, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.current_user_has_zkp_role(array['pelnomocnik', 'zastepca', 'kierownik_produkcji']) then
    raise exception 'Cofnąć potwierdzenie zakresu może Pełnomocnik ZKP, Zastępca albo Kierownik Produkcji';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Podaj powód cofnięcia potwierdzenia';
  end if;
  update public.zkp_product_cards
  set range_confirmed_at = null, range_confirmed_by = null, range_confirmed_by_name = '',
      range_reopen_reason = trim(p_reason), updated_at = now(), updated_by = auth.uid()
  where id = p_card_id and decision is null and range_confirmed_at is not null;
  if not found then
    raise exception 'Karta nie ma potwierdzonego zakresu albo jest zamknięta';
  end if;
end;
$function$;

-- ── 7) RPC: etap (C), okucie (D), wypełnienie (E) ────────────────────────
create or replace function public.zkp_record_card_stage(
  p_card_id bigint, p_stage_key text, p_catalog_no text, p_lot_id bigint, p_result text,
  p_gaps jsonb, p_notes text, p_operator text
)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_card  public.zkp_product_cards;
  v_range public.zkp_ranges;
  v_kinds text[];
  v_bad   text;
  v_id    bigint;
begin
  if not public.zkp_can_fill_card() then
    raise exception 'Etapy karty wyrobu zapisuje kontroler / Kierownik Produkcji / PJ (role ZKP) albo kierownik';
  end if;
  select * into v_card from public.zkp_product_cards where id = p_card_id for update;
  if not found then
    raise exception 'Karta % nie istnieje', p_card_id;
  end if;
  if v_card.decision is not null then
    raise exception 'Karta jest zamknięta decyzją „%"', v_card.decision;
  end if;
  if v_card.range_confirmed_at is null then
    raise exception 'Najpierw sprawdzenie i potwierdzenie zakresu (cz. B) — dopiero potem produkcja';
  end if;
  if length(trim(coalesce(p_operator, ''))) = 0 then
    raise exception 'Podaj operatora (inicjały)';
  end if;
  if p_result not in ('OK', 'NOK', 'nd') then
    raise exception 'Wynik: OK, NOK albo n/d';
  end if;
  if p_result = 'nd' and p_stage_key not in ('usz_prog', 'usz_styk') then
    raise exception '„Nie dotyczy" dopuszczalne tylko dla uszczelek progu i styku z profilem odwracającym / ścianą';
  end if;
  select * into v_range from public.zkp_ranges where code = v_card.range_code;

  v_kinds := case p_stage_key
    when 'wklady' then array['wklad']
    when 'usz_skrzydlo' then array['uszczelka']
    when 'usz_prog' then array['uszczelka']
    when 'usz_wypelnienie' then array['uszczelka']
    when 'usz_styk' then array['uszczelka']
    else null end;

  -- etapy K z komponentem krytycznym: partia obowiązkowa przy OK
  if v_kinds is not null and p_result = 'OK' and p_lot_id is null then
    raise exception 'Etap krytyczny — wybierz partię komponentu (nr partii z rejestru przyjęć 6.24)';
  end if;
  if p_lot_id is not null then
    perform public.zkp_assert_card_lot(p_lot_id, v_card.range_code, v_kinds, v_kinds is not null);
  end if;

  if p_stage_key = 'regulacja' and p_result = 'OK' then
    select string_agg(g.k || ' ' || e.k || ' ' || (p_gaps->g.k->>e.k) || ' > ' || (v_range.gaps->g.k->>e.k), ', ')
    into v_bad
    from (values ('A'), ('B'), ('C')) g(k) cross join (values ('zaw'), ('zamk'), ('nad')) e(k)
    where p_gaps->g.k->>e.k is null
       or (p_gaps->g.k->>e.k)::numeric > (v_range.gaps->g.k->>e.k)::numeric;
    if v_bad is not null then
      raise exception 'Szczeliny poza limitem zakresu % albo niewpisane (mm): %', v_range.code, v_bad;
    end if;
  end if;

  insert into public.zkp_card_stage_records
    (card_id, stage_key, catalog_no, lot_id, result, gaps, notes, operator, recorded_by, recorded_by_name)
  values
    (p_card_id, p_stage_key, trim(coalesce(p_catalog_no, '')), p_lot_id, p_result,
     case when p_stage_key = 'regulacja' then p_gaps end, trim(coalesce(p_notes, '')), trim(p_operator),
     auth.uid(), public.zkp_current_user_name())
  returning id into v_id;
  return v_id;
end;
$function$;

create or replace function public.zkp_save_card_hardware(
  p_card_id bigint, p_slot text, p_producer_model text, p_dwu_no text, p_count int, p_condition_ref text, p_lot_id bigint
)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_card public.zkp_product_cards;
  v_id   bigint;
begin
  if not public.zkp_can_fill_card() then
    raise exception 'Okucia w karcie wpisuje kontroler / Kierownik Produkcji / PJ (role ZKP) albo kierownik';
  end if;
  select * into v_card from public.zkp_product_cards where id = p_card_id for update;
  if not found or v_card.decision is not null then
    raise exception 'Karta nie istnieje albo jest zamknięta';
  end if;
  if p_lot_id is not null then
    perform public.zkp_assert_card_lot(p_lot_id, v_card.range_code, array['okucie'], false);
  end if;
  insert into public.zkp_card_hardware
    (card_id, slot, producer_model, dwu_no, count, condition_ref, lot_id, recorded_by, recorded_by_name)
  values
    (p_card_id, p_slot, trim(coalesce(p_producer_model, '')), trim(coalesce(p_dwu_no, '')), coalesce(p_count, 0),
     trim(coalesce(p_condition_ref, '')), p_lot_id, auth.uid(), public.zkp_current_user_name())
  returning id into v_id;
  return v_id;
end;
$function$;

create or replace function public.zkp_save_card_filling(
  p_card_id bigint, p_field text, p_table_row text, p_product text, p_thickness numeric, p_dims text, p_lot_id bigint
)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_card  public.zkp_product_cards;
  v_range public.zkp_ranges;
  v_id    bigint;
begin
  if not public.zkp_can_fill_card() then
    raise exception 'Wypełnienia w karcie wpisuje kontroler / Kierownik Produkcji / PJ (role ZKP) albo kierownik';
  end if;
  select * into v_card from public.zkp_product_cards where id = p_card_id for update;
  if not found or v_card.decision is not null then
    raise exception 'Karta nie istnieje albo jest zamknięta';
  end if;
  select * into v_range from public.zkp_ranges where code = v_card.range_code;
  if p_thickness is not null and v_range.code is not null
     and (p_thickness < v_range.fill_min or p_thickness > v_range.fill_max) then
    raise exception 'Grubość wypełnienia % mm poza zakresem % (% – % mm)', p_thickness, v_range.code, v_range.fill_min, v_range.fill_max;
  end if;
  if p_lot_id is not null then
    perform public.zkp_assert_card_lot(p_lot_id, v_card.range_code, array['szklo', 'wypelnienie'], false);
  end if;
  insert into public.zkp_card_fillings
    (card_id, field, table_row, product, thickness_mm, dims, lot_id, recorded_by, recorded_by_name)
  values
    (p_card_id, p_field, trim(coalesce(p_table_row, '')), trim(coalesce(p_product, '')), p_thickness,
     trim(coalesce(p_dims, '')), p_lot_id, auth.uid(), public.zkp_current_user_name())
  returning id into v_id;
  return v_id;
end;
$function$;

-- ── 8) RPC: zwolnienie (cz. F) ───────────────────────────────────────────
-- Braki do zwolnienia — ta sama lista w oknie karty i w decyzji.
create or replace function public.zkp_card_release_problems(p_card_id bigint)
returns table(r_problem text)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  c     public.zkp_product_cards;
  rng   public.zkp_ranges;
  h     numeric;
  n     int;
  v_cnt int;
begin
  select * into c from public.zkp_product_cards where id = p_card_id;
  if not found then
    r_problem := 'karta nie istnieje'; return next; return;
  end if;
  select * into rng from public.zkp_ranges where code = c.range_code;
  if c.range_confirmed_at is null then
    r_problem := 'zakres (cz. B) niepotwierdzony'; return next;
  end if;

  -- etapy: bieżący wpis każdego etapu musi być OK (albo n/d tam, gdzie wolno)
  return query
    with cur as (
      select distinct on (s.stage_key) s.stage_key, s.result
      from public.zkp_card_stage_records s where s.card_id = p_card_id
      order by s.stage_key, s.id desc
    )
    select 'etap „' || k.label || '" — ' || coalesce(case cur.result when 'NOK' then 'NOK' end, 'brak wpisu')
    from (values (1, 'ciecie', 'Cięcie i obróbka'), (2, 'wklady', 'Wkłady ogniochronne'),
                 (3, 'usz_skrzydlo', 'Uszczelki — obwiednia skrzydła'), (4, 'usz_prog', 'Uszczelki — próg'),
                 (5, 'usz_wypelnienie', 'Uszczelki — obwiednia wypełnienia'), (6, 'usz_styk', 'Uszczelki — styk / ściana'),
                 (7, 'laczenie', 'Łączenie, uszczelki przymykowe, próg'), (8, 'okucia', 'Okucia'),
                 (9, 'szklenie', 'Szklenie / wypełnienie'), (10, 'regulacja', 'Regulacja (szczeliny)')) k(sort, key, label)
    left join cur on cur.stage_key = k.key
    where cur.result is null or cur.result = 'NOK'
    order by k.sort;

  -- okucia: zawiasy i trzpienie wg tabeli K
  h := greatest(c.active_h, coalesce(c.passive_h, 0));
  select x.count into v_cnt from (
    select distinct on (slot) slot, count from public.zkp_card_hardware where card_id = p_card_id order by slot, id desc
  ) x where x.slot = 'zawiasy';
  n := public.zkp_step_min(rng.hinge_steps, h);
  if v_cnt is null then
    r_problem := 'okucia (cz. D): brak wpisu zawiasów'; return next;
  elsif n is not null and v_cnt < n then
    r_problem := 'okucia (cz. D): zawiasów ' || v_cnt || ', wymagane min. ' || n; return next;
  end if;
  v_cnt := null;
  select x.count into v_cnt from (
    select distinct on (slot) slot, count from public.zkp_card_hardware where card_id = p_card_id order by slot, id desc
  ) x where x.slot = 'trzpienie';
  n := public.zkp_step_min(rng.pin_steps, h);
  if rng.pins_mandatory and (v_cnt is null or (n is not null and v_cnt < n)) then
    r_problem := 'okucia (cz. D): trzpienie antywyważeniowe ' || coalesce(v_cnt::text, 'brak') || ', wymagane min. ' || coalesce(n::text, '?');
    return next;
  end if;
  if not exists (select 1 from public.zkp_card_hardware where card_id = p_card_id and slot = 'zamek') then
    r_problem := 'okucia (cz. D): brak wpisu zamka / elektrozaczepu'; return next;
  end if;

  -- wypełnienia: pola wynikające z części A
  return query
    select 'wypełnienia (cz. E): brak pola „' || f.label || '"'
    from (values ('czynne', 'skrzydło czynne', true),
                 ('bierne', 'skrzydło bierne', c.leaves = 2),
                 ('nadswietle', 'nadświetle', c.light = 'nadswietle'),
                 ('doswietle', 'doświetle', c.light in ('doswietle_L', 'doswietle_P'))) f(key, label, needed)
    where f.needed and not exists (select 1 from public.zkp_card_fillings x where x.card_id = p_card_id and x.field = f.key);
end;
$function$;

create or replace function public.zkp_decide_card(
  p_card_id bigint, p_decision text, p_test_protocol_no text, p_declaration_no text,
  p_released_on date, p_nonconformity_ref text, p_notes text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_bad text;
begin
  if not public.current_user_has_zkp_role(array['pelnomocnik', 'zastepca']) then
    raise exception 'Konstrukcję zwalnia Pełnomocnik ZKP albo Zastępca (zał. 6.4)';
  end if;
  if p_decision not in ('zwolniony', 'niezgodny') then
    raise exception 'Decyzja: zwolniony albo niezgodny';
  end if;
  perform 1 from public.zkp_product_cards where id = p_card_id and decision is null for update;
  if not found then
    raise exception 'Karta nie istnieje albo ma już decyzję';
  end if;
  if p_decision = 'zwolniony' then
    select string_agg(r_problem, '; ') into v_bad from public.zkp_card_release_problems(p_card_id);
    if v_bad is not null then
      raise exception 'Nie można zwolnić: %', v_bad;
    end if;
  elsif length(trim(coalesce(p_nonconformity_ref, ''))) = 0 then
    raise exception 'Niezgodność — podaj nr wpisu w rejestrze 6.20';
  end if;
  update public.zkp_product_cards
  set decision = p_decision,
      test_protocol_no = trim(coalesce(p_test_protocol_no, '')),
      declaration_no = trim(coalesce(p_declaration_no, '')),
      released_on = p_released_on,
      nonconformity_ref = trim(coalesce(p_nonconformity_ref, '')),
      decision_notes = trim(coalesce(p_notes, '')),
      decided_at = now(), decided_by = auth.uid(), decided_by_name = public.zkp_current_user_name(),
      updated_at = now(), updated_by = auth.uid()
  where id = p_card_id;
end;
$function$;

-- ── 9) Rejestr wyrobów (zał. 6.33) — wszystkie konstrukcje zleceń ZKP ────
create or replace function public.zkp_product_register()
returns table(
  r_construction_id bigint, r_construction_no text, r_year int, r_zz int, r_pp int, r_status text,
  r_order_id bigint, r_order_number text, r_company text, r_pos_no int, r_started_at timestamptz,
  r_release_date date, r_card_id bigint, r_product_type text, r_range_code text, r_type_code text,
  r_leaves int, r_active_w numeric, r_active_h numeric, r_range_confirmed boolean, r_decision text,
  r_test_protocol_no text, r_declaration_no text, r_released_on date, r_decided_by_name text,
  r_decided_at timestamptz, r_mont_doc boolean
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select k.id, k.construction_no, k.year, k.zz, k.pp, k.status,
         o.id, o.order_number, o.company, k.pos_no, p.started_at,
         o.release_date,
         c.id, c.product_type, c.range_code, c.type_code, c.leaves, c.active_w, c.active_h,
         c.range_confirmed_at is not null, c.decision, c.test_protocol_no, c.declaration_no, c.released_on,
         c.decided_by_name, c.decided_at,
         exists (select 1 from public.order_documents d where d.order_id = o.id and d.kind = 'MONT' and d.withdrawn_at is null)
  from public.alu_constructions k
  join public.orders o on o.id = k.order_id
  left join public.alu_production_orders p on p.order_id = k.order_id
  left join public.zkp_product_cards c on c.construction_id = k.id
  where public.alu_order_is_zkp(k.order_id)
  order by k.year desc, k.zz desc, k.pp;
$$;

-- ── 10) Teczka: karta wyrobu / PZ / RW z kart (reszta bez zmian, zkp_02) ─
create or replace function public.alu_dossier_status(p_order_id bigint)
returns table(r_sort int, r_item_key text, r_label text, r_status text, r_detail text,
              r_document_id bigint, r_na_id bigint, r_at timestamptz, r_by text, r_na_allowed boolean)
language sql
stable
security definer
set search_path to 'public'
as $$
  with cur as (   -- bieżąca (najnowsza niewycofana) wersja każdego rodzaju
    select distinct on (d.kind) d.*
    from public.order_documents d
    where d.order_id = p_order_id and d.withdrawn_at is null
    order by d.kind, d.version desc
  ),
  na as (
    select n.* from public.zkp_dossier_na n
    where n.order_id = p_order_id and n.withdrawn_at is null
  ),
  cards as (      -- karty wyrobu aktywnych konstrukcji zlecenia
    select count(*) as total,
           count(*) filter (where c.decision = 'zwolniony') as released,
           max(c.decided_at) as last_at,
           (array_agg(c.decided_by_name order by c.decided_at desc nulls last))[1] as last_by
    from public.alu_constructions k
    left join public.zkp_product_cards c on c.construction_id = k.id
    where k.order_id = p_order_id and k.status = 'aktywna'
  ),
  lots as (       -- partie użyte w kartach zlecenia (etapy, okucia, wypełnienia)
    select count(distinct x.lot_id) as n
    from public.zkp_product_cards c
    join lateral (
      select s.lot_id from public.zkp_card_stage_records s where s.card_id = c.id and s.lot_id is not null
      union all select h.lot_id from public.zkp_card_hardware h where h.card_id = c.id and h.lot_id is not null
      union all select f.lot_id from public.zkp_card_fillings f where f.card_id = c.id and f.lot_id is not null
    ) x on true
    where c.order_id = p_order_id
  ),
  cards_done as (
    select (cards.total > 0 and cards.released = cards.total) as done, cards.* from cards
  ),
  items(sort, key, label, kinds, na_allowed, generated_in) as (values
    (1,  'zamowienie_klienta',      'Zamówienie klienta',                       array['ZK'],         true,  null),
    (2,  'zlecenie_produkcyjne',    'Zlecenie produkcyjne (zał. 6.30)',          array[]::text[],     false, 'etap C'),
    (3,  'lista_ciec',              'Lista cięć',                                array['LC'],         false, null),
    (4,  'zestawienie_materialowe', 'Zestawienie materiałowe (Lista produkcyjna)', array['LP'],       false, null),
    (5,  'zamowienia_materialow',   'Zamówienia materiałów (szkło, profile, okucia)', array['ZM','ZMAT'], true, null),
    (6,  'przyjecia_pz',            'Dokumenty przyjęcia do magazynu (PZ)',      array[]::text[],     false, 'karty wyrobu'),
    (7,  'wydania_rw',              'Wydania materiałów na zlecenie (RW, partie)', array[]::text[],   false, 'karty wyrobu'),
    (8,  'karta_wyrobu',            'Karta wyrobu (zał. 6.25)',                  array[]::text[],     false, 'karty wyrobu'),
    (9,  'protokol_badan',          'Protokół badań wyrobu gotowego (zał. 6.17.5)', array[]::text[],  false, 'etap D'),
    (10, 'deklaracja',              'Deklaracja KDWU / DWU',                     array[]::text[],     false, 'etap E'),
    (11, 'protokol_montazu',        'Protokół montażu (zał. 6.28)',              array['MONT'],       true,  null)
  )
  select i.sort, i.key, i.label,
         case when doc.id is not null then 'jest'
              when n.id is not null then 'nie_dotyczy'
              when i.key in ('przyjecia_pz', 'wydania_rw', 'karta_wyrobu') and cd.done then 'jest'
              else 'brak' end,
         case when doc.id is not null then
                doc.kind || ' v' || doc.version || ' · ' || doc.file_name
                || coalesce(' · ' || doc.number, '')
              when n.id is not null then n.reason
              when i.key = 'karta_wyrobu' then
                'zwolnione karty: ' || cd.released || ' / ' || cd.total
              when i.key in ('przyjecia_pz', 'wydania_rw') then
                case when cd.done then 'partie w kartach wyrobu: ' || (select lots.n from lots) || ' (rejestr przyjęć 6.24)'
                     else 'z kart wyrobu — zwolnione ' || cd.released || ' / ' || cd.total end
              when i.generated_in is not null then 'generowane przez program — ' || i.generated_in
              else '' end,
         doc.id, n.id,
         coalesce(doc.uploaded_at, n.created_at,
                  case when i.key in ('przyjecia_pz', 'wydania_rw', 'karta_wyrobu') and cd.done then cd.last_at end),
         coalesce(nullif(doc.uploaded_by_name, ''), n.created_by_name,
                  case when i.key in ('przyjecia_pz', 'wydania_rw', 'karta_wyrobu') and cd.done then cd.last_by end),
         i.na_allowed
  from items i
  cross join cards_done cd
  left join lateral (
    select c.* from cur c where c.kind = any(i.kinds) order by c.uploaded_at desc limit 1
  ) doc on true
  left join na n on n.item_key = i.key
  order by i.sort;
$$;

-- ── 11) Uprawnienia ──────────────────────────────────────────────────────
revoke all on function public.zkp_current_user_name() from public, anon;
revoke all on function public.zkp_can_fill_card() from public, anon;
revoke all on function public.zkp_step_min(jsonb, numeric) from public, anon;
revoke all on function public.zkp_catalog_allowed(text, text) from public, anon;
revoke all on function public.zkp_type_code(text, text, int, text, text) from public, anon;
revoke all on function public.zkp_assert_card_lot(bigint, text, text[], boolean) from public, anon, authenticated;
revoke all on function public.zkp_card_checks(bigint) from public, anon;
revoke all on function public.zkp_save_card(bigint, jsonb) from public, anon;
revoke all on function public.zkp_confirm_card_range(bigint) from public, anon;
revoke all on function public.zkp_reopen_card_range(bigint, text) from public, anon;
revoke all on function public.zkp_record_card_stage(bigint, text, text, bigint, text, jsonb, text, text) from public, anon;
revoke all on function public.zkp_save_card_hardware(bigint, text, text, text, int, text, bigint) from public, anon;
revoke all on function public.zkp_save_card_filling(bigint, text, text, text, numeric, text, bigint) from public, anon;
revoke all on function public.zkp_card_release_problems(bigint) from public, anon;
revoke all on function public.zkp_decide_card(bigint, text, text, text, date, text, text) from public, anon;
revoke all on function public.zkp_product_register() from public, anon;
revoke all on function public.alu_dossier_status(bigint) from public, anon;

grant execute on function public.zkp_current_user_name() to authenticated, service_role;
grant execute on function public.zkp_can_fill_card() to authenticated, service_role;
grant execute on function public.zkp_step_min(jsonb, numeric) to authenticated, service_role;
grant execute on function public.zkp_catalog_allowed(text, text) to authenticated, service_role;
grant execute on function public.zkp_type_code(text, text, int, text, text) to authenticated, service_role;
grant execute on function public.zkp_card_checks(bigint) to authenticated, service_role;
grant execute on function public.zkp_save_card(bigint, jsonb) to authenticated, service_role;
grant execute on function public.zkp_confirm_card_range(bigint) to authenticated, service_role;
grant execute on function public.zkp_reopen_card_range(bigint, text) to authenticated, service_role;
grant execute on function public.zkp_record_card_stage(bigint, text, text, bigint, text, jsonb, text, text) to authenticated, service_role;
grant execute on function public.zkp_save_card_hardware(bigint, text, text, text, int, text, bigint) to authenticated, service_role;
grant execute on function public.zkp_save_card_filling(bigint, text, text, text, numeric, text, bigint) to authenticated, service_role;
grant execute on function public.zkp_card_release_problems(bigint) to authenticated, service_role;
grant execute on function public.zkp_decide_card(bigint, text, text, text, date, text, text) to authenticated, service_role;
grant execute on function public.zkp_product_register() to authenticated, service_role;
grant execute on function public.alu_dossier_status(bigint) to authenticated, service_role;
