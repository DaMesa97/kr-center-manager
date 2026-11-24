-- 2026-11-24: Minimum logistyczne komponentu (zgłoszenie #168, Tymek 24.11).
--
-- „W Capku jest tak, że na palecie jest 24 sztuk drzwi, ale niektóre drzwi możemy zamawiać np. po 8 sztuk,
-- niektóre po 12 — żeby proponowane zamówienie nie mówiło, że trzeba zamówić 1 skrzydło, tylko to minimum
-- logistyczne, jakim jest objęte”.
--
-- Dotąd: Stany → DO ZAMÓWIENIA = goły brak do minimum (stock_shortage), a Zamawianie zaokrąglało sugestie
-- w górę do pełnej palety (units_per_pallet). Teraz komponent ma „minimum logistyczne” (order_multiple =
-- wielokrotność, w jakiej dostawca sprzedaje); puste = jak paleta; bez obu = bez zaokrąglania.
-- Zaokrąglenie w górę do tej wielokrotności: DO ZAMÓWIENIA w Stanach (widok v_stock_levels, więc też CSV
-- braków i „Braki → lista zakupowa”), powiadomienie o braku krytycznym, a w aplikacji sugestie ROP i krok
-- ilości na liście zakupowej (lib/reorder.ts). Palety / TIR liczone dalej z units_per_pallet.

alter table public.warehouse_components
  add column if not exists order_multiple integer
  check (order_multiple is null or order_multiple >= 1);

comment on column public.warehouse_components.order_multiple is
  'Minimum logistyczne: wielokrotność, w jakiej dostawca sprzedaje ten komponent (np. 8 albo 12 szt.). Puste = jak sztuki na palecie. Zaokrągla w górę DO ZAMÓWIENIA i sugestie zamówień (#168).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Zaokrąglenie ilości do zamówienia do partii logistycznej
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.stock_order_lot(
  p_shortage          numeric,
  p_order_multiple    integer,
  p_units_per_pallet  integer
) returns numeric
language sql
immutable
as $$
  select case
    when coalesce(p_shortage, 0) <= 0 then greatest(coalesce(p_shortage, 0), 0)
    when coalesce(nullif(p_order_multiple, 0), nullif(p_units_per_pallet, 0)) is null then p_shortage
    else ceil(p_shortage / coalesce(nullif(p_order_multiple, 0), nullif(p_units_per_pallet, 0)))
         * coalesce(nullif(p_order_multiple, 0), nullif(p_units_per_pallet, 0))
  end;
$$;

comment on function public.stock_order_lot(numeric, integer, integer) is
  'Ilość do zamówienia zaokrąglona w górę do minimum logistycznego (order_multiple), a gdy go nie ma — do pełnej palety (units_per_pallet); bez obu zostaje bez zmian (#168).';

revoke all on function public.stock_order_lot(numeric, integer, integer) from public, anon;
grant execute on function public.stock_order_lot(numeric, integer, integer) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Widok Stany: shortage zaokrąglone; surowa wartość i parametry partii na końcu (nowe kolumny)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.v_stock_levels
with (security_invoker = true)
as
select
  s.id                            as stock_id,
  s.warehouse_id,
  w.code                          as warehouse_code,
  s.component_id,
  c.code                          as component_code,
  c.name                          as component_name,
  c.unit                          as component_unit,
  c.category                      as component_category,
  c.supplier_id,
  c.is_active,
  s.quantity,
  s.reserved_quantity,
  s.available_quantity,
  coalesce(inc.r_incoming_qty, 0) as incoming_qty,
  inc.r_earliest_eta              as earliest_eta,
  coalesce(inc.r_open_pos, 0)     as open_pos,
  s.min_quantity,
  m.min_source,
  m.min_effective,
  public.stock_level(s.quantity, s.reserved_quantity, coalesce(inc.r_incoming_qty, 0), m.min_effective)    as level,
  public.stock_order_lot(
    public.stock_shortage(s.quantity, s.reserved_quantity, coalesce(inc.r_incoming_qty, 0), m.min_effective),
    c.order_multiple, c.units_per_pallet)                                                                  as shortage,
  s.updated_at,
  public.stock_shortage(s.quantity, s.reserved_quantity, coalesce(inc.r_incoming_qty, 0), m.min_effective) as shortage_raw,
  c.order_multiple,
  c.units_per_pallet
from public.warehouse_stock s
join public.warehouses w            on w.id = s.warehouse_id
join public.warehouse_components c  on c.id = s.component_id
left join public.get_incoming_stock_per_warehouse() inc
       on inc.r_warehouse_id = s.warehouse_id and inc.r_component_id = s.component_id
cross join lateral public.stock_min_effective(s.warehouse_id, s.component_id, s.min_quantity) m;

comment on view public.v_stock_levels is
  'Magazyn — stany: półka + w drodze + minimum (shelf/smart/component) + level (critical/covered/low/inactive/ok) + shortage (do zamówienia, zaokrąglone do minimum logistycznego / palety; shortage_raw = bez zaokrąglenia).';

revoke all on public.v_stock_levels from public, anon, authenticated, service_role;
grant select on public.v_stock_levels to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Powiadomienie o braku krytycznym: „do zamówienia” też zaokrąglone
--    (podmiana jednej linii w public.stock_critical_notify() bez przepisywania całej funkcji)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  d text;
  stare text := 'v_shortage  := public.stock_shortage(new.quantity, new.reserved_quantity, v_incoming, v_min);';
  nowe  text := 'select public.stock_order_lot(public.stock_shortage(new.quantity, new.reserved_quantity, v_incoming, v_min), c.order_multiple, c.units_per_pallet)
      into v_shortage from public.warehouse_components c where c.id = new.component_id;';
begin
  select pg_get_functiondef('public.stock_critical_notify()'::regprocedure) into d;
  if position('stock_order_lot' in d) > 0 then return; end if;
  if position(stare in d) = 0 then raise exception 'stock_critical_notify: nie znaleziono linii v_shortage'; end if;
  d := replace(d, stare, nowe);
  execute d;
end $$;
