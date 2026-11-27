-- =====================================================================
-- 27.11.2026 wieczorem: poprawki Wysyłek kurierem po testach agentów (TESTY_AGENTOW_27-11.md)
--  * bl_requested_at — kiedy zlecono przesyłkę; „oczekuje” starsze niż 3 min aplikacja traktuje jak błąd z „Ponów”
--  * zlec_przesylke_bl odmawia, gdy przesyłka już się zakłada (< 3 min) — dwa kliknięcia / dwie osoby nie robią dwóch przesyłek
--  * bl_status 'usunieta_w_bl' — anulowana wysyłka z przesyłką SUUS: ktoś potwierdził, że usunął ją w BaseLinkerze
--  * crm.dni_wolne czytelne dla każdego zalogowanego (same daty świąt) — Wysyłki kurierem liczą doręczenie ze świętami
-- Uruchamiane konektorem (apply_migration wysylki_poprawki_testow).
-- =====================================================================
alter table public.order_shipments add column if not exists bl_requested_at timestamptz;

alter table public.order_shipments drop constraint if exists order_shipments_bl_status_chk;
alter table public.order_shipments add constraint order_shipments_bl_status_chk
  check (bl_status is null or bl_status = any (array['oczekuje','utworzona','blad','usunieta_w_bl']));

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
  select id, bl_order_id, bl_package_id, status, bl_status, bl_requested_at into v_s from order_shipments where id = p_shipment_id for update;
  if not found then raise exception 'Wysyłka % nie istnieje', p_shipment_id; end if;
  if v_s.bl_package_id is not null then return; end if;
  if v_s.status = 'anulowana' then raise exception 'Wysyłka jest anulowana'; end if;
  if v_s.bl_status = 'oczekuje' and v_s.bl_requested_at > now() - interval '3 minutes' then
    raise exception 'Przesyłka już się zakłada w BaseLinkerze — poczekaj chwilę i odśwież';
  end if;
  if v_s.bl_order_id is null then
    update order_shipments set bl_status = 'blad', bl_error = 'Brak numeru zamówienia BaseLinker — przesyłkę załóż ręcznie w BL' where id = p_shipment_id;
    return;
  end if;
  update order_shipments set bl_status = 'oczekuje', bl_error = null, bl_requested_at = now() where id = p_shipment_id;
  perform net.http_post(
    url := 'https://vwlabgmilckfhtuerzio.supabase.co/functions/v1/crm-bl-sync',
    body := jsonb_build_object('akcja', 'przesylka', 'shipment_id', p_shipment_id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-key', crm.klucz_wewnetrzny()),
    timeout_milliseconds := 60000
  );
end;
$function$;

drop policy if exists dni_wolne_select_zalogowani on crm.dni_wolne;
create policy dni_wolne_select_zalogowani on crm.dni_wolne for select to authenticated using (true);
