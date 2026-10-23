-- 2026-10-23: postęp zlecenia aluminium w orders.extra_fields.alu.progress.
--
-- Etapy aluminium żyją na pozycjach (order_alu_positions), a Wysyłka, Pulpit,
-- telefon i statystyki patrzą tylko na wiersz orders (countCompletedStages).
-- Zamiast dociągać pozycje w każdym widoku: trigger po każdej zmianie pozycji
-- przepisuje do zlecenia { done, total, percent } (done = suma min(done, qty)
-- po 5 etapach, total = suma qty × 5). Realtime na orders roznosi to dalej.

CREATE OR REPLACE FUNCTION public.alu_sync_order_progress(p_order_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_done int := 0;
  v_total int := 0;
  v_pct int := 0;
begin
  if p_order_id is null then return; end if;
  select
    coalesce(sum((
      select sum(least(coalesce((p.production_stages->k->>'done')::int, 0), p.quantity))
      from unnest(array['ciecie','okuwanie','skladanie','szklenie','pakowanie']) k
    )), 0)::int,
    coalesce(sum(p.quantity * 5), 0)::int
  into v_done, v_total
  from order_alu_positions p
  where p.order_id = p_order_id;
  v_pct := case when v_total > 0 then round(100.0 * v_done / v_total)::int else 0 end;
  update orders
  set extra_fields = coalesce(extra_fields, '{}'::jsonb)
    || jsonb_build_object('alu', coalesce(extra_fields->'alu', '{}'::jsonb)
         || jsonb_build_object('progress', jsonb_build_object('done', v_done, 'total', v_total, 'percent', v_pct)))
  where id = p_order_id
    and coalesce(extra_fields->'alu'->'progress', '{}'::jsonb)
        is distinct from jsonb_build_object('done', v_done, 'total', v_total, 'percent', v_pct);
end;
$function$;

REVOKE ALL ON FUNCTION public.alu_sync_order_progress(bigint) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_alu_positions_progress()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'DELETE' then
    perform public.alu_sync_order_progress(old.order_id);
    return old;
  end if;
  perform public.alu_sync_order_progress(new.order_id);
  if tg_op = 'UPDATE' and new.order_id is distinct from old.order_id then
    perform public.alu_sync_order_progress(old.order_id);
  end if;
  return new;
end;
$function$;

DROP TRIGGER IF EXISTS trg_alu_positions_progress ON public.order_alu_positions;
CREATE TRIGGER trg_alu_positions_progress
  AFTER INSERT OR UPDATE OR DELETE ON public.order_alu_positions
  FOR EACH ROW EXECUTE FUNCTION public.trg_alu_positions_progress();

-- uzupełnienie istniejących zleceń
DO $$
declare r record;
begin
  for r in select distinct order_id from order_alu_positions loop
    perform public.alu_sync_order_progress(r.order_id);
  end loop;
end $$;
