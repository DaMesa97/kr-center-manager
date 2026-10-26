-- =====================================================================
-- ZKP AS 75EI — B3: TECZKA ZLECENIA (2026-10-26)
-- ZKP 5.9: dla każdego zlecenia przechowuje się przez 10 lat komplet dokumentów.
-- ZKP 5.1.6 / zał. 6.34: zapisy zabezpieczone przed utratą i nieuprawnioną zmianą,
-- bez twardego usuwania; nowa wersja = nowy plik; dokument można tylko wycofać z powodem.
--
-- 1) order_documents: WERSJE zamiast nadpisywania (koniec UNIQUE(order_id, kind)),
--    wycofanie z powodem, migawka autora; nowe rodzaje dokumentów.
-- 2) attach_order_document: dopisuje kolejną wersję i NIE zwraca starej ścieżki
--    (stare wersje aplikacji kasowały poprzedni plik — teraz nie mają czego).
-- 3) Brak DELETE/UPDATE na order_documents i na plikach w buckecie order-documents.
-- 4) „Nie dotyczy" w teczce — decyzja PJ / Zastępcy / KP z powodem (ZKP 5.3.2).
-- 5) Zlecenie ZKP = pozycja z systemem AS 75EI (rozpoznanie po nazwie systemu,
--    do potwierdzenia na próbce LP) albo ręczne oznaczenie kierownika.
-- 6) alu_dossier_status(order_id) — lista teczki „jest / brak / nie dotyczy".
-- 7) Blokada wydania zlecenia ZKP z niekompletną teczką (pkt 4 B3 briefu).
--
-- Wymaga: zkp_00, zkp_01. Bezpieczne do ponownego uruchomienia.
-- =====================================================================

-- ── 1) Wersje dokumentów ─────────────────────────────────────────────────
alter table public.order_documents add column if not exists version int not null default 1;
alter table public.order_documents add column if not exists uploaded_by_name text not null default '';
alter table public.order_documents add column if not exists withdrawn_at timestamptz;
alter table public.order_documents add column if not exists withdrawn_by uuid;
alter table public.order_documents add column if not exists withdraw_reason text;

alter table public.order_documents drop constraint if exists order_documents_order_id_kind_key;
create unique index if not exists order_documents_version_uq
  on public.order_documents (order_id, kind, version);

alter table public.order_documents drop constraint if exists order_documents_withdraw_check;
alter table public.order_documents add constraint order_documents_withdraw_check
  check (withdrawn_at is null or coalesce(trim(withdraw_reason), '') <> '');

-- ZK = zamówienie klienta, ZMAT = zamówienie materiałów (profile/okucia),
-- MONT = protokół montażu (zał. 6.28), INNE = pozostałe (ZKP 5.9)
alter table public.order_documents drop constraint if exists order_documents_kind_check;
alter table public.order_documents add constraint order_documents_kind_check
  check (kind in ('LP', 'LC', 'ZM', 'ZK', 'ZMAT', 'MONT', 'INNE'));

-- migawka autora istniejących wpisów (FK uploaded_by → profiles ON DELETE SET NULL gubi autora)
update public.order_documents d
set uploaded_by_name = coalesce(nullif(pr.full_name, ''), nullif(pr.initials, ''), '')
from public.profiles pr
where pr.id = d.uploaded_by and d.uploaded_by_name = '';

-- ── 2) Dopięcie dokumentu = nowa wersja ──────────────────────────────────
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

  if p_kind not in ('LP', 'LC', 'ZM', 'ZK', 'ZMAT', 'MONT', 'INNE') then
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

-- Wycofanie dokumentu z podaniem powodu (zamiast usuwania, zał. 6.34)
create or replace function public.withdraw_order_document(p_document_id bigint, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_doc record;
begin
  perform public.assert_manager_or_service();
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Podaj powód wycofania dokumentu';
  end if;
  select * into v_doc from public.order_documents where id = p_document_id for update;
  if not found then
    raise exception 'Dokument % nie istnieje', p_document_id;
  end if;
  if v_doc.withdrawn_at is not null then
    raise exception 'Dokument jest już wycofany';
  end if;
  update public.order_documents
  set withdrawn_at = now(), withdrawn_by = auth.uid(), withdraw_reason = trim(p_reason)
  where id = p_document_id;
end;
$function$;

revoke all on function public.withdraw_order_document(bigint, text) from public, anon;
grant execute on function public.withdraw_order_document(bigint, text) to authenticated, service_role;

-- ── 3) Bez kasowania i bez ręcznych zmian (pkt 10.4 briefu) ──────────────
drop policy if exists order_documents_delete_manager on public.order_documents;
drop policy if exists order_documents_update_manager on public.order_documents;
drop policy if exists order_documents_storage_delete on storage.objects;
drop policy if exists order_documents_storage_update on storage.objects;

-- ── 4) „Nie dotyczy" w teczce ────────────────────────────────────────────
create table if not exists public.zkp_dossier_na (
  id              bigint generated always as identity primary key,
  order_id        bigint not null references public.orders(id) on delete restrict,
  item_key        text not null check (item_key in ('zamowienie_klienta', 'zamowienia_materialow', 'protokol_montazu')),
  reason          text not null check (length(trim(reason)) >= 3),
  created_at      timestamptz not null default now(),
  created_by      uuid default auth.uid(),
  created_by_name text not null default '',
  withdrawn_at    timestamptz,
  withdrawn_by    uuid,
  withdraw_reason text
);
create unique index if not exists zkp_dossier_na_active_uq
  on public.zkp_dossier_na (order_id, item_key) where withdrawn_at is null;

alter table public.zkp_dossier_na enable row level security;
drop policy if exists zkp_dossier_na_read on public.zkp_dossier_na;
create policy zkp_dossier_na_read on public.zkp_dossier_na for select to authenticated using (true);

drop trigger if exists audit_zkp_dossier_na on public.zkp_dossier_na;
create trigger audit_zkp_dossier_na
  after insert or update or delete on public.zkp_dossier_na
  for each row execute function public.audit_trigger_fn();

-- ZKP 5.3.2: decyzję „nie dotyczy" podejmuje PJ, Zastępca albo Kierownik Produkcji
create or replace function public.set_dossier_na(p_order_id bigint, p_item_key text, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_name text;
begin
  if not public.current_user_has_zkp_role(array['pelnomocnik', 'zastepca', 'kierownik_produkcji']) then
    raise exception '„Nie dotyczy" w teczce zaznacza tylko Pełnomocnik ZKP, Zastępca albo Kierownik Produkcji';
  end if;
  select coalesce(nullif(pr.full_name, ''), nullif(pr.initials, ''), '')
  into v_name from public.profiles pr where pr.id = auth.uid();
  insert into public.zkp_dossier_na (order_id, item_key, reason, created_by, created_by_name)
  values (p_order_id, p_item_key, trim(coalesce(p_reason, '')), auth.uid(), coalesce(v_name, ''));
end;
$function$;

create or replace function public.revoke_dossier_na(p_na_id bigint, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.current_user_has_zkp_role(array['pelnomocnik', 'zastepca', 'kierownik_produkcji']) then
    raise exception 'Cofnąć „nie dotyczy" może tylko Pełnomocnik ZKP, Zastępca albo Kierownik Produkcji';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Podaj powód cofnięcia';
  end if;
  update public.zkp_dossier_na
  set withdrawn_at = now(), withdrawn_by = auth.uid(), withdraw_reason = trim(p_reason)
  where id = p_na_id and withdrawn_at is null;
  if not found then
    raise exception 'Brak aktywnego wpisu „nie dotyczy" %', p_na_id;
  end if;
end;
$function$;

revoke all on function public.set_dossier_na(bigint, text, text) from public, anon;
revoke all on function public.revoke_dossier_na(bigint, text) from public, anon;
grant execute on function public.set_dossier_na(bigint, text, text) to authenticated, service_role;
grant execute on function public.revoke_dossier_na(bigint, text) to authenticated, service_role;

-- ── 5) Zlecenie ZKP (AS 75EI) ────────────────────────────────────────────
-- Ręczne oznaczenie trzymane osobno (import nowej LP nadpisuje extra_fields.alu).
create table if not exists public.alu_zkp_override (
  order_id   bigint primary key references public.orders(id) on delete cascade,
  is_zkp     boolean not null,
  set_at     timestamptz not null default now(),
  set_by     uuid default auth.uid()
);
alter table public.alu_zkp_override enable row level security;
drop policy if exists alu_zkp_override_read on public.alu_zkp_override;
create policy alu_zkp_override_read on public.alu_zkp_override for select to authenticated using (true);
drop trigger if exists audit_alu_zkp_override on public.alu_zkp_override;
create trigger audit_alu_zkp_override
  after insert or update or delete on public.alu_zkp_override
  for each row execute function public.audit_trigger_fn();

-- Rozpoznanie: system pozycji zawiera „75EI" / „75 EI" (pkt 1.6 briefu — reguły ZKP tylko AS 75EI).
-- Do potwierdzenia na próbce LP AS 75EI; ręczne oznaczenie zawsze wygrywa.
create or replace function public.alu_order_is_zkp(p_order_id bigint)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (select o.is_zkp from public.alu_zkp_override o where o.order_id = p_order_id),
    exists (
      select 1 from public.order_alu_positions p
      where p.order_id = p_order_id and p.system ~* '75\s*-?\s*EI'
    )
  );
$$;

create or replace function public.set_alu_order_zkp(p_order_id bigint, p_is_zkp boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.assert_manager_or_service();
  if p_is_zkp is null then
    delete from public.alu_zkp_override where order_id = p_order_id;  -- powrót do rozpoznania automatycznego
  else
    insert into public.alu_zkp_override (order_id, is_zkp, set_by) values (p_order_id, p_is_zkp, auth.uid())
    on conflict (order_id) do update set is_zkp = excluded.is_zkp, set_at = now(), set_by = auth.uid();
  end if;
end;
$function$;

revoke all on function public.alu_order_is_zkp(bigint) from public, anon;
revoke all on function public.set_alu_order_zkp(bigint, boolean) from public, anon;
grant execute on function public.alu_order_is_zkp(bigint) to authenticated, service_role;
grant execute on function public.set_alu_order_zkp(bigint, boolean) to authenticated, service_role;

-- ── 6) Stan teczki (ZKP 5.9, tabela dokumentów z pkt B3 briefu) ──────────
-- status: jest / brak / nie_dotyczy. Pozycje generowane przez program w kolejnych
-- etapach (zlecenie produkcyjne, PZ, RW, karta, protokół, deklaracja) są na razie „brak".
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
    (4,  'zestawienie_materialowe', 'Zestawienie materiałowe (Lista produkcyjna)', array['LP'],       false, null),
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
    select c.* from cur c where c.kind = any(i.kinds) order by c.uploaded_at desc limit 1
  ) doc on true
  left join na n on n.item_key = i.key
  order by i.sort;
$$;

revoke all on function public.alu_dossier_status(bigint) from public, anon;
grant execute on function public.alu_dossier_status(bigint) to authenticated, service_role;

-- ── 7) Blokada wydania zlecenia ZKP z niekompletną teczką ────────────────
create or replace function public.alu_block_release_incomplete_dossier()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_missing text;
begin
  if not public.alu_order_is_zkp(new.id) then
    return new;
  end if;
  select string_agg(s.r_label, ', ' order by s.r_sort) into v_missing
  from public.alu_dossier_status(new.id) s
  where s.r_status = 'brak';
  if v_missing is not null then
    -- ZKP 5.9: zlecenia nie można zamknąć, jeśli brakuje wymaganego dokumentu
    raise exception 'Teczka zlecenia ZKP % niekompletna — brakuje: %', new.order_number, v_missing;
  end if;
  return new;
end;
$function$;

revoke all on function public.alu_block_release_incomplete_dossier() from public, anon, authenticated;

drop trigger if exists alu_block_release_incomplete_dossier on public.orders;
create trigger alu_block_release_incomplete_dossier
  before update of release_date on public.orders
  for each row
  when (new.category = 'Aluminium' and old.release_date is null and new.release_date is not null)
  execute function public.alu_block_release_incomplete_dossier();

-- retencja: nowe tabele ZKP też 10 lat (zał. 6.34)
create or replace function public.cleanup_old_logs()
returns void
language sql
security definer
set search_path to 'public'
as $$
  delete from audit_log
  where created_at < now() - interval '12 months'
    and table_name not in ('order_alu_positions', 'order_documents',
                           'alu_constructions', 'alu_production_orders',
                           'zkp_dossier_na', 'alu_zkp_override')
    and not (table_name = 'orders'
             and coalesce(new_data->>'category', old_data->>'category') = 'Aluminium');
  delete from forecast_runs where run_at < now() - interval '90 days';
  delete from api_request_logs where created_at < now() - interval '90 days';
$$;
revoke execute on function public.cleanup_old_logs() from public, anon, authenticated;
