-- =====================================================================
-- ZKP AS 75EI — F: PRZYJĘCIA KOMPONENTÓW KRYTYCZNYCH, PARTIE, DOSTAWCY (2026-10-26)
-- Brief pkt 8 (ZKP 5.4, 5.9; zał. 6.24, 6.31, 6.10.5).
--
-- 1) Komponenty krytyczne (zał. 6.10.5): warehouse_components.zkp_critical_kind
--    (wkład / uszczelka pęczniejąca / szkło ogniochronne / okucie) + model i nr DWU okuć.
-- 2) Dostawcy kwalifikowani (zał. 6.31): zakres, czy krytyczny, wymagany dokument
--    jakości, oceny wstępna i okresowe (historia, bez kasowania).
-- 3) Rejestr przyjęć (zał. 6.24) = partie: jeden wpis na komponent w dostawie.
--    Brak nr partii lub dokumentu jakości = KWARANTANNA (wymuszone w bazie).
--    Przyjęcie komponentu krytycznego tylko od dostawcy z wykazu kwalifikowanych.
--    Kwarantannę zwalnia decyzja PJ (Pełnomocnik / Zastępca) z powodem.
--    Kolumny `source`/`source_document_path` pod przyszły import przyjęć z pliku.
-- 4) Bucket zkp-documents (skany dokumentów jakości: PDF/JPG/PNG), bez kasowania.
-- 5) Retencja 10 lat: cleanup_old_logs pomija wszystkie tabele zkp_*.
--
-- Wydanie partii na zlecenie (RW z partią) — etap B4 (wymaga obiegu magazynowego
-- aluminium). Wymaga: zkp_00. Bezpieczne do ponownego uruchomienia.
-- =====================================================================

-- ── 1) Komponenty krytyczne (zał. 6.10.5) ────────────────────────────────
alter table public.warehouse_components add column if not exists zkp_critical_kind text;
alter table public.warehouse_components drop constraint if exists warehouse_components_zkp_critical_kind_check;
alter table public.warehouse_components add constraint warehouse_components_zkp_critical_kind_check
  check (zkp_critical_kind is null or zkp_critical_kind in ('wklad', 'uszczelka', 'szklo', 'okucie'));
alter table public.warehouse_components add column if not exists zkp_model text not null default '';
alter table public.warehouse_components add column if not exists zkp_dwu_number text not null default '';

-- Listę 6.10.5 prowadzi Pełnomocnik ZKP (brief pkt 2): zmiana flagi tylko przez RPC z rolą PJ.
create or replace function public.zkp_set_component_critical(
  p_component_id bigint, p_kind text, p_model text, p_dwu_number text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.current_user_has_zkp_role(array['pelnomocnik', 'zastepca']) then
    raise exception 'Listę komponentów krytycznych (zał. 6.10.5) prowadzi Pełnomocnik ZKP lub Zastępca';
  end if;
  update public.warehouse_components
  set zkp_critical_kind = nullif(trim(coalesce(p_kind, '')), ''),
      zkp_model = trim(coalesce(p_model, '')),
      zkp_dwu_number = trim(coalesce(p_dwu_number, ''))
  where id = p_component_id;
  if not found then
    raise exception 'Komponent % nie istnieje', p_component_id;
  end if;
end;
$function$;

-- ── 2) Dostawcy kwalifikowani (zał. 6.31) ────────────────────────────────
create table if not exists public.zkp_supplier_qualifications (
  supplier_id          bigint primary key references public.suppliers(id) on delete restrict,
  scope                text not null default '',
  is_critical          boolean not null default true,
  required_quality_doc text not null default '',
  updated_at           timestamptz not null default now(),
  updated_by           uuid default auth.uid(),
  updated_by_name      text not null default ''
);

create table if not exists public.zkp_supplier_assessments (
  id                 bigint generated always as identity primary key,
  supplier_id        bigint not null references public.suppliers(id) on delete restrict,
  kind               text not null check (kind in ('wstepna', 'okresowa')),
  assessed_on        date not null,
  result             text not null check (result in ('pozytywna', 'warunkowa', 'negatywna')),
  notes              text not null default '',
  next_assessment_on date,
  created_at         timestamptz not null default now(),
  created_by         uuid default auth.uid(),
  created_by_name    text not null default ''
);
create index if not exists zkp_supplier_assessments_supplier_idx
  on public.zkp_supplier_assessments (supplier_id, assessed_on desc, id desc);

-- Na wykazie kwalifikowanych = jest wpis kwalifikacji i ostatnia ocena pozytywna albo warunkowa.
create or replace function public.zkp_supplier_is_qualified(p_supplier_id bigint)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (select 1 from public.zkp_supplier_qualifications q where q.supplier_id = p_supplier_id)
     and coalesce((
       select a.result in ('pozytywna', 'warunkowa')
       from public.zkp_supplier_assessments a
       where a.supplier_id = p_supplier_id
       order by a.assessed_on desc, a.id desc
       limit 1
     ), false);
$$;

create or replace function public.zkp_upsert_supplier_qualification(
  p_supplier_id bigint, p_scope text, p_is_critical boolean, p_required_quality_doc text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_name text;
begin
  if not public.current_user_has_zkp_role(array['pelnomocnik', 'zastepca']) then
    raise exception 'Wykaz dostawców kwalifikowanych (zał. 6.31) prowadzi Pełnomocnik ZKP lub Zastępca';
  end if;
  select coalesce(nullif(full_name, ''), nullif(initials, ''), '') into v_name from public.profiles where id = auth.uid();
  insert into public.zkp_supplier_qualifications (supplier_id, scope, is_critical, required_quality_doc, updated_by, updated_by_name)
  values (p_supplier_id, trim(coalesce(p_scope, '')), coalesce(p_is_critical, true), trim(coalesce(p_required_quality_doc, '')),
          auth.uid(), coalesce(v_name, ''))
  on conflict (supplier_id) do update set
    scope = excluded.scope, is_critical = excluded.is_critical,
    required_quality_doc = excluded.required_quality_doc,
    updated_at = now(), updated_by = auth.uid(), updated_by_name = excluded.updated_by_name;
end;
$function$;

create or replace function public.zkp_add_supplier_assessment(
  p_supplier_id bigint, p_kind text, p_assessed_on date, p_result text, p_notes text, p_next_assessment_on date
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_name text;
begin
  if not public.current_user_has_zkp_role(array['pelnomocnik', 'zastepca']) then
    raise exception 'Ocenę dostawcy (zał. 6.31) zapisuje Pełnomocnik ZKP lub Zastępca';
  end if;
  if not exists (select 1 from public.zkp_supplier_qualifications where supplier_id = p_supplier_id) then
    raise exception 'Najpierw dodaj dostawcę do wykazu (zakres, wymagany dokument jakości)';
  end if;
  select coalesce(nullif(full_name, ''), nullif(initials, ''), '') into v_name from public.profiles where id = auth.uid();
  insert into public.zkp_supplier_assessments
    (supplier_id, kind, assessed_on, result, notes, next_assessment_on, created_by, created_by_name)
  values
    (p_supplier_id, p_kind, coalesce(p_assessed_on, current_date), p_result, trim(coalesce(p_notes, '')),
     p_next_assessment_on, auth.uid(), coalesce(v_name, ''));
end;
$function$;

-- ── 3) Rejestr przyjęć komponentów krytycznych = partie (zał. 6.24) ──────
create table if not exists public.zkp_material_lots (
  id                     bigint generated always as identity primary key,
  received_on            date not null,
  supplier_id            bigint not null references public.suppliers(id) on delete restrict,
  delivery_doc           text not null check (length(trim(delivery_doc)) > 0),  -- nr WZ / faktury
  component_id           bigint not null references public.warehouse_components(id) on delete restrict,
  catalog_no             text not null default '',                              -- nr katalogowy / model
  quantity               numeric not null check (quantity > 0),
  lot_no                 text not null default '',
  quality_doc_kind       text not null default '',
  quality_doc_no         text not null default '',
  quality_doc_path       text,                                                  -- skan w bucket zkp-documents
  conforms_to_order      boolean not null,
  conforms_to_list_6105  boolean not null,
  condition_ok           boolean not null,
  condition_notes        text not null default '',
  decision               text not null check (decision in ('przyjeto', 'kwarantanna', 'zwrot')),
  decision_reason        text not null default '',
  pz_reference           text not null default '',                              -- powiązanie z PZ w magazynie
  qty_issued             numeric not null default 0 check (qty_issued >= 0),    -- wydania z partii (B4)
  source                 text not null default 'reczne' check (source in ('reczne', 'plik')),
  source_document_path   text,                                                  -- oryginał pliku przy imporcie
  received_by            uuid default auth.uid(),
  received_by_name       text not null default '',
  created_at             timestamptz not null default now(),
  decided_at             timestamptz,
  decided_by             uuid,
  decided_by_name        text not null default '',
  constraint zkp_material_lots_issued_le_qty check (qty_issued <= quantity)
);
create index if not exists zkp_material_lots_component_idx on public.zkp_material_lots (component_id);
create index if not exists zkp_material_lots_lot_idx on public.zkp_material_lots (lot_no);

-- Przyjęcie (magazyn / PJ). Reguły z briefu pkt 8:
--   * komponent musi być na liście krytycznych (zał. 6.10.5),
--   * dostawca z wykazu kwalifikowanych (zał. 6.31),
--   * brak nr partii lub dokumentu jakości (nr albo skan) = KWARANTANNA niezależnie od wyboru.
create or replace function public.zkp_register_receipt(
  p_received_on date, p_supplier_id bigint, p_delivery_doc text, p_component_id bigint,
  p_catalog_no text, p_quantity numeric, p_lot_no text, p_quality_doc_kind text, p_quality_doc_no text,
  p_quality_doc_path text, p_conforms_to_order boolean, p_conforms_to_list_6105 boolean,
  p_condition_ok boolean, p_condition_notes text, p_decision text, p_decision_reason text,
  p_pz_reference text, p_source text default 'reczne', p_source_document_path text default null
)
returns table(r_lot_id bigint, r_decision text, r_forced_quarantine boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_decision text := coalesce(p_decision, 'kwarantanna');
  v_forced   boolean := false;
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
    raise exception 'Dostawca spoza wykazu dostawców kwalifikowanych (zał. 6.31) — przyjęcie komponentu krytycznego niedozwolone';
  end if;
  if v_decision not in ('przyjeto', 'kwarantanna', 'zwrot') then
    raise exception 'Nieznana decyzja: %', v_decision;
  end if;

  -- brief pkt 8: brak nr partii lub dokumentu jakości = KWARANTANNA
  if v_decision = 'przyjeto'
     and (coalesce(trim(p_lot_no), '') = ''
          or (coalesce(trim(p_quality_doc_no), '') = '' and coalesce(p_quality_doc_path, '') = '')) then
    v_decision := 'kwarantanna';
    v_forced := true;
  end if;

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
    v_decision,
    case when v_forced then 'brak nr partii lub dokumentu jakości — kwarantanna (zał. 6.24)'
         else trim(coalesce(p_decision_reason, '')) end,
    trim(coalesce(p_pz_reference, '')), coalesce(p_source, 'reczne'), nullif(p_source_document_path, ''),
    auth.uid(), coalesce(v_name, ''), now(), auth.uid(), coalesce(v_name, '')
  ) returning id into v_id;

  return query select v_id, v_decision, v_forced;
end;
$function$;

-- Uzupełnienie nr partii / dokumentu jakości partii w kwarantannie (bez zwalniania).
create or replace function public.zkp_complete_lot(
  p_lot_id bigint, p_lot_no text, p_quality_doc_kind text, p_quality_doc_no text, p_quality_doc_path text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.current_user_has_zkp_role(array['magazyn', 'pelnomocnik', 'zastepca']) then
    raise exception 'Uzupełnić partię może magazyn (rola ZKP) albo Pełnomocnik / Zastępca';
  end if;
  update public.zkp_material_lots
  set lot_no = coalesce(nullif(trim(p_lot_no), ''), lot_no),
      quality_doc_kind = coalesce(nullif(trim(p_quality_doc_kind), ''), quality_doc_kind),
      quality_doc_no = coalesce(nullif(trim(p_quality_doc_no), ''), quality_doc_no),
      quality_doc_path = coalesce(nullif(p_quality_doc_path, ''), quality_doc_path)
  where id = p_lot_id and decision = 'kwarantanna';
  if not found then
    raise exception 'Uzupełniać można tylko partię w kwarantannie';
  end if;
end;
$function$;

-- Decyzja PJ o partii z kwarantanny: przyjęto (wymaga nr partii i dokumentu jakości) albo zwrot.
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

-- ── RLS: odczyt dla zalogowanych, zapis wyłącznie przez funkcje ──────────
alter table public.zkp_supplier_qualifications enable row level security;
alter table public.zkp_supplier_assessments    enable row level security;
alter table public.zkp_material_lots           enable row level security;
drop policy if exists zkp_supplier_qualifications_read on public.zkp_supplier_qualifications;
create policy zkp_supplier_qualifications_read on public.zkp_supplier_qualifications for select to authenticated using (true);
drop policy if exists zkp_supplier_assessments_read on public.zkp_supplier_assessments;
create policy zkp_supplier_assessments_read on public.zkp_supplier_assessments for select to authenticated using (true);
drop policy if exists zkp_material_lots_read on public.zkp_material_lots;
create policy zkp_material_lots_read on public.zkp_material_lots for select to authenticated using (true);

-- ── Audyt (pkt 10.1) ─────────────────────────────────────────────────────
drop trigger if exists audit_zkp_supplier_qualifications on public.zkp_supplier_qualifications;
create trigger audit_zkp_supplier_qualifications after insert or update or delete on public.zkp_supplier_qualifications
  for each row execute function public.audit_trigger_fn();
drop trigger if exists audit_zkp_supplier_assessments on public.zkp_supplier_assessments;
create trigger audit_zkp_supplier_assessments after insert or update or delete on public.zkp_supplier_assessments
  for each row execute function public.audit_trigger_fn();
drop trigger if exists audit_zkp_material_lots on public.zkp_material_lots;
create trigger audit_zkp_material_lots after insert or update or delete on public.zkp_material_lots
  for each row execute function public.audit_trigger_fn();

-- ── Uprawnienia do funkcji ───────────────────────────────────────────────
revoke all on function public.zkp_set_component_critical(bigint, text, text, text) from public, anon;
revoke all on function public.zkp_supplier_is_qualified(bigint) from public, anon;
revoke all on function public.zkp_upsert_supplier_qualification(bigint, text, boolean, text) from public, anon;
revoke all on function public.zkp_add_supplier_assessment(bigint, text, date, text, text, date) from public, anon;
revoke all on function public.zkp_register_receipt(date, bigint, text, bigint, text, numeric, text, text, text, text, boolean, boolean, boolean, text, text, text, text, text, text) from public, anon;
revoke all on function public.zkp_complete_lot(bigint, text, text, text, text) from public, anon;
revoke all on function public.zkp_decide_lot(bigint, text, text) from public, anon;
grant execute on function public.zkp_set_component_critical(bigint, text, text, text) to authenticated, service_role;
grant execute on function public.zkp_supplier_is_qualified(bigint) to authenticated, service_role;
grant execute on function public.zkp_upsert_supplier_qualification(bigint, text, boolean, text) to authenticated, service_role;
grant execute on function public.zkp_add_supplier_assessment(bigint, text, date, text, text, date) to authenticated, service_role;
grant execute on function public.zkp_register_receipt(date, bigint, text, bigint, text, numeric, text, text, text, text, boolean, boolean, boolean, text, text, text, text, text, text) to authenticated, service_role;
grant execute on function public.zkp_complete_lot(bigint, text, text, text, text) to authenticated, service_role;
grant execute on function public.zkp_decide_lot(bigint, text, text) to authenticated, service_role;

-- ── 4) Bucket na skany dokumentów jakości — bez kasowania (zał. 6.34) ────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('zkp-documents', 'zkp-documents', false, 20971520,
        array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

drop policy if exists zkp_documents_read on storage.objects;
create policy zkp_documents_read on storage.objects for select to authenticated
  using (bucket_id = 'zkp-documents');
drop policy if exists zkp_documents_insert on storage.objects;
create policy zkp_documents_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'zkp-documents'
              and public.current_user_has_zkp_role(array['magazyn', 'pelnomocnik', 'zastepca', 'kierownik_produkcji', 'kontroler']));

-- ── 5) Retencja: wszystkie tabele zkp_* przez 10 lat (zał. 6.34) ─────────
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
