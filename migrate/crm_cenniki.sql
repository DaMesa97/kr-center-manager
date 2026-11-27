-- CRM: cenniki producentów (27.11.2026, Tymek wybrał „wariant 2”: te same dane co skill wycena-drzwi, cenę liczy program).
-- Źródło prawdy = pliki CSV skilla (dane/kr-center/*.csv); import: scripts/cennik-import.mjs → SQL → konektor.
-- Nowa ulotka = nowe źródło (aktywny = true), stare wyłączone (aktywny = false), pozycje zostają do wglądu.
-- Wgrane konektorem jako migracja crm_cenniki.

create table if not exists crm.cennik_zrodla (
  id bigint generated always as identity primary key,
  producent text not null,
  nazwa text not null,
  edycja text,
  wazny_od date,
  aktywny boolean not null default true,
  uwagi text,
  created_at timestamptz not null default now(),
  unique (producent, nazwa)
);

create table if not exists crm.cennik_pozycje (
  id bigint generated always as identity primary key,
  zrodlo_id bigint not null references crm.cennik_zrodla (id) on delete cascade,
  producent text not null,
  kategoria text not null check (kategoria in ('skrzydlo', 'oscieznica', 'okucie', 'opcja', 'drzwi_zewnetrzne')),
  symbol text not null,
  okleina text,
  kolor text,
  dostepnosc text,
  wariant text,
  szerokosci text,
  mur_od_mm integer,
  mur_do_mm integer,
  netto numeric(12, 2),
  brutto numeric(12, 2),
  strona integer,
  uwaga text,
  atrybuty jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists cennik_pozycje_zrodlo_idx on crm.cennik_pozycje (zrodlo_id, kategoria);

alter table crm.cennik_zrodla enable row level security;
alter table crm.cennik_pozycje enable row level security;
-- czytać mogą osoby z dostępem do CRM; zapis tylko serwisowo (import konektorem, funkcje Edge)
drop policy if exists cennik_zrodla_select on crm.cennik_zrodla;
create policy cennik_zrodla_select on crm.cennik_zrodla for select to authenticated using (public.current_user_has_crm());
drop policy if exists cennik_pozycje_select on crm.cennik_pozycje;
create policy cennik_pozycje_select on crm.cennik_pozycje for select to authenticated using (public.current_user_has_crm());
grant select on crm.cennik_zrodla, crm.cennik_pozycje to authenticated;
grant all on crm.cennik_zrodla, crm.cennik_pozycje to service_role;

comment on table crm.cennik_zrodla is 'Cenniki producentów (ulotki, katalogi) — z plików skilla wycena-drzwi; crm-oferta-pdf liczy z nich pozycje bez ceny';
comment on table crm.cennik_pozycje is 'Pozycje cennika: skrzydła, ościeżnice, okucia, opcje; netto z ulotki (cena katalogowa dla klienta)';
