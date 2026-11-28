-- 28.11.2026 — decyzja właściciela (czat): „ten PIN ZKP na razie wyjeb”.
-- Podpis etapu ZKP PIN-em (20261128035300, D53) zostaje w bazie, ale jest WYŁĄCZONY przełącznikiem:
-- integration_settings.zkp_pin_wymagany = 'on' włącza go z powrotem (domyślnie brak wpisu = wyłączony).
-- Przy wyłączonym PIN-ie mark_alu_position_stage nie pyta o PIN (nie ma P0424 / P0428 / P0429); podpis nadal
-- zapisuje się w alu_stage_signatures (kto kliknął, czyje inicjały), z pin_verified = false.
-- Aplikacja (1.1.12) chowa przyciski „PIN ZKP”. Kompetencje, kolejność etapów (D54) i ZKP na pozycji (D57) bez zmian.
-- Można uruchamiać wielokrotnie.

create or replace function public.zkp_pin_wymagany()
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select coalesce((select lower(trim(value)) = 'on' from public.integration_settings where key = 'zkp_pin_wymagany'), false)
$function$;
revoke all on function public.zkp_pin_wymagany() from public, anon;
grant execute on function public.zkp_pin_wymagany() to authenticated, service_role;

do $$
declare
  d text;
  n text;
begin
  d := pg_get_functiondef('public.mark_alu_position_stage(bigint,text,text,integer,text)'::regprocedure);
  if position('public.zkp_pin_wymagany()' in d) > 0 then
    raise notice 'zkp_pin_wylaczony: już poprawione';
    return;
  end if;
  n := regexp_replace(d,
    'if v_operation is not null and v_zkp then(\s+)if not exists \(select 1 from public\.zkp_signature_pins',
    'if v_operation is not null and v_zkp and public.zkp_pin_wymagany() then\1if not exists (select 1 from public.zkp_signature_pins');
  if n = d then
    raise exception 'zkp_pin_wylaczony: nie znaleziono bloku PIN w mark_alu_position_stage';
  end if;
  execute n;
  raise notice 'zkp_pin_wylaczony: PIN wymagany tylko przy integration_settings.zkp_pin_wymagany = on';
end $$;
