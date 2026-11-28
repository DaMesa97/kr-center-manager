-- 28.11.2026 — decyzja D52 (właściciel: TAK). DO WDROŻENIA (nie wgrane).
-- Problem: set_alu_order_zkp wpuszczała każdego kierownika (także bez roli ZKP); ręczne „ZKP: nie”
-- zdejmowało kontrolę kompetencji i blokadę wydania bez kompletnej teczki (symulacja: kierownik działu
-- wyłączył ZKP i wydał zlecenie AS 75EI).
-- Teraz:
--  * WYŁĄCZENIE ZKP (zlecenie dziś jest ZKP, a po zmianie nie będzie; albo „nie” na zleceniu z pozycją
--    AS 75EI) — tylko Pełnomocnik ZKP / Zastępca (role ZKP), z OBOWIĄZKOWYM powodem (min. 5 znaków).
--    Powód trafia do kolumny alu_zkp_override.reason, a więc do audit_log (trigger audit_alu_zkp_override).
--  * Włączenie ZKP i powrót do „automatycznie” bez osłabienia — jak dotąd kierownik (albo Pełnomocnik / Zastępca).
--  * Nowy, opcjonalny parametr p_reason (domyślnie null). Stara sygnatura (2 parametry) usuwana, żeby
--    PostgREST nie miał dwóch kandydatów; aplikacja przy PGRST202 (baza bez tej migracji) woła bez powodu.

alter table public.alu_zkp_override add column if not exists reason text not null default '';

drop function if exists public.set_alu_order_zkp(bigint, boolean);

create or replace function public.set_alu_order_zkp(p_order_id bigint, p_is_zkp boolean, p_reason text default null)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_service   boolean := coalesce(auth.role(), '') = 'service_role';
  v_zkp_admin boolean := public.current_user_has_zkp_role(array['pelnomocnik', 'zastepca']);
  v_reason    text := trim(coalesce(p_reason, ''));
  v_auto      boolean;
  v_cur       boolean;
  v_after     boolean;
begin
  if not (v_service or v_zkp_admin or public.current_user_is_manager()) then
    raise exception 'Oznaczenie ZKP zmienia kierownik albo Pełnomocnik ZKP / Zastępca';
  end if;
  if not exists (select 1 from public.orders o where o.id = p_order_id) then
    raise exception 'Zlecenie % nie istnieje', p_order_id;
  end if;

  -- rozpoznanie automatyczne: jakakolwiek pozycja w systemie AS 75EI
  v_auto := exists (
    select 1 from public.order_alu_positions p
    where p.order_id = p_order_id and p.system ~* '75\s*-?\s*EI'
  );
  v_cur   := public.alu_order_is_zkp(p_order_id);
  v_after := coalesce(p_is_zkp, v_auto);

  -- D52: osłabienie kontroli = wyłączenie ZKP na zleceniu, które dziś jest ZKP, albo „nie” na zleceniu AS 75EI
  if (v_cur and not v_after) or (v_auto and p_is_zkp is false) then
    if not (v_zkp_admin or v_service) then
      raise exception 'Wyłączyć ZKP na zleceniu może tylko Pełnomocnik ZKP albo Zastępca (D52)';
    end if;
    if length(v_reason) < 5 then
      raise exception 'Podaj powód wyłączenia ZKP (min. 5 znaków) — zapisywany w audycie';
    end if;
  end if;

  if p_is_zkp is null then
    delete from public.alu_zkp_override where order_id = p_order_id;
  else
    insert into public.alu_zkp_override (order_id, is_zkp, set_by, reason)
    values (p_order_id, p_is_zkp, auth.uid(), v_reason)
    on conflict (order_id) do update
      set is_zkp = excluded.is_zkp, set_at = now(), set_by = auth.uid(), reason = excluded.reason;
  end if;
end;
$function$;

revoke all on function public.set_alu_order_zkp(bigint, boolean, text) from public, anon;
grant execute on function public.set_alu_order_zkp(bigint, boolean, text) to authenticated, service_role;
