-- =====================================================================
-- ZWIAD #6 (2026-10-30) — paczka P3: części obowiązkowe per kategoria + szkice ZD
--
-- 1) Części receptur oczekiwane przy rezerwacji były na sztywno wing/frame/hardware
--    dla każdej kategorii. Disting nie śledzi ościeżnicy (inna produkcja) → 757
--    otwartych zleceń Disting świeciło „brak receptury dla ościeżnicy".
--    Decyzja Tymka 30.10: Disting = tylko skrzydło; ST = skrzydło + ościeżnica
--    (receptury ościeżnic ST dopiero będą); STA = skrzydło + ościeżnica + okucia.
--    Tabela warehouse_expected_parts + expected_parts_for_category(); nieznana
--    kategoria = jak dotąd (wszystkie trzy). reserve_stock_for_order i
--    preview_order_stock czytają z tabeli. Istniejące issue 'missing_recipe' dla
--    części nieoczekiwanych są usuwane, status zlecenia przeliczany.
-- 2) get_incoming_stock_per_component dostaje r_draft_qty (ilość w szkicach ZD,
--    status 'draft'). Zamawianie pokazuje „w szkicu ZD: X" obok propozycji —
--    informacyjnie, nie odejmuje (szkic to nie obietnica dostawy).
--
-- Bezpieczne do ponownego uruchomienia.
-- =====================================================================

-- ── 1) części oczekiwane ─────────────────────────────────────────────────
create table if not exists public.warehouse_expected_parts (
  category text not null,
  part text not null,
  primary key (category, part)
);
comment on table public.warehouse_expected_parts is
  'Które części receptur (wing/frame/hardware) zlecenie danej kategorii MUSI mieć, żeby nie dostać missing_recipe. Brak kategorii = wing+frame+hardware.';
alter table public.warehouse_expected_parts enable row level security;
drop policy if exists warehouse_expected_parts_read on public.warehouse_expected_parts;
create policy warehouse_expected_parts_read on public.warehouse_expected_parts for select to authenticated using (true);
grant select on public.warehouse_expected_parts to authenticated, service_role;

insert into public.warehouse_expected_parts (category, part) values
  ('STA', 'wing'), ('STA', 'frame'), ('STA', 'hardware'),
  ('Disting', 'wing'),
  ('ST', 'wing'), ('ST', 'frame')
on conflict do nothing;

create or replace function public.expected_parts_for_category(p_category text)
returns text[]
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    (select array_agg(ep.part order by ep.part) from public.warehouse_expected_parts ep where ep.category = p_category),
    array['wing', 'frame', 'hardware']
  );
$function$;
grant execute on function public.expected_parts_for_category(text) to authenticated, service_role;

-- reserve_stock_for_order / preview_order_stock: deklaracja + przypisanie po wczytaniu kategorii
do $$
declare
  v_src text;
  v_new text;
begin
  -- reserve_stock_for_order(bigint)
  select pg_get_functiondef('public.reserve_stock_for_order(bigint)'::regprocedure) into v_src;
  if position('expected_parts_for_category' in v_src) = 0 then
    v_new := replace(v_src, 'v_expected_parts text[] := array[''wing'',''frame'',''hardware''];', 'v_expected_parts text[];');
    v_new := regexp_replace(v_new,
      '(raise exception ''Zamówienie % nie istnieje'', p_order_id;\s*end if;)',
      E'\\1\n  v_expected_parts := public.expected_parts_for_category(v_order.category);');
    if v_new = v_src or position('v_expected_parts := public.expected_parts_for_category(v_order.category)' in v_new) = 0 then
      raise exception 'reserve_stock_for_order: nie udało się podmienić części oczekiwanych';
    end if;
    execute v_new;
  end if;

  -- preview_order_stock(jsonb)
  select pg_get_functiondef('public.preview_order_stock(jsonb)'::regprocedure) into v_src;
  if position('expected_parts_for_category' in v_src) = 0 then
    v_new := replace(v_src, 'v_expected_parts text[] := array[''wing'',''frame'',''hardware''];', 'v_expected_parts text[];');
    v_new := regexp_replace(v_new,
      '(if coalesce\(trim\(v_category\), ''''\) = '''' then\s*return;\s*end if;)',
      E'\\1\n  v_expected_parts := public.expected_parts_for_category(v_category);');
    if v_new = v_src or position('v_expected_parts := public.expected_parts_for_category(v_category)' in v_new) = 0 then
      raise exception 'preview_order_stock: nie udało się podmienić części oczekiwanych';
    end if;
    execute v_new;
  end if;
end $$;

-- istniejące zlecenia: wyrzuć missing_recipe dla części nieoczekiwanych, przelicz status
with fixed as (
  select o.id,
         coalesce(jsonb_agg(e) filter (
           where not (coalesce(e->>'type', 'shortage') = 'missing_recipe'
                      and not (e->>'part' = any (public.expected_parts_for_category(o.category))))
         ), '[]'::jsonb) as issues
  from orders o
  cross join lateral jsonb_array_elements(o.stock_issues) e
  where o.stock_status = 'partial_recipe'
    and o.stock_issues is not null and jsonb_typeof(o.stock_issues) = 'array'
  group by o.id, o.category
)
update orders o
set stock_issues = case when jsonb_array_length(f.issues) = 0 then null else f.issues end,
    stock_status = case
      when jsonb_array_length(f.issues) = 0 then 'ok'
      when exists (select 1 from jsonb_array_elements(f.issues) x
                   where x->>'type' in ('missing_recipe', 'missing_warehouse', 'inactive_component')) then 'partial_recipe'
      else 'insufficient'
    end
from fixed f
where f.id = o.id and f.issues is distinct from o.stock_issues;

-- ── 2) szkice ZD w „w drodze" ────────────────────────────────────────────
drop function if exists public.get_incoming_stock_per_component();
create or replace function public.get_incoming_stock_per_component()
returns table(r_component_id bigint, r_incoming_qty numeric, r_earliest_eta date, r_latest_eta date, r_open_pos integer, r_draft_qty numeric)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with sent as (
    select
      i.component_id,
      sum(i.quantity_ordered - i.quantity_received) as incoming_qty,
      min(po.expected_delivery_date)::date as earliest_eta,
      max(po.expected_delivery_date)::date as latest_eta,
      count(distinct po.id)::integer as open_pos
    from purchase_order_items i
    join purchase_orders po on po.id = i.purchase_order_id
    where po.status in ('sent', 'partial')
      and i.status_per_item in ('pending', 'partial')
      and (i.quantity_ordered - i.quantity_received) > 0
    group by i.component_id
  ),
  drafts as (
    select i.component_id, sum(i.quantity_ordered) as draft_qty
    from purchase_order_items i
    join purchase_orders po on po.id = i.purchase_order_id
    where po.status = 'draft'
      and coalesce(i.status_per_item, 'pending') <> 'cancelled'
      and i.quantity_ordered > 0
    group by i.component_id
  )
  select
    coalesce(s.component_id, d.component_id),
    coalesce(s.incoming_qty, 0),
    s.earliest_eta,
    s.latest_eta,
    coalesce(s.open_pos, 0),
    coalesce(d.draft_qty, 0)
  from sent s
  full join drafts d on d.component_id = s.component_id
$function$;
grant execute on function public.get_incoming_stock_per_component() to authenticated, service_role;

select category, array_agg(part order by part) from public.warehouse_expected_parts group by 1 order by 1;
