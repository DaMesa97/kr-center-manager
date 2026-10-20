-- ============================================================================
-- update_order_form — konsolidacja edycji zamówienia do JEDNEGO UPDATE
-- (wdrożone przez MCP jako migracja update_order_form_jeden_update, 2026-10-20)
--
-- Problem: edycja zamówienia STA robiła 3 osobne zapisy na tym samym wierszu
-- (UPDATE pól formularza + RPC merge_order_stages + RPC merge_order_extra_fields)
-- = 3 broadcasty realtime na każde stanowisko na hali + okno, w którym wiersz
-- był zapisany częściowo.
--
-- Rozwiązanie: jeden RPC robi wszystko w jednej instrukcji UPDATE:
--   - pola formularza (p_fields) — kolumny walidowane po katalogu pg_attribute,
--     wartości castowane do typu kolumny (wzór jak archiwizacja dynamiczna),
--   - patch etapów (p_stage_patch) — jsonb || po stronie bazy,
--   - patch extra_fields (p_extra_patch) — jsonb || po stronie bazy.
-- Zwraca świeży wiersz (to_jsonb) do lokalnego merge w kliencie.
--
-- SECURITY INVOKER — o prawie do edycji decyduje RLS na orders (tak jak przy
-- dotychczasowym .update()). Kolumny id/created_at/production_stages/
-- extra_fields są zablokowane (dwa ostatnie idą wyłącznie patchami).
-- ============================================================================

create or replace function public.update_order_form(
  p_order_id bigint,
  p_fields jsonb default '{}'::jsonb,
  p_stage_patch jsonb default '{}'::jsonb,
  p_extra_patch jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
set search_path to 'public'
as $$
declare
  v_key text;
  v_type text;
  v_sets text := '';
  v_row jsonb;
begin
  for v_key in select jsonb_object_keys(coalesce(p_fields, '{}'::jsonb)) loop
    if v_key in ('id', 'created_at', 'production_stages', 'extra_fields') then
      raise exception 'update_order_form: kolumna % nie moze byc zmieniana tym RPC', v_key;
    end if;
    select format_type(a.atttypid, a.atttypmod) into v_type
    from pg_attribute a
    where a.attrelid = 'public.orders'::regclass
      and a.attname = v_key and a.attnum > 0 and not a.attisdropped;
    if v_type is null then
      raise exception 'update_order_form: nieznana kolumna %', v_key;
    end if;
    v_sets := v_sets || format('%I = ($1->>%L)::%s, ', v_key, v_key, v_type);
  end loop;

  execute format(
    'update public.orders set %s production_stages = coalesce(production_stages, ''{}''::jsonb) || $2, extra_fields = coalesce(extra_fields, ''{}''::jsonb) || $3 where id = $4 returning to_jsonb(orders.*)',
    v_sets
  ) using coalesce(p_fields, '{}'::jsonb), coalesce(p_stage_patch, '{}'::jsonb), coalesce(p_extra_patch, '{}'::jsonb), p_order_id
  into v_row;

  if v_row is null then
    raise exception 'update_order_form: brak zamowienia id=%', p_order_id;
  end if;
  return v_row;
end;
$$;

-- Nowe funkcje dostają domyślnie EXECUTE dla PUBLIC — odciąć (lekcja z beta.49)
revoke execute on function public.update_order_form(bigint, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.update_order_form(bigint, jsonb, jsonb, jsonb) to authenticated, service_role;
