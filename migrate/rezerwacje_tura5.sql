-- =====================================================================
-- REZERWACJE — TURA 5: ręczne zwolnienie pojedynczej rezerwacji
-- (przycisk "Zwolnij" w podzakładce Rezerwacje — tylko kierownik).
-- Zwalnia NIEWYDANĄ resztę rezerwacji: reserved_quantity spada,
-- status -> cancelled, wpis w audycie. Wydanych sztuk nie ruszamy.
-- =====================================================================

create or replace function public.cancel_reservation(p_reservation_id bigint)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res record;
  v_rest numeric;
begin
  if not current_user_is_manager() then
    raise exception 'Tylko kierownik może ręcznie zwalniać rezerwacje';
  end if;

  select sr.* into v_res
  from stock_reservations sr
  where sr.id = p_reservation_id
  for update;

  if not found then
    raise exception 'Rezerwacja % nie istnieje', p_reservation_id;
  end if;
  if v_res.status not in ('reserved', 'partially_released') then
    return 0; -- już zwolniona/wydana w całości
  end if;

  v_rest := v_res.quantity_reserved - v_res.quantity_released;
  if v_rest > 0 then
    update warehouse_stock ws
    set reserved_quantity = ws.reserved_quantity - v_rest,
        updated_at = now()
    where ws.warehouse_id = v_res.warehouse_id
      and ws.component_id = v_res.component_id;
  end if;

  update stock_reservations sr
  set status = 'cancelled', updated_at = now()
  where sr.id = p_reservation_id;

  begin
    insert into audit_log (table_name, record_id, operation, user_id, new_data)
    values (
      'stock_reservations', p_reservation_id::text, 'UPDATE', auth.uid(),
      jsonb_build_object('action', 'manual_release', 'reservation_id', p_reservation_id,
                         'order_id', v_res.order_id, 'component_id', v_res.component_id,
                         'freed_qty', greatest(v_rest, 0))
    );
  exception when others then
    null;
  end;

  return greatest(v_rest, 0);
end;
$$;

grant execute on function public.cancel_reservation(bigint) to authenticated;

-- ── WERYFIKACJA ───────────────────────────────────────────────────────
-- select cancel_reservation(<ID_REZERWACJI>);  -- zwraca zwolnioną ilość
