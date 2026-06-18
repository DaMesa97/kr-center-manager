-- =====================================================================
-- ZGŁOSZENIA / UWAGI (beta) — lista bugów i pomysłów od zespołu
-- =====================================================================
-- Wklej całość do Supabase SQL editor i Run. Idempotentne.

create table if not exists public.feedback (
  id          bigint generated always as identity primary key,
  content     text not null,
  kind        text not null default 'bug',      -- bug / pomysl / inne
  page        text,                              -- ekran/kontekst (opcjonalnie)
  author_name text,
  author_id   uuid,
  status      text not null default 'nowe',      -- nowe / w toku / zrobione
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists feedback_status_idx on public.feedback (status, created_at desc);

alter table public.feedback enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename='feedback' and policyname='feedback_rw') then
    create policy feedback_rw on public.feedback
      for all to authenticated using (true) with check (true);
  end if;
end $$;

-- Realtime (żeby lista odświeżała się na żywo) — bezpiecznie idempotentnie
do $$
begin
  alter publication supabase_realtime add table public.feedback;
exception when duplicate_object then null;
end $$;
