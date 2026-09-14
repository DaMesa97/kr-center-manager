-- =====================================================================
-- CZĘŚĆ RECEPTUR „PRÓG" + przeniesienie receptury #6 + naprawa rezerwacji
-- (2026-09-14)
--
-- Tło: receptura #6 („STA / Ościeżnica / ... / CZARNY") zawiera PRÓG czarny
-- + wykończenie (kryterium po kolorze PROGU), ale siedziała na części
-- 'frame' i ścigała się z profilami ościeżnic. Remis kryteriów rozstrzyga
-- wyższe id, więc: przy ANTRACYCIE (#1 < 6) wygrywała #6 → zlecenie BEZ
-- profilu (np. 2657 MARPLAST); przy ORZECHU (#11 > 6) wygrywał profil →
-- zlecenie BEZ progu. Fix: dedykowana część 'prog' — próg i profil
-- rezerwują się równolegle, każdy w swojej części.
--
-- Skrypt jest CAŁOŚCIOWY (odpal w jednym wklejeniu — jedna transakcja):
--   0) CHECK part w obu tabelach → pełna lista z 'intarsja' i 'prog'
--   1) przypisanie magazynu dla ('STA', NULL, 'prog') — kopiuje magazyn
--      z istniejącego przypisania STA/frame (idempotentnie)
--   2) receptura #6 → part 'prog' + uczciwa nazwa
--   3) przeliczenie rezerwacji zleceń STA NORMAL* od startu modelu
--      (2026-09-04): cancel + re-reserve wg poprawionych receptur.
--      POMIJA zlecenia z czymkolwiek już WYDANYM (released > 0) —
--      te wymagają ręcznego oka, lista na końcu.
--   4) kontrole
-- =====================================================================

-- ── 0. CHECK constrainty ────────────────────────────────────────────────
alter table warehouse_assignment drop constraint if exists warehouse_assignment_part_check;
alter table warehouse_assignment add constraint warehouse_assignment_part_check
  check (part in ('wing','frame','hardware','fittings','handle','peephole',
                  'electric_strike','glazing','decorative_panel','intarsja','prog','other'));

alter table warehouse_recipes drop constraint if exists warehouse_recipes_part_check;
alter table warehouse_recipes add constraint warehouse_recipes_part_check
  check (part in ('wing','frame','hardware','fittings','handle','peephole',
                  'electric_strike','glazing','decorative_panel','intarsja','prog','other'));

-- ── 1. Magazyn dla części 'prog' (ten sam co STA/frame) ─────────────────
insert into warehouse_assignment (category, system, part, warehouse_id)
select 'STA', null, 'prog', wa.warehouse_id
from warehouse_assignment wa
where wa.category = 'STA' and wa.part = 'frame' and wa.system is null
on conflict (category, system, part) do nothing;

-- ── 2. Receptura #6 na część 'prog' ─────────────────────────────────────
update warehouse_recipes
set part = 'prog',
    name = 'STA / Próg czarny + wykończenie / NORMAL|NORMAL PLUS|NORMAL PLUS RC2'
where id = 6;

-- ── 3. Przeliczenie rezerwacji (cancel + re-reserve) ────────────────────
do $$
declare
  v_o record;
  v_cnt integer := 0;
begin
  for v_o in
    select o.id
    from orders o
    where o.category = 'STA'
      and upper(trim(o.system)) like 'NORMAL%'
      and o.created_at >= '2026-09-04'
      and o.release_date is null
      and coalesce((o.extra_fields ->> 'cancelled')::boolean, false) = false
      and not exists (
        select 1 from stock_reservations sr
        where sr.order_id = o.id and sr.quantity_released > 0
      )
  loop
    perform cancel_order_reservations(v_o.id);
    perform 1 from reserve_stock_for_order(v_o.id);
    v_cnt := v_cnt + 1;
  end loop;
  raise notice 'Przeliczono rezerwacje % zleceń STA NORMAL*', v_cnt;
end $$;

-- ── 4a. Kontrola: magazyn dla 'prog' rozwiązany? ────────────────────────
select resolve_warehouse_for_part('STA', 'NORMAL', 'prog') as prog_wh_id;
-- oczekiwane: id magazynu, nie NULL

-- ── 4b. Kontrola: zlecenia NORMAL* wciąż bez profilu ościeżnicy ─────────
-- (powinny zostać tylko kolory bez receptury profilu i przypadki pominięte)
select o.id, o.order_number, o.frame_color, o.threshold_color, o.created_at::date
from orders o
where o.category = 'STA'
  and upper(trim(o.system)) like 'NORMAL%'
  and o.created_at >= '2026-09-04'
  and o.release_date is null
  and coalesce((o.extra_fields ->> 'cancelled')::boolean, false) = false
  and not exists (
    select 1 from stock_reservations sr
    join warehouse_components wc on wc.id = sr.component_id
    where sr.order_id = o.id and sr.status = 'reserved'
      and wc.name ilike 'PROFIL ALU%OŚCIEŻNICA%'
  )
order by o.id desc;

-- ── 5. DOKŁADKA dla pominiętych z 4c (wykonane 2026-09-14 dla 13130,
--       12939, 12930): dorzuca TYLKO brakujące komponenty wg aktualnych
--       receptur, istniejących/wydanych rezerwacji nie dotyka.
--       (Pełny DO-block w historii czatu / poniżej; podmień listę id.)
-- do $$ ... for v_order in select * from orders where id in (<IDS>) ...
--   guard: exists(stock_reservations komponentu, status<>'cancelled') → skip;
--   insert warehouse_stock upsert(reserved += total) + stock_reservations,
--   total = per_unit × orders.quantity, magazyn z resolve_warehouse_for_part.

-- ── 4c. Pominięte (coś już wydane — ogarnąć ręcznie, jeśli dotyczy) ─────
select distinct o.id, o.order_number, o.frame_color, o.threshold_color
from orders o
join stock_reservations sr on sr.order_id = o.id and sr.quantity_released > 0
where o.category = 'STA'
  and upper(trim(o.system)) like 'NORMAL%'
  and o.created_at >= '2026-09-04'
  and o.release_date is null
order by o.id desc;
