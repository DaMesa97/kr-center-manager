-- =====================================================================
-- ZNISZCZENIA / DRUGI GATUNEK (2026-09-04)
--
-- Zgłoszenie uszkodzenia komponentu — z kontekstem lub bez:
-- * na produkcji (np. skrzydło uszkodzone przy frezowaniu): zniszczona
--   sztuka zeszła już z magazynu przy "Zrobione" — zgłoszenie zdejmuje
--   ZAMIENNIK wzięty na dokończenie i zapisuje powód + zamówienie + etap;
-- * w magazynie (upadło, porysowane): zgłoszenie zdejmuje zniszczoną
--   sztukę, bez zamówienia.
-- W obu przypadkach półka traci dokładnie tyle, ile fizycznie ubyło.
--
-- Ruch typu 'ZN' (osobny — nie zaśmieca statystyk zużycia z WZ),
-- dokument ZN-{id zgłoszenia}, pełny ślad w damage_reports + audycie.
-- =====================================================================

-- ── 1. Typ ruchu ZN ──────────────────────────────────────────────────
alter table public.warehouse_movements
  drop constraint if exists warehouse_movements_movement_type_check;
alter table public.warehouse_movements
  add constraint warehouse_movements_movement_type_check
  check (movement_type in ('PZ', 'WZ', 'MM', 'ZWR', 'INW', 'ZN', 'in', 'out'));

-- ── 2. Rejestr zniszczeń ─────────────────────────────────────────────
create table if not exists public.damage_reports (
  id bigint generated always as identity primary key,
  component_id bigint not null references public.warehouse_components(id),
  warehouse_id bigint not null references public.warehouses(id),
  quantity numeric not null check (quantity > 0),
  order_id bigint references public.orders(id) on delete set null,
  stage_key text,
  reason text not null,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_damage_reports_component on public.damage_reports(component_id);
create index if not exists idx_damage_reports_order on public.damage_reports(order_id);

alter table public.damage_reports enable row level security;

drop policy if exists damage_reports_select on public.damage_reports;
create policy damage_reports_select on public.damage_reports
  for select to authenticated using (true);
-- insert wyłącznie przez RPC (security definer) — brak polityki insert
drop policy if exists damage_reports_delete on public.damage_reports;
create policy damage_reports_delete on public.damage_reports
  for delete to authenticated using (public.current_user_is_manager());

-- ── 3. RPC zgłoszenia ────────────────────────────────────────────────
create or replace function public.report_damage(
  p_component_id bigint,
  p_warehouse_id bigint,
  p_quantity numeric,
  p_reason text,
  p_order_id bigint default null,
  p_stage_key text default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report_id bigint;
  v_comp record;
  v_order record;
  v_notes text;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Ilość musi być większa od zera';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Podaj powód zniszczenia';
  end if;

  select c.name, c.code into v_comp from warehouse_components c where c.id = p_component_id;
  if not found then
    raise exception 'Komponent % nie istnieje', p_component_id;
  end if;

  insert into damage_reports (component_id, warehouse_id, quantity, order_id, stage_key, reason, created_by)
  values (p_component_id, p_warehouse_id, p_quantity, p_order_id, p_stage_key, trim(p_reason), auth.uid())
  returning id into v_report_id;

  v_notes := 'Zniszczenie: ' || trim(p_reason);
  if p_order_id is not null then
    select o.category, o.order_number into v_order from orders o where o.id = p_order_id;
    v_notes := v_notes || ' — zamówienie ' || coalesce(v_order.category, '?')
      || ' #' || coalesce(v_order.order_number, p_order_id::text);
    if p_stage_key is not null then
      v_notes := v_notes || ', etap ' || p_stage_key;
    end if;
  end if;

  -- stan może zejść na minus (prawda o ubytku ważniejsza niż ładny stan)
  insert into warehouse_stock as ws (warehouse_id, component_id, quantity)
  values (p_warehouse_id, p_component_id, -p_quantity)
  on conflict (warehouse_id, component_id)
  do update set quantity = ws.quantity - p_quantity, updated_at = now();

  insert into warehouse_movements (
    movement_type, warehouse_from_id, component_id, quantity,
    order_id, reference_doc, notes, created_by
  ) values (
    'ZN', p_warehouse_id, p_component_id, p_quantity,
    p_order_id, 'ZN-' || v_report_id, v_notes, auth.uid()
  );

  begin
    insert into audit_log (table_name, record_id, operation, user_id, new_data)
    values (
      'damage_reports', v_report_id::text, 'INSERT', auth.uid(),
      jsonb_build_object('action', 'report_damage', 'component_code', v_comp.code,
                         'quantity', p_quantity, 'order_id', p_order_id,
                         'stage_key', p_stage_key, 'reason', trim(p_reason))
    );
  exception when others then
    null;
  end;

  return v_report_id;
end;
$$;

grant execute on function public.report_damage(bigint, bigint, numeric, text, bigint, text) to authenticated;

-- ── WERYFIKACJA ───────────────────────────────────────────────────────
-- select report_damage(<KOMP>, <MAG>, 1, 'test — porysowane przy frezowaniu', <ZAM>, 'e3');
-- select * from damage_reports order by id desc limit 3;
-- select * from warehouse_movements where movement_type = 'ZN' order by id desc limit 3;
