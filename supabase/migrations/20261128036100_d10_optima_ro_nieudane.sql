-- 28.11.2026, decyzja D10 (właściciel: TAK) — MR Profil, import RO: tabela nieudanych RO z ponawianiem.
-- Problem: optima-ro-import przy błędzie zapisu jednego RO dopisywał go tylko do last_result.bledy (20 ostatnich),
-- a kursor (optima_ro_sync_state.last_u_date) szedł dalej — RO przepadało bez śladu, dopóki ktoś go nie zmienił
-- w Optimie. Teraz:
--  - optima_ro_failures: jedno RO (baza + document_id) = jeden wpis; liczba prób, ostatni błąd, kopia dokumentu;
--  - Edge (repo, ta sama decyzja) na początku przebiegu ponawia otwarte wpisy: automatycznie do 5 prób, po
--    „Ponów” z Weryfikacji bez limitu; udany zapis zamyka wpis (resolved_how = 'zaimportowane');
--  - Weryfikacja → „Nieudane RO z Optimy” (kierownicy): „Ponów” (optima_ro_blad_ponow — oznacza i od razu
--    uruchamia import tej bazy przez istniejące optima_ro_import_run) i „Pomiń” (optima_ro_blad_pomin).
-- Zapisy tylko przez funkcje (Edge = service_role; aplikacja = rpc z kontrolą current_user_is_manager()).
-- Kolejność wdrożenia: najpierw ta migracja, potem Edge optima-ro-import (Edge bez migracji też działa — jak dawniej).
-- Można uruchamiać wielokrotnie.
-- DO WDROŻENIA (nie wgrane).

create table if not exists public.optima_ro_failures (
  id bigserial primary key,
  baza text not null check (baza in ('KR', 'MR')),
  document_id bigint not null,
  full_number text,
  error text,
  attempts integer not null default 1,
  first_failed_at timestamptz not null default now(),
  last_failed_at timestamptz not null default now(),
  retry_requested_at timestamptz,
  retry_requested_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  resolved_how text check (resolved_how in ('zaimportowane', 'pominiete')),
  resolved_by uuid references auth.users(id) on delete set null,
  doc jsonb,
  unique (baza, document_id)
);
comment on table public.optima_ro_failures is
  'D10: RO z Optimy (KR/MR), których import nie zapisał — do ponowienia (Edge optima-ro-import) i podglądu w Weryfikacji.';
create index if not exists optima_ro_failures_otwarte_idx on public.optima_ro_failures (baza, last_failed_at) where resolved_at is null;

alter table public.optima_ro_failures enable row level security;
revoke all on table public.optima_ro_failures from public, anon, authenticated;
grant select on table public.optima_ro_failures to authenticated;
revoke all on sequence public.optima_ro_failures_id_seq from public, anon, authenticated;

drop policy if exists optima_ro_failures_select on public.optima_ro_failures;
create policy optima_ro_failures_select on public.optima_ro_failures
  for select to authenticated using (public.current_user_is_manager());

-- Edge (service_role): zapis / zwiększenie liczby prób
create or replace function public.optima_ro_blad_zapisz(
  p_baza text, p_document_id bigint, p_full_number text, p_blad text, p_doc jsonb default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_baza not in ('KR', 'MR') or p_document_id is null then
    raise exception 'optima_ro_blad_zapisz: zła baza / brak document_id';
  end if;
  insert into optima_ro_failures as f (baza, document_id, full_number, error, doc)
  values (p_baza, p_document_id, p_full_number, left(p_blad, 1000), p_doc)
  on conflict (baza, document_id) do update set
    full_number = coalesce(excluded.full_number, f.full_number),
    error = excluded.error,
    doc = coalesce(excluded.doc, f.doc),
    -- wpis zamknięty i błąd od nowa → liczymy od początku
    attempts = case when f.resolved_at is null then f.attempts + 1 else 1 end,
    first_failed_at = case when f.resolved_at is null then f.first_failed_at else now() end,
    last_failed_at = now(),
    retry_requested_at = null,
    retry_requested_by = null,
    resolved_at = null, resolved_how = null, resolved_by = null;
end $$;

create or replace function public.optima_ro_blad_rozwiazany(p_baza text, p_document_id bigint)
returns void
language sql
security definer
set search_path to 'public'
as $$
  update optima_ro_failures
     set resolved_at = now(), resolved_how = 'zaimportowane', retry_requested_at = null
   where baza = p_baza and document_id = p_document_id and resolved_at is null;
$$;

revoke all on function public.optima_ro_blad_zapisz(text, bigint, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.optima_ro_blad_rozwiazany(text, bigint) from public, anon, authenticated;
grant execute on function public.optima_ro_blad_zapisz(text, bigint, text, text, jsonb) to service_role;
grant execute on function public.optima_ro_blad_rozwiazany(text, bigint) to service_role;

-- Aplikacja (Weryfikacja): „Ponów” — oznacza wpis i uruchamia import tej bazy (Edge ponawia oznaczone jako pierwsze)
create or replace function public.optima_ro_blad_ponow(p_id bigint)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_baza text;
begin
  if not current_user_is_manager() then
    raise exception 'Brak uprawnień do ponawiania importu RO' using errcode = '42501';
  end if;
  update optima_ro_failures
     set retry_requested_at = now(), retry_requested_by = auth.uid()
   where id = p_id and resolved_at is null
  returning baza into v_baza;
  if v_baza is null then
    raise exception 'Ten wpis jest już zamknięty albo nie istnieje — odśwież listę' using errcode = 'P0002';
  end if;
  -- ten sam mechanizm co przycisk „Importuj teraz” (pg_net → Edge optima-ro-import)
  return optima_ro_import_run(jsonb_build_object('baza', v_baza));
end $$;

-- „Pomiń” — RO nie do zaimportowania (np. anulowane w Optimie, błędny dokument)
create or replace function public.optima_ro_blad_pomin(p_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not current_user_is_manager() then
    raise exception 'Brak uprawnień' using errcode = '42501';
  end if;
  update optima_ro_failures
     set resolved_at = now(), resolved_how = 'pominiete', resolved_by = auth.uid(), retry_requested_at = null
   where id = p_id and resolved_at is null;
  if not found then
    raise exception 'Ten wpis jest już zamknięty albo nie istnieje — odśwież listę' using errcode = 'P0002';
  end if;
end $$;

revoke all on function public.optima_ro_blad_ponow(bigint) from public, anon;
revoke all on function public.optima_ro_blad_pomin(bigint) from public, anon;
grant execute on function public.optima_ro_blad_ponow(bigint) to authenticated, service_role;
grant execute on function public.optima_ro_blad_pomin(bigint) to authenticated, service_role;
