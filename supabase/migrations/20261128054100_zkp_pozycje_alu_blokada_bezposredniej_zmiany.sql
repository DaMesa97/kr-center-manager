-- 28.11.2026 — decyzja D52 (odpowiedź właściciela, część 2). DO WDROŻENIA (nie wgrane).
-- Problem: RLS order_alu_positions pozwala kierownikowi na bezpośredni UPDATE / INSERT tabeli (z pominięciem
-- funkcji bazy). Można było więc zdjąć ZKP z pozycji, zmieniając `system` z „AS 75EI” na inny (albo dopisać
-- 75EI), i ręcznie wpisać / skasować etapy produkcji (`production_stages`) bez kompetencji, PIN-u, kolejności
-- etapów i blokad ZKP z mark_alu_position_stage.
-- Teraz trigger BEFORE INSERT / UPDATE (alu_positions_zkp_guard — nazwa po alu_positions_trim_on_quantity,
-- więc widzi już przycięte etapy):
--  * dotyczy tylko zapisu WPROST z aplikacji (current_user = authenticated / anon). Funkcje bazy
--    (import_alu_order — import i nadpisanie LP, mark_alu_position_stage, undo_alu_position_stage, triggery)
--    są SECURITY DEFINER właściciela postgres, więc wewnątrz nich current_user = postgres i trigger ich NIE
--    blokuje — to działa jak „flaga transakcji” bez łatania tych funkcji (import / nadpisanie LP działają jak
--    dotąd, także zmiana systemu w nowej wersji LP). Service role / postgres (migracje) też przechodzą.
--  * zmiana `system` przekraczająca granicę AS 75EI (z 75EI na inny albo z innego na 75EI) wprost — tylko
--    Pełnomocnik ZKP / Zastępca (role ZKP). Zmiana systemu w obrębie „nie-75EI” bez ograniczeń.
--  * `production_stages` wprost — zabronione (INSERT tylko z pustymi etapami). Wyjątek: przycięcie etapów
--    przy zmniejszeniu ilości (alu_positions_trim_on_quantity) — wartość równa alu_trim_stages(stare, ilość).
-- Aplikacja nie zapisuje tej tabeli wprost (tylko RPC) — bez zmian w kodzie.

create or replace function public.alu_positions_zkp_guard()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_old75 boolean;
  v_new75 boolean;
begin
  -- funkcje bazy (SECURITY DEFINER, właściciel postgres), service role, migracje — bez ograniczeń
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new.production_stages, '{}'::jsonb) <> '{}'::jsonb then
      raise exception 'Etapy produkcji pozycji zapisuje się tylko przez oznaczanie etapów w programie (D52)';
    end if;
    return new;
  end if;

  -- UPDATE
  if new.production_stages is distinct from old.production_stages
     and not (new.quantity < old.quantity
              and new.production_stages is not distinct from public.alu_trim_stages(old.production_stages, new.quantity)) then
    raise exception 'Etapy produkcji pozycji zmienia się tylko przez oznaczanie / cofanie etapów w programie (D52)';
  end if;

  v_old75 := coalesce(old.system ~* '75\s*-?\s*EI', false);
  v_new75 := coalesce(new.system ~* '75\s*-?\s*EI', false);
  if v_old75 <> v_new75
     and not public.current_user_has_zkp_role(array['pelnomocnik', 'zastepca']) then
    raise exception 'Zmianę systemu pozycji % z / na AS 75EI (ZKP) może zrobić tylko Pełnomocnik ZKP albo Zastępca (D52)', old.pos_no;
  end if;
  return new;
end;
$function$;

drop trigger if exists alu_positions_zkp_guard on public.order_alu_positions;
create trigger alu_positions_zkp_guard
  before insert or update of system, production_stages, quantity on public.order_alu_positions
  for each row execute function public.alu_positions_zkp_guard();
