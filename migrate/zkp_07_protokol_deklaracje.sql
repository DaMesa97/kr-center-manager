-- =====================================================================
-- ZKP AS 75EI — etap D+E: PROTOKÓŁ BADAŃ WYROBU GOTOWEGO (zał. 6.17.5),
-- DEKLARACJE KDWU / DWU (zał. 6.9), TABLICZKA 6.26 / ETYKIETA 6.8 (dane)
-- (2026-10-30)
--
-- Protokół 6.17.5 — jeden na konstrukcję (numer protokołu = numer konstrukcji;
-- po WSTRZYMANIU i naprawie nowy, kompletny protokół = /2, /3 …):
--   A identyfikacja (z karty), B przegląd dokumentacji (5 sprawdzeń), C pomiary
--   (nominal z karty, zmierzone wpisuje kontroler, kryteria z tabeli K — wynik
--   liczy BAZA tam, gdzie da się policzyć), D oględziny (8), E sprawdzenia
--   funkcjonalne (7), F oznakowanie (2), G ocena i decyzja.
--   Kontrolę wykonuje osoba z uprawnieniem „kontrola_odbiorcza" w matrycy 6.27
--   (podpis inicjałami jak etapy karty); zwalnia Pełnomocnik / Zastępca.
--   Jedno NOK w B–F = WSTRZYMANY (baza nie pozwoli zwolnić). Zwolnienie zamyka
--   kartę wyrobu (cz. F) z numerem protokołu i datą — ręczne „zwolniony" w
--   zkp_decide_card jest od teraz zablokowane bez zwolnionego protokołu.
--
-- Deklaracja (zał. 6.9) — do zlecenia, może objąć kilka konstrukcji TEGO SAMEGO
-- typu (kod typu 6.8) ze zwolnionymi kartami. Numer KDWU/RR/NNNN (drzwi wewn.)
-- albo DWU/RR/NNNN (zewn.) z licznika per rodzaj i rok. Wartości przepisywane z
-- karty (klasa, dymoszczelność, zdolność do zwolnienia, wysokość). Numery
-- certyfikatów, sprawozdań LTB, podpisujący — w zkp_settings (prowadzi PJ).
-- Wycofanie z powodem zamiast kasowania (zał. 6.34). Numer wraca do kart.
--
-- Teczka: „Protokół badań" i „Deklaracja" = jest, gdy wszystkie aktywne
-- konstrukcje zlecenia je mają.
--
-- Wymaga: zkp_05, zkp_06. Bezpieczne do ponownego uruchomienia.
-- =====================================================================

-- ── 1) Ustawienia ZKP (certyfikaty, podpisujący) ─────────────────────────
create table if not exists public.zkp_settings (
  key             text primary key,
  value           text not null default '',
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  updated_by_name text not null default ''
);
alter table public.zkp_settings enable row level security;
drop policy if exists zkp_settings_read on public.zkp_settings;
create policy zkp_settings_read on public.zkp_settings for select to authenticated using (true);
drop trigger if exists audit_zkp_settings on public.zkp_settings;
create trigger audit_zkp_settings after insert or update or delete on public.zkp_settings
  for each row execute function public.audit_trigger_fn();

insert into public.zkp_settings (key, value) values
  ('cert_krajowy_nr', ''),            -- krajowy certyfikat CERTBUD AC 158 (KDWU pkt 7)
  ('cert_ce_nr', ''),                 -- certyfikat stałości CERTBUD NB 2310 (DWU pkt 6a)
  ('ltb_sprawozdania', ''),           -- sprawozdania LTB NB 1827 (DWU pkt 6a) — zał. 6.7 cz. C
  ('odt', 'ODT/MRP/1'),
  ('mounting_default', ''),           -- konstrukcje mocujące (pkt 3 / 2 deklaracji) wg raportu 2.2.2.8 / 2.2.3.8
  ('signer_name', ''),                -- podpisujący deklaracje (Właściciel / osoba upoważniona, zał. 6.4)
  ('signer_title', ''),
  ('ud_default', 'NPD'),              -- UD do czasu obliczeń ALURON (zał. 6.7 cz. C)
  ('impact_default', 'NPD')           -- odporność na uderzenie do czasu świadectw ITT dla wariantów
on conflict (key) do nothing;

create or replace function public.zkp_set_setting(p_key text, p_value text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not (public.current_user_has_zkp_role(array['pelnomocnik', 'zastepca']) or public.current_user_is_admin()) then
    raise exception 'Ustawienia ZKP (certyfikaty, podpisujący) zmienia Pełnomocnik ZKP, Zastępca albo administrator';
  end if;
  insert into public.zkp_settings (key, value, updated_by, updated_by_name)
  values (p_key, trim(coalesce(p_value, '')), auth.uid(), public.zkp_current_user_name())
  on conflict (key) do update set value = excluded.value, updated_at = now(),
    updated_by = excluded.updated_by, updated_by_name = excluded.updated_by_name;
end;
$function$;

create or replace function public.zkp_setting(p_key text)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$ select coalesce((select value from public.zkp_settings where key = p_key), ''); $$;

-- ── 2) Protokół badań 6.17.5 ─────────────────────────────────────────────
create table if not exists public.zkp_test_protocols (
  id                 bigint generated always as identity primary key,
  card_id            bigint not null references public.zkp_product_cards(id) on delete restrict,
  construction_id    bigint not null references public.alu_constructions(id) on delete restrict,
  order_id           bigint not null references public.orders(id) on delete restrict,
  attempt            int not null default 1 check (attempt > 0),
  protocol_no        text not null,                         -- nr konstrukcji (+ "/2" przy ponownym)
  produced_on        date,
  inspected_on       date not null default current_date,
  instruments        text not null default '',              -- numery przyrządów z zał. 6.14
  checks             jsonb not null default '{}'::jsonb,    -- {"b1":"OK",…,"d2":"nd",…,"f2":"NOK"}
  measurements       jsonb not null default '{}'::jsonb,    -- {"frame_w":{"m":["1000","1001"]},…} wpisane
  eval               jsonb not null default '[]'::jsonb,    -- wiersze C policzone przez bazę (zkp_protocol_eval)
  nok_count          int not null default 0,
  assessment         text check (assessment in ('zgodny', 'niezgodny')),
  nonconformity_ref  text not null default '',
  decision           text check (decision in ('zwolniony', 'wstrzymany')),
  notes              text not null default '',
  inspector_id       uuid references public.profiles(id) on delete restrict,
  inspector_initials text not null default '',
  saved_by           uuid default auth.uid(),
  saved_by_name      text not null default '',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  closed_at          timestamptz,
  closed_by          uuid,
  closed_by_name     text not null default '',
  constraint zkp_test_protocols_attempt_uq unique (card_id, attempt)
);
create index if not exists zkp_test_protocols_card_idx on public.zkp_test_protocols (card_id);
create index if not exists zkp_test_protocols_order_idx on public.zkp_test_protocols (order_id);
-- jeden otwarty protokół na kartę
create unique index if not exists zkp_test_protocols_open_uq on public.zkp_test_protocols (card_id) where decision is null;

alter table public.zkp_test_protocols enable row level security;
drop policy if exists zkp_test_protocols_read on public.zkp_test_protocols;
create policy zkp_test_protocols_read on public.zkp_test_protocols for select to authenticated using (true);
drop trigger if exists audit_zkp_test_protocols on public.zkp_test_protocols;
create trigger audit_zkp_test_protocols after insert or update or delete on public.zkp_test_protocols
  for each row execute function public.audit_trigger_fn();

-- liczba z tekstu formularza (przecinek dziesiętny też); śmieci → null
create or replace function public.zkp_num(p text)
returns numeric
language sql
immutable
as $$ select case when p ~ '^\s*-?\d+([.,]\d+)?\s*$' then replace(trim(p), ',', '.')::numeric end; $$;

-- Ocena pomiarów części C: nominal z karty, zmierzone z p_m, kryterium z tabeli K.
-- auto=true → wynik liczy baza; auto=false → wynik kontrolera z p_m->key->>'r' (OK/NOK/nd).
create or replace function public.zkp_protocol_eval(p_card_id bigint, p_m jsonb)
returns table(r_sort int, r_key text, r_label text, r_nominal text, r_measured text, r_criterion text, r_result text, r_auto boolean)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  c    public.zkp_product_cards;
  k    public.zkp_ranges;
  m    jsonb := coalesce(p_m, '{}'::jsonb);
  fmt  constant text := 'FM999990.00';
  v1   numeric; v2   numeric; v3   numeric;
  a    numeric;
  n    int;
  h    numeric;
  gaps jsonb;
  manual text;
begin
  select * into c from public.zkp_product_cards where id = p_card_id;
  if not found then raise exception 'Karta % nie istnieje', p_card_id; end if;
  select * into k from public.zkp_ranges where code = c.range_code;
  if k.code is null then raise exception 'Karta bez zakresu raportu — najpierw cz. A/B'; end if;
  h := greatest(c.active_h, coalesce(c.passive_h, 0));

  -- 1. szerokość ościeżnicy zewn. góra / dół (±2 mm od nominału wpisanego w protokole)
  r_sort := 1; r_key := 'frame_w'; r_label := 'Szerokość ościeżnicy zewn. (góra / dół)';
  v1 := public.zkp_num(m->'frame_w'->>'n'); v2 := public.zkp_num(m->'frame_w'->'m'->>0); v3 := public.zkp_num(m->'frame_w'->'m'->>1);
  r_nominal := coalesce(v1::text, '—'); r_measured := coalesce(v2::text, '—') || ' / ' || coalesce(v3::text, '—');
  r_criterion := '± 2 mm (ZKP pkt 5.7)'; r_auto := true;
  r_result := case when v1 is null or v2 is null or v3 is null then null
                   when abs(v2 - v1) <= 2 and abs(v3 - v1) <= 2 then 'OK' else 'NOK' end;
  return next;

  -- 2. wysokość ościeżnicy zewn. L / P
  r_sort := 2; r_key := 'frame_h'; r_label := 'Wysokość ościeżnicy zewn. (L / P)';
  v1 := public.zkp_num(m->'frame_h'->>'n'); v2 := public.zkp_num(m->'frame_h'->'m'->>0); v3 := public.zkp_num(m->'frame_h'->'m'->>1);
  r_nominal := coalesce(v1::text, '—'); r_measured := coalesce(v2::text, '—') || ' / ' || coalesce(v3::text, '—');
  r_criterion := '± 2 mm (ZKP pkt 5.7)'; r_auto := true;
  r_result := case when v1 is null or v2 is null or v3 is null then null
                   when abs(v2 - v1) <= 2 and abs(v3 - v1) <= 2 then 'OK' else 'NOK' end;
  return next;

  -- 3. przekątne ościeżnicy (różnica ≤ 3 mm)
  r_sort := 3; r_key := 'frame_diag'; r_label := 'Przekątne ościeżnicy (różnica)';
  v2 := public.zkp_num(m->'frame_diag'->'m'->>0); v3 := public.zkp_num(m->'frame_diag'->'m'->>1);
  r_nominal := '–'; r_measured := coalesce(v2::text, '—') || ' / ' || coalesce(v3::text, '—');
  r_criterion := '≤ 3 mm (ZKP pkt 5.7)'; r_auto := true;
  r_result := case when v2 is null or v3 is null then null when abs(v2 - v3) <= 3 then 'OK' else 'NOK' end;
  return next;

  -- 4. skrzydło czynne: szer. × wys. (±2 od karty) i limity K
  r_sort := 4; r_key := 'leaf_active'; r_label := 'Skrzydło czynne: szer. × wys. × pow.';
  v2 := public.zkp_num(m->'leaf_active'->'m'->>0); v3 := public.zkp_num(m->'leaf_active'->'m'->>1);
  a := case when v2 is null or v3 is null then null else round(v2 * v3 / 1000000.0, 2) end;
  r_nominal := coalesce(c.active_w::text, '?') || ' × ' || coalesce(c.active_h::text, '?');
  r_measured := coalesce(v2::text, '—') || ' × ' || coalesce(v3::text, '—') || coalesce(' / ' || to_char(a, fmt) || ' m²', '');
  if coalesce(c.leaves, 1) = 1 then
    r_criterion := '± 2 mm; ≤ ' || k.leaf1_w || ' × ' || k.leaf1_h || ' mm / ' || k.leaf1_area || ' m²';
    r_result := case when v2 is null or v3 is null or c.active_w is null or c.active_h is null then null
      when abs(v2 - c.active_w) <= 2 and abs(v3 - c.active_h) <= 2 and v2 <= k.leaf1_w and v3 <= k.leaf1_h and a <= k.leaf1_area then 'OK' else 'NOK' end;
  else
    r_criterion := '± 2 mm; szer. ≤ ' || k.leaf2_active_w || ', wys. ≤ ' || k.leaf2_h || ' mm / ' || k.leaf2_active_area || ' m²';
    r_result := case when v2 is null or v3 is null or c.active_w is null or c.active_h is null then null
      when abs(v2 - c.active_w) <= 2 and abs(v3 - c.active_h) <= 2 and v2 <= k.leaf2_active_w and v3 <= k.leaf2_h and a <= k.leaf2_active_area then 'OK' else 'NOK' end;
  end if;
  r_auto := true; return next;

  -- 5. skrzydło bierne + sumy
  r_sort := 5; r_key := 'leaf_passive'; r_label := 'Skrzydło bierne: szer. × wys. × pow.; suma szerokości i powierzchni';
  if c.leaves = 2 then
    v2 := public.zkp_num(m->'leaf_passive'->'m'->>0); v3 := public.zkp_num(m->'leaf_passive'->'m'->>1);
    v1 := public.zkp_num(m->'leaf_active'->'m'->>0);                    -- szer. czynnego zmierzona
    a := case when v2 is null or v3 is null then null else round(v2 * v3 / 1000000.0, 2) end;
    r_nominal := coalesce(c.passive_w::text, '?') || ' × ' || coalesce(c.passive_h::text, '?');
    r_measured := coalesce(v2::text, '—') || ' × ' || coalesce(v3::text, '—') || coalesce(' / ' || to_char(a, fmt) || ' m²', '')
                  || case when v1 is not null and v2 is not null then '; suma szer. ' || (v1 + v2)::text else '' end;
    r_criterion := 'szer. ≤ ' || k.leaf2_passive_w || ', wys. ≤ ' || k.leaf2_h || ', pow. ≤ ' || k.leaf2_passive_area || '; suma ≤ ' || k.leaf2_sum_w || ' mm / ' || k.leaf2_sum_area || ' m²';
    r_result := case when v2 is null or v3 is null or c.passive_w is null or c.passive_h is null or v1 is null then null
      when abs(v2 - c.passive_w) <= 2 and abs(v3 - c.passive_h) <= 2 and v2 <= k.leaf2_passive_w and v3 <= k.leaf2_h and a <= k.leaf2_passive_area
           and v1 + v2 <= k.leaf2_sum_w and a + round(v1 * public.zkp_num(m->'leaf_active'->'m'->>1) / 1000000.0, 2) <= k.leaf2_sum_area then 'OK' else 'NOK' end;
  else
    r_nominal := '–'; r_measured := 'n/d'; r_criterion := 'tabela K, wiersz „drzwi 2-skrzydłowe"'; r_result := 'nd';
  end if;
  r_auto := true; return next;

  -- 6. nad- / doświetle
  r_sort := 6; r_key := 'light'; r_label := 'Nadświetle / doświetle: szer. × wys. × pow.';
  if c.light <> 'brak' then
    v2 := public.zkp_num(m->'light'->'m'->>0); v3 := public.zkp_num(m->'light'->'m'->>1);
    a := case when v2 is null or v3 is null then null else round(v2 * v3 / 1000000.0, 2) end;
    r_nominal := coalesce(c.light_w::text, '?') || ' × ' || coalesce(c.light_h::text, '?');
    r_measured := coalesce(v2::text, '—') || ' × ' || coalesce(v3::text, '—') || coalesce(' / ' || to_char(a, fmt) || ' m²', '');
    if c.light = 'nadswietle' then
      r_criterion := case when k.transom_w is null then 'niedopuszczone w zakresie ' || k.code else '≤ ' || k.transom_w || ' × ' || k.transom_h || ' mm / ' || k.transom_area || ' m²' end;
      r_result := case when k.transom_w is null then 'NOK' when v2 is null or v3 is null then null
        when v2 <= k.transom_w and v3 <= k.transom_h and a <= k.transom_area then 'OK' else 'NOK' end;
    else
      r_criterion := case when k.side_w is null then 'niedopuszczone w zakresie ' || k.code else '≤ ' || k.side_w || ' × ' || k.side_h || ' mm / ' || k.side_area || ' m²' end;
      r_result := case when k.side_w is null then 'NOK' when v2 is null or v3 is null then null
        when v2 <= k.side_w and v3 <= k.side_h and a <= k.side_area then 'OK' else 'NOK' end;
    end if;
  else
    r_nominal := '–'; r_measured := 'n/d'; r_criterion := 'tabela K; EI30S, EI60S, S — niedopuszczone'; r_result := 'nd';
  end if;
  r_auto := true; return next;

  -- 7. przekątne skrzydła
  r_sort := 7; r_key := 'leaf_diag'; r_label := 'Przekątne skrzydła (różnica)';
  v2 := public.zkp_num(m->'leaf_diag'->'m'->>0); v3 := public.zkp_num(m->'leaf_diag'->'m'->>1);
  r_nominal := '–'; r_measured := coalesce(v2::text, '—') || ' / ' || coalesce(v3::text, '—');
  r_criterion := '≤ 3 mm (ZKP pkt 5.7)'; r_auto := true;
  r_result := case when v2 is null or v3 is null then null when abs(v2 - v3) <= 3 then 'OK' else 'NOK' end;
  return next;

  -- 8. grubość wypełnienia (skrzydło / nad-doświetle) — zakres G i zgodność z kartą
  r_sort := 8; r_key := 'fill_thick'; r_label := 'Grubość wypełnienia (skrzydło / nad- / doświetle)';
  v2 := public.zkp_num(m->'fill_thick'->'m'->>0); v3 := public.zkp_num(m->'fill_thick'->'m'->>1);
  r_nominal := coalesce(c.fill_thickness_mm::text, '—') || ' (karta cz. E)';
  r_measured := coalesce(v2::text, '—') || case when c.light <> 'brak' then ' / ' || coalesce(v3::text, '—') else '' end;
  r_criterion := 'G ' || k.fill_min || '–' || k.fill_max || ' mm; jak w karcie';
  r_result := case when v2 is null then null
    when v2 between k.fill_min and k.fill_max and (c.fill_thickness_mm is null or abs(v2 - c.fill_thickness_mm) <= 0.5)
         and (c.light = 'brak' or (v3 is not null and v3 between k.fill_min and k.fill_max)) then 'OK' else 'NOK' end;
  r_auto := true; return next;

  -- 9. wymiary wypełnienia — ocena kontrolera (wiersz tabeli raportu z karty cz. E)
  r_sort := 9; r_key := 'fill_dims'; r_label := 'Wymiary wypełnienia (szer. × wys. × pow.)';
  r_nominal := coalesce(nullif(c.fill_ref, ''), '—'); r_measured := coalesce(m->'fill_dims'->>'t', '');
  r_criterion := 'wiersz tabeli raportu z karty cz. E (zał. 6.10.5 cz. D)'; r_auto := false;
  r_result := nullif(m->'fill_dims'->>'r', ''); return next;

  -- 10–12. szczeliny A/B/C na trzech krawędziach — limity zakresu
  gaps := k.gaps;
  for n in 1..3 loop
    r_sort := 9 + n;
    r_key := case n when 1 then 'gap_zaw' when 2 then 'gap_zamk' else 'gap_nad' end;
    r_label := 'Szczeliny A / B / C — krawędź ' || case n when 1 then 'zawiasowa' when 2 then 'zamkowa / przeciwzamkowa' else 'nadprożowa' end;
    manual := case n when 1 then 'zaw' when 2 then 'zamk' else 'nad' end;
    v1 := public.zkp_num(m->r_key->'m'->>0); v2 := public.zkp_num(m->r_key->'m'->>1); v3 := public.zkp_num(m->r_key->'m'->>2);
    r_nominal := '–';
    r_measured := coalesce(v1::text, '—') || ' / ' || coalesce(v2::text, '—') || ' / ' || coalesce(v3::text, '—');
    r_criterion := 'A ≤ ' || (gaps->'A'->>manual) || ', B ≤ ' || (gaps->'B'->>manual) || ', C ≤ ' || (gaps->'C'->>manual) || ' mm';
    r_result := case when v1 is null or v2 is null or v3 is null then null
      when v1 <= (gaps->'A'->>manual)::numeric and v2 <= (gaps->'B'->>manual)::numeric and v3 <= (gaps->'C'->>manual)::numeric then 'OK' else 'NOK' end;
    r_auto := true; return next;
  end loop;

  -- 13. próg — ocena kontrolera
  r_sort := 13; r_key := 'threshold'; r_label := 'Szczelina progowa / rozwiązanie progowe';
  r_nominal := coalesce(nullif(c.threshold_ref, ''), '—'); r_measured := coalesce(m->'threshold'->>'t', '');
  r_criterion := 'zał. 6.10.5 cz. C dla zakresu (rozwiązanie z karty)'; r_auto := false;
  r_result := nullif(m->'threshold'->>'r', ''); return next;

  -- 14. zawiasy: liczba (auto) + odległości (kontroler)
  r_sort := 14; r_key := 'hinges'; r_label := 'Zawiasy: liczba; odległość od krawędzi; między zawiasami';
  v1 := public.zkp_num(m->'hinges'->'m'->>0); n := public.zkp_step_min(k.hinge_steps, h);
  r_nominal := coalesce(c.hinges_count::text, '—') || ' (karta)';
  r_measured := coalesce(v1::text, '—') || ' / ' || coalesce(m->'hinges'->'m'->>1, '—') || ' / ' || coalesce(m->'hinges'->'m'->>2, '—');
  r_criterion := 'min. ' || coalesce(n::text, '?') || ' przy h = ' || coalesce(h::text, '?') || ' mm; rozstaw wg tabeli K';
  r_auto := false;
  r_result := case when v1 is not null and n is not null and v1 < n then 'NOK' else nullif(m->'hinges'->>'r', '') end;
  return next;

  -- 15. trzpienie
  r_sort := 15; r_key := 'pins'; r_label := 'Trzpienie antywyważeniowe: liczba i rozmieszczenie';
  v1 := public.zkp_num(m->'pins'->'m'->>0); n := public.zkp_step_min(k.pin_steps, h);
  r_nominal := coalesce(c.pins_count::text, '—') || ' (karta)';
  r_measured := coalesce(v1::text, '—') || coalesce(' / ' || nullif(m->'pins'->'m'->>1, ''), '');
  r_criterion := case when k.pins_mandatory then 'obowiązkowe: min. ' || coalesce(n::text, '?') else 'opcjonalne w zakresie ' || k.code || '; jeśli są: min. ' || coalesce(n::text, '?') end;
  r_auto := false;
  r_result := case when k.pins_mandatory and v1 is not null and n is not null and v1 < n then 'NOK' else nullif(m->'pins'->>'r', '') end;
  return next;

  -- 16. masa skrzydła
  r_sort := 16; r_key := 'mass'; r_label := 'Masa skrzydła (obliczona / zważona)';
  v1 := public.zkp_num(m->'mass'->'m'->>0);
  r_nominal := coalesce(c.leaf_mass_kg::text, '—') || ' kg (karta)'; r_measured := coalesce(v1::text || ' kg', '—');
  r_criterion := '≤ ' || k.mass_max || ' kg'; r_auto := true;
  r_result := case when v1 is null then null when v1 <= k.mass_max then 'OK' else 'NOK' end;
  return next;
end;
$function$;

-- Zapis / aktualizacja OTWARTEGO protokołu karty (kontroler z uprawnieniem 6.27).
create or replace function public.zkp_save_test_protocol(p_card_id bigint, p_data jsonb)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_card    public.zkp_product_cards;
  v_con     public.alu_constructions;
  v_open    public.zkp_test_protocols;
  v_attempt int;
  v_no      text;
  v_insp    uuid;
  v_init    text;
  v_eval    jsonb;
  v_nok     int;
  v_checks  jsonb := coalesce(p_data->'checks', '{}'::jsonb);
  v_m       jsonb := coalesce(p_data->'measurements', '{}'::jsonb);
  v_id      bigint;
  k         text;
begin
  if not public.zkp_can_record_card() then
    raise exception 'Protokół badań wypełnia kontroler odbiorczy (rola ZKP) albo kierownik';
  end if;
  select * into v_card from public.zkp_product_cards where id = p_card_id for update;
  if not found then raise exception 'Karta % nie istnieje', p_card_id; end if;
  if v_card.decision is not null then raise exception 'Karta jest zamknięta decyzją „%"', v_card.decision; end if;
  if v_card.range_confirmed_at is null then raise exception 'Najpierw potwierdzenie zakresu (cz. B) i produkcja'; end if;
  select * into v_con from public.alu_constructions where id = v_card.construction_id;

  -- zał. 6.27: kontrolę odbiorczą wykonuje osoba z uprawnieniem
  if length(trim(coalesce(p_data->>'inspector', ''))) = 0 then
    raise exception 'Podaj kontrolera (inicjały)';
  end if;
  v_insp := public.zkp_profile_by_initials(p_data->>'inspector');
  perform public.zkp_assert_competency(v_insp, 'kontrola_odbiorcza');
  select initials into v_init from public.profiles where id = v_insp;

  -- wartości sprawdzeń tylko OK / NOK / nd
  for k in select jsonb_object_keys(v_checks) loop
    if v_checks->>k not in ('OK', 'NOK', 'nd') then
      raise exception 'Sprawdzenie %: wynik OK, NOK albo n/d', k;
    end if;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object('sort', e.r_sort, 'key', e.r_key, 'label', e.r_label, 'nominal', e.r_nominal,
           'measured', e.r_measured, 'criterion', e.r_criterion, 'result', e.r_result, 'auto', e.r_auto) order by e.r_sort), '[]'::jsonb),
         count(*) filter (where e.r_result = 'NOK')
  into v_eval, v_nok
  from public.zkp_protocol_eval(p_card_id, v_m) e;
  v_nok := v_nok + (select count(*) from jsonb_each_text(v_checks) where value = 'NOK');

  select * into v_open from public.zkp_test_protocols where card_id = p_card_id and decision is null;
  if found then
    update public.zkp_test_protocols set
      produced_on = nullif(p_data->>'produced_on', '')::date,
      inspected_on = coalesce(nullif(p_data->>'inspected_on', '')::date, current_date),
      instruments = trim(coalesce(p_data->>'instruments', '')),
      checks = v_checks, measurements = v_m, eval = v_eval, nok_count = v_nok,
      notes = trim(coalesce(p_data->>'notes', '')),
      inspector_id = v_insp, inspector_initials = v_init,
      saved_by = auth.uid(), saved_by_name = public.zkp_current_user_name(), updated_at = now()
    where id = v_open.id;
    return v_open.id;
  end if;

  select coalesce(max(attempt), 0) + 1 into v_attempt from public.zkp_test_protocols where card_id = p_card_id;
  v_no := v_con.construction_no || case when v_attempt > 1 then '/' || v_attempt else '' end;
  insert into public.zkp_test_protocols
    (card_id, construction_id, order_id, attempt, protocol_no, produced_on, inspected_on, instruments,
     checks, measurements, eval, nok_count, notes, inspector_id, inspector_initials, saved_by, saved_by_name)
  values
    (p_card_id, v_card.construction_id, v_card.order_id, v_attempt, v_no,
     nullif(p_data->>'produced_on', '')::date, coalesce(nullif(p_data->>'inspected_on', '')::date, current_date),
     trim(coalesce(p_data->>'instruments', '')), v_checks, v_m, v_eval, v_nok, trim(coalesce(p_data->>'notes', '')),
     v_insp, v_init, auth.uid(), public.zkp_current_user_name())
  returning id into v_id;
  return v_id;
end;
$function$;

-- Braki protokołu przed zwolnieniem (ta sama lista w oknie i w decyzji)
create or replace function public.zkp_protocol_problems(p_protocol_id bigint)
returns table(r_problem text)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  p public.zkp_test_protocols;
  req_checks text[] := array['b1','b2','b3','b4','b5','d1','d2','d3','d4','d5','d6','d7','d8','e1','e2','e3','e4','e5','e6','e7','f1','f2'];
  k text;
  e jsonb;
begin
  select * into p from public.zkp_test_protocols where id = p_protocol_id;
  if not found then r_problem := 'protokół nie istnieje'; return next; return; end if;
  if p.inspector_id is null then r_problem := 'brak kontrolera'; return next; end if;
  foreach k in array req_checks loop
    if p.checks->>k is null then
      r_problem := 'sprawdzenie ' || upper(k) || ' bez wyniku'; return next;
    elsif p.checks->>k = 'NOK' then
      r_problem := 'sprawdzenie ' || upper(k) || ' = NOK'; return next;
    end if;
  end loop;
  for e in select * from jsonb_array_elements(p.eval) loop
    if e->>'result' is null then
      r_problem := 'pomiar „' || (e->>'label') || '" bez wyniku'; return next;
    elsif e->>'result' = 'NOK' then
      r_problem := 'pomiar „' || (e->>'label') || '" = NOK'; return next;
    end if;
  end loop;
  -- karta musi być kompletna (etapy, okucia, wypełnienia) — jak przy ręcznym zwolnieniu
  return query select pr.r_problem from public.zkp_card_release_problems(p.card_id) pr;
end;
$function$;

-- Zamknięcie protokołu: Pełnomocnik / Zastępca. ZWOLNIONY tylko bez NOK i braków;
-- zamyka kartę wyrobu (cz. F). WSTRZYMANY — karta otwarta, naprawa, nowy protokół.
-- Ocena NIEZGODNY (rejestr 6.20) z WSTRZYMANY = karta zamknięta jako niezgodna.
create or replace function public.zkp_close_test_protocol(
  p_protocol_id bigint, p_assessment text, p_decision text, p_nonconformity_ref text, p_notes text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  p     public.zkp_test_protocols;
  v_bad text;
begin
  if not public.current_user_has_zkp_role(array['pelnomocnik', 'zastepca']) then
    raise exception 'Protokół zamyka i konstrukcję zwalnia Pełnomocnik ZKP albo Zastępca (zał. 6.4)';
  end if;
  if p_assessment not in ('zgodny', 'niezgodny') then raise exception 'Ocena: zgodny albo niezgodny'; end if;
  if p_decision not in ('zwolniony', 'wstrzymany') then raise exception 'Decyzja: zwolniony albo wstrzymany'; end if;
  select * into p from public.zkp_test_protocols where id = p_protocol_id and decision is null for update;
  if not found then raise exception 'Protokół nie istnieje albo jest już zamknięty'; end if;

  if p_decision = 'zwolniony' then
    if p_assessment <> 'zgodny' then raise exception 'Zwolnić można tylko konstrukcję ocenioną jako zgodna'; end if;
    select string_agg(r_problem, '; ') into v_bad from public.zkp_protocol_problems(p_protocol_id);
    if v_bad is not null then raise exception 'Nie można zwolnić — %', v_bad; end if;
  end if;
  if p_assessment = 'niezgodny' and length(trim(coalesce(p_nonconformity_ref, ''))) = 0 then
    raise exception 'Ocena NIEZGODNY wymaga numeru wpisu w rejestrze 6.20';
  end if;

  update public.zkp_test_protocols
  set assessment = p_assessment, decision = p_decision, nonconformity_ref = trim(coalesce(p_nonconformity_ref, '')),
      notes = case when length(trim(coalesce(p_notes, ''))) > 0 then trim(p_notes) else notes end,
      closed_at = now(), closed_by = auth.uid(), closed_by_name = public.zkp_current_user_name(), updated_at = now()
  where id = p_protocol_id;

  if p_decision = 'zwolniony' then
    update public.zkp_product_cards
    set decision = 'zwolniony', test_protocol_no = p.protocol_no, released_on = current_date,
        decision_notes = trim(coalesce(p_notes, '')),
        decided_at = now(), decided_by = auth.uid(), decided_by_name = public.zkp_current_user_name(),
        updated_at = now(), updated_by = auth.uid()
    where id = p.card_id and decision is null;
  elsif p_assessment = 'niezgodny' then
    update public.zkp_product_cards
    set decision = 'niezgodny', test_protocol_no = p.protocol_no, nonconformity_ref = trim(p_nonconformity_ref),
        decision_notes = trim(coalesce(p_notes, '')),
        decided_at = now(), decided_by = auth.uid(), decided_by_name = public.zkp_current_user_name(),
        updated_at = now(), updated_by = auth.uid()
    where id = p.card_id and decision is null;
  end if;
end;
$function$;

-- Ręczne „zwolniony" w karcie tylko ze zwolnionym protokołem (6.17.5 jest obowiązkowy)
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
  v_no  text;
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
    select protocol_no into v_no from public.zkp_test_protocols
    where card_id = p_card_id and decision = 'zwolniony' order by attempt desc limit 1;
    if v_no is null then
      raise exception 'Zwolnienie wymaga protokołu badań 6.17.5 zamkniętego decyzją ZWOLNIONY (cz. G karty)';
    end if;
    select string_agg(r_problem, '; ') into v_bad from public.zkp_card_release_problems(p_card_id);
    if v_bad is not null then
      raise exception 'Nie można zwolnić: %', v_bad;
    end if;
  elsif length(trim(coalesce(p_nonconformity_ref, ''))) = 0 then
    raise exception 'Niezgodność — podaj nr wpisu w rejestrze 6.20';
  end if;
  update public.zkp_product_cards
  set decision = p_decision,
      test_protocol_no = coalesce(v_no, trim(coalesce(p_test_protocol_no, ''))),
      declaration_no = coalesce(nullif(trim(coalesce(p_declaration_no, '')), ''), declaration_no),
      released_on = coalesce(p_released_on, case when p_decision = 'zwolniony' then current_date end),
      nonconformity_ref = trim(coalesce(p_nonconformity_ref, '')),
      decision_notes = trim(coalesce(p_notes, '')),
      decided_at = now(), decided_by = auth.uid(), decided_by_name = public.zkp_current_user_name(),
      updated_at = now(), updated_by = auth.uid()
  where id = p_card_id;
end;
$function$;

-- ── 3) Deklaracje KDWU / DWU (zał. 6.9) ──────────────────────────────────
create table if not exists public.zkp_declaration_counters (
  kind     text not null check (kind in ('KDWU', 'DWU')),
  year     int not null,
  last_seq int not null default 0,
  primary key (kind, year)
);

create table if not exists public.zkp_declarations (
  id                  bigint generated always as identity primary key,
  kind                text not null check (kind in ('KDWU', 'DWU')),
  year                int not null,
  seq                 int not null,
  number              text not null unique,                  -- KDWU/26/0001
  order_id            bigint not null references public.orders(id) on delete restrict,
  construction_ids    bigint[] not null,
  type_code           text not null,
  product_type        text not null,
  range_code          text not null,
  leaves              int not null,
  opening             text,
  evacuation          text not null,
  fire_class          text not null,                         -- EI2 30 / EI2 60 / NPD
  smoke               text not null,                         -- S200 / Sa4 albo NPD
  release_capability  text not null,                         -- zapewniona / NPD
  height_mm           numeric,
  height_tol_mm       numeric not null default 2,
  mounting_text       text not null default '',
  certificate_no      text not null default '',
  test_reports        text not null default '',              -- DWU: sprawozdania LTB
  water_class         text not null default '',              -- DWU: 7A/4A/2A/3A
  impact_class        text not null default '',              -- DWU
  ud_value            text not null default '',              -- DWU
  odt                 text not null default '',
  issued_on           date not null default current_date,
  signer_name         text not null default '',
  signer_title        text not null default '',
  status              text not null default 'wydana' check (status in ('wydana', 'wycofana')),
  withdrawn_at        timestamptz,
  withdrawn_by        uuid,
  withdrawn_by_name   text not null default '',
  withdraw_reason     text,
  created_at          timestamptz not null default now(),
  created_by          uuid default auth.uid(),
  created_by_name     text not null default '',
  constraint zkp_declarations_kind_year_seq_uq unique (kind, year, seq)
);
create index if not exists zkp_declarations_order_idx on public.zkp_declarations (order_id);

alter table public.zkp_declaration_counters enable row level security;
alter table public.zkp_declarations enable row level security;
drop policy if exists zkp_declaration_counters_read on public.zkp_declaration_counters;
create policy zkp_declaration_counters_read on public.zkp_declaration_counters for select to authenticated using (true);
drop policy if exists zkp_declarations_read on public.zkp_declarations;
create policy zkp_declarations_read on public.zkp_declarations for select to authenticated using (true);
drop trigger if exists audit_zkp_declarations on public.zkp_declarations;
create trigger audit_zkp_declarations after insert or update or delete on public.zkp_declarations
  for each row execute function public.audit_trigger_fn();

-- Klasa wodoszczelności / uderzenia wg wariantu (zał. 6.9 cz. B, C1–C4); uderzenie tylko gdy ustawienie ≠ NPD
create or replace function public.zkp_water_class(p_leaves int, p_opening text)
returns text
language sql
immutable
as $$
  select case
    when p_leaves = 1 and p_opening = 'do_wewnatrz' then '7A'
    when p_leaves = 1 and p_opening = 'na_zewnatrz' then '4A'
    when p_leaves = 2 and p_opening = 'do_wewnatrz' then '2A'
    when p_leaves = 2 and p_opening = 'na_zewnatrz' then '3A'
    else '' end;
$$;

-- Wystawienie deklaracji do zlecenia dla konstrukcji tego samego typu ze zwolnionymi kartami.
-- p_data: {mounting_text, certificate_no, test_reports, ud_value, impact_class, signer_name,
--          signer_title, height_mm, issued_on} — puste = z karty / ustawień.
create or replace function public.zkp_issue_declaration(p_order_id bigint, p_construction_ids bigint[], p_data jsonb)
returns table(r_id bigint, r_number text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  d        jsonb := coalesce(p_data, '{}'::jsonb);
  v_cards  int;
  v_types  int;
  v_card   public.zkp_product_cards;
  v_kind   text;
  v_year   int;
  v_seq    int;
  v_no     text;
  v_h      numeric;
  v_id     bigint;
  v_signer text;
begin
  if not (public.current_user_has_zkp_role(array['pelnomocnik', 'zastepca']) or public.current_user_is_admin()) then
    raise exception 'Deklarację wystawia Właściciel / osoba upoważniona (zał. 6.4) — w programie Pełnomocnik, Zastępca albo administrator';
  end if;
  if p_construction_ids is null or array_length(p_construction_ids, 1) is null then
    raise exception 'Wybierz konstrukcje objęte deklaracją';
  end if;

  select count(*), count(distinct c.type_code)
  into v_cards, v_types
  from public.zkp_product_cards c
  join public.alu_constructions k on k.id = c.construction_id
  where c.construction_id = any(p_construction_ids) and c.order_id = p_order_id
    and k.status = 'aktywna' and c.decision = 'zwolniony' and coalesce(c.declaration_no, '') = '';
  if v_cards <> array_length(p_construction_ids, 1) then
    raise exception 'Każda wybrana konstrukcja musi należeć do zlecenia, być aktywna, zwolniona (protokół 6.17.5) i bez deklaracji';
  end if;
  if v_types <> 1 then
    raise exception 'Jedna deklaracja obejmuje konstrukcje tego samego typu (kod typu zał. 6.8) — podziel wybór';
  end if;

  select c.* into v_card from public.zkp_product_cards c where c.construction_id = p_construction_ids[1];
  v_kind := case when v_card.product_type = 'drzwi_zewn' then 'DWU' else 'KDWU' end;
  v_year := extract(year from coalesce(nullif(d->>'issued_on', '')::date, current_date))::int;

  insert into public.zkp_declaration_counters as cnt (kind, year, last_seq) values (v_kind, v_year, 1)
  on conflict (kind, year) do update set last_seq = cnt.last_seq + 1
  returning cnt.last_seq into v_seq;
  v_no := v_kind || '/' || right(v_year::text, 2) || '/' || lpad(v_seq::text, 4, '0');

  -- wysokość: z danych albo największa wysokość skrzydła wśród konstrukcji
  v_h := coalesce(nullif(d->>'height_mm', '')::numeric,
         (select max(greatest(c.active_h, coalesce(c.passive_h, 0))) from public.zkp_product_cards c where c.construction_id = any(p_construction_ids)));
  v_signer := coalesce(nullif(d->>'signer_name', ''), nullif(public.zkp_setting('signer_name'), ''), public.zkp_current_user_name());

  insert into public.zkp_declarations
    (kind, year, seq, number, order_id, construction_ids, type_code, product_type, range_code, leaves, opening, evacuation,
     fire_class, smoke, release_capability, height_mm, height_tol_mm, mounting_text, certificate_no, test_reports,
     water_class, impact_class, ud_value, odt, issued_on, signer_name, signer_title, created_by, created_by_name)
  values
    (v_kind, v_year, v_seq, v_no, p_order_id, p_construction_ids, v_card.type_code, v_card.product_type, v_card.range_code,
     v_card.leaves, v_card.opening, v_card.evacuation,
     case v_card.range_code when 'EI30' then 'EI2 30' when 'EI30S' then 'EI2 30' when 'EI60' then 'EI2 60' when 'EI60S' then 'EI2 60' else 'NPD' end,
     case when v_card.range_code in ('EI30S', 'EI60S', 'S') then 'S200 / Sa4' else 'NPD' end,
     case when v_card.evacuation <> 'nie' then 'zapewniona' else 'NPD' end,
     v_h, coalesce(nullif(d->>'height_tol_mm', '')::numeric, 2),
     coalesce(nullif(d->>'mounting_text', ''), public.zkp_setting('mounting_default')),
     coalesce(nullif(d->>'certificate_no', ''), public.zkp_setting(case when v_kind = 'DWU' then 'cert_ce_nr' else 'cert_krajowy_nr' end)),
     case when v_kind = 'DWU' then coalesce(nullif(d->>'test_reports', ''), public.zkp_setting('ltb_sprawozdania')) else '' end,
     case when v_kind = 'DWU' then public.zkp_water_class(v_card.leaves, v_card.opening) else '' end,
     case when v_kind = 'DWU' then coalesce(nullif(d->>'impact_class', ''), nullif(public.zkp_setting('impact_default'), ''), 'NPD') else '' end,
     case when v_kind = 'DWU' then coalesce(nullif(d->>'ud_value', ''), nullif(public.zkp_setting('ud_default'), ''), 'NPD') else '' end,
     public.zkp_setting('odt'),
     coalesce(nullif(d->>'issued_on', '')::date, current_date),
     v_signer, coalesce(nullif(d->>'signer_title', ''), public.zkp_setting('signer_title')),
     auth.uid(), public.zkp_current_user_name())
  returning id into v_id;

  -- numer deklaracji wraca do kart (rejestr 6.33)
  update public.zkp_product_cards set declaration_no = v_no, updated_at = now(), updated_by = auth.uid()
  where construction_id = any(p_construction_ids);

  return query select v_id, v_no;
end;
$function$;

create or replace function public.zkp_withdraw_declaration(p_id bigint, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v public.zkp_declarations;
begin
  if not (public.current_user_has_zkp_role(array['pelnomocnik', 'zastepca']) or public.current_user_is_admin()) then
    raise exception 'Deklarację wycofuje Pełnomocnik ZKP, Zastępca albo administrator';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Podaj powód wycofania deklaracji'; end if;
  select * into v from public.zkp_declarations where id = p_id and status = 'wydana' for update;
  if not found then raise exception 'Deklaracja nie istnieje albo jest już wycofana'; end if;
  update public.zkp_declarations
  set status = 'wycofana', withdrawn_at = now(), withdrawn_by = auth.uid(), withdrawn_by_name = public.zkp_current_user_name(),
      withdraw_reason = trim(p_reason)
  where id = p_id;
  -- numer zostaje w historii; karty wolne pod nową deklarację
  update public.zkp_product_cards set declaration_no = '', updated_at = now(), updated_by = auth.uid()
  where construction_id = any(v.construction_ids) and declaration_no = v.number;
end;
$function$;

-- Konstrukkcje gotowe do deklaracji (zwolnione, bez deklaracji) — do okna „Wystaw"
create or replace function public.zkp_declaration_candidates()
returns table(r_order_id bigint, r_order_number text, r_company text, r_construction_id bigint, r_construction_no text,
              r_type_code text, r_product_type text, r_range_code text, r_leaves int, r_active_h numeric, r_passive_h numeric, r_released_on date)
language sql
stable
security definer
set search_path to 'public'
as $$
  select o.id, o.order_number, o.company, k.id, k.construction_no, c.type_code, c.product_type, c.range_code, c.leaves,
         c.active_h, c.passive_h, c.released_on
  from public.zkp_product_cards c
  join public.alu_constructions k on k.id = c.construction_id and k.status = 'aktywna'
  join public.orders o on o.id = c.order_id
  where c.decision = 'zwolniony' and coalesce(c.declaration_no, '') = ''
  order by o.id desc, k.pp;
$$;

-- ── 4) Teczka: protokół i deklaracja z kart ──────────────────────────────
create or replace function public.alu_dossier_status(p_order_id bigint)
returns table(r_sort int, r_item_key text, r_label text, r_status text, r_detail text,
              r_document_id bigint, r_na_id bigint, r_at timestamptz, r_by text, r_na_allowed boolean)
language sql
stable
security definer
set search_path to 'public'
as $$
  with cur as (
    select distinct on (d.kind) d.*
    from public.order_documents d
    where d.order_id = p_order_id and d.withdrawn_at is null
    order by d.kind, d.version desc
  ),
  na as (
    select n.* from public.zkp_dossier_na n
    where n.order_id = p_order_id and n.withdrawn_at is null
  ),
  cards as (
    select count(*) as total,
           count(*) filter (where c.decision = 'zwolniony') as released,
           count(*) filter (where c.decision = 'zwolniony' and exists (
             select 1 from public.zkp_test_protocols p where p.card_id = c.id and p.decision = 'zwolniony')) as with_protocol,
           count(*) filter (where coalesce(c.declaration_no, '') <> '') as with_declaration,
           max(c.decided_at) as last_at,
           (array_agg(c.decided_by_name order by c.decided_at desc nulls last))[1] as last_by,
           string_agg(distinct c.declaration_no, ', ') filter (where coalesce(c.declaration_no, '') <> '') as declarations
    from public.alu_constructions k
    left join public.zkp_product_cards c on c.construction_id = k.id
    where k.order_id = p_order_id and k.status = 'aktywna'
  ),
  lots as (
    select count(distinct x.lot_id) as n
    from public.zkp_product_cards c
    join lateral (
      select s.lot_id from public.zkp_card_stage_records s where s.card_id = c.id and s.lot_id is not null
      union all select h.lot_id from public.zkp_card_hardware h where h.card_id = c.id and h.lot_id is not null
      union all select f.lot_id from public.zkp_card_fillings f where f.card_id = c.id and f.lot_id is not null
    ) x on true
    where c.order_id = p_order_id
  ),
  cd as (
    select (cards.total > 0 and cards.released = cards.total) as done,
           (cards.total > 0 and cards.with_protocol = cards.total) as protocols_done,
           (cards.total > 0 and cards.with_declaration = cards.total) as declarations_done,
           cards.* from cards
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
    (9,  'protokol_badan',          'Protokół badań wyrobu gotowego (zał. 6.17.5)', array[]::text[],  false, 'protokoły'),
    (10, 'deklaracja',              'Deklaracja KDWU / DWU',                     array[]::text[],     false, 'deklaracje'),
    (11, 'protokol_montazu',        'Protokół montażu (zał. 6.28)',              array['MONT'],       true,  null)
  )
  select i.sort, i.key, i.label,
         case when doc.id is not null then 'jest'
              when n.id is not null then 'nie_dotyczy'
              when i.key in ('przyjecia_pz', 'wydania_rw', 'karta_wyrobu') and cd.done then 'jest'
              when i.key = 'protokol_badan' and cd.protocols_done then 'jest'
              when i.key = 'deklaracja' and cd.declarations_done then 'jest'
              else 'brak' end,
         case when doc.id is not null then
                doc.kind || ' v' || doc.version || ' · ' || doc.file_name
                || coalesce(' · ' || doc.number, '')
              when n.id is not null then n.reason
              when i.key = 'karta_wyrobu' then 'zwolnione karty: ' || cd.released || ' / ' || cd.total
              when i.key = 'protokol_badan' then 'protokoły zwolnione: ' || cd.with_protocol || ' / ' || cd.total
              when i.key = 'deklaracja' then coalesce(cd.declarations || ' · ', '') || 'konstrukcje z deklaracją: ' || cd.with_declaration || ' / ' || cd.total
              when i.key in ('przyjecia_pz', 'wydania_rw') then
                case when cd.done then 'partie w kartach wyrobu: ' || (select lots.n from lots) || ' (rejestr przyjęć 6.24)'
                     else 'z kart wyrobu — zwolnione ' || cd.released || ' / ' || cd.total end
              when i.generated_in is not null then 'generowane przez program — ' || i.generated_in
              else '' end,
         doc.id, n.id,
         coalesce(doc.uploaded_at, n.created_at,
                  case when i.key in ('przyjecia_pz', 'wydania_rw', 'karta_wyrobu', 'protokol_badan', 'deklaracja') and cd.done then cd.last_at end),
         coalesce(nullif(doc.uploaded_by_name, ''), n.created_by_name,
                  case when i.key in ('przyjecia_pz', 'wydania_rw', 'karta_wyrobu', 'protokol_badan', 'deklaracja') and cd.done then cd.last_by end),
         i.na_allowed
  from items i
  cross join cd
  left join lateral (
    select c.* from cur c where c.kind = any(i.kinds) order by c.uploaded_at desc limit 1
  ) doc on true
  left join na n on n.item_key = i.key
  order by i.sort;
$$;

-- ── 5) Uprawnienia ───────────────────────────────────────────────────────
revoke all on function public.zkp_set_setting(text, text) from public, anon;
revoke all on function public.zkp_setting(text) from public, anon;
revoke all on function public.zkp_num(text) from public, anon;
revoke all on function public.zkp_protocol_eval(bigint, jsonb) from public, anon;
revoke all on function public.zkp_save_test_protocol(bigint, jsonb) from public, anon;
revoke all on function public.zkp_protocol_problems(bigint) from public, anon;
revoke all on function public.zkp_close_test_protocol(bigint, text, text, text, text) from public, anon;
revoke all on function public.zkp_decide_card(bigint, text, text, text, date, text, text) from public, anon;
revoke all on function public.zkp_water_class(int, text) from public, anon;
revoke all on function public.zkp_issue_declaration(bigint, bigint[], jsonb) from public, anon;
revoke all on function public.zkp_withdraw_declaration(bigint, text) from public, anon;
revoke all on function public.zkp_declaration_candidates() from public, anon;
revoke all on function public.alu_dossier_status(bigint) from public, anon;
grant execute on function public.zkp_set_setting(text, text) to authenticated, service_role;
grant execute on function public.zkp_setting(text) to authenticated, service_role;
grant execute on function public.zkp_num(text) to authenticated, service_role;
grant execute on function public.zkp_protocol_eval(bigint, jsonb) to authenticated, service_role;
grant execute on function public.zkp_save_test_protocol(bigint, jsonb) to authenticated, service_role;
grant execute on function public.zkp_protocol_problems(bigint) to authenticated, service_role;
grant execute on function public.zkp_close_test_protocol(bigint, text, text, text, text) to authenticated, service_role;
grant execute on function public.zkp_decide_card(bigint, text, text, text, date, text, text) to authenticated, service_role;
grant execute on function public.zkp_water_class(int, text) to authenticated, service_role;
grant execute on function public.zkp_issue_declaration(bigint, bigint[], jsonb) to authenticated, service_role;
grant execute on function public.zkp_withdraw_declaration(bigint, text) to authenticated, service_role;
grant execute on function public.zkp_declaration_candidates() to authenticated, service_role;
grant execute on function public.alu_dossier_status(bigint) to authenticated, service_role;

-- retencja: nowe tabele zkp_* już objęte (cleanup_old_logs pomija 'zkp\_%')
