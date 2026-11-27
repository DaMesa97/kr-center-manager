-- 27.11.2026 (sesja testów, runda 2; tester hali, WYSOKI): revert_order_stage na WYDANYM zleceniu oddawał na stan także
-- pozycje zdjęte przy wydaniu końcowym i przywracał rezerwacje do 'reserved' — zlecenie zostaje wydane, więc tych
-- rezerwacji nic już nie zdejmie (łamie ARCHITEKTURA 11.13). Teraz cofnięcie etapu na wydanym zleceniu jest
-- odrzucane z czytelnym komunikatem: najpierw cofnij wydanie (wyczyść datę wydania), potem etap.
-- DO WDROŻENIA (nie wgrane w sesji).
create or replace function public.revert_order_stage(p_order_id bigint, p_stage_key text)
 returns table(r_component_id bigint, r_component_name text, r_component_code text, r_quantity numeric, r_warehouse_code text)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_cur text;
  v_wydane text;
begin
  if not public.can_write_order_stage(p_order_id) then
    raise exception 'Brak uprawnień do cofania etapów tego zlecenia';
  end if;
  select coalesce(trim(production_stages->>p_stage_key), ''), nullif(trim(coalesce(release_date::text, '')), '') into v_cur, v_wydane
  from orders where id = p_order_id for update;
  if not found then
    raise exception 'Zlecenie % nie istnieje', p_order_id;
  end if;
  if v_wydane is not null then
    raise exception 'Zlecenie jest już wydane (%) — najpierw cofnij wydanie, potem etap (inaczej towar wróci na stan, a rezerwacja zostanie na zawsze).', v_wydane
      using errcode = 'P0409';
  end if;
  if v_cur <> '' and not public.stage_value_owned_by_caller(v_cur) then
    raise exception 'To wpis innej osoby (%). Cofnąć może % albo kierownik.', v_cur, v_cur using errcode = 'P0403';
  end if;
  return query select * from public.return_stock_for_stage__impl(p_order_id, p_stage_key);
  update orders
  set production_stages = coalesce(production_stages, '{}'::jsonb) || jsonb_build_object(p_stage_key, '')
  where id = p_order_id;
end;
$function$;
