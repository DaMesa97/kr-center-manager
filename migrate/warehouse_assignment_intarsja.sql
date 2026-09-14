-- =====================================================================
-- CZĘŚĆ RECEPTUR „INTARSJA" — przypisanie magazynu (2026-09-14)
--
-- Nowa część 'intarsja' w edytorze receptur (materiały intarsji Titan;
-- ilość zależna od rodzaju: JEDNOSTRONNA/DWUSTRONNA — dwie receptury
-- z kryterium „Intarsja (Titan)", dobór wybierze właściwą).
--
-- ⚠️ BEZ tego wiersza reserve_stock_for_order rzuca wyjątek
-- ('Brak przypisania magazynu...') dla KAŻDEGO zlecenia, do którego
-- dopasuje się receptura części 'intarsja' — wklej PRZED utworzeniem
-- pierwszej takiej receptury.
-- =====================================================================

-- ── 1. Podgląd: magazyny i obecne przypisania Bastiona ──────────────────
select id, code, name from warehouses order by id;

select wa.category, wa.system, wa.part, wa.warehouse_id, w.code
from warehouse_assignment wa
join warehouses w on w.id = wa.warehouse_id
where wa.category = 'Bastion'
order by wa.part, wa.system nulls first;

-- ── 2. Przypisanie (PODMIEŃ <ID_MAGAZYNU> wg podglądu wyżej!) ───────────
-- system = NULL → domyślne dla całej kategorii (fallback funkcji).
insert into warehouse_assignment (category, system, part, warehouse_id)
values ('Bastion', null, 'intarsja', <ID_MAGAZYNU>);

-- Jeżeli receptury intarsji mają powstać też w kategorii STA
-- (np. frezowanie z materiałem po stronie STA), dodaj analogicznie:
-- insert into warehouse_assignment (category, system, part, warehouse_id)
-- values ('STA', null, 'intarsja', <ID_MAGAZYNU>);

-- ── 3. Kontrola ─────────────────────────────────────────────────────────
select resolve_warehouse_for_part('Bastion', 'CORE', 'intarsja') as wh_id;
-- oczekiwane: id magazynu (nie NULL)
