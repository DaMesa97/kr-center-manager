-- =====================================================================
-- 27.11.2026: Wysyłki kurierem (SUUS) — przesyłka w BaseLinkerze, data doręczenia, palety przy nadaniu,
-- „Oznacz jako wydane” dla starych zleceń.
--
--  * order_shipments: delivery_date (wysyłka + 2 dni robocze), stan przesyłki w BL (bl_status oczekuje|utworzona|blad,
--    bl_error, bl_created_at, bl_request — co wysłaliśmy).
--  * Palety (trigger order_shipments_pallets_sync): schodzą z Bukowej dopiero przy statusie 'nadana' (wersja miękka,
--    Tymek 27.11: „nie wiem, czy od razu wszyscy będą z programu korzystać”).
--  * zlec_przesylke_bl(id): ten sam zakres ról co zapis order_shipments; pg_net → crm-bl-sync {akcja:'przesylka'}
--    (x-internal-key), funkcja zakłada przesyłkę Rohlig SUUS w BaseLinkerze (createPackage) i zapisuje numer albo błąd.
--    Resztę (statusy, maile, etykieta do Mateusza) robi BaseLinker.
--  * podpowiedz_daty_wydania(ids): dzień ostatniej zmiany etapów produkcji z audit_log (podpowiedź do „Oznacz jako wydane”).
--  * oznacz_wydane_wysylki(id, data): data wydania; przed granicą rozchodu (integration_settings.excel_sync_rozchod_od,
--    7.11 — stany po inwentaryzacji już nie mają tego materiału) rezerwacje zamyka bez WZ (cancel manual), od granicy
--    normalne wydanie końcowe (release_remaining_for_order, wymuszone). Drzwi wewnętrzne: tylko data.
-- =====================================================================

alter table public.order_shipments
  add column if not exists delivery_date date,
  add column if not exists bl_status text,
  add column if not exists bl_error text,
  add column if not exists bl_created_at timestamptz,
  add column if not exists bl_request jsonb;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'order_shipments_bl_status_chk') then
    alter table public.order_shipments add constraint order_shipments_bl_status_chk
      check (bl_status is null or bl_status in ('oczekuje', 'utworzona', 'blad'));
  end if;
end $$;

-- palety: tylko przy nadaniu
CREATE OR REPLACE FUNCTION public.order_shipments_pallets_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_wh constant bigint := 2;
  r record; v_need numeric; v_done numeric; v_delta numeric;
begin
  for r in select w.id, case when w.code='PALETA PIONOWA' then new.pallets_vertical else new.pallets_horizontal end as qty
           from warehouse_components w where w.code in ('PALETA PIONOWA','PALETA POZIOMA') loop
    -- 27.11: wersja miękka — palety schodzą dopiero przy nadaniu (wcześniej już przy „gotowa”)
    v_need := case when new.status = 'nadana' then r.qty else 0 end;
    select coalesce(sum(case when movement_type='WZ' then quantity when movement_type='ZWR' then -quantity else 0 end),0)
      into v_done from warehouse_movements where component_id = r.id and reference_doc = 'PAL-WYS-' || new.id;
    v_delta := v_need - v_done;
    if v_delta <> 0 then
      insert into warehouse_movements(movement_type, warehouse_from_id, warehouse_to_id, component_id, quantity, reference_doc, notes, created_by)
      values (case when v_delta > 0 then 'WZ' else 'ZWR' end,
              case when v_delta > 0 then v_wh end, case when v_delta < 0 then v_wh end,
              r.id, abs(v_delta), 'PAL-WYS-' || new.id,
              'Palety do wysyłki #' || new.id || coalesce(' / BL ' || new.bl_order_id, ''), auth.uid());
      insert into warehouse_stock as ws (warehouse_id, component_id, quantity) values (v_wh, r.id, -v_delta)
      on conflict (warehouse_id, component_id) do update set quantity = ws.quantity - v_delta, updated_at = now();
    end if;
  end loop;
  new.updated_at := now();
  return new;
end $function$;

-- kto może planować wysyłki (jak polityka shipments_write)
create or replace function public.current_user_can_ship()
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select public.current_user_is_manager()
      or exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('magazynier', 'obsluga_klienta'))
$function$;

create or replace function public.zlec_przesylke_bl(p_shipment_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_s record;
begin
  if not (public.current_user_can_ship() or auth.role() = 'service_role') then
    raise exception 'Brak uprawnień do wysyłek';
  end if;
  select id, bl_order_id, bl_package_id, status into v_s from order_shipments where id = p_shipment_id for update;
  if not found then raise exception 'Wysyłka % nie istnieje', p_shipment_id; end if;
  if v_s.bl_package_id is not null then return; end if;
  if v_s.status = 'anulowana' then raise exception 'Wysyłka jest anulowana'; end if;
  if v_s.bl_order_id is null then
    update order_shipments set bl_status = 'blad', bl_error = 'Brak numeru zamówienia BaseLinker — przesyłkę załóż ręcznie w BL' where id = p_shipment_id;
    return;
  end if;
  update order_shipments set bl_status = 'oczekuje', bl_error = null where id = p_shipment_id;
  perform net.http_post(
    url := 'https://vwlabgmilckfhtuerzio.supabase.co/functions/v1/crm-bl-sync',
    body := jsonb_build_object('akcja', 'przesylka', 'shipment_id', p_shipment_id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-key', crm.klucz_wewnetrzny()),
    timeout_milliseconds := 60000
  );
end;
$function$;

create or replace function public.podpowiedz_daty_wydania(p_order_ids bigint[])
returns table(order_id bigint, data date)
language sql
stable security definer
set search_path to 'public'
as $function$
  select o.id, (select (max(a.created_at) at time zone 'Europe/Warsaw')::date
                from audit_log a
                where a.table_name = 'orders' and a.record_id = o.id::text and 'production_stages' = any(a.changed_fields))
  from orders o
  where o.id = any(p_order_ids)
$function$;

create or replace function public.oznacz_wydane_wysylki(p_order_id bigint, p_date date)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_o record;
  v_granica date := coalesce(
    (select nullif(trim(value), '')::date from integration_settings where key = 'excel_sync_rozchod_od'),
    date '2026-11-07');
  v_tryb text;
begin
  perform public.assert_warehouse_perm('movements');
  if p_date is null then raise exception 'Podaj datę wydania'; end if;
  if p_date > (now() at time zone 'Europe/Warsaw')::date then raise exception 'Data wydania nie może być z przyszłości'; end if;
  select id, category, release_date, extra_fields into v_o from orders where id = p_order_id for update;
  if not found then raise exception 'Zlecenie % nie istnieje', p_order_id; end if;
  if v_o.release_date is not null and v_o.release_date::date <= (now() at time zone 'Europe/Warsaw')::date then
    raise exception 'Zlecenie jest już wydane';
  end if;
  if v_o.category = 'DrzwiWewnetrzne' then
    v_tryb := 'tylko_data';
  elsif p_date < v_granica then
    perform public.cancel_order_reservations__impl(p_order_id, 'manual');
    v_tryb := 'bez_rozchodu';
  else
    perform * from public.release_remaining_for_order(p_order_id, true);
    v_tryb := 'rozchod';
  end if;
  update orders set release_date = p_date where id = p_order_id;
  return v_tryb;
end;
$function$;

revoke all on function public.zlec_przesylke_bl(bigint) from public, anon;
revoke all on function public.oznacz_wydane_wysylki(bigint, date) from public, anon;
revoke all on function public.podpowiedz_daty_wydania(bigint[]) from public, anon;
grant execute on function public.zlec_przesylke_bl(bigint) to authenticated;
grant execute on function public.oznacz_wydane_wysylki(bigint, date) to authenticated;
grant execute on function public.podpowiedz_daty_wydania(bigint[]) to authenticated;
grant execute on function public.current_user_can_ship() to authenticated;

-- KOREKTA (migracja wysylki_oznacz_wydane_bez_rozchodu, ten sam dzień): oznacz_wydane_wysylki NIGDY nie robi rozchodu —
-- historia etapów w audit_log ma daty importów (np. 20.10, 24.11), więc WZ wg niej mógłby zdjąć drugi raz materiał sprzed
-- inwentaryzacji. Zostaje: data wydania + cancel_order_reservations__impl(id, 'manual'). Pełna definicja w bazie.
