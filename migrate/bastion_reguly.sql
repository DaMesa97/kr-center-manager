-- =====================================================================
-- BASTION — REGUŁY DOMYŚLNE (2026-10-31), przeniesione z makra Excela
-- (dodajZamowienieDoArkusza). Tabela bastion_rules + funkcja oceny, trigger
-- BEFORE INSERT na zleceniach Bastion (bot, formularz, Excel — to samo wejście)
-- oraz jednorazowe przepisanie otwartych zleceń (bastion_rules_backfill).
--
-- Reguła: warunki (system ∈, prefiks ościeżnicy, ościeżnica ∈, szerokość ∈,
-- wartość pola ∉) → pole + tryb + wartość. Tryby:
--   set            — ustaw zawsze (np. szerokość 80 → 845 dla BOLD / stalowej)
--   set_if_empty   — ustaw, gdy puste (wysokość domyślna, wizjer, uwagi)
--   append         — dopisz na końcu, jeśli jeszcze nie ma (okucia „ 92", próg „ NISKI")
--   prepend        — dopisz na początku, jeśli jeszcze nie ma (uwagi „ZAMEK LISTWOWY MACO")
-- Reguły działają po kolei (priority), każda widzi efekt poprzednich (jak w VBA).
-- Bezpieczne do ponownego uruchomienia.
-- =====================================================================

create table if not exists public.bastion_rules (
  id bigserial primary key,
  priority integer not null,
  name text not null,
  is_active boolean not null default true,
  when_system text[],
  when_frame_prefix text,
  when_frame text[],
  when_width text[],
  when_target_not_in text[],
  target text not null check (target in ('system', 'width', 'height', 'peephole', 'notes', 'hardware', 'threshold_color')),
  mode text not null check (mode in ('set', 'set_if_empty', 'append', 'prepend')),
  value text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.bastion_rules is 'Reguły domyślne Bastion (z makra Excela): warunki → pole/tryb/wartość, stosowane przy nowym zleceniu i w backfillu.';
alter table public.bastion_rules enable row level security;
drop policy if exists bastion_rules_read on public.bastion_rules;
create policy bastion_rules_read on public.bastion_rules for select to authenticated using (true);
grant select on public.bastion_rules to authenticated, service_role;

-- seed: tylko gdy tabela pusta (ręczne zmiany w Konfiguracji nie są nadpisywane)
insert into public.bastion_rules (priority, name, when_system, when_frame_prefix, when_frame, when_width, when_target_not_in, target, mode, value)
select * from (values
  -- system / szerokość
  (10, 'Stalowa ościeżnica przy BOLD → system BASIC', array['BOLD','BOLD PLUS'], 'STAL', null, null, null, 'system', 'set', 'BASIC'),
  (20, 'Stalowa ościeżnica: szerokość 80 → 845', null, 'STAL', null, array['80'], null, 'width', 'set', '845'),
  (21, 'Stalowa ościeżnica: szerokość 90 → 945', null, 'STAL', null, array['90'], null, 'width', 'set', '945'),
  (22, 'BOLD: szerokość 80 → 845', array['BOLD','BOLD PLUS'], null, null, array['80'], null, 'width', 'set', '845'),
  (23, 'BOLD: szerokość 90 → 945', array['BOLD','BOLD PLUS'], null, null, array['90'], null, 'width', 'set', '945'),
  -- wizjer
  (30, 'Pusty wizjer → BEZ WIZJERA', null, null, null, null, null, 'peephole', 'set_if_empty', 'BEZ WIZJERA'),
  -- wysokość domyślna (system × ościeżnica × szerokość)
  (40, 'Wysokość: BASIC* + drewniana pełna, 70/80/90 → 208 Z OŚC', array['BASIC','BASIC PLUS','BASIC LOCK PLUS'], null, array['DREWNIANA PEŁNA'], array['70','80','90'], null, 'height', 'set_if_empty', '208 Z OŚC'),
  (41, 'Wysokość: BASIC* + drewniana pełna, NW → 205 Z OŚC', array['BASIC','BASIC PLUS','BASIC LOCK PLUS'], null, array['DREWNIANA PEŁNA'], array['70 NW','80 NW','90 NW'], null, 'height', 'set_if_empty', '205 Z OŚC'),
  (42, 'Wysokość: stalowa → 201.5 wf', null, 'STAL', null, null, null, 'height', 'set_if_empty', '201.5 wf'),
  (43, 'Wysokość: BOLD → 201.5 wf', array['BOLD','BOLD PLUS'], null, null, null, null, 'height', 'set_if_empty', '201.5 wf'),
  (44, 'Wysokość: PREMIUM* + drewniana pełna, 70/80/90 → 207.3 Z OŚC', array['PREMIUM','PREMIUM RC2'], null, array['DREWNIANA PEŁNA'], array['70','80','90'], null, 'height', 'set_if_empty', '207.3 Z OŚC'),
  (45, 'Wysokość: PREMIUM* + drewniana pełna, NW → 204.3 Z OŚC', array['PREMIUM','PREMIUM RC2'], null, array['DREWNIANA PEŁNA'], array['70 NW','80 NW','90 NW'], null, 'height', 'set_if_empty', '204.3 Z OŚC'),
  (46, 'Wysokość: BASIC* + regulowana/opaskowa, 70/80/90 → 206 Z OŚC', array['BASIC','BASIC PLUS','BASIC LOCK PLUS'], null, array['DREWNIANA REGULOWANA','DREWNIANA OPASKOWA'], array['70','80','90'], null, 'height', 'set_if_empty', '206 Z OŚC'),
  (47, 'Wysokość: BASIC* + regulowana/opaskowa, NW → 203 Z OŚC', array['BASIC','BASIC PLUS','BASIC LOCK PLUS'], null, array['DREWNIANA REGULOWANA','DREWNIANA OPASKOWA'], array['70 NW','80 NW','90 NW'], null, 'height', 'set_if_empty', '203 Z OŚC'),
  (48, 'Wysokość: PREMIUM* + regulowana/opaskowa, 70/80/90 → 205.3 Z OŚC', array['PREMIUM','PREMIUM RC2'], null, array['DREWNIANA REGULOWANA','DREWNIANA OPASKOWA'], array['70','80','90'], null, 'height', 'set_if_empty', '205.3 Z OŚC'),
  (49, 'Wysokość: PREMIUM* + regulowana/opaskowa, NW → 202.3 Z OŚC', array['PREMIUM','PREMIUM RC2'], null, array['DREWNIANA REGULOWANA','DREWNIANA OPASKOWA'], array['70 NW','80 NW','90 NW'], null, 'height', 'set_if_empty', '202.3 Z OŚC'),
  (50, 'Wysokość: zabudowa ośc. metal., 70/80/90 → 203.5 Z OŚC', null, null, array['ZAB.OŚC.METAL.'], array['70','80','90'], null, 'height', 'set_if_empty', '203.5 Z OŚC'),
  (51, 'Wysokość: zabudowa ośc. metal., NW → 200.5 Z OŚC', null, null, array['ZAB.OŚC.METAL.'], array['70 NW','80 NW','90 NW'], null, 'height', 'set_if_empty', '200.5 Z OŚC'),
  -- uwagi
  (60, 'Stalowa ościeżnica bez uwag → Z BOLCAMI', null, 'STAL', null, null, null, 'notes', 'set_if_empty', 'Z BOLCAMI'),
  (61, 'BOLD bez uwag → BEZ BOLCÓW', array['BOLD','BOLD PLUS'], null, null, null, null, 'notes', 'set_if_empty', 'BEZ BOLCÓW'),
  -- okucia / próg / zamek listwowy
  (70, 'BASIC LOCK PLUS / PREMIUM RC2: okucia + „92"', array['BASIC LOCK PLUS','PREMIUM RC2'], null, null, null, array['BRAK',''], 'hardware', 'append', '92'),
  (71, 'PREMIUM*: próg + „NISKI"', array['PREMIUM','PREMIUM RC2'], null, null, null, array['BRAK',''], 'threshold_color', 'append', 'NISKI'),
  (72, 'BASIC LOCK PLUS / PREMIUM RC2: uwagi „ZAMEK LISTWOWY MACO"', array['BASIC LOCK PLUS','PREMIUM RC2'], null, null, null, null, 'notes', 'prepend', 'ZAMEK LISTWOWY MACO')
) as v(priority, name, when_system, when_frame_prefix, when_frame, when_width, when_target_not_in, target, mode, value)
where not exists (select 1 from public.bastion_rules);

-- ── ocena reguł na wierszu zlecenia ───────────────────────────────────────
create or replace function public.bastion_rules_eval(p_order public.orders)
returns public.orders
language plpgsql
stable
as $function$
declare
  r record;
  o public.orders := p_order;
  v_cur text;
  v_new text;
  v_frame text;
begin
  for r in select * from public.bastion_rules where is_active order by priority, id loop
    v_frame := upper(trim(coalesce(o.bastion_frame_type, '')));
    if r.when_system is not null and not (upper(trim(coalesce(o.system, ''))) = any (select upper(trim(x)) from unnest(r.when_system) x)) then continue; end if;
    if r.when_frame_prefix is not null and left(v_frame, length(r.when_frame_prefix)) <> upper(r.when_frame_prefix) then continue; end if;
    -- ościeżnica: dopasowanie przez zawieranie (zlecenia mają pełne nazwy, np. „DREWNIANA REGULOWANA INTERIOR")
    if r.when_frame is not null and not exists (select 1 from unnest(r.when_frame) x where v_frame like '%' || upper(trim(x)) || '%') then continue; end if;
    if r.when_width is not null and not (upper(trim(coalesce(o.width, ''))) = any (select upper(trim(x)) from unnest(r.when_width) x)) then continue; end if;

    v_cur := case r.target
      when 'system' then o.system when 'width' then o.width when 'height' then o.height
      when 'peephole' then o.peephole when 'notes' then o.notes when 'hardware' then o.hardware
      when 'threshold_color' then o.threshold_color end;
    v_cur := coalesce(v_cur, '');
    if r.when_target_not_in is not null and (upper(trim(v_cur)) = any (select upper(trim(x)) from unnest(r.when_target_not_in) x)) then continue; end if;

    v_new := case r.mode
      when 'set' then r.value
      when 'set_if_empty' then case when trim(v_cur) = '' then r.value else v_cur end
      when 'append' then case when upper(trim(v_cur)) like '%' || upper(r.value) then v_cur else trim(v_cur) || ' ' || r.value end
      when 'prepend' then case when upper(v_cur) like '%' || upper(r.value) || '%' then v_cur
                               when trim(v_cur) = '' then r.value else r.value || ' ' || trim(v_cur) end
    end;
    if v_new is distinct from v_cur then
      case r.target
        when 'system' then o.system := v_new; when 'width' then o.width := v_new; when 'height' then o.height := v_new;
        when 'peephole' then o.peephole := v_new; when 'notes' then o.notes := v_new; when 'hardware' then o.hardware := v_new;
        when 'threshold_color' then o.threshold_color := v_new;
      end case;
    end if;
  end loop;
  return o;
end;
$function$;

-- podgląd: co reguły zmieniłyby w zleceniu (UI / diagnostyka)
create or replace function public.bastion_rules_preview(p_order_id bigint)
returns table(field text, old_value text, new_value text)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  o public.orders;
  n public.orders;
begin
  select * into o from orders where id = p_order_id and category = 'Bastion';
  if not found then return; end if;
  n := public.bastion_rules_eval(o);
  return query
    select * from (values
      ('system', o.system, n.system), ('width', o.width, n.width), ('height', o.height, n.height),
      ('peephole', o.peephole, n.peephole), ('notes', o.notes, n.notes), ('hardware', o.hardware, n.hardware),
      ('threshold_color', o.threshold_color, n.threshold_color)) v(f, a, b)
    where v.a is distinct from v.b;
end;
$function$;
grant execute on function public.bastion_rules_preview(bigint) to authenticated, service_role;

-- trigger: nowe zlecenie Bastion (bot / formularz / Excel) przechodzi przez reguły
create or replace function public.bastion_rules_trigger()
returns trigger
language plpgsql
as $function$
begin
  if new.category = 'Bastion' then
    new := public.bastion_rules_eval(new);
  end if;
  return new;
end;
$function$;
drop trigger if exists trg_bastion_rules on public.orders;
create trigger trg_bastion_rules
  before insert on public.orders
  for each row execute function public.bastion_rules_trigger();

-- włącz/wyłącz regułę (Konfiguracja → Bastion → Reguły)
create or replace function public.bastion_rule_set_active(p_rule_id bigint, p_active boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.assert_manager_or_service();
  update bastion_rules set is_active = p_active, updated_at = now() where id = p_rule_id;
  if not found then raise exception 'Reguła % nie istnieje', p_rule_id; end if;
end;
$function$;
grant execute on function public.bastion_rule_set_active(bigint, boolean) to authenticated, service_role;

-- jednorazowo: otwarte, nieanulowane zlecenia Bastion (zmiany do audit_log per zlecenie)
create or replace function public.bastion_rules_backfill()
returns table(r_changed integer, r_checked integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  o public.orders;
  n public.orders;
  v_changed integer := 0;
  v_checked integer := 0;
  v_diff jsonb;
begin
  perform public.assert_manager_or_service();
  for o in
    select * from orders
    where category = 'Bastion'
      and (release_date is null or release_date::text = '')
      and coalesce((extra_fields->>'cancelled')::boolean, false) = false
    order by id
  loop
    v_checked := v_checked + 1;
    n := public.bastion_rules_eval(o);
    -- zlecenia spoza bota (import z Excela) mają wysokość na arkuszu, której import nie przeniósł —
    -- nie zgadujemy jej regułą domyślną; bot zawsze przysyła wysokość, więc jego to nie dotyczy
    if coalesce(o.source, '') <> 'bot' then n.height := o.height; end if;
    v_diff := '{}'::jsonb;
    if n.system is distinct from o.system then v_diff := v_diff || jsonb_build_object('system', jsonb_build_array(o.system, n.system)); end if;
    if n.width is distinct from o.width then v_diff := v_diff || jsonb_build_object('width', jsonb_build_array(o.width, n.width)); end if;
    if n.height is distinct from o.height then v_diff := v_diff || jsonb_build_object('height', jsonb_build_array(o.height, n.height)); end if;
    if n.peephole is distinct from o.peephole then v_diff := v_diff || jsonb_build_object('peephole', jsonb_build_array(o.peephole, n.peephole)); end if;
    if n.notes is distinct from o.notes then v_diff := v_diff || jsonb_build_object('notes', jsonb_build_array(o.notes, n.notes)); end if;
    if n.hardware is distinct from o.hardware then v_diff := v_diff || jsonb_build_object('hardware', jsonb_build_array(o.hardware, n.hardware)); end if;
    if n.threshold_color is distinct from o.threshold_color then v_diff := v_diff || jsonb_build_object('threshold_color', jsonb_build_array(o.threshold_color, n.threshold_color)); end if;
    if v_diff <> '{}'::jsonb then
      update orders set system = n.system, width = n.width, height = n.height, peephole = n.peephole,
                        notes = n.notes, hardware = n.hardware, threshold_color = n.threshold_color
      where id = o.id;
      begin
        insert into audit_log (table_name, record_id, operation, user_id, new_data)
        values ('orders', o.id::text, 'UPDATE', auth.uid(),
                jsonb_build_object('action', 'bastion_rules_backfill', 'order_number', o.order_number, 'changes', v_diff));
      exception when others then null;
      end;
      v_changed := v_changed + 1;
    end if;
  end loop;
  r_changed := v_changed; r_checked := v_checked;
  return next;
end;
$function$;
revoke all on function public.bastion_rules_backfill() from public, anon, authenticated;
grant execute on function public.bastion_rules_backfill() to service_role;

select count(*) as regul, count(*) filter (where is_active) as aktywnych from public.bastion_rules;
