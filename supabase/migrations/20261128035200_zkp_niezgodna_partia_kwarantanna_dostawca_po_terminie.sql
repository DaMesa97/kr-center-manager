-- 28.11.2026 — decyzja D58 (właściciel: TAK). DO WDROŻENIA (nie wgrane).
-- Problem: partię niezgodną z zamówieniem / z listą 6.10.5 / uszkodzoną można było przyjąć jako PRZYJĘTO
-- (wystarczyło uzasadnienie), a dostawca po terminie oceny okresowej dalej był „kwalifikowany”.
-- Teraz:
--  1) zkp_register_receipt: decyzja „przyjeto” przy jakiejkolwiek niezgodności (conforms_to_order,
--     conforms_to_list_6105 albo condition_ok = false) jest zamieniana na KWARANTANNĘ (jak dotąd przy braku
--     nr partii / dokumentu jakości; r_forced_quarantine = true). Powód wymuszenia + uzasadnienie magazynu
--     trafiają do decision_reason. Partię z kwarantanny zwalnia jak dotąd decyzja Pełnomocnika / Zastępcy
--     (zkp_decide_lot — bez zmian).
--  2) zkp_supplier_is_qualified: dostawca kwalifikowany = na wykazie 6.31 + ostatnia ocena pozytywna/warunkowa
--     + termin kolejnej oceny (next_assessment_on ostatniej oceny) nie minął (data w Polsce). Brak terminu =
--     jak dotąd (kwalifikowany).
-- Reszta obu funkcji bez zmian (pełne definicje — żadna nocna migracja ich nie zmienia).

create or replace function public.zkp_supplier_is_qualified(p_supplier_id bigint)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (select 1 from public.zkp_supplier_qualifications q where q.supplier_id = p_supplier_id)
     and coalesce((
       select a.result in ('pozytywna', 'warunkowa')
              -- D58: po terminie oceny okresowej = niekwalifikowany
              and (a.next_assessment_on is null
                   or a.next_assessment_on >= (now() at time zone 'Europe/Warsaw')::date)
       from public.zkp_supplier_assessments a
       where a.supplier_id = p_supplier_id
       order by a.assessed_on desc, a.id desc
       limit 1
     ), false);
$function$;

create or replace function public.zkp_register_receipt(p_received_on date, p_supplier_id bigint, p_delivery_doc text, p_component_id bigint, p_catalog_no text, p_quantity numeric, p_lot_no text, p_quality_doc_kind text, p_quality_doc_no text, p_quality_doc_path text, p_conforms_to_order boolean, p_conforms_to_list_6105 boolean, p_condition_ok boolean, p_condition_notes text, p_decision text, p_decision_reason text, p_pz_reference text, p_source text DEFAULT 'reczne'::text, p_source_document_path text DEFAULT NULL::text)
 returns table(r_lot_id bigint, r_decision text, r_forced_quarantine boolean)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_decision text := coalesce(p_decision, 'kwarantanna');
  v_forced   boolean := false;
  v_why      text[] := array[]::text[];
  v_reason   text;
  v_name     text;
  v_id       bigint;
begin
  if not public.current_user_has_zkp_role(array['magazyn', 'pelnomocnik', 'zastepca']) then
    raise exception 'Przyjęcie komponentu krytycznego rejestruje magazyn (rola ZKP) albo Pełnomocnik / Zastępca';
  end if;
  if not exists (select 1 from public.warehouse_components c where c.id = p_component_id and c.zkp_critical_kind is not null) then
    raise exception 'Komponent nie jest na liście komponentów krytycznych (zał. 6.10.5)';
  end if;
  if not public.zkp_supplier_is_qualified(p_supplier_id) then
    raise exception 'Dostawca niekwalifikowany (spoza wykazu 6.31, ocena negatywna / brak oceny albo po terminie oceny okresowej) — przyjęcie komponentu krytycznego niedozwolone';
  end if;
  if v_decision not in ('przyjeto', 'kwarantanna', 'zwrot') then
    raise exception 'Nieznana decyzja: %', v_decision;
  end if;

  if v_decision = 'przyjeto' then
    -- brief pkt 8: brak nr partii lub dokumentu jakości = KWARANTANNA
    if coalesce(trim(p_lot_no), '') = ''
       or (coalesce(trim(p_quality_doc_no), '') = '' and coalesce(p_quality_doc_path, '') = '') then
      v_why := v_why || 'brak nr partii lub dokumentu jakości'::text;
    end if;
    -- D58: niezgodność = obowiązkowa kwarantanna (decyzja Pełnomocnika / Zastępcy)
    if not coalesce(p_conforms_to_order, false) then
      v_why := v_why || 'niezgodne z zamówieniem'::text;
    end if;
    if not coalesce(p_conforms_to_list_6105, false) then
      v_why := v_why || 'niezgodne z listą 6.10.5'::text;
    end if;
    if not coalesce(p_condition_ok, false) then
      v_why := v_why || 'uwagi do stanu / opakowania'::text;
    end if;
    if cardinality(v_why) > 0 then
      v_decision := 'kwarantanna';
      v_forced := true;
    end if;
  end if;

  v_reason := case
    when v_forced then array_to_string(v_why, ', ') || ' — kwarantanna (zał. 6.24)'
                       || coalesce(' · ' || nullif(trim(coalesce(p_decision_reason, '')), ''), '')
    else trim(coalesce(p_decision_reason, '')) end;

  select coalesce(nullif(full_name, ''), nullif(initials, ''), '') into v_name from public.profiles where id = auth.uid();

  insert into public.zkp_material_lots (
    received_on, supplier_id, delivery_doc, component_id, catalog_no, quantity, lot_no,
    quality_doc_kind, quality_doc_no, quality_doc_path, conforms_to_order, conforms_to_list_6105,
    condition_ok, condition_notes, decision, decision_reason, pz_reference, source, source_document_path,
    received_by, received_by_name, decided_at, decided_by, decided_by_name
  ) values (
    coalesce(p_received_on, current_date), p_supplier_id, trim(coalesce(p_delivery_doc, '')), p_component_id,
    trim(coalesce(p_catalog_no, '')), p_quantity, trim(coalesce(p_lot_no, '')),
    trim(coalesce(p_quality_doc_kind, '')), trim(coalesce(p_quality_doc_no, '')), nullif(p_quality_doc_path, ''),
    coalesce(p_conforms_to_order, false), coalesce(p_conforms_to_list_6105, false),
    coalesce(p_condition_ok, false), trim(coalesce(p_condition_notes, '')),
    v_decision, v_reason,
    trim(coalesce(p_pz_reference, '')), coalesce(p_source, 'reczne'), nullif(p_source_document_path, ''),
    auth.uid(), coalesce(v_name, ''), now(), auth.uid(), coalesce(v_name, '')
  ) returning id into v_id;

  return query select v_id, v_decision, v_forced;
end;
$function$;
