-- =====================================================================
-- TURA 8: INWENTARYZACJA dopasowana do modelu rezerwacji (2026-09-04)
--
-- Naprawy istniejących funkcji:
-- 1. close: korekta BEZ ucinania na zerze (ujemne stany po wymuszeniach
--    są legalne i to spis je prostuje) — greatest(0, ...) usunięte.
-- 2. close: update TYLKO magazynu sesji (stary kod przy sesji zbiorczej
--    mnożył korektę na każdy magazyn).
-- 3. Ruch korekty: typ 'INW' (nie 'in'/'out'), z magazynem i wspólnym
--    numerem dokumentu INW-{sesja} — jeden dokument w Ruchach; osobny
--    typ nie zafałszowuje statystyk zużycia (liczonych z WZ).
-- 4. Sesja WYMAGA magazynu (tryb "wszystkie" wycofany — frontend i tak
--    otwiera per magazyn); stare przeciążenie open() skasowane.
-- 5. Rezerwacji korekta NIE dotyka — prostuje wyłącznie stan fizyczny.
--
-- Decyzje Tymka: różnice zatwierdza kierownik przed zaksięgowaniem
-- (modal w aplikacji przed wywołaniem close), spis ślepy (UI nie
-- pokazuje stanu systemowego podczas liczenia).
-- =====================================================================

-- ── 1. Typ ruchu INW ─────────────────────────────────────────────────
-- ('in'/'out' zostają na liście, bo takie ruchy historycznie istnieją)
alter table public.warehouse_movements
  drop constraint if exists warehouse_movements_movement_type_check;
alter table public.warehouse_movements
  add constraint warehouse_movements_movement_type_check
  check (movement_type in ('PZ', 'WZ', 'MM', 'ZWR', 'INW', 'in', 'out'));

-- ── 2. Stare przeciążenie open (bez magazynu) — do kosza ─────────────
drop function if exists public.open_inventory_session(text, date);

-- ── 3. open: magazyn obowiązkowy ─────────────────────────────────────
create or replace function public.open_inventory_session(
  p_notes text default null,
  p_counted_date date default current_date,
  p_warehouse_id integer default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id int;
begin
  if p_warehouse_id is null then
    raise exception 'Inwentaryzację otwiera się dla konkretnego magazynu';
  end if;

  if exists (
    select 1 from inventory_sessions
    where status = 'open' and warehouse_id = p_warehouse_id
  ) then
    raise exception 'Istnieje już otwarta sesja inwentaryzacyjna dla tego magazynu';
  end if;

  insert into inventory_sessions (status, counted_date, notes, created_by, warehouse_id)
  values ('open', p_counted_date, p_notes, auth.uid(), p_warehouse_id)
  returning id into v_session_id;

  -- snapshot stanów magazynu (tylko aktywne komponenty)
  insert into inventory_lines (session_id, component_id, system_qty)
  select v_session_id, ws.component_id, coalesce(ws.quantity, 0)
  from warehouse_stock ws
  join warehouse_components wc on wc.id = ws.component_id
  where wc.is_active = true
    and ws.warehouse_id = p_warehouse_id
  order by wc.name;

  return v_session_id;
end;
$$;

-- ── 4. close: korekty INW, bez klamry zera, tylko magazyn sesji ──────
create or replace function public.close_inventory_session(p_session_id integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line record;
  v_diff numeric;
  v_warehouse_id int;
  v_audit_items jsonb := '[]'::jsonb;
begin
  select warehouse_id into v_warehouse_id
  from inventory_sessions
  where id = p_session_id and status = 'open';

  if not found then
    raise exception 'Sesja nie istnieje lub jest już zamknięta';
  end if;
  if v_warehouse_id is null then
    raise exception 'Sesja bez magazynu — zamknij ją ręcznie (legacy)';
  end if;

  for v_line in
    select il.component_id, il.system_qty, il.counted_qty
    from inventory_lines il
    where il.session_id = p_session_id
      and il.counted_qty is not null
  loop
    v_diff := v_line.counted_qty - v_line.system_qty;
    if v_diff = 0 then continue; end if;

    -- BEZ greatest(0, ...): spis może celowo sprowadzić ujemny stan do prawdy
    update warehouse_stock
    set quantity = quantity + v_diff,
        updated_at = now()
    where component_id = v_line.component_id
      and warehouse_id = v_warehouse_id;

    insert into warehouse_movements (
      component_id, movement_type, quantity,
      warehouse_from_id, warehouse_to_id,
      reference_doc, notes, created_by, created_at
    ) values (
      v_line.component_id,
      'INW',
      abs(v_diff),
      case when v_diff < 0 then v_warehouse_id end,
      case when v_diff > 0 then v_warehouse_id end,
      'INW-' || p_session_id,
      'Korekta inwentaryzacyjna (' || case when v_diff > 0 then 'nadwyżka +' else 'niedobór -' end || abs(v_diff) || ')',
      auth.uid(),
      now()
    );

    v_audit_items := v_audit_items || jsonb_build_object(
      'component_id', v_line.component_id,
      'system_qty', v_line.system_qty,
      'counted_qty', v_line.counted_qty,
      'diff', v_diff
    );
  end loop;

  update inventory_sessions
  set status = 'closed', closed_by = auth.uid(), closed_at = now()
  where id = p_session_id;

  begin
    insert into audit_log (table_name, record_id, operation, user_id, new_data)
    values (
      'inventory_sessions', p_session_id::text, 'UPDATE', auth.uid(),
      jsonb_build_object('action', 'inventory_close', 'session_id', p_session_id,
                         'warehouse_id', v_warehouse_id, 'corrections', v_audit_items)
    );
  exception when others then
    null;
  end;
end;
$$;

-- ── WERYFIKACJA ───────────────────────────────────────────────────────
-- select open_inventory_session('test', current_date, <ID_MAGAZYNU>);
-- update inventory_lines set counted_qty = system_qty + 2 where session_id = <SESJA> and component_id = <KOMP>;
-- select close_inventory_session(<SESJA>);
-- select * from warehouse_movements where reference_doc = 'INW-<SESJA>';
-- select new_data from audit_log where new_data->>'action' = 'inventory_close' order by id desc limit 1;
