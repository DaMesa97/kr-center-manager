-- 28.11.2026, decyzja D38 (TAK, opcja a) — audyt warehouse_stock tylko przy zmianie ilości, nie samej rezerwacji.
-- Problem: plik 20261127234300 (wgrany) założył trigger audit_warehouse_stock (audit_trigger_fn) na KAŻDĄ zmianę
-- wiersza stanu — także samego reserved_quantity (każda rezerwacja / zwolnienie / przeliczenie receptury).
-- Na produkcji 28.11: 1291 wpisów audit_log dla warehouse_stock, z czego 1290 to zmiany wyłącznie rezerwacji;
-- audit_log ma ~326 MB. Rezerwacje mają własną historię w stock_reservations.
-- Zmiana: trigger z warunkiem WHEN — UPDATE trafia do audytu tylko, gdy zmieniło się coś poza reserved_quantity /
-- available_quantity (kolumna liczona) / updated_at, czyli quantity albo min_quantity (ręczne minimum półki).
-- INSERT i DELETE — bez zmian (zawsze w audycie). audit_trigger_fn bez zmian (wspólna z orders / ruchami).
-- Istniejących wpisów nie kasuje.
-- Można uruchamiać wielokrotnie.
-- DO WDROŻENIA (nie wgrane).

drop trigger if exists audit_warehouse_stock on public.warehouse_stock;
drop trigger if exists audit_warehouse_stock_upd on public.warehouse_stock;

create trigger audit_warehouse_stock
  after insert or delete on public.warehouse_stock
  for each row execute function public.audit_trigger_fn();

create trigger audit_warehouse_stock_upd
  after update on public.warehouse_stock
  for each row
  when ((to_jsonb(old) - 'reserved_quantity' - 'available_quantity' - 'updated_at')
        is distinct from
        (to_jsonb(new) - 'reserved_quantity' - 'available_quantity' - 'updated_at'))
  execute function public.audit_trigger_fn();

comment on trigger audit_warehouse_stock_upd on public.warehouse_stock is
  'D38: audyt zmian stanu tylko, gdy zmienia się ilość / minimum półki — same rezerwacje mają historię w stock_reservations.';
