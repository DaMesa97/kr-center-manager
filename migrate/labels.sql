-- =====================================================================
-- ETYKIETY — schemat (dynamiczne HTML + statyczne ZPL/DoP + drukarki ZPL)
-- =====================================================================
-- Wklej całość do Supabase SQL editor i Run. Idempotentne.

-- 1) Drukarki sieciowe Zebra (dla surowego ZPL po TCP) ----------------------
create table if not exists public.label_printers (
  id          bigint generated always as identity primary key,
  name        text not null,
  ip          text not null,
  port        int  not null default 9100,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now()
);

-- 2) Szablony etykiet dynamicznych (HTML per kategoria) ---------------------
create table if not exists public.label_templates (
  id          bigint generated always as identity primary key,
  category    text not null,            -- STA / Disting / ST / Bastion / DrzwiWewnetrzne
  name        text not null,
  html        text not null default '',
  width_mm    numeric not null default 100,
  height_mm   numeric not null default 50,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 3) Statyczne dokumenty ZPL (DoP/deklaracje) per kategoria -----------------
create table if not exists public.print_documents (
  id          bigint generated always as identity primary key,
  category    text not null,
  name        text not null,
  zpl_content text not null default '',
  created_at  timestamptz not null default now()
);

-- RLS: odczyt dla zalogowanych, zapis dla zalogowanych (UI i tak ogranicza do managera)
alter table public.label_printers   enable row level security;
alter table public.label_templates  enable row level security;
alter table public.print_documents  enable row level security;

do $$
begin
  -- label_printers
  if not exists (select 1 from pg_policies where tablename='label_printers' and policyname='label_printers_rw') then
    create policy label_printers_rw on public.label_printers
      for all to authenticated using (true) with check (true);
  end if;
  -- label_templates
  if not exists (select 1 from pg_policies where tablename='label_templates' and policyname='label_templates_rw') then
    create policy label_templates_rw on public.label_templates
      for all to authenticated using (true) with check (true);
  end if;
  -- print_documents
  if not exists (select 1 from pg_policies where tablename='print_documents' and policyname='print_documents_rw') then
    create policy print_documents_rw on public.print_documents
      for all to authenticated using (true) with check (true);
  end if;
end $$;
