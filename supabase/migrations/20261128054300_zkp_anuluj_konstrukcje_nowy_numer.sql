-- 28.11.2026 — decyzja D56 (właściciel: TAK — opcja a). DO WDROŻENIA (nie wgrane).
-- Wgrywać PO 20261128054200 (D55) — używa alu_assert_no_declaration.
-- Problem: po protokole niezgodnym karta wyrobu jest zamknięta, nowego protokołu nie da się zapisać, a nie ma
-- funkcji anulowania / zastąpienia jednej konstrukcji — teczka zlecenia nigdy nie będzie kompletna
-- (alu_dossier_status liczy aktywne konstrukcje ZKP).
-- Teraz zkp_cancel_construction(konstrukcja, powód, nr w rejestrze niezgodności 6.20):
--  * tylko Pełnomocnik ZKP / Zastępca; powód min. 5 znaków; odnośnik do rejestru 6.20 obowiązkowy,
--  * nie dla konstrukcji ze ZWOLNIONĄ kartą, z wydaną deklaracją (alu_assert_no_declaration), ani w zleceniu
--    już wydanym,
--  * konstrukcja → „anulowana” (powód + nr 6.20 w status_reason, audit_log przez audit_alu_constructions);
--    karta i protokoły zostają przy anulowanym numerze (historia),
--  * od razu nowa konstrukcja dla tej samej sztuki pozycji (ten sam piece_index) z KOLEJNYM numerem RRRR/ZZ/PP
--    (numer anulowany nie wraca do puli); dla niej zakłada się nową kartę wyrobu i protokół.
-- Liczniki etapów pozycji (production_stages) bez zmian — patrz raport (pytanie do właściciela).

create or replace function public.zkp_cancel_construction(p_construction_id bigint, p_reason text, p_nonconformity_ref text)
 returns table(r_cancelled_no text, r_new_id bigint, r_new_no text)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_con     record;
  v_reason  text := trim(coalesce(p_reason, ''));
  v_ref     text := trim(coalesce(p_nonconformity_ref, ''));
  v_new_id  bigint;
  v_new_no  text;
begin
  if not public.current_user_has_zkp_role(array['pelnomocnik', 'zastepca']) then
    raise exception 'Konstrukcję po niezgodności anuluje Pełnomocnik ZKP albo Zastępca (D56)';
  end if;
  if length(v_reason) < 5 then
    raise exception 'Podaj powód anulowania konstrukcji (min. 5 znaków)';
  end if;
  if v_ref = '' then
    raise exception 'Podaj numer niezgodności w rejestrze 6.20';
  end if;

  select k.* into v_con from public.alu_constructions k where k.id = p_construction_id for update;
  if not found then
    raise exception 'Nie ma konstrukcji %', p_construction_id;
  end if;
  if v_con.status <> 'aktywna' then
    raise exception 'Konstrukcja % jest już anulowana', v_con.construction_no;
  end if;
  if v_con.position_id is null then
    raise exception 'Konstrukcja % nie ma pozycji w zleceniu — nie da się nadać nowego numeru', v_con.construction_no;
  end if;
  if exists (select 1 from public.orders o where o.id = v_con.order_id and o.release_date is not null) then
    raise exception 'Zlecenie jest już wydane — konstrukcji % nie anuluje się (reklamacja / nowe zlecenie)', v_con.construction_no;
  end if;
  if exists (select 1 from public.zkp_product_cards c where c.construction_id = v_con.id and c.decision = 'zwolniony') then
    raise exception 'Konstrukcja % jest ZWOLNIONA — nie anuluje się jej tą funkcją', v_con.construction_no;
  end if;
  perform public.alu_assert_no_declaration(array[v_con.id]);

  update public.alu_constructions
  set status = 'anulowana',
      status_reason = 'niezgodność — rejestr 6.20: ' || v_ref || ' — ' || v_reason,
      status_changed_at = now(),
      status_changed_by = auth.uid()
  where id = v_con.id;

  -- nowy numer dla TEJ SAMEJ sztuki pozycji (piece_index jak anulowana), kolejny PP w zleceniu —
  -- jak alu_append_constructions (blokada wiersza alu_production_orders = brak wyścigu o PP)
  perform 1 from public.alu_production_orders po where po.order_id = v_con.order_id for update;
  if not found then
    raise exception 'Zlecenie nie jest uruchomione do produkcji — nie da się nadać nowego numeru';
  end if;
  insert into public.alu_constructions (order_id, position_id, pos_no, piece_index, year, zz, pp)
  select v_con.order_id, v_con.position_id, v_con.pos_no, v_con.piece_index, v_con.year, v_con.zz,
         (select coalesce(max(k.pp), 0) + 1 from public.alu_constructions k where k.year = v_con.year and k.zz = v_con.zz)
  returning id, construction_no into v_new_id, v_new_no;

  return query select v_con.construction_no, v_new_id, v_new_no;
end;
$function$;

revoke all on function public.zkp_cancel_construction(bigint, text, text) from public, anon;
grant execute on function public.zkp_cancel_construction(bigint, text, text) to authenticated, service_role;
