-- Aluminium — poprawki z przeglądu 23.10 (wdrożone przez MCP jako aluminium_poprawki_przegladu)
-- 1) Wymiary konstrukcji > 0 także w bazie (okno importu przepuszczało ujemne,
--    import_alu_order nie sprawdzał). NULL zostaje dozwolony — parser nie
--    zawsze odczyta wymiar, a wtedy okno importu i tak blokuje zapis.
-- 2) attach_order_document: komunikat o dozwolonych rodzajach znał tylko LP, LC (bez ZM).

alter table public.order_alu_positions
  add constraint order_alu_positions_width_positive check (width_mm is null or width_mm > 0),
  add constraint order_alu_positions_height_positive check (height_mm is null or height_mm > 0);

create or replace function public.attach_order_document(p_order_id bigint, p_kind text, p_number text, p_storage_path text, p_file_name text)
 returns table(r_document_id bigint, r_replaced_storage_path text)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_order_number text;
  v_old_path     text;
  v_doc_id       bigint;
  v_uploader     uuid;
begin
  perform public.assert_manager_or_service();

  if p_kind not in ('LP', 'LC', 'ZM') then
    raise exception 'Nieznany rodzaj dokumentu: % (dozwolone: LP, LC, ZM)', p_kind;
  end if;
  if coalesce(p_storage_path, '') = '' or coalesce(p_file_name, '') = '' then
    raise exception 'Brak ścieżki lub nazwy pliku dokumentu';
  end if;

  select o.order_number into v_order_number from public.orders o where o.id = p_order_id;
  if not found then
    raise exception 'Zlecenie % nie istnieje', p_order_id;
  end if;

  select d.storage_path into v_old_path
  from public.order_documents d
  where d.order_id = p_order_id and d.kind = p_kind;

  -- service_role nie ma profilu — uploaded_by zostaje puste
  select pr.id into v_uploader from public.profiles pr where pr.id = auth.uid();

  insert into public.order_documents (order_id, order_number, kind, number, storage_path, file_name, uploaded_by, uploaded_at)
  values (p_order_id, v_order_number, p_kind, nullif(trim(p_number), ''), p_storage_path, p_file_name, v_uploader, now())
  on conflict (order_id, kind) do update set
    order_number = excluded.order_number,
    number       = excluded.number,
    storage_path = excluded.storage_path,
    file_name    = excluded.file_name,
    uploaded_by  = excluded.uploaded_by,
    uploaded_at  = now()
  returning id into v_doc_id;

  return query select
    v_doc_id,
    case when v_old_path is not null and v_old_path <> p_storage_path then v_old_path else null end;
end;
$function$;
