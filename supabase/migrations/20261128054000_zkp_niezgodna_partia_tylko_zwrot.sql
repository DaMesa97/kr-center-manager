-- 28.11.2026 — decyzja D58 (odpowiedź właściciela, część 2). DO WDROŻENIA (nie wgrane).
-- Problem: po 20261128035200 partia niezgodna trafia do kwarantanny, ale Pełnomocnik / Zastępca mógł ją potem
-- zwolnić jako PRZYJĘTO (wystarczyło uzasadnienie). Właściciel: partia niezgodna z listą 6.10.5 albo
-- uszkodzona (stan / opakowanie z uwagami) = dozwolony TYLKO ZWROT.
-- Teraz zkp_decide_lot odmawia decyzji „przyjeto”, gdy conforms_to_list_6105 = false albo condition_ok = false.
-- Niezgodność z zamówieniem (conforms_to_order = false) — jak dotąd: decyzja Pełnomocnika (zwolnić albo zwrot).
-- Flag zgodności po zapisie przyjęcia nie da się zmienić (zkp_complete_lot uzupełnia tylko nr partii i dokument
-- jakości), więc obejścia przez „Uzupełnij” nie ma.
-- Reszta funkcji bez zmian (pełna definicja z bazy produkcyjnej z 28.11).

create or replace function public.zkp_decide_lot(p_lot_id bigint, p_decision text, p_reason text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_lot  record;
  v_name text;
begin
  if not public.current_user_has_zkp_role(array['pelnomocnik', 'zastepca']) then
    raise exception 'Partię z kwarantanny zwalnia decyzja Pełnomocnika ZKP lub Zastępcy';
  end if;
  if p_decision not in ('przyjeto', 'zwrot') then
    raise exception 'Decyzja: przyjeto albo zwrot';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Podaj uzasadnienie decyzji';
  end if;
  select * into v_lot from public.zkp_material_lots where id = p_lot_id for update;
  if not found or v_lot.decision <> 'kwarantanna' then
    raise exception 'Decyzję podejmuje się tylko dla partii w kwarantannie';
  end if;
  -- D58: partia niezgodna z listą 6.10.5 albo uszkodzona — tylko zwrot
  if p_decision = 'przyjeto' and (not v_lot.conforms_to_list_6105 or not v_lot.condition_ok) then
    raise exception 'Partii niezgodnej z listą 6.10.5 albo uszkodzonej nie można przyjąć — dozwolony tylko zwrot do dostawcy';
  end if;
  if p_decision = 'przyjeto'
     and (v_lot.lot_no = '' or (v_lot.quality_doc_no = '' and v_lot.quality_doc_path is null)) then
    raise exception 'Nie można przyjąć partii bez nr partii i dokumentu jakości — najpierw je uzupełnij';
  end if;
  select coalesce(nullif(full_name, ''), nullif(initials, ''), '') into v_name from public.profiles where id = auth.uid();
  update public.zkp_material_lots
  set decision = p_decision, decision_reason = trim(p_reason),
      decided_at = now(), decided_by = auth.uid(), decided_by_name = coalesce(v_name, '')
  where id = p_lot_id;
end;
$function$;
