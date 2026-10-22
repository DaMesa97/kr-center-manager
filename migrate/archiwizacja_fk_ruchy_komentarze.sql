-- 2026-10-22: archiwizacja zleceń z ruchami magazynowymi.
--
-- archive_old_orders przenosi zlecenie do orders_archive i USUWA je z orders.
--  * warehouse_movements.order_id miał FK bez ON DELETE → usunięcie zlecenia,
--    z którego cokolwiek wydano (WZ/ZWR), wywracało CAŁĄ archiwizację
--    (a docelowo prawie każde zlecenie ma ruchy magazynowe).
--  * order_comments i order_internal_door_items miały ON DELETE CASCADE →
--    archiwizacja po cichu KASOWAŁA komentarze i pozycje drzwi wewnętrznych
--    (zdjęcia archiwum kopiuje do orders_archive.photos, komentarzy nie).
--
-- Teraz:
--  * ruch zapamiętuje numer zlecenia (order_number — trigger przy zapisie +
--    uzupełnienie istniejących), FK → ON DELETE SET NULL. Historia ruchów po
--    archiwizacji dalej pokazuje numer zlecenia.
--  * komentarze i pozycje drzwi wewnętrznych bez FK do orders — zostają pod tym
--    samym order_id (restore_from_archive przywraca zlecenie z tym samym id,
--    więc wracają razem z nim). Indeksy po order_id zostają.

ALTER TABLE public.warehouse_movements ADD COLUMN IF NOT EXISTS order_number text;

UPDATE public.warehouse_movements m
SET order_number = o.order_number
FROM public.orders o
WHERE o.id = m.order_id AND m.order_number IS NULL;

CREATE OR REPLACE FUNCTION public.warehouse_movements_fill_order_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.order_id is not null and new.order_number is null then
    select o.order_number into new.order_number from orders o where o.id = new.order_id;
  end if;
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION public.warehouse_movements_fill_order_number() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_warehouse_movements_order_number ON public.warehouse_movements;
CREATE TRIGGER trg_warehouse_movements_order_number
  BEFORE INSERT OR UPDATE OF order_id ON public.warehouse_movements
  FOR EACH ROW EXECUTE FUNCTION public.warehouse_movements_fill_order_number();

ALTER TABLE public.warehouse_movements DROP CONSTRAINT IF EXISTS warehouse_movements_order_id_fkey;
ALTER TABLE public.warehouse_movements
  ADD CONSTRAINT warehouse_movements_order_id_fkey
  FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;

ALTER TABLE public.order_comments DROP CONSTRAINT IF EXISTS order_comments_order_id_fkey;
ALTER TABLE public.order_internal_door_items DROP CONSTRAINT IF EXISTS order_internal_door_items_order_id_fkey;
