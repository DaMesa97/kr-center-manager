-- ZKP AS 75EI — lista materiałowa zlecenia (zestawienie materiałowe, ZKP 5.9)
--
-- „Lista materiałowa" z programu Aluron (.xls) dopinana do zlecenia aluminium:
-- 1) Nowy rodzaj dokumentu LM; bucket order-documents przyjmuje też .xls/.xlsx.
-- 2) zkp_material_lists + zkp_material_list_items: pozycje listy przypięte do
--    KONKRETNEJ wersji dokumentu LM (nowa wersja = nowa lista, stara zostaje).
-- 3) zkp_import_material_list: w jednej transakcji nowa wersja dokumentu LM
--    (attach_order_document) i pozycje — nie ma stanu „plik jest, pozycji brak".
-- 4) Teczka: pozycja 4 „Zestawienie materiałowe" = LM albo LP.
-- Tabele zkp_* są objęte 10-letnią retencją audytu (cleanup_old_logs z zkp_03);
-- tu ta sama definicja, żeby kolejność wgrania 03/04 nie miała znaczenia.

-- ── 1) Rodzaj LM i pliki Excel w buckecie ────────────────────────────────
alter table public.order_documents drop constraint if exists order_documents_kind_check;
alter table public.order_documents add constraint order_documents_kind_check
  check (kind in ('LP', 'LC', 'ZM', 'ZK', 'ZMAT', 'MONT', 'INNE', 'LM'));

update storage.buckets
set allowed_mime_types = array['application/pdf',
                               'application/vnd.ms-excel',
                               'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
where id = 'order-documents';

create or replace function public.attach_order_document(p_order_id bigint, p_kind text, p_number text, p_storage_path text, p_file_name text)
returns table(r_document_id bigint, r_replaced_storage_path text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order_number text;
  v_doc_id       bigint;
  v_uploader     uuid;
  v_name         text;
  v_version      int;
begin
  perform public.assert_manager_or_service();

  if p_kind not in ('LP', 'LC', 'ZM', 'ZK', 'ZMAT', 'MONT', 'INNE', 'LM') then
    raise exception 'Nieznany rodzaj dokumentu: %', p_kind;
  end if;
  if coalesce(p_storage_path, '') = '' or coalesce(p_file_name, '') = '' then
    raise exception 'Brak ścieżki lub nazwy pliku dokumentu';
  end if;

  -- blokada zlecenia serializuje numerację wersji
  select o.order_number into v_order_number from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'Zlecenie % nie istnieje', p_order_id;
  end if;

  select coalesce(max(d.version), 0) + 1 into v_version
  from public.order_documents d where d.order_id = p_order_id and d.kind = p_kind;

  select pr.id, coalesce(nullif(pr.full_name, ''), nullif(pr.initials, ''), '')
  into v_uploader, v_name
  from public.profiles pr where pr.id = auth.uid();

  insert into public.order_documents
    (order_id, order_number, kind, number, storage_path, file_name, uploaded_by, uploaded_by_name, uploaded_at, version)
  values
    (p_order_id, v_order_number, p_kind, nullif(trim(p_number), ''), p_storage_path, p_file_name,
     v_uploader, coalesce(v_name, ''), now(), v_version)
  returning id into v_doc_id;

  -- ZKP 5.1.6: poprzednie wersje zostają — nigdy nie zwracamy ścieżki do skasowania
  return query select v_doc_id, null::text;
end;
$function$;

revoke all on function public.attach_order_document(bigint, text, text, text, text) from public, anon;
grant execute on function public.attach_order_document(bigint, text, text, text, text) to authenticated, service_role;

-- ── 2) Lista materiałowa i jej pozycje ───────────────────────────────────
create table if not exists public.zkp_material_lists (
  id                  bigint generated always as identity primary key,
  order_id            bigint not null references public.orders(id) on delete restrict,
  document_id         bigint not null unique references public.order_documents(id) on delete restrict,
  source_order_number text not null default '',      -- „Zlecenie:" z pliku (np. OF348/2026)
  list_created_on     date,                          -- „Utworzono:" z pliku
  total_value         numeric(14, 2),
  total_need_value    numeric(14, 2),
  item_count          int not null check (item_count > 0),
  imported_at         timestamptz not null default now(),
  imported_by         uuid default auth.uid(),
  imported_by_name    text not null default ''
);
create index if not exists zkp_material_lists_order_idx on public.zkp_material_lists (order_id);

create table if not exists public.zkp_material_list_items (
  id          bigint generated always as identity primary key,
  list_id     bigint not null references public.zkp_material_lists(id) on delete restrict,
  line_no     int not null,
  group_name  text not null default '',
  code        text not null check (trim(code) <> ''),
  gm_code     text not null default '',
  description text not null default '',
  quantity    numeric(14, 3) not null,
  unit        text not null default '',
  unit_price  numeric(14, 4),
  value       numeric(14, 2),
  need        numeric(14, 4),
  need_value  numeric(14, 2),
  need_net    numeric(14, 4),                        -- potrzeba bez odpadów
  unique (list_id, line_no)
);
create index if not exists zkp_material_list_items_code_idx on public.zkp_material_list_items (code);

-- tylko odczyt; zapis wyłącznie przez RPC, bez UPDATE/DELETE (zał. 6.34)
alter table public.zkp_material_lists enable row level security;
alter table public.zkp_material_list_items enable row level security;
drop policy if exists zkp_material_lists_read on public.zkp_material_lists;
create policy zkp_material_lists_read on public.zkp_material_lists for select to authenticated using (true);
drop policy if exists zkp_material_list_items_read on public.zkp_material_list_items;
create policy zkp_material_list_items_read on public.zkp_material_list_items for select to authenticated using (true);

drop trigger if exists audit_zkp_material_lists on public.zkp_material_lists;
create trigger audit_zkp_material_lists after insert or update or delete on public.zkp_material_lists
  for each row execute function public.audit_trigger_fn();

-- ── 3) Import: dokument LM + pozycje w jednej transakcji ─────────────────
-- p_header: {order_number, created_at (YYYY-MM-DD), total_value, total_need_value}
-- p_items:  [{group, code, gm_code, description, quantity, unit, unit_price,
--             value, need, need_value, need_net}, …] — wynik parsera listy
create or replace function public.zkp_import_material_list(
  p_order_id bigint, p_storage_path text, p_file_name text, p_header jsonb, p_items jsonb)
returns table(r_list_id bigint, r_document_id bigint, r_version int, r_item_count int)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_doc_id  bigint;
  v_list_id bigint;
  v_count   int;
  v_name    text;
begin
  perform public.assert_manager_or_service();

  if not exists (select 1 from public.orders o where o.id = p_order_id and o.category = 'Aluminium') then
    raise exception 'Zlecenie % nie jest zleceniem aluminium', p_order_id;
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Lista materiałowa nie zawiera pozycji';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) e
    where coalesce(trim(e->>'code'), '') = ''
       or jsonb_typeof(e->'quantity') is distinct from 'number'
  ) then
    raise exception 'Każda pozycja listy musi mieć kod elementu i ilość';
  end if;

  select a.r_document_id into v_doc_id
  from public.attach_order_document(p_order_id, 'LM', p_header->>'order_number', p_storage_path, p_file_name) a;

  select coalesce(nullif(pr.full_name, ''), nullif(pr.initials, ''), '')
  into v_name from public.profiles pr where pr.id = auth.uid();

  v_count := jsonb_array_length(p_items);
  insert into public.zkp_material_lists
    (order_id, document_id, source_order_number, list_created_on, total_value, total_need_value,
     item_count, imported_by_name)
  values
    (p_order_id, v_doc_id, coalesce(trim(p_header->>'order_number'), ''),
     case when coalesce(p_header->>'created_at', '') ~ '^\d{4}-\d{2}-\d{2}$'
          then (p_header->>'created_at')::date end,
     (p_header->>'total_value')::numeric, (p_header->>'total_need_value')::numeric,
     v_count, coalesce(v_name, ''))
  returning id into v_list_id;

  insert into public.zkp_material_list_items
    (list_id, line_no, group_name, code, gm_code, description, quantity, unit,
     unit_price, value, need, need_value, need_net)
  select v_list_id, e.ord::int,
         coalesce(trim(e.val->>'group'), ''), trim(e.val->>'code'),
         coalesce(trim(e.val->>'gm_code'), ''), coalesce(trim(e.val->>'description'), ''),
         (e.val->>'quantity')::numeric, coalesce(trim(e.val->>'unit'), ''),
         (e.val->>'unit_price')::numeric, (e.val->>'value')::numeric,
         (e.val->>'need')::numeric, (e.val->>'need_value')::numeric, (e.val->>'need_net')::numeric
  from jsonb_array_elements(p_items) with ordinality as e(val, ord);

  return query
  select v_list_id, v_doc_id, d.version, v_count
  from public.order_documents d where d.id = v_doc_id;
end;
$function$;

revoke all on function public.zkp_import_material_list(bigint, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.zkp_import_material_list(bigint, text, text, jsonb, jsonb) to authenticated, service_role;

-- ── 4) Teczka: zestawienie materiałowe = LM albo LP ──────────────────────
create or replace function public.alu_dossier_status(p_order_id bigint)
returns table(r_sort int, r_item_key text, r_label text, r_status text, r_detail text,
              r_document_id bigint, r_na_id bigint, r_at timestamptz, r_by text, r_na_allowed boolean)
language sql
stable
security definer
set search_path to 'public'
as $$
  with cur as (   -- bieżąca (najnowsza niewycofana) wersja każdego rodzaju
    select distinct on (d.kind) d.*
    from public.order_documents d
    where d.order_id = p_order_id and d.withdrawn_at is null
    order by d.kind, d.version desc
  ),
  na as (
    select n.* from public.zkp_dossier_na n
    where n.order_id = p_order_id and n.withdrawn_at is null
  ),
  items(sort, key, label, kinds, na_allowed, generated_in) as (values
    (1,  'zamowienie_klienta',      'Zamówienie klienta',                       array['ZK'],         true,  null),
    (2,  'zlecenie_produkcyjne',    'Zlecenie produkcyjne (zał. 6.30)',          array[]::text[],     false, 'etap C'),
    (3,  'lista_ciec',              'Lista cięć',                                array['LC'],         false, null),
    (4,  'zestawienie_materialowe', 'Zestawienie materiałowe (lista materiałowa / LP)', array['LM','LP'], false, null),
    (5,  'zamowienia_materialow',   'Zamówienia materiałów (szkło, profile, okucia)', array['ZM','ZMAT'], true, null),
    (6,  'przyjecia_pz',            'Dokumenty przyjęcia do magazynu (PZ)',      array[]::text[],     false, 'etap F'),
    (7,  'wydania_rw',              'Wydania materiałów na zlecenie (RW, partie)', array[]::text[],   false, 'etap F'),
    (8,  'karta_wyrobu',            'Karta wyrobu (zał. 6.25)',                  array[]::text[],     false, 'etap C'),
    (9,  'protokol_badan',          'Protokół badań wyrobu gotowego (zał. 6.17.5)', array[]::text[],  false, 'etap D'),
    (10, 'deklaracja',              'Deklaracja KDWU / DWU',                     array[]::text[],     false, 'etap E'),
    (11, 'protokol_montazu',        'Protokół montażu (zał. 6.28)',              array['MONT'],       true,  null)
  )
  select i.sort, i.key, i.label,
         case when doc.id is not null then 'jest'
              when n.id is not null then 'nie_dotyczy'
              else 'brak' end,
         case when doc.id is not null then
                doc.kind || ' v' || doc.version || ' · ' || doc.file_name
                || coalesce(' · ' || doc.number, '')
              when n.id is not null then n.reason
              when i.generated_in is not null then 'generowane przez program — ' || i.generated_in
              else '' end,
         doc.id, n.id,
         coalesce(doc.uploaded_at, n.created_at),
         coalesce(nullif(doc.uploaded_by_name, ''), n.created_by_name),
         i.na_allowed
  from items i
  left join lateral (
    -- pierwszeństwo wg kolejności w kinds (LM przed LP), potem najnowszy
    select c.* from cur c where c.kind = any(i.kinds)
    order by array_position(i.kinds, c.kind), c.uploaded_at desc limit 1
  ) doc on true
  left join na n on n.item_key = i.key
  order by i.sort;
$$;

revoke all on function public.alu_dossier_status(bigint) from public, anon;
grant execute on function public.alu_dossier_status(bigint) to authenticated, service_role;

-- ── 5) Retencja 10 lat (ta sama definicja co w zkp_03) ───────────────────
create or replace function public.cleanup_old_logs()
returns void
language sql
security definer
set search_path to 'public'
as $$
  delete from audit_log
  where created_at < now() - interval '12 months'
    and table_name not like 'zkp\_%'
    and table_name not in ('order_alu_positions', 'order_documents',
                           'alu_constructions', 'alu_production_orders', 'alu_zkp_override')
    and not (table_name = 'orders'
             and coalesce(new_data->>'category', old_data->>'category') = 'Aluminium')
    and not (table_name = 'warehouse_components'
             and coalesce(new_data->>'zkp_critical_kind', old_data->>'zkp_critical_kind') is not null);
  delete from forecast_runs where run_at < now() - interval '90 days';
  delete from api_request_logs where created_at < now() - interval '90 days';
$$;
revoke execute on function public.cleanup_old_logs() from public, anon, authenticated;
